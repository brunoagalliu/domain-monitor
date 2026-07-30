const express = require('express');
const axios = require('axios');
const https = require('https');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

router.use((req, res, next) => {
  if (!requireAuth(req, res)) return;
  next();
});

const cf = () => axios.create({
  baseURL: 'https://api.cloudflare.com/client/v4',
  headers: {
    Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

function cpanel() {
  return axios.create({
    baseURL: `https://${process.env.CPANEL_HOST}/execute`,
    headers: { Authorization: `cpanel ${process.env.CPANEL_USER}:${process.env.CPANEL_TOKEN}` },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    timeout: 60000,
  });
}

function cfErr(err) {
  return err.response?.data?.errors?.[0]?.message || err.message;
}

// POST /api/provision — run all 5 setup steps for a new domain
router.post('/', async (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain is required' });

  const steps = [];
  const log = (step, status, detail = {}) => {
    steps.push({ step, status, ...detail });
    console.log(`[provision] ${domain} / ${step}: ${status}`, Object.keys(detail).length ? detail : '');
  };

  const client = cf();

  // ── Step 1: Cloudflare zone ───────────────────────────────────────────────
  let zoneId;
  try {
    const { data: existing } = await client.get('/zones', {
      params: { name: domain, account_id: process.env.CLOUDFLARE_ACCOUNT_ID },
    });
    if (existing.result?.length > 0) {
      zoneId = existing.result[0].id;
      log('cloudflare_zone', 'exists', { zoneId });
    } else {
      const { data: created } = await client.post('/zones', {
        name: domain,
        account: { id: process.env.CLOUDFLARE_ACCOUNT_ID },
        jump_start: false,
      });
      zoneId = created.result.id;
      log('cloudflare_zone', 'created', { zoneId });
    }
  } catch (err) {
    log('cloudflare_zone', 'error', { error: cfErr(err) });
    return res.json({ domain, steps, success: false });
  }

  // ── Step 2: A record ──────────────────────────────────────────────────────
  const serverIp = process.env.SERVER_IP;
  if (!serverIp) {
    log('dns_a_record', 'skipped', { error: 'SERVER_IP env var not set' });
  } else {
    try {
      const { data: dns } = await client.get(`/zones/${zoneId}/dns_records`, {
        params: { type: 'A', name: domain },
      });
      if (dns.result?.length > 0) {
        await client.put(`/zones/${zoneId}/dns_records/${dns.result[0].id}`, {
          type: 'A', name: domain, content: serverIp, proxied: true,
        });
        log('dns_a_record', 'updated', { ip: serverIp });
      } else {
        await client.post(`/zones/${zoneId}/dns_records`, {
          type: 'A', name: domain, content: serverIp, proxied: true,
        });
        log('dns_a_record', 'created', { ip: serverIp });
      }
    } catch (err) {
      log('dns_a_record', 'error', { error: cfErr(err) });
    }
  }

  // ── Step 3: Cloudflare origin certificate ─────────────────────────────────
  let cert, privateKey;
  try {
    const { data: certData } = await client.post('/certificates', {
      hostnames: [domain, `*.${domain}`],
      request_type: 'origin-rsa',
      requested_validity: 5475, // 15 years
    });
    cert = certData.result.certificate;
    privateKey = certData.result.private_key;
    log('origin_certificate', 'created');
  } catch (err) {
    log('origin_certificate', 'error', { error: cfErr(err) });
    return res.json({ domain, steps, success: false });
  }

  // ── Step 4: cPanel domain ─────────────────────────────────────────────────
  const cp = cpanel();
  const docRoot = `public_html/${domain}`; // relative to cPanel home dir
  try {
    // Try newer Domains/create first (cPanel 86+), fall back to AddonDomain
    let addResp;
    try {
      const { data } = await cp.post('/Domains/create', null, {
        params: { domain, document_root: docRoot },
      });
      addResp = data;
    } catch {
      const { data } = await cp.post('/AddonDomain/addaddondomain', null, {
        params: { newdomain: domain, subdomain: domain, dir: docRoot },
      });
      addResp = data;
    }

    if (addResp.status === 1) {
      log('cpanel_domain', 'created', { docRoot });
    } else {
      const errMsg = (addResp.errors || []).join(', ');
      if (/already exists|already been added|already configured/i.test(errMsg)) {
        log('cpanel_domain', 'exists', { docRoot });
      } else {
        log('cpanel_domain', 'error', { error: errMsg });
        return res.json({ domain, steps, success: false });
      }
    }
  } catch (err) {
    log('cpanel_domain', 'error', { error: err.message });
    return res.json({ domain, steps, success: false });
  }

  // ── Step 5: Install SSL in cPanel ─────────────────────────────────────────
  try {
    const { data: sslResp } = await cp.post('/SSL/install_ssl', null, {
      params: { domain, cert, key: privateKey },
    });
    if (sslResp.status === 1) {
      log('cpanel_ssl', 'installed');
    } else {
      log('cpanel_ssl', 'error', { error: (sslResp.errors || []).join(', ') });
    }
  } catch (err) {
    log('cpanel_ssl', 'error', { error: err.message });
  }

  const homeDir = process.env.CPANEL_HOME || `/home/${process.env.CPANEL_USER}`;
  const fullDocRoot = `${homeDir}/public_html/${domain}`;

  res.json({ domain, steps, success: true, docRoot: fullDocRoot });
});

module.exports = router;
