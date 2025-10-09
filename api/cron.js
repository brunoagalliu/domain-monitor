const DomainMonitor = require('../monitor');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    // Verify the request is from Vercel Cron
    const authHeader = req.headers.authorization;
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;
    
    if (!process.env.CRON_SECRET) {
      console.error('CRON_SECRET not configured');
      return res.status(500).json({ 
        error: 'CRON_SECRET not configured' 
      });
    }
    
    if (authHeader !== expectedAuth) {
      console.warn('Unauthorized cron attempt');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const monitor = new DomainMonitor();
    console.log('⏰ Running scheduled scan...');
    
    const result = await monitor.scanDomains();
    
    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      result
    });
  } catch (error) {
    console.error('Scheduled scan error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message,
      code: error.code
    });
  }
};