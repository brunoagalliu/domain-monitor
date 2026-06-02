const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body;

  const adminPass = process.env.ADMIN_PASSWORD;
  const secret = process.env.JWT_SECRET;

  if (!adminPass || !secret) {
    return res.status(500).json({ error: 'Auth not configured on server' });
  }

  const passBuf     = Buffer.from(password || '');
  const expectedBuf = Buffer.from(adminPass);

  // timingSafeEqual requires same length — pad to avoid throwing
  const maxLen = Math.max(passBuf.length, expectedBuf.length);
  const a = Buffer.alloc(maxLen); passBuf.copy(a);
  const b = Buffer.alloc(maxLen); expectedBuf.copy(b);

  const passMatch = crypto.timingSafeEqual(a, b) && passBuf.length === expectedBuf.length;

  if (!passMatch) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = jwt.sign({ user: 'admin' }, secret, { expiresIn: '7d' });

  res.setHeader(
    'Set-Cookie',
    `token=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=604800`
  );

  return res.status(200).json({ token });
};
