const db = require('../db');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET - Get all categories with domain counts
    if (req.method === 'GET') {
      try {
        const [categories] = await db.execute(`
          SELECT 
            c.id,
            c.name,
            c.color,
            c.created_at,
            COUNT(DISTINCT d.id) as domain_count,
            COALESCE(SUM(CASE WHEN sr.is_safe = 1 THEN 1 ELSE 0 END), 0) as safe_count,
            COALESCE(SUM(CASE WHEN sr.is_safe = 0 THEN 1 ELSE 0 END), 0) as flagged_count
          FROM categories c
          LEFT JOIN domains d ON c.id = d.category_id AND d.is_active = true
          LEFT JOIN scan_results sr ON d.id = sr.domain_id 
            AND sr.id = (
              SELECT MAX(sr2.id) 
              FROM scan_results sr2 
              WHERE sr2.domain_id = d.id
            )
          GROUP BY c.id, c.name, c.color, c.created_at
          ORDER BY c.name
        `);
        
        // Ensure we return an array
        return res.status(200).json(Array.isArray(categories) ? categories : []);
      } catch (error) {
        console.error('Error fetching categories:', error);
        throw error;
      }
    }
    
    // POST - Create new category
    if (req.method === 'POST') {
      const { name, color } = req.body;
      
      // Validation
      if (!name || name.trim().length === 0) {
        return res.status(400).json({ error: 'Category name is required' });
      }
      
      if (name.length > 50) {
        return res.status(400).json({ error: 'Category name too long (max 50 characters)' });
      }
      
      // Validate color format
      const colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      const finalColor = color || '#667eea';
      
      if (!colorRegex.test(finalColor)) {
        return res.status(400).json({ error: 'Invalid color format. Use hex format like #667eea' });
      }
      
      // Check for duplicate
      const [existing] = await db.execute(
        'SELECT id FROM categories WHERE LOWER(name) = LOWER(?)',
        [name.trim()]
      );
      
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Category with this name already exists' });
      }
      
      // Insert category
      const [result] = await db.execute(
        'INSERT INTO categories (name, color) VALUES (?, ?)',
        [name.trim(), finalColor]
      );
      
      return res.status(201).json({ 
        message: 'Category created successfully',
        category: {
          id: result.insertId,
          name: name.trim(),
          color: finalColor
        }
      });
    }
    
    // PUT - Update category
    if (req.method === 'PUT') {
      const { id, name, color } = req.body;
      
      if (!id) {
        return res.status(400).json({ error: 'Category ID is required' });
      }
      
      // Check if category exists
      const [existing] = await db.execute(
        'SELECT id FROM categories WHERE id = ?',
        [id]
      );
      
      if (existing.length === 0) {
        return res.status(404).json({ error: 'Category not found' });
      }
      
      // Build update query dynamically
      const updates = [];
      const values = [];
      
      if (name !== undefined) {
        if (!name || name.trim().length === 0) {
          return res.status(400).json({ error: 'Category name cannot be empty' });
        }
        if (name.length > 50) {
          return res.status(400).json({ error: 'Category name too long (max 50 characters)' });
        }
        
        // Check for duplicate name
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
          return res.status(400).json({ error: 'Invalid color format. Use hex format like #667eea' });
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
      
      return res.status(200).json({ 
        message: 'Category updated successfully',
        id: parseInt(id)
      });
    }
    
    // DELETE - Delete category
    if (req.method === 'DELETE') {
      const { id } = req.query;
      
      if (!id) {
        return res.status(400).json({ error: 'Category ID is required' });
      }
      
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
      
      if (domains[0].count > 0) {
        // Don't delete, just unassign domains
        await db.execute(
          'UPDATE domains SET category_id = NULL WHERE category_id = ?',
          [id]
        );
      }
      
      // Delete category
      await db.execute('DELETE FROM categories WHERE id = ?', [id]);
      
      return res.status(200).json({ 
        message: 'Category deleted successfully',
        domains_unassigned: domains[0].count
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('Error in /api/categories:', error);
    
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Category already exists' });
    }
    
    return res.status(500).json({ 
      error: error.message,
      code: error.code 
    });
  }
};