const jwt = require('jsonwebtoken');

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie;
  if (!header) return cookies;
  header.split(';').forEach(pair => {
    const [key, ...rest] = pair.trim().split('=');
    cookies[key.trim()] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

function requireAuth(req, res) {
  // API key auth — for external tools
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    const authHeader = req.headers.authorization;
    if (authHeader === `Bearer ${apiKey}`) {
      req.user = { api: true };
      return true;
    }
  }

  // JWT auth — from Authorization: Bearer header (React app) or cookie (legacy)
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'JWT_SECRET not configured' });
    return false;
  }

  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const cookies = parseCookies(req);
  const token = bearerToken || cookies.token;

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }

  try {
    const payload = jwt.verify(token, secret);
    req.user = payload;
    return true;
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
}

module.exports = { requireAuth, parseCookies };
