const axios = require('axios');

const BASE = 'https://webrisk.googleapis.com/v1';
const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'];
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

class WebRiskClient {
  constructor() {
    this.apiKey = process.env.GOOGLE_API_KEY;
    this.cache = new Map(); // domain -> { result, expiresAt }
  }

  _cached(domain) {
    const entry = this.cache.get(domain);
    if (entry && Date.now() < entry.expiresAt) return entry.result;
    return undefined;
  }

  _setCache(domain, result) {
    this.cache.set(domain, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  async checkDomains(domains) {
    if (!this.apiKey || !domains.length) return {};

    const confirmed = {};
    const toCheck = [];

    for (const domain of domains) {
      const cached = this._cached(domain);
      if (cached !== undefined) {
        if (cached) confirmed[domain] = cached;
      } else {
        toCheck.push(domain);
      }
    }

    await Promise.all(toCheck.map(async domain => {
      try {
        const params = new URLSearchParams({ key: this.apiKey, uri: `http://${domain}/` });
        THREAT_TYPES.forEach(t => params.append('threatTypes', t));

        const res = await axios.get(`${BASE}/uris:search?${params}`, { timeout: 10000 });
        const threat = res.data.threat;
        const result = threat ? { threatType: threat.threatTypes?.[0] } : null;
        this._setCache(domain, result);
        if (result) confirmed[domain] = result;
      } catch (err) {
        console.error(`[webrisk] check failed for ${domain}:`, err.response?.status, err.message);
      }
    }));

    return confirmed;
  }
}

module.exports = WebRiskClient;
