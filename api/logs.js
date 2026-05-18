const { execute } = require('../db');
const { requireAuth } = require('../lib/auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAuth(req, res)) return;

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const [rows] = await execute(
      `SELECT id, domain, category, method, threat_type, detected_at
       FROM flag_logs
       ORDER BY detected_at DESC
       LIMIT $1`,
      [limit]
    );
    return res.status(200).json(rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
