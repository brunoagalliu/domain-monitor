const express = require('express');
const axios = require('axios');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

const cf = axios.create({
  baseURL: 'https://api.cloudflare.com/client/v4',
  headers: {
    Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

router.use((req, res, next) => {
  if (!requireAuth(req, res)) return;
  next();
});

// GET /api/cloudflare/zones — list all zones
router.get('/zones', async (req, res) => {
  try {
    const { data } = await cf.get('/zones', {
      params: { account_id: process.env.CLOUDFLARE_ACCOUNT_ID, per_page: 200 },
    });
    res.json(data.result);
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.errors?.[0]?.message || err.message });
  }
});

// GET /api/cloudflare/zones/:zoneId — zone details + SSL status
router.get('/zones/:zoneId', async (req, res) => {
  try {
    const [zone, ssl] = await Promise.all([
      cf.get(`/zones/${req.params.zoneId}`),
      cf.get(`/zones/${req.params.zoneId}/ssl/certificate_packs`),
    ]);
    res.json({ zone: zone.data.result, ssl: ssl.data.result });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.errors?.[0]?.message || err.message });
  }
});

// GET /api/cloudflare/zones/:zoneId/dns — list DNS records
router.get('/zones/:zoneId/dns', async (req, res) => {
  try {
    const { data } = await cf.get(`/zones/${req.params.zoneId}/dns_records`, {
      params: { per_page: 200 },
    });
    res.json(data.result);
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.errors?.[0]?.message || err.message });
  }
});

// POST /api/cloudflare/zones/:zoneId/dns — create a DNS record
router.post('/zones/:zoneId/dns', async (req, res) => {
  try {
    const { data } = await cf.post(`/zones/${req.params.zoneId}/dns_records`, req.body);
    res.json(data.result);
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.errors?.[0]?.message || err.message });
  }
});

// DELETE /api/cloudflare/zones/:zoneId/dns/:recordId — delete a DNS record
router.delete('/zones/:zoneId/dns/:recordId', async (req, res) => {
  try {
    await cf.delete(`/zones/${req.params.zoneId}/dns_records/${req.params.recordId}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.errors?.[0]?.message || err.message });
  }
});

// GET /api/cloudflare/domain/:name — look up zone by domain name
router.get('/domain/:name', async (req, res) => {
  try {
    const { data } = await cf.get('/zones', {
      params: { name: req.params.name, account_id: process.env.CLOUDFLARE_ACCOUNT_ID },
    });
    const zone = data.result?.[0] || null;
    res.json(zone);
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.errors?.[0]?.message || err.message });
  }
});

module.exports = router;
