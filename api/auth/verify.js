const { requireAuth } = require('../../lib/auth');
require('dotenv').config();

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (!requireAuth(req, res)) return;

  return res.status(200).json({ authenticated: true });
};
