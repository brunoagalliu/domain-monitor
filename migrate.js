const { execute } = require('./db');
require('dotenv').config();

async function migrate() {
  console.log('🚀 Running database migrations...\n');

  const migrations = [
    {
      name: 'Create categories table',
      sql: `
        CREATE TABLE IF NOT EXISTS categories (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          color VARCHAR(7) DEFAULT '#667eea',
          created_at TIMESTAMP DEFAULT NOW()
        )
      `
    },
    {
      name: 'Create domains table',
      sql: `
        CREATE TABLE IF NOT EXISTS domains (
          id SERIAL PRIMARY KEY,
          domain VARCHAR(255) NOT NULL UNIQUE,
          notes TEXT DEFAULT '',
          category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
          is_active BOOLEAN DEFAULT true,
          is_flagged BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `
    },
    {
      name: 'Create scan_results table',
      sql: `
        CREATE TABLE IF NOT EXISTS scan_results (
          id SERIAL PRIMARY KEY,
          domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
          is_safe BOOLEAN NOT NULL,
          threat_types TEXT,
          platform_types TEXT,
          threat_entry_types TEXT,
          scan_date TIMESTAMP DEFAULT NOW()
        )
      `
    },
    {
      name: 'Index: scan_results(domain_id, id)',
      sql: `CREATE INDEX IF NOT EXISTS idx_scan_results_domain_id ON scan_results (domain_id, id DESC)`
    },
    {
      name: 'Index: scan_results(scan_date)',
      sql: `CREATE INDEX IF NOT EXISTS idx_scan_results_scan_date ON scan_results (scan_date DESC)`
    },
    {
      name: 'Index: domains(is_active)',
      sql: `CREATE INDEX IF NOT EXISTS idx_domains_is_active ON domains (is_active)`
    }
  ];

  for (const m of migrations) {
    try {
      await execute(m.sql);
      console.log(`✅ ${m.name}`);
    } catch (err) {
      console.error(`❌ Failed: ${m.name}`);
      console.error(`   ${err.message}`);
    }
  }

  console.log('\n✨ Migration complete.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
