const express = require('express');
const path = require('path');
const cron = require('node-cron');
const DomainMonitor = require('./monitor');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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
const monitor = new DomainMonitor();
cron.schedule('* * * * *', async () => {
  try {
    await monitor.scanDomains();
  } catch (err) {
    console.error('Scheduled scan error:', err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
