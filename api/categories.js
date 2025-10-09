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
    // GET - Get all categories
    if (req.method === 'GET') {
      console.log('📂 Fetching categories...');
      
      // Start with simple query
      const [categories] = await db.execute(`
        SELECT 
          c.id,
          c.name,
          c.color,
          c.created_at
        FROM categories c
        ORDER BY c.name
      `);
      
      console.log('✅ Found', categories.length, 'categories');
      
      // Add domain counts separately (safer)
      for (let cat of categories) {
        try {
          const [domainCount] = await db.execute(
            'SELECT COUNT(*) as count FROM domains WHERE category_id = ? AND is_active = true',
            [cat.id]
          );
          cat.domain_count = domainCount[0].count || 0;
          
          // Try to get safe/flagged counts
          const [safeCount] = await db.execute(`
            SELECT COUNT(DISTINCT d.id) as count
            FROM domains d
            JOIN scan_results sr ON d.id = sr.domain_id
            WHERE d.category_id = ? 
              AND d.is_active = true
              AND sr.is_safe = 1
              AND sr.id = (
                SELECT MAX(sr2.id) 
                FROM scan_results sr2 
                WHERE sr2.domain_id = d.id
              )
          `, [cat.id]);
          cat.safe_count = safeCount[0].count || 0;
          
          const [flaggedCount] = await db.execute(`
            SELECT COUNT(DISTINCT d.id) as count
            FROM domains d
            JOIN scan_results sr ON d.id = sr.domain_id
            WHERE d.category_id = ? 
              AND d.is_active = true
              AND sr.is_safe = 0
              AND sr.id = (
                SELECT MAX(sr2.id) 
                FROM scan_results sr2 
                WHERE sr2.domain_id = d.id
              )
          `, [cat.id]);
          cat.flagged_count = flaggedCount[0].count || 0;
        } catch (countError) {
          console.warn('Error getting counts for category', cat.id, ':', countError.message);
          cat.domain_count = 0;
          cat.safe_count = 0;
          cat.flagged_count = 0;
        }
      }
      
      return res.status(200).json(categories);
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
      
      console.log('✅ Category created:', name);
      
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
      
      console.log('✅ Category updated:', id);
      
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
        // Unassign domains from category
        await db.execute(
          'UPDATE domains SET category_id = NULL WHERE category_id = ?',
          [id]
        );
      }
      
      // Delete category
      await db.execute('DELETE FROM categories WHERE id = ?', [id]);
      
      console.log('✅ Category deleted:', id);
      
      return res.status(200).json({ 
        message: 'Category deleted successfully',
        domains_unassigned: domains[0].count
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('❌ Error in /api/categories:', error);
    
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Category already exists' });
    }
    
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({ 
        error: 'Categories table does not exist. Run setup-db.js',
        code: error.code
      });
    }
    
    return res.status(500).json({ 
      error: error.message,
      code: error.code 
    });
  }
};