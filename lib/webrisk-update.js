const crypto = require('crypto');
const axios = require('axios');

const BASE = 'https://webrisk.googleapis.com/v1';
const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'];
const PREFIX_SIZE = 4;

function buildIndex(hexSet) {
  const arr = new Uint32Array(hexSet.size);
  let i = 0;
  for (const hex of hexSet) arr[i++] = parseInt(hex, 16);
  arr.sort();
  return arr;
}

function hasPrefix(arr, hexPrefix) {
  const target = parseInt(hexPrefix, 16);
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] === target) return true;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

class WebRiskUpdateClient {
  constructor(db) {
    this.db = db;
    this.apiKey = process.env.GOOGLE_API_KEY;
    this.indexes = new Map();      // threatType -> Uint32Array (sorted)
    this.versionTokens = new Map(); // threatType -> token
    this.nextFetch = 0;
    this.ready = false;
  }

  async init() {
    if (this.ready) return;
    await this.loadFromDB();
    this.ready = true;
    console.log(`🛡️  Web Risk local lists ready — ${this.totalPrefixes().toLocaleString()} prefixes`);
  }

  totalPrefixes() {
    let n = 0;
    for (const arr of this.indexes.values()) n += arr.length;
    return n;
  }

  async loadFromDB() {
    try {
      const [rows] = await this.db.execute(
        "SELECT list_key, state_token, prefixes_b64 FROM threat_lists WHERE list_key LIKE 'webrisk:%'"
      );
      for (const row of rows) {
        const threatType = row.list_key.replace('webrisk:', '');
        this.versionTokens.set(threatType, row.state_token || '');
        if (row.prefixes_b64) {
          const buf = Buffer.from(row.prefixes_b64, 'base64');
          const arr = new Uint32Array(buf.buffer, buf.byteOffset, buf.length / 4);
          this.indexes.set(threatType, arr.slice());
        }
      }
    } catch (err) {
      if (!err.message.includes('does not exist')) {
        console.warn('[webrisk-update] loadFromDB failed:', err.message);
      }
    }
  }

  async fetchUpdates() {
    if (!this.apiKey || Date.now() < this.nextFetch) return;
    this.nextFetch = Date.now() + 5 * 60 * 1000; // default 5 min

    let minNext = Infinity;

    for (const threatType of THREAT_TYPES) {
      try {
        const params = new URLSearchParams({
          key: this.apiKey,
          threatType,
          'constraints.maxDiffEntries': 100000,
          'constraints.maxDatabaseEntries': 100000,
        });
        const token = this.versionTokens.get(threatType);
        if (token) params.set('versionToken', token);

        const res = await axios.get(`${BASE}/threatLists:computeDiff?${params}`, { timeout: 30000 });
        const { responseType, additions, removals, newVersionToken, recommendedNextDiff } = res.data;

        if (recommendedNextDiff) {
          const secs = parseFloat(recommendedNextDiff);
          if (!isNaN(secs)) minNext = Math.min(minNext, Date.now() + Math.min(secs, 300) * 1000);
        }

        // Rebuild prefix set from existing index (skip on RESET)
        const existingArr = this.indexes.get(threatType);
        const prefixSet = new Set();
        if (responseType !== 'RESET' && existingArr) {
          for (let i = 0; i < existingArr.length; i++) {
            prefixSet.add(existingArr[i].toString(16).padStart(PREFIX_SIZE * 2, '0'));
          }
        }

        // Apply additions
        if (additions?.rawHashes) {
          const { prefixSize = PREFIX_SIZE, rawHashes } = additions.rawHashes;
          const buf = Buffer.from(rawHashes, 'base64');
          for (let i = 0; i < buf.length; i += prefixSize) {
            prefixSet.add(
              buf.slice(i, i + Math.min(prefixSize, PREFIX_SIZE))
                .toString('hex').padEnd(PREFIX_SIZE * 2, '0')
            );
          }
        }

        // Apply removals
        if (removals?.rawIndices?.indices?.length) {
          const sorted = [...prefixSet].sort();
          const toRemove = new Set(removals.rawIndices.indices);
          prefixSet.clear();
          sorted.forEach((h, i) => { if (!toRemove.has(i)) prefixSet.add(h); });
        }

        const arr = buildIndex(prefixSet);
        this.indexes.set(threatType, arr);
        this.versionTokens.set(threatType, newVersionToken || '');

        // Persist
        const buf = Buffer.from(arr.buffer);
        await this.db.execute(
          `INSERT INTO threat_lists (list_key, state_token, prefixes_b64, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (list_key) DO UPDATE SET state_token = $2, prefixes_b64 = $3, updated_at = NOW()`,
          [`webrisk:${threatType}`, newVersionToken || '', buf.toString('base64')]
        );
      } catch (err) {
        console.error(`[webrisk-update] ${threatType} failed:`, err.response?.status, err.message);
      }
    }

    if (isFinite(minNext)) this.nextFetch = minNext;
    console.log(`✅ Web Risk lists updated — ${this.totalPrefixes().toLocaleString()} prefixes`);
  }

  urlExpressions(domain) {
    const d = domain.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    return [`http://${d}/`, `https://${d}/`];
  }

  async checkDomains(domains) {
    if (this.indexes.size === 0) return {};

    const potentialMatches = [];
    for (const domain of domains) {
      for (const url of this.urlExpressions(domain)) {
        const hash = crypto.createHash('sha256').update(url).digest();
        const prefix = hash.slice(0, PREFIX_SIZE).toString('hex');
        for (const [threatType, arr] of this.indexes) {
          if (hasPrefix(arr, prefix)) {
            potentialMatches.push({ domain, url, threatType });
            break;
          }
        }
      }
    }

    if (!potentialMatches.length) return {};

    // Verify only the potential matches with uris:search (rare, only for flagged domains)
    const confirmed = {};
    await Promise.all(potentialMatches.map(async ({ domain, url }) => {
      if (confirmed[domain]) return;
      try {
        const params = new URLSearchParams({ key: this.apiKey, uri: url });
        THREAT_TYPES.forEach(t => params.append('threatTypes', t));
        const res = await axios.get(`${BASE}/uris:search?${params}`, { timeout: 10000 });
        if (res.data.threat) {
          confirmed[domain] = { threatType: res.data.threat.threatTypes?.[0] };
        }
      } catch (err) {
        console.error(`[webrisk] verify failed for ${domain}:`, err.message);
      }
    }));

    return confirmed;
  }
}

module.exports = WebRiskUpdateClient;
