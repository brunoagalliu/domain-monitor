const crypto = require('crypto');
const axios = require('axios');

const BASE = 'https://safebrowsing.googleapis.com/v5';
const PREFIX_SIZE = 4;

class SafeBrowsingV5Client {
  constructor() {
    this.apiKey = process.env.GOOGLE_API_KEY;
  }

  urlExpressions(domain) {
    const d = domain.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    const www = `www.${d}`;
    return [
      `http://${d}/`,
      `https://${d}/`,
      `http://${www}/`,
      `https://${www}/`,
    ];
  }

  async checkDomains(domains) {
    if (!this.apiKey || !domains.length) return {};

    const fullHashMap = new Map(); // fullHashB64 -> domain
    const prefixes = new Set();

    for (const domain of domains) {
      for (const url of this.urlExpressions(domain)) {
        const hash = crypto.createHash('sha256').update(url).digest();
        prefixes.add(hash.slice(0, PREFIX_SIZE).toString('base64'));
        fullHashMap.set(hash.toString('base64'), domain);
      }
    }

    try {
      const params = new URLSearchParams({ key: this.apiKey });
      for (const p of prefixes) params.append('hashPrefixes', p);

      const res = await axios.get(`${BASE}/hashes:search?${params.toString()}`, {
        timeout: 10000,
      });

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
      console.error('Safe Browsing v5 check failed:', err.message);
      return {};
    }
  }
}

module.exports = SafeBrowsingV5Client;
