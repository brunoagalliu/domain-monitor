const express = require('express');
const { rotate } = require('../lib/rotator');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

router.use((req, res, next) => {
  if (!requireAuth(req, res)) return;
  next();
});

router.post('/trigger', async (req, res) => {
  const { domain, reason } = req.body;
  if (!domain) return res.status(400).json({ message: 'domain is required.' });
  try {
    const result = await rotate(domain.toLowerCase().trim(), reason || 'api');
    res.json({ success: true, ...result });
  } catch (err) {
    const alreadyBanned = err.message.includes('already banned');
    res.status(alreadyBanned ? 409 : 500).json({ success: false, message: err.message });
  }
});

module.exports = router;
