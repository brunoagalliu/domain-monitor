const express = require('express');
const path = require('path');
const cron = require('node-cron');
const DomainMonitor = require('./monitor');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const monitor = new DomainMonitor();

app.use(express.json());

// Auth routes (public)
app.all('/api/auth/login', require('./api/auth/login'));
app.all('/api/auth/logout', require('./api/auth/logout'));
app.all('/api/auth/verify', require('./api/auth/verify'));

// ── Rotator API routes ─────────────────────────────────────────────────────────
app.use('/api/funnels', require('./api/funnels'));
app.use('/api/landers', require('./api/landers'));
app.use('/api/rotate', require('./api/rotate'));
app.use('/api/history', require('./api/rotation-history'));
app.use('/api/redtrack', require('./api/redtrack').router);
app.use('/api/files', require('./api/files'));
app.use('/api/cloudflare', require('./api/cloudflare'));
app.use('/api/recovery',  require('./api/recovery'));
app.use('/api/gsc',       require('./api/gsc'));
app.use('/api/provision', require('./api/provision'));

// One-time fix: clear scan_suspended on manually-banned domains
app.get('/api/fix/clear-banned-suspension', async (req, res) => {
  const { execute } = require('./db');
  const [, result] = await execute(
    `UPDATE domains SET scan_suspended = false WHERE rotator_status = 'banned' AND scan_suspended = true`
  );
  res.json({ fixed: result.rowCount });
});

app.get('/api/test', require('./api/test'));

// Domain-landers sub-routes (MUST be before the /api/domains/:id catch-all)
app.use('/api/domains/:id/landers', require('./api/domains/landers'));

// Domain deploy sub-route
app.post('/api/domains/:id/deploy', async (req, res) => {
  const { requireAuth } = require('./lib/auth');
  if (!requireAuth(req, res)) return;
  req.query.id = req.params.id;
  req.path = '/deploy';
  return require('./api/domains/[id]')(req, res);
});

// Manual scan for a suspended domain
app.post('/api/domains/:id/scan', async (req, res) => {
  const { requireAuth } = require('./lib/auth');
  if (!requireAuth(req, res)) return;
  try {
    const result = await monitor.manualScanDomain(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Domain routes
app.all('/api/domains/:id', (req, res) => {
  req.query.id = req.params.id;
  return require('./api/domains/[id]')(req, res);
});
app.all('/api/domains', require('./api/domains'));

// Scan + stats + logs routes
app.all('/api/scans', require('./api/scans'));
app.all('/api/stats', require('./api/stats'));
app.all('/api/logs', require('./api/logs'));

// Category routes
app.all('/api/categories/:id', (req, res) => {
  req.query.id = req.params.id;
  return require('./api/categories/[id]')(req, res);
});
app.all('/api/categories', require('./api/categories'));

// Browser scanner status
app.get('/api/browser-status', async (req, res) => {
  const { execute } = require('./db');
  const [rows] = await execute(`
    SELECT
      COUNT(*) FILTER (WHERE last_browser_check IS NOT NULL)::int AS checked,
      COUNT(*) FILTER (WHERE browser_status = 'safe')::int            AS safe,
      COUNT(*) FILTER (WHERE browser_status = 'dangerous')::int       AS dangerous,
      COUNT(*) FILTER (WHERE is_priority = true)::int                 AS priority,
      COUNT(*) FILTER (WHERE
        d.is_priority = true
        AND d.scan_suspended = false
        AND d.rotator_status != 'banned'
        AND COALESCE(f.browser_scan, true) = true
      )::int AS browser_scan_active,
      COUNT(*) FILTER (WHERE scan_suspended = true)::int              AS suspended,
      MAX(last_browser_check)                                         AS last_check
    FROM domains d
    LEFT JOIN funnels f ON d.funnel_id = f.id
    WHERE d.is_active = true
  `);
  res.json({
    scanRunning: monitor.browserScanRunning,
    browserReady: !!monitor.browserChecker.context,
    browserScanEnabled: await isBrowserScanEnabled(),
    lastError: monitor.browserChecker.lastError || null,
    ...rows[0],
  });
});

// Browser scanner on/off switch — persisted in settings table
async function isBrowserScanEnabled() {
  const { execute } = require('./db');
  const [rows] = await execute(`SELECT value FROM settings WHERE key = 'browser_scan_enabled'`);
  return rows.length === 0 || rows[0].value !== 'false';
}

app.post('/api/browser-status/toggle', async (req, res) => {
  const { requireAuth } = require('./lib/auth');
  if (!requireAuth(req, res)) return;
  const { execute } = require('./db');
  const { enabled } = req.body;
  await execute(`
    INSERT INTO settings (key, value, updated_at) VALUES ('browser_scan_enabled', $1, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `, [enabled ? 'true' : 'false']);
  if (!enabled) {
    await monitor.browserChecker.close().catch(() => {});
  }
  res.json({ enabled });
});

// Monitor status (for sidebar badge)
app.get('/api/monitor/status', (req, res) => {
  res.json({
    running: monitor.browserScanRunning || false,
    configured: true,
    lastError: monitor.browserChecker?.lastError || null,
  });
});

// Detection method comparison test
app.get('/api/test-detection', async (req, res) => {
  const domain = req.query.domain || 'vbjqzmd.com';
  const start = Date.now();
  const log = [];
  const ts = () => Date.now() - start;

  const SafeBrowsingChecker = require('./safe-browsing');

  await Promise.allSettled([
    (async () => {
      const t = Date.now();
      try {
        const checker = new SafeBrowsingChecker();
        const results = await checker.checkDomains([domain]);
        const r = results[domain];
        log.push({ method: 'Lookup API', elapsed: Date.now() - t, at: ts(), flagged: !r.is_safe, detail: r.threats?.map(t => t.threatType).filter(Boolean).join(', ') || null });
      } catch (e) {
        log.push({ method: 'Lookup API', elapsed: Date.now() - t, at: ts(), flagged: false, detail: 'ERROR: ' + e.message });
      }
    })(),
    (async () => {
      const t = Date.now();
      if (monitor.browserScanRunning) {
        log.push({ method: 'Browser', elapsed: 0, at: ts(), flagged: false, detail: 'skipped — browser scan in progress' });
        return;
      }
      try {
        const results = await monitor.browserChecker.checkDomains([domain]);
        const r = results[0];
        log.push({ method: 'Browser', elapsed: Date.now() - t, at: ts(), flagged: r.status === 'dangerous', detail: r.status, lastError: monitor.browserChecker.lastError || null });
      } catch (e) {
        log.push({ method: 'Browser', elapsed: Date.now() - t, at: ts(), flagged: false, detail: 'ERROR: ' + e.message });
      }
    })(),
  ]);

  log.sort((a, b) => a.at - b.at);
  res.json({ domain, totalMs: ts(), results: log });
});

// One-time migration route
app.get('/api/migrate', async (req, res) => {
  try {
    const { runMigration } = require('./migrate');
    await runMigration();
    res.json({ success: true, message: 'Migration complete' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One-time data migration from domain-rotator
app.get('/api/migrate-rotator', async (req, res) => {
  if (!process.env.ROTATOR_DATABASE_URL) {
    return res.status(400).json({ error: 'ROTATOR_DATABASE_URL not set' });
  }
  try {
    const { migrateFromRotator } = require('./migrate-from-rotator');
    const result = await migrateFromRotator();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── React SPA ──────────────────────────────────────────────────────────────────
const clientDist = path.join(__dirname, 'client/dist');
const fs = require('fs');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  // Fallback: serve old static HTML files during development
  app.use(express.static(path.join(__dirname)));
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
  app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
  app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
  app.get('/categories', (req, res) => res.sendFile(path.join(__dirname, 'categories.html')));
  app.get('/logs', (req, res) => res.sendFile(path.join(__dirname, 'logs.html')));
  app.get('/logs.html', (req, res) => res.sendFile(path.join(__dirname, 'logs.html')));
}

// Cron: Lookup API scan every 2 minutes (all non-suspended domains)
cron.schedule('*/2 * * * *', async () => {
  try {
    await monitor.scanDomains();
  } catch (err) {
    console.error('Scheduled scan error:', err.message);
  }
});

// Cron: Browser scan every 30 seconds (priority domains only — sub-1-minute detection)
cron.schedule('*/30 * * * * *', async () => {
  try {
    if (!(await isBrowserScanEnabled())) return;
    await monitor.browserScanDomains();
  } catch (err) {
    console.error('Browser scan error:', err.message);
  }
});


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`  Lookup API scan: every 2 minutes (all non-suspended domains)`);
  console.log(`  Browser scan:    every 30 seconds (priority domains only)`);
});

process.on('SIGTERM', async () => {
  await monitor.browserChecker.close();
  process.exit(0);
});

// Prevent Chrome crashes from taking down the whole container
process.on('uncaughtException', err => {
  console.error('[server] uncaught exception:', err.message);
});
process.on('unhandledRejection', err => {
  console.error('[server] unhandled rejection:', err?.message || err);
});
