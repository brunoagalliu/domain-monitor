const { execute } = require('./db');
require('dotenv').config();

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
  },
  {
    name: 'Add is_suspicious to domains',
    sql: `ALTER TABLE domains ADD COLUMN IF NOT EXISTS is_suspicious BOOLEAN DEFAULT false`
  },
  {
    name: 'Index: domains(is_flagged) partial',
    sql: `CREATE INDEX IF NOT EXISTS idx_domains_is_flagged ON domains (is_flagged) WHERE is_active = true`
  },
  {
    name: 'Index: domains(is_suspicious) partial',
    sql: `CREATE INDEX IF NOT EXISTS idx_domains_is_suspicious ON domains (is_suspicious) WHERE is_active = true`
  },
  {
    name: 'Add browser_status to domains',
    sql: `ALTER TABLE domains ADD COLUMN IF NOT EXISTS browser_status VARCHAR(20) DEFAULT NULL`
  },
  {
    name: 'Add browser_redirect_target to domains',
    sql: `ALTER TABLE domains ADD COLUMN IF NOT EXISTS browser_redirect_target VARCHAR(500) DEFAULT NULL`
  },
  {
    name: 'Add last_browser_check to domains',
    sql: `ALTER TABLE domains ADD COLUMN IF NOT EXISTS last_browser_check TIMESTAMP DEFAULT NULL`
  },
  {
    name: 'Index: domains(browser_status) partial',
    sql: `CREATE INDEX IF NOT EXISTS idx_domains_browser_status ON domains (browser_status) WHERE is_active = true AND browser_status IS NOT NULL`
  },
  {
    name: 'Create threat_lists table',
    sql: `
      CREATE TABLE IF NOT EXISTS threat_lists (
        list_key VARCHAR(100) PRIMARY KEY,
        state_token TEXT DEFAULT '',
        prefixes_b64 TEXT DEFAULT '',
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `
  },
  {
    name: 'create flag_logs table',
    sql: `
      CREATE TABLE IF NOT EXISTS flag_logs (
        id SERIAL PRIMARY KEY,
        domain TEXT NOT NULL,
        category TEXT,
        method TEXT NOT NULL,
        threat_type TEXT,
        detected_at TIMESTAMP DEFAULT NOW()
      )
    `
  },
  {
    name: 'Add is_priority to domains',
    sql: `ALTER TABLE domains ADD COLUMN IF NOT EXISTS is_priority BOOLEAN DEFAULT false`
  },
  {
    name: 'Add scan_suspended to domains',
    sql: `ALTER TABLE domains ADD COLUMN IF NOT EXISTS scan_suspended BOOLEAN DEFAULT false`
  },
  {
    name: 'Add lookup_flagged to domains',
    sql: `ALTER TABLE domains ADD COLUMN IF NOT EXISTS lookup_flagged BOOLEAN DEFAULT false`
  },
  {
    name: 'Index: domains(is_priority) partial',
    sql: `CREATE INDEX IF NOT EXISTS idx_domains_is_priority ON domains (is_priority) WHERE is_active = true AND is_priority = true`
  }
];

async function runMigration() {
  const results = [];
  for (const m of migrations) {
    try {
      await execute(m.sql);
      results.push({ name: m.name, ok: true });
    } catch (err) {
      results.push({ name: m.name, ok: false, error: err.message });
    }
  }
  return results;
}

// Allow running directly: node migrate.js
if (require.main === module) {
  runMigration().then(results => {
    results.forEach(r => console.log(r.ok ? `✅ ${r.name}` : `❌ ${r.name}: ${r.error}`));
    process.exit(0);
  }).catch(err => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
}

module.exports = { runMigration };
