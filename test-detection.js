require('dotenv').config();
const SafeBrowsingChecker = require('./safe-browsing');
const SafeBrowsingUpdateClient = require('./lib/safebrowsing-update');
const BrowserChecker = require('./lib/browser-checker');
const { execute: dbExecute } = require('./db');
const db = { execute: dbExecute };

const DOMAIN = 'vbjqzmd.com';
const start = Date.now();
const ts = () => `+${String(Date.now() - start).padStart(5)}ms`;

async function testAll() {
  console.log(`\n🧪 Testing detection methods for: ${DOMAIN}`);
  console.log('─'.repeat(50));

  const updateClient = new SafeBrowsingUpdateClient(db);
  await updateClient.init();

  const browserChecker = new BrowserChecker();

  await Promise.all([
    // ── Lookup API ───────────────────────────────────────
    (async () => {
      const t = Date.now();
      const checker = new SafeBrowsingChecker();
      const results = await checker.checkDomains([DOMAIN]);
      const r = results[DOMAIN];
      const elapsed = Date.now() - t;
      if (!r.is_safe) {
        const threats = r.threats.map(t => t.threatType).filter(Boolean).join(', ');
        console.log(`[${ts()}] 🚨 LOOKUP API     → FLAGGED  (${elapsed}ms)  ${threats}`);
      } else {
        console.log(`[${ts()}] ✅ LOOKUP API     → safe     (${elapsed}ms)`);
      }
    })(),

    // ── Update API ───────────────────────────────────────
    (async () => {
      const t = Date.now();
      await updateClient.fetchUpdates();
      const results = await updateClient.checkDomains([DOMAIN]);
      const match = results[DOMAIN];
      const elapsed = Date.now() - t;
      if (match) {
        console.log(`[${ts()}] 🚨 UPDATE API     → FLAGGED  (${elapsed}ms)  ${match.threatType}`);
      } else {
        console.log(`[${ts()}] ✅ UPDATE API     → safe     (${elapsed}ms)`);
      }
    })(),

    // ── Browser ──────────────────────────────────────────
    (async () => {
      const t = Date.now();
      await browserChecker.init();
      const results = await browserChecker.checkDomains([DOMAIN]);
      const r = results[0];
      const elapsed = Date.now() - t;
      if (r.status === 'dangerous') {
        console.log(`[${ts()}] 🚨 BROWSER        → FLAGGED  (${elapsed}ms)  Chrome blocked`);
      } else {
        console.log(`[${ts()}] ✅ BROWSER        → ${r.status.padEnd(9)}(${elapsed}ms)`);
      }
      await browserChecker.close();
    })(),
  ]);

  console.log('─'.repeat(50));
  console.log(`Total: ${Date.now() - start}ms\n`);
  process.exit(0);
}

testAll().catch(e => { console.error(e); process.exit(1); });
