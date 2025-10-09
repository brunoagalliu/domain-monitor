const DomainMonitor = require('../monitor');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const monitor = new DomainMonitor();

  try {
    if (req.method === 'GET') {
      // Get recent scan results
      const limit = parseInt(req.query.limit) || 100;
      const scans = await monitor.getRecentScans(limit);
      return res.status(200).json(scans);
    }
    
    if (req.method === 'POST') {
      // Trigger new scan
      // Return immediately to prevent timeout
      res.status(200).json({ 
        message: 'Scan initiated', 
        timestamp: new Date().toISOString() 
      });
      
      // Run scan asynchronously (don't block response)
      monitor.scanDomains().catch(error => {
        console.error('Background scan error:', error);
      });
      
      return;
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Error in /api/scans:', error);
    return res.status(500).json({ 
      error: error.message,
      code: error.code 
    });
  }
};