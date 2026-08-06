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
  },
  // ── Rotator merge columns ──────────────────────────────────────────────────
  {
    name: 'Add redtrack_lander_id to domains',
    sql: `ALTER TABLE domains ADD COLUMN IF NOT EXISTS redtrack_lander_id TEXT`
  },
  {
    name: 'Add banned_at to domains',
    sql: `ALTER TABLE domains ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP`
  },
  {
    name: 'Add from_domain to rotation_history',
    sql: `ALTER TABLE rotation_history ADD COLUMN IF NOT EXISTS from_domain TEXT`
  },
  {
    name: 'Add to_domain to rotation_history',
    sql: `ALTER TABLE rotation_history ADD COLUMN IF NOT EXISTS to_domain TEXT`
  },
  {
    name: 'Add lander_name to rotation_history',
    sql: `ALTER TABLE rotation_history ADD COLUMN IF NOT EXISTS lander_name TEXT`
  },
  {
    name: 'Add trigger_source to rotation_history',
    sql: `ALTER TABLE rotation_history ADD COLUMN IF NOT EXISTS trigger_source TEXT DEFAULT 'auto'`
  },
  {
    name: 'Add error to rotation_history',
    sql: `ALTER TABLE rotation_history ADD COLUMN IF NOT EXISTS error TEXT`
  },
  {
    name: 'Add redtrack_offer_id to funnel_offers',
    sql: `ALTER TABLE funnel_offers ADD COLUMN IF NOT EXISTS redtrack_offer_id TEXT`
  },
  {
    name: 'Add offer_title to funnel_offers',
    sql: `ALTER TABLE funnel_offers ADD COLUMN IF NOT EXISTS offer_title TEXT`
  },
  {
    name: 'Add subdirectory to domain_landers',
    sql: `ALTER TABLE domain_landers ADD COLUMN IF NOT EXISTS subdirectory TEXT DEFAULT ''`
  },
  {
    name: 'Add redtrack_lander_title to domain_landers',
    sql: `ALTER TABLE domain_landers ADD COLUMN IF NOT EXISTS redtrack_lander_title TEXT`
  },
  {
    name: 'Unique index on funnels.redtrack_stream_id',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_funnels_redtrack_stream_id ON funnels (redtrack_stream_id) WHERE redtrack_stream_id IS NOT NULL`
  },
  {
    name: 'Add domain_type to domains',
    sql: `ALTER TABLE domains ADD COLUMN IF NOT EXISTS domain_type VARCHAR(20) DEFAULT NULL CHECK (domain_type IN ('brand', 'non-brand'))`
  },
  {
    name: 'Add recovery_status to domains',
    sql: `ALTER TABLE domains ADD COLUMN IF NOT EXISTS recovery_status VARCHAR(20) DEFAULT NULL`
  },
  {
    name: 'Create domain_recovery_logs table',
    sql: `
      CREATE TABLE IF NOT EXISTS domain_recovery_logs (
        id SERIAL PRIMARY KEY,
        domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL,
        note TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
  },
  {
    name: 'Create settings table',
    sql: `
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
  },
  {
    name: 'Add cpanel_path to landers',
    sql: `ALTER TABLE landers ADD COLUMN IF NOT EXISTS cpanel_path TEXT DEFAULT NULL`
  },
  {
    name: 'Add last_lookup_check to domains',
    sql: `ALTER TABLE domains ADD COLUMN IF NOT EXISTS last_lookup_check TIMESTAMP DEFAULT NULL`
  },
  {
    name: 'Add browser_scan to funnels',
    sql: `ALTER TABLE funnels ADD COLUMN IF NOT EXISTS browser_scan BOOLEAN DEFAULT true`
  },
  {
    name: 'Create domain_funnels many-to-many table',
    sql: `CREATE TABLE IF NOT EXISTS domain_funnels (
      id SERIAL PRIMARY KEY,
      domain_id INT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
      funnel_id INT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'standby',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(domain_id, funnel_id)
    )`
  },
  {
    name: 'Migrate existing domain-funnel pairs into domain_funnels',
    sql: `INSERT INTO domain_funnels (domain_id, funnel_id, status)
      SELECT id, funnel_id, rotator_status
      FROM domains
      WHERE funnel_id IS NOT NULL
        AND rotator_status IN ('active', 'standby')
        AND is_active = true
      ON CONFLICT (domain_id, funnel_id) DO NOTHING`
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
