const DomainMonitor = require('../monitor');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const monitor = new DomainMonitor();
    
    // Return response immediately
    res.json({ 
      message: 'Scan initiated', 
      timestamp: new Date().toISOString() 
    });
    
    // Run scan asynchronously (don't await)
    monitor.scanDomains().catch(error => {
      console.error('Background scan error:', error);
    });
  } catch (error) {
    console.error('Error in POST /scan:', error);
    return res.status(500).json({ error: error.message });
  }
};