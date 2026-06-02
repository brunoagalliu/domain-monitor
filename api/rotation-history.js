const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

router.use((req, res, next) => {
  if (!requireAuth(req, res)) return;
  next();
});

router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM rotation_history ORDER BY rotated_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const { rows: [{ count }] } = await pool.query(`SELECT COUNT(*) FROM rotation_history`);
    res.json({ rows, total: parseInt(count) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
