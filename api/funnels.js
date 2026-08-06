const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

function auth(req, res, next) {
  if (!requireAuth(req, res)) return;
  next();
}

router.use(auth);

// List funnels with domain/offer counts
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        f.*,
        COUNT(DISTINCT df.domain_id) AS domain_count,
        COUNT(DISTINCT df.domain_id) FILTER (WHERE df.status = 'active') AS is_active,
        COUNT(DISTINCT df.domain_id) FILTER (WHERE df.status = 'standby') AS standby_count,
        COUNT(DISTINCT fo.id) AS offer_count
      FROM funnels f
      LEFT JOIN domain_funnels df ON df.funnel_id = f.id
      LEFT JOIN funnel_offers fo ON fo.funnel_id = f.id
      GROUP BY f.id
      ORDER BY f.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single funnel with domains + offers
router.get('/:id', async (req, res) => {
  try {
    const { rows: [funnel] } = await pool.query(`SELECT * FROM funnels WHERE id = $1`, [req.params.id]);
    if (!funnel) return res.status(404).json({ message: 'Not found.' });

    const { rows: domains } = await pool.query(
      `SELECT d.*,
         df.status,
         d.rotator_priority AS priority,
         df.created_at AS added_at
       FROM domains d
       JOIN domain_funnels df ON df.domain_id = d.id AND df.funnel_id = $1
       WHERE d.is_active = true
       ORDER BY df.status = 'active' DESC, d.rotator_priority DESC, df.created_at ASC`,
      [req.params.id]
    );
    const { rows: offers } = await pool.query(
      `SELECT * FROM funnel_offers WHERE funnel_id = $1 ORDER BY created_at ASC`,
      [req.params.id]
    );

    res.json({ ...funnel, domains, offers });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create funnel
router.post('/', async (req, res) => {
  const { name, redtrack_stream_id } = req.body;
  if (!name) return res.status(400).json({ message: 'name is required.' });
  try {
    const { rows: [funnel] } = await pool.query(
      `INSERT INTO funnels (name, redtrack_stream_id) VALUES ($1, $2) RETURNING *`,
      [name.trim(), redtrack_stream_id || null]
    );
    res.status(201).json(funnel);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get or create a funnel linked to a RedTrack stream
router.post('/by-stream', async (req, res) => {
  const { redtrack_stream_id, title } = req.body;
  if (!redtrack_stream_id) return res.status(400).json({ message: 'redtrack_stream_id is required.' });
  try {
    const { rows: [funnel] } = await pool.query(
      `INSERT INTO funnels (name, redtrack_stream_id)
       VALUES ($1, $2)
       ON CONFLICT (redtrack_stream_id) WHERE redtrack_stream_id IS NOT NULL DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [title || redtrack_stream_id, redtrack_stream_id]
    );
    res.json(funnel);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update funnel
router.patch('/:id', async (req, res) => {
  const { name, redtrack_stream_id, category, auto_rotate } = req.body;
  const fields = [];
  const values = [];
  if (name !== undefined)               { fields.push(`name = $${fields.length + 1}`);               values.push(name || null); }
  if (redtrack_stream_id !== undefined) { fields.push(`redtrack_stream_id = $${fields.length + 1}`); values.push(redtrack_stream_id || null); }
  if (category !== undefined)           { fields.push(`category = $${fields.length + 1}`);           values.push(category || null); }
  if (auto_rotate !== undefined)        { fields.push(`auto_rotate = $${fields.length + 1}`);        values.push(Boolean(auto_rotate)); }
  if (req.body.browser_scan !== undefined) { fields.push(`browser_scan = $${fields.length + 1}`); values.push(Boolean(req.body.browser_scan)); }
  if (fields.length === 0) return res.status(400).json({ message: 'No fields to update.' });
  values.push(req.params.id);
  try {
    const { rows: [funnel] } = await pool.query(
      `UPDATE funnels SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (!funnel) return res.status(404).json({ message: 'Not found.' });
    res.json(funnel);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete funnel
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM funnels WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Adjust RT lander weight in stream
router.patch('/:id/lander-weight', async (req, res) => {
  const axios = require('axios');
  const { rt_lander_id, weight } = req.body;
  if (!rt_lander_id || weight == null) return res.status(400).json({ message: 'rt_lander_id and weight required.' });
  try {
    const { rows: [funnel] } = await pool.query(`SELECT * FROM funnels WHERE id = $1`, [req.params.id]);
    if (!funnel) return res.status(404).json({ message: 'Funnel not found.' });
    if (!funnel.redtrack_stream_id) return res.status(400).json({ message: 'Funnel not linked to RT stream.' });

    const apiKey = process.env.REDTRACK_API_KEY;
    if (!apiKey) return res.status(500).json({ message: 'REDTRACK_API_KEY not configured.' });

    const { data: list } = await axios.get('https://api.redtrack.io/streams', {
      params: { api_key: apiKey, template: true, per: 500 }, timeout: 10000,
    });
    const items = (list.items || list || []).map(s => ({ ...s, id: s.id || s._id }));
    const stream = items.find(s => String(s.id) === String(funnel.redtrack_stream_id));
    if (!stream) return res.status(404).json({ message: 'RT stream not found.' });

    const { rows: [banned] } = await pool.query(
      `SELECT id FROM domains WHERE redtrack_lander_id = $1 AND rotator_status = 'banned' LIMIT 1`,
      [String(rt_lander_id)]
    );
    if (banned) return res.status(400).json({ message: 'Domain is banned — remove it from the stream instead.' });

    const updatedLandings = (stream.landings || []).map(l =>
      String(l.id) === String(rt_lander_id) ? { ...l, weight: Number(weight) } : l
    );

    await axios.put(
      `https://api.redtrack.io/streams/${funnel.redtrack_stream_id}`,
      { ...stream, landings: updatedLandings },
      { params: { api_key: apiKey }, timeout: 10000 }
    );

    const newStatus = Number(weight) >= 1000 ? 'active' : 'standby';
    await pool.query(
      `UPDATE domains SET rotator_status = $1
       WHERE redtrack_lander_id = $2 AND funnel_id = $3 AND rotator_status != 'banned'`,
      [newStatus, String(rt_lander_id), req.params.id]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.response?.data?.error || err.message });
  }
});

// Sync domain statuses from RT stream weights
router.post('/:id/sync-from-rt', async (req, res) => {
  const axios = require('axios');
  try {
    const { rows: [funnel] } = await pool.query(`SELECT * FROM funnels WHERE id = $1`, [req.params.id]);
    if (!funnel?.redtrack_stream_id) return res.status(404).json({ message: 'Funnel or stream not found.' });

    const apiKey = process.env.REDTRACK_API_KEY;
    if (!apiKey) return res.status(500).json({ message: 'REDTRACK_API_KEY not configured.' });

    const { data: list } = await axios.get('https://api.redtrack.io/streams', {
      params: { api_key: apiKey, template: true, per: 500 }, timeout: 10000,
    });
    const items = (list.items || list || []).map(s => ({ ...s, id: s.id || s._id }));
    const stream = items.find(s => String(s.id) === String(funnel.redtrack_stream_id));
    if (!stream) return res.status(404).json({ message: 'RT stream not found.' });

    let updated = 0;
    for (const l of (stream.landings || [])) {
      const newStatus = l.weight >= 1000 ? 'active' : 'standby';

      // Update domain_funnels (source of truth for per-funnel status)
      const { rowCount: dfRows } = await pool.query(
        `UPDATE domain_funnels df SET status = $1
         FROM domains d
         WHERE df.domain_id = d.id
           AND df.funnel_id = $3
           AND d.redtrack_lander_id = $2
           AND d.rotator_status != 'banned'`,
        [newStatus, String(l.id), req.params.id]
      );

      // Keep domains.rotator_status in sync
      await pool.query(
        `UPDATE domains SET rotator_status = $1
         WHERE redtrack_lander_id = $2 AND rotator_status != 'banned'
           AND EXISTS (SELECT 1 FROM domain_funnels df WHERE df.domain_id = domains.id AND df.funnel_id = $3)`,
        [newStatus, String(l.id), req.params.id]
      );

      updated += dfRows;
    }
    res.json({ ok: true, updated });
  } catch (err) {
    res.status(500).json({ message: err.response?.data?.error || err.message });
  }
});

// Add lander to RT stream at weight 1
router.post('/:id/stream-lander', async (req, res) => {
  const axios = require('axios');
  const { rt_lander_id } = req.body;
  if (!rt_lander_id) return res.status(400).json({ message: 'rt_lander_id is required.' });
  try {
    const { rows: [funnel] } = await pool.query(`SELECT * FROM funnels WHERE id = $1`, [req.params.id]);
    if (!funnel?.redtrack_stream_id) return res.status(404).json({ message: 'Funnel or stream not found.' });

    const apiKey = process.env.REDTRACK_API_KEY;
    if (!apiKey) return res.status(500).json({ message: 'REDTRACK_API_KEY not configured.' });

    const { data: list } = await axios.get('https://api.redtrack.io/streams', {
      params: { api_key: apiKey, template: true, per: 500 }, timeout: 10000,
    });
    const items = (list.items || list || []).map(s => ({ ...s, id: s.id || s._id }));
    const stream = items.find(s => String(s.id) === String(funnel.redtrack_stream_id));
    if (!stream) return res.status(404).json({ message: 'RT stream not found.' });

    const already = (stream.landings || []).find(l => String(l.id) === String(rt_lander_id));
    if (already) return res.json({ ok: true, already_present: true });

    const updatedLandings = [...(stream.landings || []), { id: rt_lander_id, weight: 1 }];
    await axios.put(
      `https://api.redtrack.io/streams/${funnel.redtrack_stream_id}`,
      { ...stream, landings: updatedLandings, direct: false },
      { params: { api_key: apiKey }, timeout: 10000 }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.response?.data?.error || err.message });
  }
});

// Remove lander from RT stream
router.delete('/:id/stream-lander/:rtLanderId', async (req, res) => {
  const axios = require('axios');
  try {
    const { rows: [funnel] } = await pool.query(`SELECT * FROM funnels WHERE id = $1`, [req.params.id]);
    if (!funnel?.redtrack_stream_id) return res.status(404).json({ message: 'Funnel or stream not found.' });

    const apiKey = process.env.REDTRACK_API_KEY;
    if (!apiKey) return res.status(500).json({ message: 'REDTRACK_API_KEY not configured.' });

    const { data: list } = await axios.get('https://api.redtrack.io/streams', {
      params: { api_key: apiKey, template: true, per: 500 }, timeout: 10000,
    });
    const items = (list.items || list || []).map(s => ({ ...s, id: s.id || s._id }));
    const stream = items.find(s => String(s.id) === String(funnel.redtrack_stream_id));
    if (!stream) return res.status(404).json({ message: 'RT stream not found.' });

    const updatedLandings = (stream.landings || []).filter(
      l => String(l.id) !== String(req.params.rtLanderId)
    );
    const patch = { ...stream, landings: updatedLandings };
    if (updatedLandings.length === 0) patch.direct = true;

    await axios.put(
      `https://api.redtrack.io/streams/${funnel.redtrack_stream_id}`,
      patch,
      { params: { api_key: apiKey }, timeout: 10000 }
    );
    res.json({ ok: true, direct: updatedLandings.length === 0 });
  } catch (err) {
    res.status(500).json({ message: err.response?.data?.error || err.message });
  }
});

// Add domain to funnel pool (many-to-many)
router.post('/:id/domains', async (req, res) => {
  const { domain_id, redtrack_lander_id } = req.body;
  if (!domain_id) return res.status(400).json({ message: 'domain_id is required.' });
  try {
    const funnelId = parseInt(req.params.id);
    await pool.query(
      `INSERT INTO domain_funnels (domain_id, funnel_id, status)
       VALUES ($1, $2, 'standby')
       ON CONFLICT (domain_id, funnel_id) DO NOTHING`,
      [domain_id, funnelId]
    );
    // Keep domains.rotator_status in sync (standby if not already active/banned)
    await pool.query(
      `UPDATE domains SET rotator_status = 'standby', funnel_id = $2
       WHERE id = $1 AND rotator_status NOT IN ('active', 'banned')`,
      [domain_id, funnelId]
    );
    // If RT lander ID supplied, add to stream at standby weight
    if (redtrack_lander_id) {
      const { rows: [funnel] } = await pool.query(`SELECT * FROM funnels WHERE id = $1`, [funnelId]);
      if (funnel?.redtrack_stream_id) {
        const { ensureLanderInStream } = require('../lib/rotator');
        ensureLanderInStream(funnel.redtrack_stream_id, redtrack_lander_id, 1).catch(() => {});
      }
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Remove domain from funnel pool (does NOT ban — domain stays in system)
router.delete('/:id/domains/:domainId', async (req, res) => {
  try {
    const funnelId  = parseInt(req.params.id);
    const domainId  = parseInt(req.params.domainId);

    // Get domain's RT lander ID and funnel's stream ID before deletion
    const { rows: [info] } = await pool.query(
      `SELECT d.redtrack_lander_id, f.redtrack_stream_id
       FROM domains d, funnels f
       WHERE d.id = $1 AND f.id = $2`,
      [domainId, funnelId]
    );

    await pool.query(
      `DELETE FROM domain_funnels WHERE domain_id = $1 AND funnel_id = $2`,
      [domainId, funnelId]
    );

    // If domain is no longer in ANY funnel, set global status to standby
    const { rows: remaining } = await pool.query(
      `SELECT 1 FROM domain_funnels WHERE domain_id = $1 LIMIT 1`,
      [domainId]
    );
    if (remaining.length === 0) {
      await pool.query(
        `UPDATE domains SET rotator_status = 'standby' WHERE id = $1 AND rotator_status != 'banned'`,
        [domainId]
      );
    }

    // Remove from RT stream
    if (info?.redtrack_lander_id && info?.redtrack_stream_id) {
      const { ensureLanderInStream: _, ...rotatorMod } = require('../lib/rotator');
      const stream = require('../lib/rotator');
      // Just fire and forget removal from RT stream
      const axios = require('axios');
      const apiKey = process.env.REDTRACK_API_KEY;
      if (apiKey) {
        axios.get('https://api.redtrack.io/streams', { params: { api_key: apiKey, template: true, per: 500 }, timeout: 10000 })
          .then(({ data: list }) => {
            const items = (list.items || list || []).map(s => ({ ...s, id: s.id || s._id }));
            const st = items.find(s => String(s.id) === String(info.redtrack_stream_id));
            if (!st) return;
            const remaining = (st.landings || []).filter(l => String(l.id) !== String(info.redtrack_lander_id));
            return axios.put(`https://api.redtrack.io/streams/${info.redtrack_stream_id}`, { ...st, landings: remaining }, { params: { api_key: apiKey }, timeout: 10000 });
          })
          .catch(err => console.error('[funnels] RT stream cleanup failed:', err.message));
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add offer to funnel
router.post('/:id/offers', async (req, res) => {
  const { redtrack_offer_id, offer_title, weight = 100 } = req.body;
  if (!redtrack_offer_id || !offer_title) {
    return res.status(400).json({ message: 'redtrack_offer_id and offer_title are required.' });
  }
  try {
    const { rows: [offer] } = await pool.query(
      `INSERT INTO funnel_offers (funnel_id, redtrack_offer_id, offer_title, weight)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, redtrack_offer_id, offer_title, weight]
    );
    res.status(201).json(offer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
