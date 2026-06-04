const express = require('express');
const axios = require('axios');
const { execute } = require('../db');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

const SCOPES = [
  'https://www.googleapis.com/auth/siteverification',
  'https://www.googleapis.com/auth/webmasters',
].join(' ');

function appUrl() {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function authMiddleware(req, res, next) {
  if (!requireAuth(req, res)) return;
  next();
}

// GET /api/gsc/status — check if Google account is connected
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const [rows] = await execute(`SELECT value FROM settings WHERE key = 'gsc_refresh_token'`);
    res.json({ connected: rows.length > 0 && !!rows[0].value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/gsc/auth — initiate Google OAuth (opens in browser tab)
router.get('/auth', authMiddleware, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(400).json({ error: 'GOOGLE_CLIENT_ID not configured' });
  }
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', `${appUrl()}/api/gsc/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  res.redirect(url.toString());
});

// GET /api/gsc/callback — OAuth callback (no auth required — called by Google)
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?gsc=error');
  try {
    const { data } = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${appUrl()}/api/gsc/callback`,
      grant_type: 'authorization_code',
    });
    await execute(`
      INSERT INTO settings (key, value, updated_at) VALUES ('gsc_refresh_token', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `, [data.refresh_token]);
    res.redirect('/?gsc=connected');
  } catch (err) {
    console.error('GSC OAuth callback error:', err.response?.data || err.message);
    res.redirect('/?gsc=error');
  }
});

// Helper: get a fresh access token
async function getAccessToken() {
  const [rows] = await execute(`SELECT value FROM settings WHERE key = 'gsc_refresh_token'`);
  if (!rows.length || !rows[0].value) throw new Error('Google account not connected. Go to Settings → Connect Google.');
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured');
  }
  const { data } = await axios.post('https://oauth2.googleapis.com/token', {
    refresh_token: rows[0].value,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  return data.access_token;
}

// GET /api/gsc/sites — list all verified GSC properties
router.get('/sites', authMiddleware, async (req, res) => {
  try {
    const token = await getAccessToken();
    const { data } = await axios.get('https://www.googleapis.com/webmasters/v3/sites', {
      headers: { Authorization: `Bearer ${token}` },
    });
    res.json(data.siteEntry || []);
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

// POST /api/gsc/verify — verify a domain via Cloudflare DNS TXT record
// Body: { domain: 'example.com', zoneId: 'cf-zone-id' }
router.post('/verify', authMiddleware, async (req, res) => {
  const { domain, zoneId } = req.body;
  if (!domain || !zoneId) return res.status(400).json({ error: 'domain and zoneId are required' });

  try {
    const token = await getAccessToken();

    // 1. Get verification token from Google
    const { data: tokenData } = await axios.post(
      'https://www.googleapis.com/siteVerification/v1/token',
      { site: { type: 'INET_DOMAIN', identifier: domain }, verificationMethod: 'DNS_TXT' },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const verificationToken = tokenData.token;

    // 2. Add TXT record to Cloudflare
    const cfHeaders = {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    };
    const { data: dnsRecord } = await axios.post(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
      { type: 'TXT', name: domain, content: verificationToken, ttl: 120 },
      { headers: cfHeaders }
    );

    // 3. Wait for DNS to propagate before asking Google to verify
    await new Promise(r => setTimeout(r, 8000));

    // 4. Ask Google to verify
    const { data: verifyData } = await axios.post(
      `https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=DNS_TXT`,
      { site: { type: 'INET_DOMAIN', identifier: domain } },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // 5. Add as a domain property to Search Console
    const siteUrl = `sc-domain:${domain}`;
    await axios.put(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}`,
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    ).catch(() => {}); // already exists = ok

    res.json({
      success: true,
      verificationToken,
      dnsRecordId: dnsRecord.result?.id,
      gscSite: verifyData,
    });
  } catch (err) {
    const detail = err.response?.data;
    const msg = detail?.error?.message || detail?.error || err.message;
    console.error('[gsc verify error]', JSON.stringify(detail || err.message));
    res.status(500).json({ error: msg, detail });
  }
});

// DELETE /api/gsc/disconnect — remove stored refresh token
router.delete('/disconnect', authMiddleware, async (req, res) => {
  try {
    await execute(`DELETE FROM settings WHERE key = 'gsc_refresh_token'`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
