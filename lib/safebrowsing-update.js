const crypto = require('crypto');
const axios = require('axios');

const BASE = 'https://safebrowsing.googleapis.com/v4';
const PREFIX_SIZE = 4;

const LISTS = [
  { threatType: 'MALWARE',            platformType: 'ANY_PLATFORM', threatEntryType: 'URL' },
  { threatType: 'SOCIAL_ENGINEERING', platformType: 'ANY_PLATFORM', threatEntryType: 'URL' },
  { threatType: 'UNWANTED_SOFTWARE',  platformType: 'ANY_PLATFORM', threatEntryType: 'URL' },
];

function listKey(list) {
  return `${list.threatType}:${list.platformType}:${list.threatEntryType}`;
}

// Sorted Uint32Array binary search — O(log n), ~2MB per 500k prefixes
function buildIndex(prefixSet) {
  const arr = new Uint32Array(prefixSet.size);
  let i = 0;
  for (const hex of prefixSet) arr[i++] = parseInt(hex, 16);
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

class SafeBrowsingUpdateClient {
  constructor(db) {
    this.db = db;
    this.apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
    this.prefixSets = new Map();  // listKey -> Set<hexString> (used during updates)
    this.indexes = new Map();     // listKey -> Uint32Array (used for lookups)
    this.states = new Map();      // listKey -> stateToken
    this.nextFetch = 0;
    this.ready = false;
  }

  async init() {
    if (this.ready) return;
    await this.loadFromDB();
    this.ready = true;
    console.log(`Safe Browsing Update client ready — ${this.totalPrefixes().toLocaleString()} prefixes loaded`);
  }

  totalPrefixes() {
    let n = 0;
    for (const arr of this.indexes.values()) n += arr.length;
    return n;
  }

  async loadFromDB() {
    try {
      const [rows] = await this.db.execute('SELECT list_key, state_token, prefixes_b64 FROM threat_lists');
      for (const row of rows) {
        this.states.set(row.list_key, row.state_token || '');
        if (row.prefixes_b64) {
          const buf = Buffer.from(row.prefixes_b64, 'base64');
          const arr = new Uint32Array(buf.buffer, buf.byteOffset, buf.length / 4);
          this.indexes.set(row.list_key, arr.slice()); // copy to own buffer
        }
      }
    } catch (err) {
      if (!err.message.includes('does not exist')) {
        console.warn('Could not load threat lists from DB:', err.message);
      }
    }
  }

  async persistToDB() {
    for (const [key, prefixSet] of this.prefixSets) {
      const arr = buildIndex(prefixSet);
      this.indexes.set(key, arr);
      const buf = Buffer.from(arr.buffer);
      const b64 = buf.toString('base64');
      const state = this.states.get(key) || '';
      await this.db.execute(
        `INSERT INTO threat_lists (list_key, state_token, prefixes_b64, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (list_key) DO UPDATE SET state_token = $2, prefixes_b64 = $3, updated_at = NOW()`,
        [key, state, b64]
      );
    }
  }

  async fetchUpdates() {
    if (!this.apiKey) return;
    if (Date.now() < this.nextFetch) return;

    try {
      // Rebuild prefixSets from current indexes for incremental update processing
      for (const [key, arr] of this.indexes) {
        const set = new Set();
        for (let i = 0; i < arr.length; i++) {
          set.add(arr[i].toString(16).padStart(PREFIX_SIZE * 2, '0'));
        }
        this.prefixSets.set(key, set);
      }

      const res = await axios.post(`${BASE}/threatListUpdates:fetch?key=${this.apiKey}`, {
        client: { clientId: 'domain-safety-monitor', clientVersion: '1.0' },
        listUpdateRequests: LISTS.map(list => ({
          threatType: list.threatType,
          platformType: list.platformType,
          threatEntryType: list.threatEntryType,
          state: this.states.get(listKey(list)) || '',
          constraints: { maxUpdateEntries: 100000, maxDatabaseEntries: 100000 }
        }))
      }, { timeout: 30000 });

      const { listUpdateResponses, minimumWaitDuration } = res.data;
      const waitSecs = minimumWaitDuration ? parseFloat(minimumWaitDuration) : 1800;
      this.nextFetch = Date.now() + waitSecs * 1000;

      for (const update of listUpdateResponses || []) {
        const key = `${update.threatType}:${update.platformType}:${update.threatEntryType}`;

        if (update.responseType === 'FULL_UPDATE') {
          this.prefixSets.set(key, new Set());
        }
        if (!this.prefixSets.has(key)) this.prefixSets.set(key, new Set());
        const prefixSet = this.prefixSets.get(key);

        for (const addition of update.additions || []) {
          if (addition.rawHashes) {
            const { prefixSize, rawHashes } = addition.rawHashes;
            const buf = Buffer.from(rawHashes, 'base64');
            for (let i = 0; i < buf.length; i += prefixSize) {
              // Normalize all prefixes to PREFIX_SIZE bytes for lookups
              prefixSet.add(buf.slice(i, i + Math.min(prefixSize, PREFIX_SIZE)).toString('hex').padEnd(PREFIX_SIZE * 2, '0'));
            }
          }
        }

        for (const removal of update.removals || []) {
          if (removal.rawIndices) {
            const sorted = [...prefixSet].sort();
            const toRemove = new Set(removal.rawIndices.indices);
            const kept = sorted.filter((_, i) => !toRemove.has(i));
            this.prefixSets.set(key, new Set(kept));
          }
        }

        this.states.set(key, update.newClientState || '');
      }

      await this.persistToDB();
      console.log(`✅ Threat lists updated — ${this.totalPrefixes().toLocaleString()} prefixes, next fetch in ${Math.round(waitSecs / 60)}min`);
    } catch (err) {
      console.error('Threat list fetch failed:', err.message);
      this.nextFetch = Date.now() + 5 * 60 * 1000; // retry in 5 min
    }
  }

  // URL expressions to hash for a given domain (Google SB canonicalization subset)
  urlExpressions(domain) {
    const d = domain.toLowerCase().replace(/\.$/, '');
    const noWww = d.replace(/^www\./, '');
    const withWww = d.startsWith('www.') ? d : `www.${d}`;
    return [
      `http://${noWww}/`,
      `https://${noWww}/`,
      `http://${withWww}/`,
      `https://${withWww}/`,
    ];
  }

  async checkDomains(domains) {
    if (this.indexes.size === 0) return {};

    const potentialMatches = []; // { domain, url, fullHash }

    for (const domain of domains) {
      for (const url of this.urlExpressions(domain)) {
        const fullHash = crypto.createHash('sha256').update(url).digest();
        const prefix = fullHash.slice(0, PREFIX_SIZE).toString('hex');

        for (const arr of this.indexes.values()) {
          if (hasPrefix(arr, prefix)) {
            potentialMatches.push({ domain, url, fullHash, fullHashB64: fullHash.toString('base64') });
            break;
          }
        }
      }
    }

    if (!potentialMatches.length) return {};

    // Confirm with full hash API
    try {
      const res = await axios.post(`${BASE}/fullHashes:find?key=${this.apiKey}`, {
        client: { clientId: 'domain-safety-monitor', clientVersion: '1.0' },
        clientStates: [...this.states.values()],
        threatInfo: {
          threatTypes: LISTS.map(l => l.threatType),
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: potentialMatches.map(m => ({ hash: m.fullHashB64 }))
        }
      }, { timeout: 10000 });

      const confirmed = {};
      for (const match of res.data.matches || []) {
        const pm = potentialMatches.find(m => m.fullHashB64 === match.threat.hash);
        if (pm && !confirmed[pm.domain]) {
          confirmed[pm.domain] = { threatType: match.threatType };
        }
      }
      return confirmed;
    } catch (err) {
      console.error('Full hash confirmation failed:', err.message);
      return {};
    }
  }
}

module.exports = SafeBrowsingUpdateClient;
