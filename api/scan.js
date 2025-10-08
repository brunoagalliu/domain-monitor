const DomainMonitor = require('./monitor');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const monitor = new DomainMonitor();
    const limit = parseInt(req.query.limit) || 100;
    const scans = await monitor.getRecentScans(limit);
    
    return res.json(scans);
  } catch (error) {
    console.error('Error in GET /api/scans:', error);
    return res.status(500).json({ error: error.message });
  }
};