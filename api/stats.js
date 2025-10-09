const DomainMonitor = require('../monitor');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const monitor = new DomainMonitor();
    const stats = await monitor.getDomainStats();
    
    return res.status(200).json(stats);
  } catch (error) {
    console.error('Error in /api/stats:', error);
    return res.status(500).json({ 
      error: error.message,
      code: error.code 
    });
  }
};