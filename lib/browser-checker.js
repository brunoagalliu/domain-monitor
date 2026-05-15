const { chromium } = require('playwright');
const pLimit = require('p-limit');

const CONCURRENCY = 20;
const TIMEOUT = 12000;

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

async function checkSingleDomain(browser, domain) {
  const page = await browser.newPage();
  try {
    await page.goto(`https://${domain}`, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT,
    });

    const finalUrl = page.url();
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
    if (/ERR_CERT|ERR_SSL|certificate|SSL/i.test(msg)) {
      const code = msg.match(/ERR_[A-Z_]+/)?.[0] || 'ssl_error';
      return { domain, status: 'ssl_error', error: code };
    }
    if (/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/i.test(msg)) {
      return { domain, status: 'unreachable', error: 'dns_failed' };
    }
    return { domain, status: 'unreachable', error: 'connection_failed' };
  } finally {
    await page.close();
  }
}

async function browserCheckDomains(domains) {
  const browser = await chromium.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-accelerated-2d-canvas',
    ],
  });
  const limit = pLimit(CONCURRENCY);
  try {
    return await Promise.all(
      domains.map(d => limit(() => checkSingleDomain(browser, d)))
    );
  } finally {
    await browser.close();
  }
}

module.exports = { browserCheckDomains };
