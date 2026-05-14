const { execute: dbExecute } = require('../db');
const db = { execute: dbExecute };
const { requireAuth } = require('../lib/auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      const [categories] = await db.execute(`
        SELECT id, name, color, created_at FROM categories ORDER BY name
      `);

      for (let cat of categories) {
        const [domainCount] = await db.execute(
          'SELECT COUNT(*)::int as count FROM domains WHERE category_id = $1 AND is_active = true',
          [cat.id]
        );
        cat.domain_count = domainCount[0].count || 0;

        const [safeCount] = await db.execute(`
          SELECT COUNT(DISTINCT d.id)::int as count
          FROM domains d
          JOIN scan_results sr ON d.id = sr.domain_id
          WHERE d.category_id = $1 AND d.is_active = true AND sr.is_safe = true
            AND sr.id = (SELECT MAX(sr2.id) FROM scan_results sr2 WHERE sr2.domain_id = d.id)
        `, [cat.id]);
        cat.safe_count = safeCount[0].count || 0;

        const [flaggedCount] = await db.execute(`
          SELECT COUNT(DISTINCT d.id)::int as count
          FROM domains d
          JOIN scan_results sr ON d.id = sr.domain_id
          WHERE d.category_id = $1 AND d.is_active = true AND sr.is_safe = false
            AND sr.id = (SELECT MAX(sr2.id) FROM scan_results sr2 WHERE sr2.domain_id = d.id)
        `, [cat.id]);
        cat.flagged_count = flaggedCount[0].count || 0;
      }

      return res.status(200).json(categories);
    }

    if (req.method === 'POST') {
      const { name, color } = req.body;

      if (!name || name.trim().length === 0)
        return res.status(400).json({ error: 'Category name is required' });
      if (name.length > 50)
        return res.status(400).json({ error: 'Category name too long (max 50 characters)' });

      const finalColor = color || '#667eea';
      if (!/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(finalColor))
        return res.status(400).json({ error: 'Invalid color format. Use hex format like #667eea' });

      const [existing] = await db.execute(
        'SELECT id FROM categories WHERE LOWER(name) = LOWER($1)',
        [name.trim()]
      );
      if (existing.length > 0)
        return res.status(400).json({ error: 'Category with this name already exists' });

      const [rows] = await db.execute(
        'INSERT INTO categories (name, color) VALUES ($1, $2) RETURNING id',
        [name.trim(), finalColor]
      );

      return res.status(201).json({
        message: 'Category created successfully',
        category: { id: rows[0].id, name: name.trim(), color: finalColor }
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('❌ Error in /api/categories:', error);
    if (error.code === '23505')
      return res.status(400).json({ error: 'Category already exists' });
    return res.status(500).json({ error: error.message, code: error.code });
  }
};
