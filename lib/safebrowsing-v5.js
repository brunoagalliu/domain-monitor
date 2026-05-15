const crypto = require('crypto');
const axios = require('axios');

const BASE = 'https://safebrowsing.googleapis.com/v5';
const PREFIX_SIZE = 4;

// Google Safe Browsing URL canonicalization (subset covering domain-only inputs)
function canonicalize(str) {
  return str
    .replace(/[\t\r\n]/g, '')   // remove whitespace control chars
    .replace(/#.*$/, '')         // remove fragment
    .toLowerCase();
}

// All host permutations: exact hostname + up to 4 parent subdomains (never strip past eTLD+1)
function hostPermutations(hostname) {
  const parts = hostname.split('.');
  const result = [hostname];
  for (let i = 1; i <= Math.min(4, parts.length - 2); i++) {
    result.push(parts.slice(i).join('.'));
  }
  return result;
}

// Full set of URL expressions per Google spec — host × path × scheme variants
function urlExpressions(domain) {
  const d = canonicalize(domain).replace(/^www\./, '');
  const expressions = new Set();

  for (const baseHost of [d, `www.${d}`]) {
    for (const host of hostPermutations(baseHost)) {
      // Google spec: hash with scheme (http + https), path '/'
      expressions.add(`http://${host}/`);
      expressions.add(`https://${host}/`);
      // Also try without scheme — some implementations hash host/path only
      expressions.add(`${host}/`);
    }
  }

  return [...expressions];
}

class SafeBrowsingV5Client {
  constructor() {
    this.apiKey = process.env.GOOGLE_API_KEY;
  }

  async checkDomains(domains) {
    if (!this.apiKey || !domains.length) return {};

    const fullHashMap = new Map(); // fullHashB64url -> domain
    const prefixes = new Set();

    for (const domain of domains) {
      for (const expr of urlExpressions(domain)) {
        // Correct: digest() returns raw bytes; slice(0,4) = 4 bytes; base64url = no padding
        const hash = crypto.createHash('sha256').update(expr).digest();
        prefixes.add(hash.slice(0, PREFIX_SIZE).toString('base64url'));
        fullHashMap.set(hash.toString('base64url'), domain);
      }
    }

    try {
      const params = new URLSearchParams({ key: this.apiKey });
      for (const p of prefixes) params.append('hashPrefixes', p);

      const res = await axios.get(`${BASE}/hashes:search?${params.toString()}`, {
        timeout: 10000,
      });

      console.log(`[v5] status=${res.status} prefixes=${prefixes.size} fullHashes=${JSON.stringify(res.data.fullHashes || []).slice(0, 300)}`);

      const confirmed = {};
      for (const fh of res.data.fullHashes || []) {
        const domain = fullHashMap.get(fh.fullHash);
        if (domain && !confirmed[domain]) {
          const detail = fh.fullHashDetails?.[0];
          confirmed[domain] = { threatType: detail?.threatType };
        }
      }
      return confirmed;
    } catch (err) {
      console.error('[v5] check failed:', err.response?.status, err.response?.data || err.message);
      return {};
    }
  }
}

module.exports = SafeBrowsingV5Client;
module.exports.urlExpressions = urlExpressions;
