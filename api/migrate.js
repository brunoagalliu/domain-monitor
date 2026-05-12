const db = require('../db');
const { requireAuth } = require('../lib/auth');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (!requireAuth(req, res)) return;

  try {
    await db.execute(
      `ALTER TABLE domains ADD COLUMN IF NOT EXISTS is_flagged TINYINT(1) NOT NULL DEFAULT 0`
    );
    return res.status(200).json({ message: 'Migration applied: is_flagged column ready' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
