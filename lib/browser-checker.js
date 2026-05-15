const { chromium } = require('playwright');
const pLimit = require('p-limit');

const CONCURRENCY = 20;
const TIMEOUT = 12000;
const CHROME_PROFILE = '/tmp/chrome-safe-browsing-profile';

const PARKING_PATTERNS = [
  /domain.*for sale/i,
  /buy this domain/i,
  /parked domain/i,
  /this domain is (available|for sale)/i,
  /domain parking/i,
  /domain is registered/i,
];

function getBaseDomain(hostname) {
  const clean = hostname.replace(/^www\./, '');
  const parts = clean.split('.');
  return parts.slice(-2).join('.');
}

async function checkSingleDomain(page, domain) {
  try {
    await page.goto(`https://${domain}`, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT,
    });

    const finalUrl = page.url();

    // Chrome Safe Browsing blocked the page (blocked:other → chrome-error://)
    if (finalUrl.startsWith('chrome-error://') || finalUrl.startsWith('chrome://')) {
      return { domain, status: 'dangerous' };
    }

    const title = await page.title();

    let finalBase;
    try { finalBase = getBaseDomain(new URL(finalUrl).hostname); } catch {}
    const originalBase = getBaseDomain(domain);

    if (finalBase && finalBase !== originalBase) {
      return { domain, status: 'redirected', redirectTarget: finalBase };
    }

    if (PARKING_PATTERNS.some(p => p.test(title))) {
      return { domain, status: 'parked' };
    }

    return { domain, status: 'safe' };
  } catch (err) {
    const msg = err.message || '';
    if (/ERR_BLOCKED_BY_CLIENT|ERR_BLOCKED_BY_ADMINISTRATOR/i.test(msg)) {
      return { domain, status: 'dangerous' };
    }
    if (/ERR_CERT|ERR_SSL|certificate|SSL/i.test(msg)) {
      const code = msg.match(/ERR_[A-Z_]+/)?.[0] || 'ssl_error';
      return { domain, status: 'ssl_error', error: code };
    }
    if (/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/i.test(msg)) {
      return { domain, status: 'unreachable', error: 'dns_failed' };
    }
    return { domain, status: 'unreachable', error: 'connection_failed' };
  }
}

async function browserCheckDomains(domains) {
  // launchPersistentContext keeps the Chrome profile (including Safe Browsing
  // threat lists) on disk so subsequent scans don't re-download them.
  const context = await chromium.launchPersistentContext(CHROME_PROFILE, {
    channel: 'chrome',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  // Close the blank page launchPersistentContext opens automatically
  const [defaultPage] = context.pages();
  if (defaultPage) await defaultPage.close();

  const limit = pLimit(CONCURRENCY);
  try {
    return await Promise.all(
      domains.map(d => limit(async () => {
        const page = await context.newPage();
        try {
          return await checkSingleDomain(page, d);
        } finally {
          await page.close();
        }
      }))
    );
  } finally {
    await context.close();
  }
}

module.exports = { browserCheckDomains };
