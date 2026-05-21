const { execute: dbExecute } = require('./db');
const db = { execute: dbExecute };
const SafeBrowsingChecker = require('./safe-browsing');
const BrowserChecker = require('./lib/browser-checker');
const TelegramNotifier = require('./telegram-notifier');
require('dotenv').config();

class DomainMonitor {
  constructor() {
    this.checker = new SafeBrowsingChecker();
    this.telegram = new TelegramNotifier();
    this.browserChecker = new BrowserChecker();
    this.browserScanRunning = false;
  }

  async addDomain(domain, notes = '', categoryId = null) {
    try {
      // Clean the domain (remove protocol if present)
      domain = domain.replace(/^https?:\/\//, '').toLowerCase();
      
      const [rows] = await db.execute(
        `INSERT INTO domains (domain, notes, category_id) VALUES ($1, $2, $3)
         ON CONFLICT (domain) DO UPDATE SET notes = EXCLUDED.notes, is_active = true, category_id = EXCLUDED.category_id
         RETURNING id`,
        [domain, notes, categoryId]
      );

      console.log(`✅ Domain added: ${domain}`);
      return rows[0].id;
    } catch (error) {
      console.error('Error adding domain:', error);
      throw error;
    }
  }

  async getCategories() {
    try {
      const [rows] = await db.execute(
        'SELECT * FROM categories ORDER BY name'
      );
      return rows;
    } catch (error) {
      console.error('Error fetching categories:', error);
      throw error;
    }
  }

  async addCategory(name, color = '#667eea') {
    try {
      const [rows] = await db.execute(
        'INSERT INTO categories (name, color) VALUES ($1, $2) RETURNING id',
        [name, color]
      );
      return rows[0].id;
    } catch (error) {
      console.error('Error adding category:', error);
      throw error;
    }
  }

  async getActiveDomains() {
    try {
      const [rows] = await db.execute(
        `SELECT d.*, c.name as category_name, c.color as category_color 
         FROM domains d 
         LEFT JOIN categories c ON d.category_id = c.id 
         WHERE d.is_active = true 
         ORDER BY c.name, d.domain`
      );
      return rows;
    } catch (error) {
      console.error('Error fetching domains:', error);
      throw error;
    }
  }

  async scanDomains() {
    console.log('\n🔍 Starting domain safety scan...');

    try {
      const domains = await this.getActiveDomains();
      if (domains.length === 0) {
        console.log('ℹ️ No domains to scan');
        return { scanned: 0, safe: 0, flagged: 0, suspicious: 0, newFlags: 0 };
      }

      console.log(`📋 Scanning ${domains.length} domain(s)...`);
      const domainUrls = domains.map(d => d.domain);

      const domainIds = domains.map(d => d.id);

      // Run Lookup API + batch-fetch recent scan history in parallel
      const [lookupResults, recentScansRows] = await Promise.all([
        this.checker.checkDomains(domainUrls),
        db.execute(`
          SELECT domain_id, is_safe
          FROM (
            SELECT domain_id, is_safe,
                   ROW_NUMBER() OVER (PARTITION BY domain_id ORDER BY id DESC) AS rn
            FROM scan_results WHERE domain_id = ANY($1)
          ) ranked WHERE rn <= 10
        `, [domainIds]).then(([rows]) => rows)
      ]);

      // Index recent scans by domain_id
      const recentByDomain = {};
      for (const row of recentScansRows) {
        (recentByDomain[row.domain_id] ??= []).push(row);
      }

      let safeCount = 0, flaggedCount = 0;
      const newlyFlagged = [], newlyCleared = [];
      const toSetFlagged = [], toClearFlagged = [];
      const scanRows = [];

      for (const domain of domains) {
        const lookup = lookupResults[domain.domain];
        const lookupFlagged = !lookup.is_safe;

        const recent = recentByDomain[domain.id] || [];
        const allSafe = recent.length >= 10 && recent.every(s => s.is_safe === true);

        if (lookupFlagged) {
          flaggedCount++;
          if (!domain.is_flagged) {
            toSetFlagged.push(domain.id);
            newlyFlagged.push({
              domain: domain.domain, category: domain.category_name,
              threats: lookup.threats.map(t => t.threatType).filter(Boolean),
              scanDate: new Date()
            });
          }
        } else {
          safeCount++;
          // Don't clear a browser-flagged domain on Lookup API alone — wait until
          // Chrome also confirms it's safe, preventing premature clears when the
          // browser detects a threat before Google's hash lists catch up.
          if (domain.is_flagged && allSafe && domain.browser_status !== 'dangerous') {
            toClearFlagged.push(domain.id);
            newlyCleared.push({ domain: domain.domain, category: domain.category_name, scanDate: new Date() });
          }
        }

        scanRows.push([
          domain.id, lookup.is_safe,
          JSON.stringify(lookup.threats.map(t => t.threatType).filter(Boolean)),
          JSON.stringify(lookup.threats.map(t => t.platformType).filter(Boolean)),
          JSON.stringify(lookup.threats.map(t => t.threatEntryType).filter(Boolean))
        ]);

        console.log(`${lookupFlagged ? '🚨' : '✅'} ${domain.domain}: ${lookupFlagged ? 'FLAGGED' : 'SAFE'}`);
      }

      // Batch UPDATE domains
      await Promise.all([
        toSetFlagged.length   && db.execute('UPDATE domains SET is_flagged = true WHERE id = ANY($1)', [toSetFlagged]),
        toClearFlagged.length && db.execute('UPDATE domains SET is_flagged = false WHERE id = ANY($1)', [toClearFlagged]),
      ].filter(Boolean));

      // Log new flags
      if (newlyFlagged.length) {
        const logRows = newlyFlagged.map(d => [d.domain, d.category || null, 'lookup_api', d.threats?.[0] || null]);
        const ph = logRows.map((_, i) => `($${i*4+1},$${i*4+2},$${i*4+3},$${i*4+4})`).join(',');
        await db.execute(
          `INSERT INTO flag_logs (domain, category, method, threat_type) VALUES ${ph}`,
          logRows.flat()
        );
      }

      // Batch INSERT scan results
      if (scanRows.length) {
        const placeholders = scanRows.map((_, i) =>
          `($${i*5+1},$${i*5+2},$${i*5+3},$${i*5+4},$${i*5+5})`
        ).join(',');
        await db.execute(
          `INSERT INTO scan_results (domain_id, is_safe, threat_types, platform_types, threat_entry_types) VALUES ${placeholders}`,
          scanRows.flat()
        );
      }

      console.log(`📊 ${safeCount} safe, ${flaggedCount} flagged`);

      // Telegram notifications
      if (newlyFlagged.length > 0) {
        await this.telegram.notifyFlaggedDomains(newlyFlagged).catch(e => console.error('Telegram error:', e.message));
      }
      if (newlyCleared.length > 0) {
        await this.telegram.notifyClearedDomains(newlyCleared).catch(e => console.error('Telegram error:', e.message));
      }

      // Prune old scan results
      const [, pruned] = await db.execute(
        `DELETE FROM scan_results WHERE scan_date < NOW() - INTERVAL '7 days'`
      );
      if (pruned.rowCount > 0) console.log(`🗑️ Pruned ${pruned.rowCount} old scan record(s)`);

      console.log(`✨ Scan completed at ${new Date().toLocaleTimeString()}\n`);
      return { scanned: domains.length, safe: safeCount, flagged: flaggedCount, newFlags: newlyFlagged.length };
    } catch (error) {
      console.error('❌ Scan error:', error.message);
      throw error;
    }
  }

  async getRecentScans(limit = 10) {
    try {
      const [rows] = await db.execute(`
        SELECT 
          d.domain,
          sr.scan_date,
          sr.is_safe,
          sr.threat_types
        FROM scan_results sr
        JOIN domains d ON sr.domain_id = d.id
        ORDER BY sr.scan_date DESC
        LIMIT $1
      `, [limit]);
      
      return rows;
    } catch (error) {
      console.error('Error fetching recent scans:', error);
      throw error;
    }
  }

  async getDomainStats() {
    try {
      const [stats] = await db.execute(`
        SELECT
          COUNT(DISTINCT d.id)::int AS total_domains,
          COUNT(DISTINCT CASE WHEN sr.is_safe = true THEN d.id END)::int AS safe_domains,
          COUNT(DISTINCT CASE WHEN d.is_flagged = true THEN d.id END)::int AS flagged_domains,
          COUNT(DISTINCT CASE WHEN d.is_suspicious = true AND d.is_flagged = false THEN d.id END)::int AS suspicious_domains
        FROM domains d
        LEFT JOIN scan_results sr ON d.id = sr.domain_id
          AND sr.id = (SELECT MAX(sr2.id) FROM scan_results sr2 WHERE sr2.domain_id = d.id)
        WHERE d.is_active = true
      `);
      return stats[0];
    } catch (error) {
      console.error('Error fetching stats:', error);
      throw error;
    }
  }
  async browserScanDomains() {
    if (this.browserScanRunning) {
      console.log('⏭️ Browser scan already running, skipping');
      return;
    }
    this.browserScanRunning = true;
    console.log('\n🌐 Starting browser scan...');

    try {
      const domains = await this.getActiveDomains();
      if (!domains.length) return;

      const domainUrls = domains.map(d => d.domain);
      const results = await this.browserChecker.checkDomains(domainUrls);

      const resultByDomain = {};
      for (const r of results) resultByDomain[r.domain] = r;

      const ids = [], statuses = [];
      const newDangerous = [], toSetFlagged = [];

      for (const domain of domains) {
        const result = resultByDomain[domain.domain];
        if (!result) continue;

        const { status } = result;
        if (status !== 'safe' && status !== 'dangerous') continue;
        ids.push(domain.id);
        statuses.push(status);

        if (status === 'dangerous' && domain.browser_status !== 'dangerous') {
          newDangerous.push({
            domain: domain.domain, category: domain.category_name,
            scanDate: new Date()
          });
          if (!domain.is_flagged) toSetFlagged.push(domain.id);
          console.log(`🚨 ${domain.domain}: dangerous (browser Safe Browsing)`);
        }
      }

      await Promise.all([
        ids.length && db.execute(
          `UPDATE domains SET browser_status = v.s, last_browser_check = NOW()
           FROM (SELECT unnest($1::int[]) id, unnest($2::text[]) s) v
           WHERE domains.id = v.id`,
          [ids, statuses]
        ),
        toSetFlagged.length && db.execute(
          'UPDATE domains SET is_flagged = true WHERE id = ANY($1)', [toSetFlagged]
        ),
      ].filter(Boolean));

      // Log new browser flags
      if (newDangerous.length) {
        const logRows = newDangerous.map(d => [d.domain, d.category || null, 'browser', null]);
        const ph = logRows.map((_, i) => `($${i*4+1},$${i*4+2},$${i*4+3},$${i*4+4})`).join(',');
        await db.execute(
          `INSERT INTO flag_logs (domain, category, method, threat_type) VALUES ${ph}`,
          logRows.flat()
        );
      }

      const dangerousCount = results.filter(r => r.status === 'dangerous').length;
      console.log(`🌐 Browser scan done: ${domains.length - dangerousCount} safe, ${dangerousCount} dangerous\n`);

      if (newDangerous.length) {
        await this.telegram.notifyBrowserIssues(newDangerous).catch(e => console.error('Telegram error:', e.message));
      }
    } catch (error) {
      console.error('❌ Browser scan error:', error.message);
    } finally {
      this.browserScanRunning = false;
    }
  }
}

module.exports = DomainMonitor;