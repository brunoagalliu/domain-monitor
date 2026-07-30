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

function cpanel(path = '/execute') {
  return axios.create({
    baseURL: `https://${process.env.CPANEL_HOST}${path}`,
    headers: { Authorization: `cpanel ${process.env.CPANEL_USER}:${process.env.CPANEL_TOKEN}` },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    timeout: 60000,
  });
}

function isCpanelModuleError(errors = []) {
  return errors.some(e => /Failed to load module|Can't locate/i.test(e));
}

function cfErr(err) {
  return err.response?.data?.errors?.[0]?.message || err.message;
}

// Split domain into SLD + TLD for Namecheap API (handles common 2-part TLDs)
function parseDomain(domain) {
  const parts = domain.split('.');
  const known2part = new Set(['co.uk','com.au','net.au','org.au','com.br','co.nz','org.uk','me.uk','net.uk','co.in','com.mx']);
  const last2 = parts.slice(-2).join('.');
  if (parts.length > 2 && known2part.has(last2)) {
    return { sld: parts.slice(0, -2).join('.'), tld: last2 };
  }
  return { sld: parts.slice(0, -1).join('.'), tld: parts[parts.length - 1] };
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
  let zoneCreated = false;
  let cfNameservers = [];
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
      cfNameservers = created.result.name_servers || [];
      zoneCreated = true;
      log('cloudflare_zone', 'created', { zoneId, nameservers: cfNameservers });
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

  // ── Step 3: cPanel domain ─────────────────────────────────────────────────
  // Tries three methods in order: UAPI Domains/create → UAPI AddonDomain → API2 AddonDomain
  const cp   = cpanel('/execute');
  const cp2  = cpanel('/json-api');
  const docRoot = `public_html/${domain}`;
  try {
    let addResult; // { ok: bool, exists: bool, error: string }

    // Attempt 1: UAPI Domains/create (cPanel 86+)
    try {
      const { data } = await cp.post('/Domains/create', null, {
        params: { domain, document_root: docRoot },
      });
      if (data.status === 1) {
        addResult = { ok: true };
      } else if (isCpanelModuleError(data.errors || [])) {
        // module not available — try next method
      } else {
        const msg = (data.errors || []).join(', ');
        addResult = /already exists|already been added|already configured/i.test(msg)
          ? { ok: true, exists: true }
          : { ok: false, error: msg };
      }
    } catch { /* HTTP error — try next method */ }

    // Attempt 2: UAPI AddonDomain/addaddondomain
    if (!addResult) {
      try {
        const { data } = await cp.post('/AddonDomain/addaddondomain', null, {
          params: { newdomain: domain, subdomain: domain, dir: docRoot },
        });
        if (data.status === 1) {
          addResult = { ok: true };
        } else if (isCpanelModuleError(data.errors || [])) {
          // module not available — try next method
        } else {
          const msg = (data.errors || []).join(', ');
          addResult = /already exists|already been added|already configured/i.test(msg)
            ? { ok: true, exists: true }
            : { ok: false, error: msg };
        }
      } catch { /* HTTP error — try next method */ }
    }

    // Attempt 3: cPanel API2 AddonDomain::addaddondomain
    if (!addResult) {
      const { data } = await cp2.get('/cpanel', {
        params: {
          cpanel_jsonapi_apiversion: '2',
          cpanel_jsonapi_module: 'AddonDomain',
          cpanel_jsonapi_func: 'addaddondomain',
          newdomain: domain,
          subdomain: domain,
          dir: docRoot,
        },
      });
      const r = data?.cpanelresult;
      const eventOk = r?.event?.result === 1;
      if (eventOk) {
        addResult = { ok: true };
      } else {
        const msg = r?.data?.[0]?.reason || r?.error || 'Unknown cPanel error';
        addResult = /already exists|already been added|already configured/i.test(msg)
          ? { ok: true, exists: true }
          : { ok: false, error: msg };
      }
    }

    if (addResult.ok) {
      log('cpanel_domain', addResult.exists ? 'exists' : 'created', { docRoot });
    } else {
      log('cpanel_domain', 'error', { error: addResult.error });
      return res.json({ domain, steps, success: false });
    }
  } catch (err) {
    log('cpanel_domain', 'error', { error: err.message });
    return res.json({ domain, steps, success: false });
  }

  // ── Step 4: AutoSSL (Let's Encrypt via cPanel) ────────────────────────────
  try {
    const { data: sslResp } = await cp.post('/SSL/start_autossl_check', null, {
      params: { 'domains[0]': domain },
    });
    if (sslResp.status === 1) {
      log('cpanel_ssl', 'queued');
    } else {
      log('cpanel_ssl', 'error', { error: (sslResp.errors || []).join(', ') });
    }
  } catch (err) {
    log('cpanel_ssl', 'error', { error: err.message });
  }

  // ── Step 5: Namecheap nameservers (only when CF zone was just created) ────
  if (!zoneCreated) {
    log('namecheap_ns', 'skipped');
  } else {
    const ncUser = process.env.NAMECHEAP_API_USER;
    const ncKey  = process.env.NAMECHEAP_API_KEY;
    const ncIp   = process.env.NAMECHEAP_CLIENT_IP;

    if (!ncUser || !ncKey || !ncIp) {
      log('namecheap_ns', 'skipped', { nameservers: cfNameservers });
    } else {
      try {
        const { sld, tld } = parseDomain(domain);
        const { data: xml } = await axios.get('https://api.namecheap.com/xml.response', {
          params: {
            ApiUser:     ncUser,
            ApiKey:      ncKey,
            UserName:    ncUser,
            ClientIp:    ncIp,
            Command:     'namecheap.domains.dns.setCustom',
            SLD:         sld,
            TLD:         tld,
            Nameservers: cfNameservers.join(','),
          },
          timeout: 30000,
          responseType: 'text',
        });

        const status = (/<ApiResponse[^>]*Status="(\w+)"/).exec(xml)?.[1];
        if (status === 'OK') {
          log('namecheap_ns', 'updated', { nameservers: cfNameservers });
        } else {
          const errMsg = (/<Error[^>]*>([\s\S]*?)<\/Error>/).exec(xml)?.[1]?.trim() || 'Unknown error';
          log('namecheap_ns', 'error', { error: errMsg, nameservers: cfNameservers });
        }
      } catch (err) {
        log('namecheap_ns', 'error', { error: err.message, nameservers: cfNameservers });
      }
    }
  }

  const homeDir = process.env.CPANEL_HOME || `/home/${process.env.CPANEL_USER}`;
  const fullDocRoot = `${homeDir}/public_html/${domain}`;

  res.json({ domain, steps, success: true, docRoot: fullDocRoot });
});

module.exports = router;
