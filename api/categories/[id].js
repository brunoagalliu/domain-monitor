const { execute: dbExecute } = require('../../db');
const db = { execute: dbExecute };
const { requireAuth } = require('../../lib/auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAuth(req, res)) return;

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Category ID is required' });

  try {
    if (req.method === 'PUT') {
      const { name, color } = req.body;

      const [existing] = await db.execute('SELECT * FROM categories WHERE id = $1', [id]);
      if (existing.length === 0)
        return res.status(404).json({ error: 'Category not found' });

      const updates = [];
      const values = [];
      let p = 1;

      if (name !== undefined) {
        if (!name || name.trim().length === 0)
          return res.status(400).json({ error: 'Category name cannot be empty' });

        const [duplicate] = await db.execute(
          `SELECT id FROM categories WHERE LOWER(name) = LOWER($1) AND id != $2`,
          [name.trim(), id]
        );
        if (duplicate.length > 0)
          return res.status(400).json({ error: 'Category with this name already exists' });

        updates.push(`name = $${p++}`);
        values.push(name.trim());
      }

      if (color !== undefined) {
        if (!/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color))
          return res.status(400).json({ error: 'Invalid color format' });
        updates.push(`color = $${p++}`);
        values.push(color);
      }

      if (updates.length === 0)
        return res.status(400).json({ error: 'No fields to update' });

      values.push(id);
      await db.execute(`UPDATE categories SET ${updates.join(', ')} WHERE id = $${p}`, values);

      const [updated] = await db.execute('SELECT * FROM categories WHERE id = $1', [id]);
      return res.status(200).json({ message: 'Category updated successfully', category: updated[0] });
    }

    if (req.method === 'DELETE') {
      const [existing] = await db.execute('SELECT id FROM categories WHERE id = $1', [id]);
      if (existing.length === 0)
        return res.status(404).json({ error: 'Category not found' });

      const [domainCount] = await db.execute(
        'SELECT COUNT(*)::int as count FROM domains WHERE category_id = $1 AND is_active = true',
        [id]
      );
      const count = domainCount[0].count;

      if (count > 0)
        await db.execute('UPDATE domains SET category_id = NULL WHERE category_id = $1', [id]);

      await db.execute('DELETE FROM categories WHERE id = $1', [id]);

      return res.status(200).json({ message: 'Category deleted successfully', domains_unassigned: count });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Error in /api/categories/[id]:', error);
    return res.status(500).json({ error: error.message, code: error.code });
  }
};
