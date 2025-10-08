const DomainMonitor = require('./monitor');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const monitor = new DomainMonitor();

  try {
    if (req.method === 'GET') {
      // Get all categories
      const categories = await monitor.getCategories();
      return res.json(categories);
    }
    
    if (req.method === 'POST') {
      // Add category
      const { name, color } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: 'Category name is required' });
      }
      
      const categoryId = await monitor.addCategory(name, color);
      return res.json({ 
        message: 'Category added successfully', 
        id: categoryId,
        name: name 
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Error in /api/categories:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Category already exists' });
    }
    return res.status(500).json({ error: error.message });
  }
};