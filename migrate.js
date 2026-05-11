const db = require('./db');
require('dotenv').config();

async function migrate() {
  console.log('🚀 Running database migrations...\n');

  const migrations = [
    {
      name: 'Purge: delete scan_results older than 7 days (one-time bulk cleanup)',
      sql: `DELETE FROM scan_results WHERE scan_date < DATE_SUB(NOW(), INTERVAL 7 DAY)`
    },
    {
      name: 'Index: scan_results(domain_id, id) — fast latest-scan-per-domain lookup',
      sql: `ALTER TABLE scan_results ADD INDEX IF NOT EXISTS idx_domain_id (domain_id, id DESC)`
    },
    {
      name: 'Index: scan_results(scan_date) — fast recent scans list',
      sql: `ALTER TABLE scan_results ADD INDEX IF NOT EXISTS idx_scan_date (scan_date DESC)`
    },
    {
      name: 'Index: domains(is_active) — fast active domain filter',
      sql: `ALTER TABLE domains ADD INDEX IF NOT EXISTS idx_is_active (is_active)`
    },
    {
      name: 'Drop column: scan_results.raw_response — redundant data',
      sql: `ALTER TABLE scan_results DROP COLUMN IF EXISTS raw_response`
    },
    {
      name: 'Add column: domains.is_flagged — persistent flagged state',
      sql: `ALTER TABLE domains ADD COLUMN IF NOT EXISTS is_flagged TINYINT(1) NOT NULL DEFAULT 0`
    }
  ];

  for (const m of migrations) {
    try {
      const [result] = await db.execute(m.sql);
      const extra = result.affectedRows > 0 ? ` (${result.affectedRows} rows affected)` : '';
      console.log(`✅ ${m.name}${extra}`);
    } catch (err) {
      // IF NOT EXISTS / IF EXISTS not supported in older MySQL — handle gracefully
      if (err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_CANT_DROP_FIELD_OR_KEY') {
        console.log(`⏭️  Already applied: ${m.name}`);
      } else {
        console.error(`❌ Failed: ${m.name}`);
        console.error(`   ${err.message}`);
      }
    }
  }

  console.log('\n✨ Migration complete.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
