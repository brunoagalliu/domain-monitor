const db = require('../db');
const { requireAuth } = require('../lib/auth');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (!requireAuth(req, res)) return;

  const migrations = [
    {
      name: 'scan_results(domain_id, id) index',
      sql: `ALTER TABLE scan_results ADD INDEX IF NOT EXISTS idx_domain_id (domain_id, id DESC)`
    },
    {
      name: 'scan_results(scan_date) index',
      sql: `ALTER TABLE scan_results ADD INDEX IF NOT EXISTS idx_scan_date (scan_date DESC)`
    },
    {
      name: 'domains(is_active) index',
      sql: `ALTER TABLE domains ADD INDEX IF NOT EXISTS idx_is_active (is_active)`
    },
    {
      name: 'Drop scan_results.raw_response',
      sql: `ALTER TABLE scan_results DROP COLUMN IF EXISTS raw_response`
    },
    {
      name: 'Add domains.is_flagged',
      sql: `ALTER TABLE domains ADD COLUMN IF NOT EXISTS is_flagged TINYINT(1) NOT NULL DEFAULT 0`
    }
  ];

  const results = [];

  for (const m of migrations) {
    try {
      await db.execute(m.sql);
      results.push({ name: m.name, status: 'applied' });
    } catch (err) {
      if (err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_CANT_DROP_FIELD_OR_KEY') {
        results.push({ name: m.name, status: 'already applied' });
      } else {
        results.push({ name: m.name, status: 'error', error: err.message });
      }
    }
  }

  return res.status(200).json({ migrations: results });
};
