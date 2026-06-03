const { execute: dbExecute } = require('../db');
const db = { execute: dbExecute };
const DomainMonitor = require('../monitor');
const { requireAuth } = require('../lib/auth');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      const [domains] = await db.execute(
        `SELECT d.*,
           d.rotator_status  AS status,
           d.rotator_priority AS priority,
           d.created_at       AS added_at,
           c.name  AS category_name,
           c.color AS category_color,
           l.name  AS lander_name,
           f.name  AS funnel_name
         FROM domains d
         LEFT JOIN categories   c ON d.category_id = c.id
         LEFT JOIN landers      l ON d.lander_id   = l.id
         LEFT JOIN funnels      f ON d.funnel_id   = f.id
         WHERE d.is_active = true
         ORDER BY
           CASE WHEN d.rotator_status = 'active'  THEN 0
                WHEN d.rotator_status = 'standby' THEN 1
                ELSE 2 END,
           d.rotator_priority DESC,
           c.name,
           d.domain`
      );
      return res.status(200).json(domains);
    }
    
    if (req.method === 'POST') {
      const { domain, notes, category_id, doc_root, status, domain_type, lander_id, priority } = req.body;

      if (!domain) return res.status(400).json({ error: 'Domain is required' });

      const clean = domain.replace(/^https?:\/\//, '').toLowerCase().trim();

      const [rows] = await db.execute(
        `INSERT INTO domains
           (domain, notes, category_id, doc_root, rotator_status, domain_type, lander_id, rotator_priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (domain) DO UPDATE SET
           notes            = EXCLUDED.notes,
           category_id      = EXCLUDED.category_id,
           doc_root         = EXCLUDED.doc_root,
           rotator_status   = EXCLUDED.rotator_status,
           domain_type      = EXCLUDED.domain_type,
           lander_id        = EXCLUDED.lander_id,
           rotator_priority = EXCLUDED.rotator_priority,
           is_active        = true
         RETURNING *`,
        [
          clean,
          notes    || '',
          category_id  ? Number(category_id)  : null,
          doc_root     || null,
          status       || 'standby',
          domain_type  || null,
          lander_id    ? Number(lander_id)    : null,
          priority     ? Number(priority)     : 0,
        ]
      );

      return res.status(200).json({
        message: 'Domain added successfully',
        id: rows[0].id,
        domain: clean,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Error in /api/domains:', error);
    console.error('Error stack:', error.stack);
    
    // Return detailed error for debugging
    if (error.code === '23505') {
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