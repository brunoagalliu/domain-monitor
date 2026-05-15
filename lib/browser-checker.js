const { chromium } = require('playwright');
const { spawn } = require('child_process');
const pLimit = require('p-limit');

const CONCURRENCY = 20;
const TIMEOUT = 12000;
const CHROME_PROFILE = '/tmp/chrome-safe-browsing-profile';
const XVFB_DISPLAY = ':99';

// Use headed Chrome on Linux (Railway) so Safe Browsing downloads its lists.
// On macOS (local dev) stay headless — Safe Browsing is handled by the API.
const USE_XVFB = process.platform === 'linux';

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
  return clean.split('.').slice(-2).join('.');
}

async function checkSingleDomain(page, domain) {
  try {
    await page.goto(`https://${domain}`, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT,
    });

    const finalUrl = page.url();

    // chrome-error:// means Chrome blocked the navigation (Safe Browsing)
    if (finalUrl.startsWith('chrome-error://') || finalUrl.startsWith('chrome://')) {
      return { domain, status: 'dangerous' };
    }

    // Safe Browsing interstitial HTML — body has class="safe-browsing"
    const blocked = await page.$('body.safe-browsing').then(el => !!el).catch(() => false);
    if (blocked) return { domain, status: 'dangerous' };

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

class BrowserChecker {
  constructor() {
    this.context = null;
    this.xvfb = null;
  }

  async startXvfb() {
    this.xvfb = spawn('Xvfb', [XVFB_DISPLAY, '-screen', '0', '1280x720x24', '-ac']);
    this.xvfb.on('error', e => console.error('❌ Xvfb error:', e.message));
    process.env.DISPLAY = XVFB_DISPLAY;
    // Give Xvfb a moment to initialise before Chrome connects
    await new Promise(r => setTimeout(r, 1000));
  }

  async init() {
    if (this.context) return;

    if (USE_XVFB) await this.startXvfb();

    this.context = await chromium.launchPersistentContext(CHROME_PROFILE, {
      channel: 'chrome',
      // headed on Railway (Xvfb) so Safe Browsing works; headless locally
      headless: !USE_XVFB,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1280,720',
      ],
    });

    const [defaultPage] = this.context.pages();
    if (defaultPage) await defaultPage.close();

    const mode = USE_XVFB ? 'headed + Xvfb' : 'headless';
    console.log(`🌐 Browser checker ready (${mode}, Safe Browsing lists downloading...)`);
  }

  async checkDomains(domains) {
    if (!this.context) await this.init();
    const limit = pLimit(CONCURRENCY);
    return Promise.all(
      domains.map(d => limit(async () => {
        const page = await this.context.newPage();
        try {
          return await checkSingleDomain(page, d);
        } finally {
          await page.close();
        }
      }))
    );
  }

  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.xvfb) {
      this.xvfb.kill();
      this.xvfb = null;
    }
  }
}

module.exports = BrowserChecker;
