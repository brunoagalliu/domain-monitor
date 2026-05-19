const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const pLimit = require('p-limit');
const path = require('path');
const fs = require('fs');

const CONCURRENCY = 3;
const TIMEOUT = 10000;
const CHROME_PROFILE = process.env.CHROME_PROFILE_PATH || '/tmp/chrome-safe-browsing-profile';
const XVFB_DISPLAY = ':99';
const USE_XVFB = process.platform === 'linux';

// Delete known large cache dirs only. Avoid touching top-level profile files
// (Local State, lockfile, etc.) that Chrome needs to start correctly.
function purgeChromeCache() {
  // Large dirs inside Default/ that are safe to delete
  const defaultCacheDirs = [
    'Cache', 'Code Cache', 'GPUCache', 'Media Cache',
    'DawnCache', 'IndexedDB', 'blob_storage', 'Session Storage',
  ];
  const defaultDir = path.join(CHROME_PROFILE, 'Default');
  for (const dir of defaultCacheDirs) {
    try { fs.rmSync(path.join(defaultDir, dir), { recursive: true, force: true }); } catch {}
  }
  // Large top-level dirs (shader caches, crash reports)
  const topLevelCacheDirs = ['GrShaderCache', 'ShaderCache', 'Crashpad'];
  for (const dir of topLevelCacheDirs) {
    try { fs.rmSync(path.join(CHROME_PROFILE, dir), { recursive: true, force: true }); } catch {}
  }
}

// Write Chrome preferences to enable Enhanced Protection before launch.
// Enhanced Protection sends URLs to Google in real-time — much more comprehensive
// than Standard Protection's local hash lists.
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

class BrowserChecker {
  constructor() {
    this.context = null;
    this.xvfb = null;
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
    purgeChromeCache();

    if (USE_XVFB) await this.startXvfb();

    this.context = await chromium.launchPersistentContext(CHROME_PROFILE, {
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
        '--disable-features=InfiniteSessionRestore',
        '--restore-last-session=0',
        '--no-zygote',
        // Prevent Chrome from accumulating GBs of cache on the Railway volume.
        // We only need Safe Browsing data — not network/shader/media caches.
        '--disk-cache-size=1',
        '--media-cache-size=1',
        '--disable-gpu-shader-disk-cache',
      ],
    });

    const [defaultPage] = this.context.pages();
    if (defaultPage) await defaultPage.close();

    // Give Chrome a moment to fully initialise before accepting new tabs.
    // Without this, the first newPage() call can race and fail.
    if (USE_XVFB) await new Promise(r => setTimeout(r, 2000));

    console.log(`🌐 Browser checker ready (${USE_XVFB ? 'headed + Xvfb' : 'headless'}, Enhanced Safe Browsing active)`);
  }

  async checkDomain(page, domain) {
    // Abort everything except the main document — we only need Chrome's navigation
    // decision, not the page content.
    await page.route('**/*', route =>
      route.request().resourceType() === 'document' ? route.continue() : route.abort()
    );

    try {
      await page.goto(`https://${domain}`, {
        // 'commit' fires as soon as Chrome commits to a URL. Safe Browsing runs
        // before commit, so chrome-error:// is already set when this resolves.
        waitUntil: 'commit',
        timeout: TIMEOUT,
      });

      // When Chrome Safe Browsing blocks a URL it never loads the target site —
      // it renders its own interstitial at chrome-error://chromewebdata/ instead.
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
    }
  }

  async checkDomains(domains) {
    if (!this.context) await this.init();
    const limit = pLimit(CONCURRENCY);
    try {
      return await Promise.all(
        domains.map(d => limit(async () => {
          const page = await this.context.newPage();
          try {
            return await this.checkDomain(page, d);
          } finally {
            await page.close().catch(() => {});
          }
        }))
      );
    } catch (err) {
      if (/has been closed|Target page|browser has been closed|Failed to open a new tab/i.test(err.message)) {
        console.log('🔄 Browser context not ready, reinitialising...');
        this.context = null;
        await this.init();
        return this.checkDomains(domains);
      }
      throw err;
    }
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
