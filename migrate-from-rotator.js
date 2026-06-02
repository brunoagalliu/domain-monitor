const { Pool } = require('pg');
require('dotenv').config();

async function migrateFromRotator() {
  const monitorPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const rotatorPool = new Pool({ connectionString: process.env.ROTATOR_DATABASE_URL });

  const mdb = await monitorPool.connect();
  const rdb = await rotatorPool.connect();
  const log = [];

  const step = msg => { console.log(msg); log.push(msg); };

  try {
    step('🔄 Starting migration from domain-rotator...');

    // ── Schema: new tables ────────────────────────────────────────────

    await mdb.query(`
      CREATE TABLE IF NOT EXISTS funnels (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        redtrack_stream_id TEXT,
        category VARCHAR(20) DEFAULT 'Auto',
        auto_rotate BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await mdb.query(`
      CREATE TABLE IF NOT EXISTS landers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        folder TEXT NOT NULL UNIQUE,
        category VARCHAR(20) DEFAULT 'Auto',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── Schema: new columns on domains ────────────────────────────────

    for (const sql of [
      `ALTER TABLE domains ADD COLUMN IF NOT EXISTS doc_root TEXT`,
      `ALTER TABLE domains ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'primary'`,
      `ALTER TABLE domains ADD COLUMN IF NOT EXISTS rotator_status VARCHAR(20) DEFAULT 'active'`,
      `ALTER TABLE domains ADD COLUMN IF NOT EXISTS rotator_priority INTEGER DEFAULT 0`,
      `ALTER TABLE domains ADD COLUMN IF NOT EXISTS funnel_id INTEGER REFERENCES funnels(id) ON DELETE SET NULL`,
      `ALTER TABLE domains ADD COLUMN IF NOT EXISTS lander_id INTEGER REFERENCES landers(id) ON DELETE SET NULL`,
    ]) await mdb.query(sql);

    await mdb.query(`
      CREATE TABLE IF NOT EXISTS domain_landers (
        id SERIAL PRIMARY KEY,
        domain_id INTEGER REFERENCES domains(id) ON DELETE CASCADE,
        lander_id INTEGER REFERENCES landers(id) ON DELETE CASCADE,
        sub_directory TEXT DEFAULT '',
        redtrack_lander_id TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await mdb.query(`
      CREATE TABLE IF NOT EXISTS funnel_offers (
        id SERIAL PRIMARY KEY,
        funnel_id INTEGER REFERENCES funnels(id) ON DELETE CASCADE,
        offer_name TEXT NOT NULL,
        weight INTEGER DEFAULT 100,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await mdb.query(`
      CREATE TABLE IF NOT EXISTS rotation_history (
        id SERIAL PRIMARY KEY,
        funnel_id INTEGER REFERENCES funnels(id) ON DELETE SET NULL,
        domain_id_from INTEGER,
        domain_id_to INTEGER,
        lander_id INTEGER,
        triggered_by TEXT DEFAULT 'auto',
        status TEXT DEFAULT 'success',
        error_msg TEXT,
        rotated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    step('✅ Schema ready');

    // ── Migrate funnels ───────────────────────────────────────────────

    const { rows: funnels } = await rdb.query('SELECT * FROM funnels ORDER BY id');
    const funnelMap = {};
    for (const f of funnels) {
      const { rows } = await mdb.query(
        `INSERT INTO funnels (name, redtrack_stream_id, category, auto_rotate, created_at)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [f.name, f.redtrack_stream_id, f.category || 'Auto', f.auto_rotate || false, f.created_at]
      );
      funnelMap[f.id] = rows[0].id;
    }
    step(`✅ Funnels: ${funnels.length}`);

    // ── Migrate landers ───────────────────────────────────────────────

    const { rows: landers } = await rdb.query('SELECT * FROM landers ORDER BY id');
    const landerMap = {};
    for (const l of landers) {
      try {
        const { rows } = await mdb.query(
          `INSERT INTO landers (name, folder, category, created_at)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [l.name, l.folder, l.category || 'Auto', l.created_at]
        );
        landerMap[l.id] = rows[0].id;
      } catch {
        // folder already exists — find it
        const { rows } = await mdb.query('SELECT id FROM landers WHERE folder=$1', [l.folder]);
        if (rows.length) landerMap[l.id] = rows[0].id;
      }
    }
    step(`✅ Landers: ${landers.length}`);

    // ── Migrate domains (merge with existing) ─────────────────────────

    const { rows: rotatorDomains } = await rdb.query('SELECT * FROM domains ORDER BY id');
    const domainMap = {};
    let updated = 0, inserted = 0;

    for (const d of rotatorDomains) {
      const newFunnelId = d.funnel_id ? (funnelMap[d.funnel_id] ?? null) : null;
      const newLanderId = d.lander_id ? (landerMap[d.lander_id] ?? null) : null;

      const { rows: existing } = await mdb.query(
        'SELECT id FROM domains WHERE domain=$1', [d.domain]
      );

      if (existing.length) {
        await mdb.query(
          `UPDATE domains SET
             doc_root=$1, role=$2, rotator_status=$3,
             rotator_priority=$4, funnel_id=$5, lander_id=$6
           WHERE domain=$7`,
          [d.doc_root, d.role || 'primary', d.status || 'active',
           d.priority || 0, newFunnelId, newLanderId, d.domain]
        );
        domainMap[d.id] = existing[0].id;
        updated++;
      } else {
        const { rows } = await mdb.query(
          `INSERT INTO domains
             (domain, notes, is_active, doc_root, role, rotator_status, rotator_priority, funnel_id, lander_id)
           VALUES ($1,$2,true,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [d.domain, d.notes || '', d.doc_root, d.role || 'primary',
           d.status || 'active', d.priority || 0, newFunnelId, newLanderId]
        );
        domainMap[d.id] = rows[0].id;
        inserted++;
      }
    }
    step(`✅ Domains: ${updated} updated, ${inserted} inserted`);

    // ── Migrate domain_landers ────────────────────────────────────────

    const { rows: domainLanders } = await rdb.query('SELECT * FROM domain_landers ORDER BY id');
    let dlCount = 0;
    for (const dl of domainLanders) {
      const newDomainId = domainMap[dl.domain_id];
      const newLanderId = landerMap[dl.lander_id];
      if (!newDomainId || !newLanderId) continue;
      await mdb.query(
        `INSERT INTO domain_landers (domain_id, lander_id, sub_directory, redtrack_lander_id, created_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [newDomainId, newLanderId, dl.sub_directory || '', dl.redtrack_lander_id, dl.created_at]
      );
      dlCount++;
    }
    step(`✅ Domain-landers: ${dlCount}`);

    // ── Migrate funnel_offers ─────────────────────────────────────────

    const { rows: offers } = await rdb.query('SELECT * FROM funnel_offers ORDER BY id');
    let offerCount = 0;
    for (const o of offers) {
      const newFunnelId = funnelMap[o.funnel_id];
      if (!newFunnelId) continue;
      await mdb.query(
        `INSERT INTO funnel_offers (funnel_id, offer_name, weight, created_at)
         VALUES ($1,$2,$3,$4)`,
        [newFunnelId, o.offer_name, o.weight || 100, o.created_at]
      );
      offerCount++;
    }
    step(`✅ Funnel offers: ${offerCount}`);

    // ── Migrate rotation_history ──────────────────────────────────────

    const { rows: history } = await rdb.query('SELECT * FROM rotation_history ORDER BY id');
    let histCount = 0;
    for (const h of history) {
      await mdb.query(
        `INSERT INTO rotation_history
           (funnel_id, domain_id_from, domain_id_to, lander_id, triggered_by, status, error_msg, rotated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          h.funnel_id    ? (funnelMap[h.funnel_id]       ?? null) : null,
          h.domain_id_from ? (domainMap[h.domain_id_from] ?? null) : null,
          h.domain_id_to   ? (domainMap[h.domain_id_to]   ?? null) : null,
          h.lander_id    ? (landerMap[h.lander_id]       ?? null) : null,
          h.triggered_by || 'auto',
          h.status       || 'success',
          h.error_msg,
          h.rotated_at
        ]
      );
      histCount++;
    }
    step(`✅ Rotation history: ${histCount}`);

    step('🎉 Migration complete!');
    return { ok: true, log };
  } catch (err) {
    step(`❌ Error: ${err.message}`);
    throw err;
  } finally {
    mdb.release();
    rdb.release();
    await monitorPool.end();
    await rotatorPool.end();
  }
}

module.exports = { migrateFromRotator };

if (require.main === module) {
  migrateFromRotator()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
