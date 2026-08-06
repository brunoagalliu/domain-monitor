const path = require('path');
const axios = require('axios');
const { pool } = require('../db');
const { uploadLander } = require('./cpanel');

const LANDERS_DIR = process.env.LANDERS_DIR || path.join(__dirname, '../landers');

async function fetchStream(apiKey, streamId) {
  const { data: list } = await axios.get(
    'https://api.redtrack.io/streams',
    { params: { api_key: apiKey, template: true, per: 500 }, timeout: 10000 }
  );
  const items = (list.items || list || []).map(s => ({ ...s, id: s.id || s._id }));
  return items.find(s => String(s.id) === String(streamId)) || null;
}

async function putStream(apiKey, streamId, stream) {
  await axios.put(
    `https://api.redtrack.io/streams/${streamId}`,
    stream,
    { params: { api_key: apiKey }, timeout: 10000 }
  );
}

async function rotateInStream(streamId, bannedLanderId, nextLanderId) {
  const apiKey = process.env.REDTRACK_API_KEY;
  if (!apiKey || !streamId || !nextLanderId) return;

  const stream = await fetchStream(apiKey, streamId);
  if (!stream) throw new Error(`Stream ${streamId} not found in RT`);

  const nextInStream = (stream.landings || []).find(l => String(l.id) === String(nextLanderId));
  if (!nextInStream) throw new Error(`Backup lander ${nextLanderId} not found in stream ${streamId} — add it to the funnel template first`);

  const updatedLandings = (stream.landings || [])
    .filter(l => !bannedLanderId || String(l.id) !== String(bannedLanderId))
    .map(l => String(l.id) === String(nextLanderId) ? { ...l, weight: 1000 } : { ...l, weight: 1 });

  await putStream(apiKey, streamId, { ...stream, landings: updatedLandings });
  console.log(`[rotator] RT stream ${streamId}: removed ${bannedLanderId}, ${nextLanderId} → weight 1000`);
}

async function removeFromStream(streamId, rtLanderId) {
  const apiKey = process.env.REDTRACK_API_KEY;
  if (!apiKey || !streamId || !rtLanderId) return;
  try {
    const stream = await fetchStream(apiKey, streamId);
    if (!stream) return;
    const remaining = (stream.landings || []).filter(l => String(l.id) !== String(rtLanderId));
    const patch = { ...stream, landings: remaining };
    if (remaining.length === 0) patch.direct = true;
    await putStream(apiKey, streamId, patch);
    console.log(`[rotator] RT stream ${streamId}: removed lander ${rtLanderId}`);
  } catch (err) {
    console.error(`[rotator] removeFromStream ${streamId} failed:`, err.message);
  }
}

async function ensureLanderInStream(streamId, rtLanderId, weight = 1) {
  const apiKey = process.env.REDTRACK_API_KEY;
  if (!apiKey || !streamId || !rtLanderId) return;

  try {
    const stream = await fetchStream(apiKey, streamId);
    if (!stream) return;

    const already = (stream.landings || []).find(l => String(l.id) === String(rtLanderId));
    if (already) return;

    const updatedLandings = [...(stream.landings || []), { id: rtLanderId, weight }];
    await putStream(apiKey, streamId, { ...stream, landings: updatedLandings });
    console.log(`[rotator] RT stream ${streamId}: added lander ${rtLanderId} at weight ${weight}`);
  } catch (err) {
    console.error('[rotator] ensureLanderInStream failed:', err.message);
  }
}

// Recompute domains.rotator_status from domain_funnels (active > standby > unassigned)
async function syncDomainStatus(client, domainId) {
  await client.query(`
    UPDATE domains SET rotator_status = COALESCE(
      (SELECT CASE WHEN bool_or(status = 'active') THEN 'active' ELSE 'standby' END
       FROM domain_funnels WHERE domain_id = $1),
      rotator_status  -- keep 'banned' or existing if no funnel rows
    )
    WHERE id = $1 AND rotator_status != 'banned'
  `, [domainId]);
}

async function rotate(bannedDomain, triggerSource = 'api') {
  // ── Phase 1: ban the domain + collect funnel memberships ─────────────────
  let fromDomain, memberships;
  {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [d] } = await client.query(
        `SELECT * FROM domains WHERE domain = $1 AND is_active = true`,
        [bannedDomain]
      );
      if (!d) throw new Error(`Domain not found: ${bannedDomain}`);
      if (d.rotator_status === 'banned') throw new Error(`Domain already banned: ${bannedDomain}`);
      fromDomain = d;

      // All funnel memberships before we delete them
      const { rows: m } = await client.query(
        `SELECT df.funnel_id, df.status, f.redtrack_stream_id, f.auto_rotate, f.name AS funnel_name
         FROM domain_funnels df
         JOIN funnels f ON f.id = df.funnel_id
         WHERE df.domain_id = $1`,
        [fromDomain.id]
      );
      memberships = m;

      // Fallback for domains not yet migrated to domain_funnels
      if (memberships.length === 0 && fromDomain.funnel_id) {
        const { rows: [f] } = await client.query(`SELECT * FROM funnels WHERE id = $1`, [fromDomain.funnel_id]);
        if (f) memberships = [{ funnel_id: fromDomain.funnel_id, status: fromDomain.rotator_status, redtrack_stream_id: f.redtrack_stream_id, auto_rotate: f.auto_rotate, funnel_name: f.name }];
      }

      // Ban globally
      await client.query(
        `UPDATE domains SET rotator_status = 'banned', banned_at = NOW() WHERE id = $1`,
        [fromDomain.id]
      );

      // Remove from all funnel memberships
      await client.query(`DELETE FROM domain_funnels WHERE domain_id = $1`, [fromDomain.id]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      pool.query(
        `INSERT INTO rotation_history (from_domain, to_domain, trigger_source, status, error)
         VALUES ($1, 'failed', $2, 'failed', $3)`,
        [bannedDomain, triggerSource, err.message]
      ).catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // If no funnel memberships, just log a simple ban
  if (memberships.length === 0) {
    await pool.query(
      `INSERT INTO rotation_history (from_domain, to_domain, trigger_source, status)
       VALUES ($1, 'N/A', $2, 'success')`,
      [bannedDomain, triggerSource]
    ).catch(() => {});
    return { fromDomain: bannedDomain, toDomain: null, action: 'banned_only', funnelsAffected: 0 };
  }

  // ── Phase 2: handle each funnel independently ─────────────────────────────
  const results = [];

  for (const membership of memberships) {
    if (membership.status !== 'active') {
      // Was standby in this funnel — just remove from RT stream
      await removeFromStream(membership.redtrack_stream_id, fromDomain.redtrack_lander_id);
      await pool.query(
        `INSERT INTO rotation_history (funnel_id, from_domain, to_domain, trigger_source, status)
         VALUES ($1, $2, 'N/A', $3, 'success')`,
        [membership.funnel_id, bannedDomain, triggerSource]
      ).catch(() => {});
      results.push({ funnelId: membership.funnel_id, funnelName: membership.funnel_name, action: 'standby_removed', toDomain: null });
      continue;
    }

    // Was active — find next standby in this funnel
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [nextDomain] } = await client.query(
        `SELECT d.* FROM domains d
         JOIN domain_funnels df ON df.domain_id = d.id
         WHERE df.funnel_id = $1
           AND df.status = 'standby'
           AND d.rotator_status != 'banned'
           AND d.is_active = true
         ORDER BY (d.redtrack_lander_id IS NOT NULL) DESC, d.rotator_priority DESC, d.created_at ASC
         LIMIT 1`,
        [membership.funnel_id]
      );

      if (!nextDomain) {
        await client.query(
          `INSERT INTO rotation_history (funnel_id, from_domain, to_domain, trigger_source, status, error)
           VALUES ($1, $2, 'direct_mode', $3, 'success', 'No standby — switched RT stream to direct offers')`,
          [membership.funnel_id, bannedDomain, triggerSource]
        );
        await client.query('COMMIT');

        if (membership.redtrack_stream_id) {
          try {
            const apiKey = process.env.REDTRACK_API_KEY;
            if (apiKey) {
              const stream = await fetchStream(apiKey, membership.redtrack_stream_id);
              if (stream) {
                const remaining = (stream.landings || []).filter(l => String(l.id) !== String(fromDomain.redtrack_lander_id));
                await putStream(apiKey, membership.redtrack_stream_id, { ...stream, landings: remaining, direct: true });
                console.log(`[rotator] No standby — RT stream ${membership.redtrack_stream_id} set to direct offers`);
              }
            }
          } catch (err) {
            console.error(`[rotator] Failed to switch stream to direct (funnel ${membership.funnel_id}):`, err.message);
          }
        }

        results.push({ funnelId: membership.funnel_id, funnelName: membership.funnel_name, action: 'direct_mode', toDomain: null, directMode: true });
        continue;
      }

      // Promote next domain to active in this funnel
      await client.query(
        `UPDATE domain_funnels SET status = 'active' WHERE domain_id = $1 AND funnel_id = $2`,
        [nextDomain.id, membership.funnel_id]
      );
      await syncDomainStatus(client, nextDomain.id);

      const { rows: [histRow] } = await client.query(
        `INSERT INTO rotation_history (funnel_id, from_domain, to_domain, trigger_source, status)
         VALUES ($1, $2, $3, $4, 'success') RETURNING id`,
        [membership.funnel_id, bannedDomain, nextDomain.domain, triggerSource]
      );

      await client.query('COMMIT');

      // Update RT stream
      let rtWarning = null;
      if (membership.redtrack_stream_id && nextDomain.redtrack_lander_id) {
        try {
          await rotateInStream(membership.redtrack_stream_id, fromDomain.redtrack_lander_id, nextDomain.redtrack_lander_id);
        } catch (err) {
          rtWarning = err.message;
          console.error(`[rotator] RT update failed for funnel ${membership.funnel_id}:`, err.message);
        }
      }

      results.push({ funnelId: membership.funnel_id, funnelName: membership.funnel_name, action: 'rotated', toDomain: nextDomain.domain, historyId: histRow?.id, rtWarning });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[rotator] Failed to rotate funnel ${membership.funnel_id}:`, err.message);
      results.push({ funnelId: membership.funnel_id, funnelName: membership.funnel_name, action: 'error', error: err.message });
    } finally {
      client.release();
    }
  }

  const primary = results.find(r => r.action === 'rotated') || results[0] || {};
  return {
    fromDomain: bannedDomain,
    toDomain: primary.toDomain || null,
    rtUpdated: results.some(r => r.action === 'rotated' && !r.rtWarning),
    rtWarning: results.find(r => r.rtWarning)?.rtWarning || null,
    directMode: results.some(r => r.directMode),
    funnelsAffected: memberships.length,
    results,
  };
}

module.exports = { rotate, ensureLanderInStream };
