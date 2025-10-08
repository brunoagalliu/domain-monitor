const db = require('../db');
const DomainMonitor = require('../monitor');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      // Get all domains
      const [domains] = await db.execute(
        `SELECT d.*, c.name as category_name, c.color as category_color 
         FROM domains d 
         LEFT JOIN categories c ON d.category_id = c.id 
         WHERE d.is_active = true 
         ORDER BY c.name, d.domain`
      );
      return res.status(200).json(domains);
    } 
    
    if (req.method === 'POST') {
      // Add domain
      const { domain, notes, category_id } = req.body;
      
      if (!domain) {
        return res.status(400).json({ error: 'Domain is required' });
      }
      
      const monitor = new DomainMonitor();
      const domainId = await monitor.addDomain(domain, notes || '', category_id || null);
      return res.status(200).json({ 
        message: 'Domain added successfully', 
        id: domainId,
        domain: domain 
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Error in /api/domains:', error);
    console.error('Error stack:', error.stack);
    
    // Return detailed error for debugging
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Domain already exists' });
    }
    
    // Database connection errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return res.status(500).json({ 
        error: 'Database connection failed',
        details: error.message 
      });
    }
    
    return res.status(500).json({ 
      error: error.message || 'Internal server error',
      code: error.code || 'UNKNOWN'
    });
  }
};