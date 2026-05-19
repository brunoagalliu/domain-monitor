const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const CONCURRENCY = 3;
const TIMEOUT = 10000;
const CHROME_PROFILE = process.env.CHROME_PROFILE_PATH || '/tmp/chrome-safe-browsing-profile';
const XVFB_DISPLAY = ':99';
const USE_XVFB = process.platform === 'linux';

function enableEnhancedProtection() {
  const prefsDir = path.join(CHROME_PROFILE, 'Default');
  const prefsFile = path.join(prefsDir, 'Preferences');
  try {
    fs.mkdirSync(prefsDir, { recursive: true });
    let prefs = {};
    try { prefs = JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch {}
    prefs.safebrowsing = { ...(prefs.safebrowsing || {}), enabled: true, enhanced: true };
    fs.writeFileSync(prefsFile, JSON.stringify(prefs));
  } catch (e) {
    console.warn('[browser] could not set Safe Browsing preferences:', e.message);
  }
}

// Simple page pool: pages are created once at init and reused across all scans.
// This avoids repeated context.newPage() calls which trigger renderer forks on
// every check — the main cause of crashes under Railway's process limits.
class PagePool {
  constructor(pages) {
    this._available = [...pages];
    this._queue = [];
  }

  acquire() {
    return new Promise(resolve => {
      if (this._available.length > 0) {
        resolve(this._available.pop());
      } else {
        this._queue.push(resolve);
      }
    });
  }

  release(page) {
    if (this._queue.length > 0) {
      this._queue.shift()(page);
    } else {
      this._available.push(page);
    }
  }
}

class BrowserChecker {
  constructor() {
    this.context = null;
    this.pool = null;
    this.xvfb = null;
    this.lastError = null;
  }

  async startXvfb() {
    this.xvfb = spawn('Xvfb', [XVFB_DISPLAY, '-screen', '0', '1280x720x24', '-ac']);
    this.xvfb.on('error', e => console.error('Xvfb error:', e.message));
    process.env.DISPLAY = XVFB_DISPLAY;
    await new Promise(r => setTimeout(r, 1000));
  }

  async init() {
    if (this.context) return;

    try { execSync(`pkill -f "${CHROME_PROFILE}"`, { stdio: 'ignore' }); } catch {}
    await new Promise(r => setTimeout(r, 800));
    for (const lock of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      try { fs.rmSync(`${CHROME_PROFILE}/${lock}`); } catch {}
    }

    enableEnhancedProtection();

    if (USE_XVFB) await this.startXvfb();

    const launchOpts = {
      channel: 'chrome',
      headless: !USE_XVFB,
      timeout: 60000,
      ignoreDefaultArgs: [
        '--disable-client-side-phishing-detection',
        '--disable-background-networking',
        '--disable-component-update',
      ],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1280,720',
        '--disable-session-crashed-bubble',
        '--disable-features=InfiniteSessionRestore,IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--restore-last-session=0',
        '--no-zygote',
        '--renderer-process-limit=1',
      ],
    };

    try {
      this.context = await chromium.launchPersistentContext(CHROME_PROFILE, launchOpts);
    } catch (err) {
      console.warn('[browser] launch failed, resetting profile:', err.message.split('\n')[0]);
      try { fs.rmSync(CHROME_PROFILE, { recursive: true, force: true }); } catch {}
      enableEnhancedProtection();
      this.context = await chromium.launchPersistentContext(CHROME_PROFILE, launchOpts);
    }

    this.context.on('close', () => {
      console.error('[browser] ⚠️ Chrome context closed unexpectedly');
      this.context = null;
      this.pool = null;
    });

    // Close the default page Chrome opens on launch
    const [defaultPage] = this.context.pages();
    if (defaultPage) await defaultPage.close();

    // Pre-create the page pool — renderer forks happen here once, not per-domain
    const pages = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      pages.push(await this.context.newPage());
    }
    this.pool = new PagePool(pages);

    if (USE_XVFB) await new Promise(r => setTimeout(r, 2000));

    console.log(`🌐 Browser checker ready (${USE_XVFB ? 'headed+Xvfb' : 'headless'} Chrome, Enhanced Safe Browsing active)`);
  }

  async checkDomain(page, domain) {
    await page.unroute('**/*').catch(() => {});
    await page.route('**/*', route =>
      route.request().resourceType() === 'document' ? route.continue() : route.abort()
    );

    try {
      await page.goto(`https://${domain}`, { waitUntil: 'commit', timeout: TIMEOUT });

      const finalUrl = page.url();
      if (finalUrl.startsWith('chrome-error://') || finalUrl.startsWith('chrome://interstitialpage')) {
        return { domain, status: 'dangerous' };
      }
      return { domain, status: 'safe' };
    } catch (err) {
      const msg = err.message || '';
      if (/ERR_BLOCKED_BY_CLIENT|ERR_BLOCKED_BY_ADMINISTRATOR|ERR_UNSAFE_REDIRECT/i.test(msg)) {
        return { domain, status: 'dangerous' };
      }
      return { domain, status: 'safe' };
    } finally {
      // Reset page to a clean state before returning it to the pool
      await page.goto('about:blank', { timeout: 3000 }).catch(() => {});
    }
  }

  async checkDomains(domains) {
    if (!this.context || !this.pool) {
      try {
        await this.init();
      } catch (err) {
        this.lastError = err.message.split('\n')[0];
        return domains.map(d => ({ domain: d, status: 'error' }));
      }
    }

    let contextDied = false;

    const results = await Promise.all(
      domains.map(async domain => {
        const page = await this.pool.acquire();
        try {
          return await this.checkDomain(page, domain);
        } catch (err) {
          const msg = (err.message || err.toString()).split('\n')[0];
          this.lastError = msg;
          console.error(`[browser] ❌ ${domain}: ${msg}`);
          if (/has been closed|Target page|browser has been closed|Failed to open a new tab|properties of null/i.test(msg)) {
            contextDied = true;
          }
          return { domain, status: 'error' };
        } finally {
          this.pool.release(page);
        }
      })
    );

    if (contextDied) {
      console.log('⚠️ Browser context died during scan, will re-init on next run');
      this.context = null;
      this.pool = null;
    }

    return results;
  }

  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.pool = null;
    }
    if (this.xvfb) {
      this.xvfb.kill();
      this.xvfb = null;
    }
  }
}

module.exports = BrowserChecker;
