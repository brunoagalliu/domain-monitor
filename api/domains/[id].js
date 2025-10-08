const db = require('../../db');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;
    
    await db.execute(
      'UPDATE domains SET is_active = false WHERE id = ?', 
      [id]
    );
    
    return res.json({ message: 'Domain removed successfully' });
  } catch (error) {
    console.error('Error deleting domain:', error);
    return res.status(500).json({ error: error.message });
  }
};