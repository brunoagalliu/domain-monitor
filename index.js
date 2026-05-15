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

// Auth routes
app.all('/api/auth/login', require('./api/auth/login'));
app.all('/api/auth/logout', require('./api/auth/logout'));
app.all('/api/auth/verify', require('./api/auth/verify'));

// Domain routes
app.all('/api/domains/:id', (req, res) => {
  req.query.id = req.params.id;
  return require('./api/domains/[id]')(req, res);
});
app.all('/api/domains', require('./api/domains'));

// Scan + stats routes
app.all('/api/scans', require('./api/scans'));
app.all('/api/stats', require('./api/stats'));

// Category routes
app.all('/api/categories/:id', (req, res) => {
  req.query.id = req.params.id;
  return require('./api/categories/[id]')(req, res);
});
app.all('/api/categories', require('./api/categories'));

// Detection method comparison test
app.get('/api/test-detection', async (req, res) => {
  const domain = req.query.domain || 'vbjqzmd.com';
  const start = Date.now();
  const log = [];
  const ts = () => Date.now() - start;

  const SafeBrowsingChecker = require('./safe-browsing');
  const BrowserChecker = require('./lib/browser-checker');

  await Promise.allSettled([
    (async () => {
      const t = Date.now();
      const checker = new SafeBrowsingChecker();
      const results = await checker.checkDomains([domain]);
      const r = results[domain];
      log.push({ method: 'Lookup API', elapsed: Date.now() - t, at: ts(), flagged: !r.is_safe, detail: r.threats?.map(t => t.threatType).filter(Boolean).join(', ') || null });
    })(),
    (async () => {
      const t = Date.now();
      try {
        const crypto = require('crypto');
        const { urlExpressions } = require('./lib/webrisk');
        const exprs = urlExpressions(domain);
        const prefixMap = {};
        for (const e of exprs) {
          const hash = crypto.createHash('sha256').update(e).digest();
          prefixMap[e] = hash.slice(0, 4).toString('base64url');
        }
        const axios = require('axios');
        const key = process.env.GOOGLE_API_KEY;
        // URI search — checks if domain is in Web Risk DB at all
        const uriParams = new URLSearchParams({ key, uri: `http://${domain}/` });
        ['MALWARE','SOCIAL_ENGINEERING','UNWANTED_SOFTWARE'].forEach(t => uriParams.append('threatTypes', t));
        const uriRes = await axios.get(`https://webrisk.googleapis.com/v1/uris:search?${uriParams}`, { timeout: 10000 }).catch(e => ({ data: { error: e.response?.data?.error?.message || e.message } }));

        const results = await monitor.updateClient.checkDomains([domain]);
        const match = results[domain];
        log.push({ method: 'Web Risk API', elapsed: Date.now() - t, at: ts(), flagged: !!match, detail: match?.threatType || null, debug: { prefixes: prefixMap, uriSearch: uriRes.data } });
      } catch (e) {
        log.push({ method: 'Web Risk API', elapsed: Date.now() - t, at: ts(), flagged: false, detail: 'ERROR: ' + e.message });
      }
    })(),
    (async () => {
      const t = Date.now();
      try {
        const results = await monitor.browserChecker.checkDomains([domain]);
        const r = results[0];
        log.push({ method: 'Browser', elapsed: Date.now() - t, at: ts(), flagged: r.status === 'dangerous', detail: r.status });
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

// Cron: scan every minute
cron.schedule('* * * * *', async () => {
  try {
    await monitor.scanDomains();
  } catch (err) {
    console.error('Scheduled scan error:', err.message);
  }
});

// Cron: browser scan every 2 minutes
cron.schedule('*/2 * * * *', async () => {
  try {
    await monitor.browserScanDomains();
  } catch (err) {
    console.error('Browser scan error:', err.message);
  }
});


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('SIGTERM', async () => {
  await monitor.browserChecker.close();
  process.exit(0);
});
