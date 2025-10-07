// index.js
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const DomainMonitor = require('./monitor');
const db = require('./db');
require('dotenv').config();

const app = express();
const monitor = new DomainMonitor();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (including dashboard.html)
app.use(express.static(__dirname));

// Serve dashboard at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// API Routes
app.get('/api', (req, res) => {
  res.json({
    message: '🛡️ Domain Safety Monitor API',
    status: 'running',
    endpoints: {
      'GET /domains': 'List all domains',
      'POST /domains': 'Add a domain',
      'DELETE /domains/:id': 'Remove a domain',
      'POST /scan': 'Trigger manual scan',
      'GET /scans/recent': 'Get recent scan results',
      'GET /stats': 'Get dashboard statistics'
    }
  });
});

// Get all domains
app.get('/domains', async (req, res) => {
  try {
    const [domains] = await db.execute(
      'SELECT * FROM domains WHERE is_active = true ORDER BY domain'
    );
    res.json(domains);
  } catch (error) {
    console.error('Error in GET /domains:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add domain
app.post('/domains', async (req, res) => {
  try {
    const { domain, notes } = req.body;
    
    if (!domain) {
      return res.status(400).json({ error: 'Domain is required' });
    }
    
    const domainId = await monitor.addDomain(domain, notes || '');
    res.json({ 
      message: 'Domain added successfully', 
      id: domainId,
      domain: domain 
    });
  } catch (error) {
    console.error('Error in POST /domains:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'Domain already exists' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Remove domain (soft delete)
app.delete('/domains/:id', async (req, res) => {
  try {
    await db.execute(
      'UPDATE domains SET is_active = false WHERE id = ?', 
      [req.params.id]
    );
    res.json({ message: 'Domain removed successfully' });
  } catch (error) {
    console.error('Error in DELETE /domains:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual scan
app.post('/scan', async (req, res) => {
  try {
    // Return response immediately
    res.json({ 
      message: 'Scan initiated', 
      timestamp: new Date().toISOString() 
    });
    
    // Run scan asynchronously
    monitor.scanDomains().catch(error => {
      console.error('Background scan error:', error);
    });
  } catch (error) {
    console.error('Error in POST /scan:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get recent scans
app.get('/scans/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const scans = await monitor.getRecentScans(limit);
    res.json(scans);
  } catch (error) {
    console.error('Error in GET /scans/recent:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get statistics
app.get('/stats', async (req, res) => {
  try {
    const stats = await monitor.getDomainStats();
    res.json(stats);
  } catch (error) {
    console.error('Error in GET /stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('\n🚀 Domain Safety Monitor Started!');
  console.log('─'.repeat(50));
  console.log(`📡 API Server: http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log('─'.repeat(50));
  
  // Test database connection
  try {
    await db.execute('SELECT 1');
    console.log('✅ Database connected');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.log('💡 Make sure MySQL is running and credentials are correct in .env');
  }

  // Test Google API key
  if (!process.env.GOOGLE_API_KEY) {
    console.log('⚠️ Google API Key not set! Add GOOGLE_API_KEY to .env file');
    console.log('💡 Get your key at: https://console.cloud.google.com/');
  } else {
    console.log('✅ Google API Key configured');
  }
  
  console.log('─'.repeat(50));
  
  // Schedule automatic scans every 6 hours
  cron.schedule('*/30 * * * *', async () => {
    console.log('⏰ Running scheduled scan...');
    try {
      await monitor.scanDomains();
    } catch (error) {
      console.error('Scheduled scan error:', error);
    }
  });
  
  console.log('📅 Automatic scans scheduled every 6 hours');
  console.log('💡 Use the dashboard to add domains and trigger manual scans');
  console.log('\n🎯 Ready to monitor your domains!\n');
  
  // Run initial scan if domains exist
  const domains = await monitor.getActiveDomains();
  if (domains.length > 0) {
    console.log(`Found ${domains.length} domain(s). Running initial scan...`);
    monitor.scanDomains().catch(error => {
      console.error('Initial scan error:', error);
    });
  }
});