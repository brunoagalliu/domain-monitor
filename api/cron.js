const DomainMonitor = require('./monitor');

module.exports = async (req, res) => {
  // Verify the request is from Vercel Cron
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const monitor = new DomainMonitor();
    console.log('⏰ Running scheduled scan...');
    const result = await monitor.scanDomains();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      result
    });
  } catch (error) {
    console.error('Scheduled scan error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};