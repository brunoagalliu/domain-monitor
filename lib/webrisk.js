const crypto = require('crypto');
const axios = require('axios');

const BASE = 'https://webrisk.googleapis.com/v1';
const PREFIX_SIZE = 4;
const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'];

function canonicalize(str) {
  return str.replace(/[\t\r\n]/g, '').replace(/#.*$/, '').toLowerCase();
}

function hostPermutations(hostname) {
  const parts = hostname.split('.');
  const result = [hostname];
  for (let i = 1; i <= Math.min(4, parts.length - 2); i++) {
    result.push(parts.slice(i).join('.'));
  }
  return result;
}

function urlExpressions(domain) {
  const d = canonicalize(domain).replace(/^www\./, '');
  const expressions = new Set();
  for (const baseHost of [d, `www.${d}`]) {
    for (const host of hostPermutations(baseHost)) {
      expressions.add(`http://${host}/`);
      expressions.add(`https://${host}/`);
      expressions.add(`${host}/`);
    }
  }
  return [...expressions];
}

function hashPrefix(url) {
  return crypto.createHash('sha256').update(url).digest().slice(0, PREFIX_SIZE).toString('base64url');
}

class WebRiskClient {
  constructor() {
    this.apiKey = process.env.GOOGLE_API_KEY;
  }

  async checkDomains(domains) {
    if (!this.apiKey || !domains.length) return {};

    // Build: prefix -> domain map
    const prefixToDomain = new Map();
    const prefixToFullHash = new Map();

    for (const domain of domains) {
      for (const expr of urlExpressions(domain)) {
        const hash = crypto.createHash('sha256').update(expr).digest();
        const prefix = hash.slice(0, PREFIX_SIZE).toString('base64url');
        const full = hash.toString('base64url');
        if (!prefixToDomain.has(prefix)) prefixToDomain.set(prefix, domain);
        prefixToFullHash.set(prefix, full);
      }
    }

    // Web Risk API: one request per unique prefix
    const confirmed = {};
    const requests = [];

    for (const [prefix, domain] of prefixToDomain) {
      if (confirmed[domain]) continue;
      requests.push(
        this._searchHash(prefix).then(threats => {
          if (threats.length && !confirmed[domain]) {
            confirmed[domain] = { threatType: threats[0].threatTypes?.[0] };
          }
        }).catch(() => {})
      );
    }

    await Promise.all(requests);
    return confirmed;
  }

  async _searchHash(prefix) {
    const params = new URLSearchParams({ key: this.apiKey, hashPrefix: prefix });
    THREAT_TYPES.forEach(t => params.append('threatTypes', t));

    const res = await axios.get(`${BASE}/hashes:search?${params.toString()}`, {
      timeout: 10000,
    });

    return res.data.threats || [];
  }
}

module.exports = WebRiskClient;
module.exports.urlExpressions = urlExpressions;
