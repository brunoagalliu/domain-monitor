const db = require('../../db');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;
    
    if (!id) {
      return res.status(400).json({ error: 'Domain ID is required' });
    }
    
    const [result] = await db.execute(
      'UPDATE domains SET is_active = false WHERE id = ?', 
      [id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Domain not found' });
    }
    
    return res.status(200).json({ 
      message: 'Domain removed successfully',
      id: parseInt(id)
    });
  } catch (error) {
    console.error('Error deleting domain:', error);
    return res.status(500).json({ 
      error: error.message,
      code: error.code 
    });
  }
};