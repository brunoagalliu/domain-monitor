const express = require('express');
const path = require('path');
const cron = require('node-cron');
const DomainMonitor = require('./monitor');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const monitor = new DomainMonitor();

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Static pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/categories', (req, res) => res.sendFile(path.join(__dirname, 'categories.html')));
app.get('/logs', (req, res) => res.sendFile(path.join(__dirname, 'logs.html')));
app.get('/logs.html', (req, res) => res.sendFile(path.join(__dirname, 'logs.html')));

// Auth routes
app.all('/api/auth/login', require('./api/auth/login'));
app.all('/api/auth/logout', require('./api/auth/logout'));
app.all('/api/auth/verify', require('./api/auth/verify'));

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

// Browser scanner health check
app.get('/api/browser-status', async (req, res) => {
  const { execute } = require('./db');
  const [rows] = await execute(`
    SELECT
      COUNT(*) FILTER (WHERE last_browser_check IS NOT NULL)::int AS checked,
      COUNT(*) FILTER (WHERE browser_status = 'safe')::int            AS safe,
      COUNT(*) FILTER (WHERE browser_status = 'dangerous')::int       AS dangerous,
      COUNT(*) FILTER (WHERE is_priority = true)::int                 AS priority,
      COUNT(*) FILTER (WHERE scan_suspended = true)::int              AS suspended,
      MAX(last_browser_check)                                          AS last_check
    FROM domains WHERE is_active = true
  `);
  res.json({
    scanRunning: monitor.browserScanRunning,
    browserReady: !!monitor.browserChecker.context,
    lastError: monitor.browserChecker.lastError || null,
    ...rows[0],
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

// One-time migration route (remove after first use)
app.get('/api/migrate', async (req, res) => {
  try {
    const { runMigration } = require('./migrate');
    await runMigration();
    res.json({ success: true, message: 'Migration complete' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
