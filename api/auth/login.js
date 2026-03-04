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

  const { username, password } = req.body;

  const adminUser = process.env.ADMIN_USERNAME;
  const adminPass = process.env.ADMIN_PASSWORD;
  const secret = process.env.JWT_SECRET;

  if (!adminUser || !adminPass || !secret) {
    return res.status(500).json({ error: 'Auth not configured on server' });
  }

  // Timing-safe comparison to prevent enumeration attacks
  const userMatch = crypto.timingSafeEqual(
    Buffer.from(username || ''),
    Buffer.from(adminUser)
  );
  const passMatch = crypto.timingSafeEqual(
    Buffer.from(password || ''),
    Buffer.from(adminPass)
  );

  if (!userMatch || !passMatch) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = jwt.sign({ username: adminUser }, secret, { expiresIn: '24h' });

  res.setHeader(
    'Set-Cookie',
    `token=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400`
  );

  return res.status(200).json({ success: true });
};
