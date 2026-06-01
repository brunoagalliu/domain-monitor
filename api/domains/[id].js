const { execute: dbExecute } = require('../../db');
const db = { execute: dbExecute };
const { requireAuth } = require('../../lib/auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAuth(req, res)) return;

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Domain ID is required' });

  // PATCH — toggle is_priority (and optionally other boolean fields)
  if (req.method === 'PATCH') {
    try {
      const { is_priority } = req.body;

      if (typeof is_priority !== 'boolean') {
        return res.status(400).json({ error: 'is_priority (boolean) is required' });
      }

      const [, result] = await db.execute(
        'UPDATE domains SET is_priority = $1 WHERE id = $2 AND is_active = true',
        [is_priority, id]
      );

      if (result.rowCount === 0) return res.status(404).json({ error: 'Domain not found' });

      return res.status(200).json({ success: true, id: parseInt(id), is_priority });
    } catch (error) {
      console.error('Error patching domain:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // DELETE — soft-delete the domain
  try {
    const [, result] = await db.execute(
      'UPDATE domains SET is_active = false WHERE id = $1',
      [id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Domain not found' });

    return res.status(200).json({ message: 'Domain removed successfully', id: parseInt(id) });
  } catch (error) {
    console.error('Error deleting domain:', error);
    return res.status(500).json({ error: error.message, code: error.code });
  }
};
