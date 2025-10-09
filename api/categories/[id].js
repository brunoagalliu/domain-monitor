const db = require('../../db');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Category ID is required' });
  }

  try {
    // PUT - Update specific category
    if (req.method === 'PUT') {
      const { name, color } = req.body;
      
      // Check if category exists
      const [existing] = await db.execute(
        'SELECT * FROM categories WHERE id = ?',
        [id]
      );
      
      if (existing.length === 0) {
        return res.status(404).json({ error: 'Category not found' });
      }
      
      const updates = [];
      const values = [];
      
      if (name !== undefined) {
        if (!name || name.trim().length === 0) {
          return res.status(400).json({ error: 'Category name cannot be empty' });
        }
        
        // Check for duplicate
        const [duplicate] = await db.execute(
          'SELECT id FROM categories WHERE LOWER(name) = LOWER(?) AND id != ?',
          [name.trim(), id]
        );
        
        if (duplicate.length > 0) {
          return res.status(400).json({ error: 'Category with this name already exists' });
        }
        
        updates.push('name = ?');
        values.push(name.trim());
      }
      
      if (color !== undefined) {
        const colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
        if (!colorRegex.test(color)) {
          return res.status(400).json({ error: 'Invalid color format' });
        }
        updates.push('color = ?');
        values.push(color);
      }
      
      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }
      
      values.push(id);
      
      await db.execute(
        `UPDATE categories SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
      
      // Get updated category
      const [updated] = await db.execute(
        'SELECT * FROM categories WHERE id = ?',
        [id]
      );
      
      return res.status(200).json({
        message: 'Category updated successfully',
        category: updated[0]
      });
    }
    
    // DELETE - Delete category
    if (req.method === 'DELETE') {
      // Check if category exists
      const [existing] = await db.execute(
        'SELECT id FROM categories WHERE id = ?',
        [id]
      );
      
      if (existing.length === 0) {
        return res.status(404).json({ error: 'Category not found' });
      }
      
      // Check if category has domains
      const [domains] = await db.execute(
        'SELECT COUNT(*) as count FROM domains WHERE category_id = ? AND is_active = true',
        [id]
      );
      
      const domainCount = domains[0].count;
      
      if (domainCount > 0) {
        // Unassign domains from category
        await db.execute(
          'UPDATE domains SET category_id = NULL WHERE category_id = ?',
          [id]
        );
      }
      
      // Delete category
      await db.execute('DELETE FROM categories WHERE id = ?', [id]);
      
      return res.status(200).json({ 
        message: 'Category deleted successfully',
        domains_unassigned: domainCount
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('Error in /api/categories/[id]:', error);
    return res.status(500).json({ 
      error: error.message,
      code: error.code 
    });
  }
};