const { execute: dbExecute } = require('./db');
const db = { execute: dbExecute };
const SafeBrowsingChecker = require('./safe-browsing');
const BrowserChecker = require('./lib/browser-checker');
const TelegramNotifier = require('./telegram-notifier');
const { rotate } = require('./lib/rotator');
require('dotenv').config();

// Fire rotate() on first flag from either scan method for active domains in auto-rotate funnels
async function autoRotateNewlyFlagged(newlyFlaggedIds, telegram) {
  if (!newlyFlaggedIds.length) return;
  const [candidates] = await db.execute(
    `SELECT d.domain, f.name AS funnel_name
     FROM domains d
     JOIN funnels f ON d.funnel_id = f.id
     WHERE d.id = ANY($1)
       AND d.rotator_status = 'active'
       AND f.auto_rotate = true`,
    [newlyFlaggedIds]
  );
  if (!candidates.length) return;

  console.log(`[monitor] auto-rotating ${candidates.length} domain(s) on first flag`);
  const rotations = [];
  for (const c of candidates) {
    try {
      const result = await rotate(c.domain, 'auto_monitor');
      rotations.push({ from: c.domain, to: result.toDomain, funnel: c.funnel_name, warning: result.rtWarning, directMode: result.directMode });
      console.log(`[monitor] auto-rotated ${c.domain} → ${result.toDomain || (result.directMode ? 'direct offers' : 'none')}`);
    } catch (err) {
      rotations.push({ from: c.domain, to: null, funnel: c.funnel_name, warning: err.message });
      console.error(`[monitor] auto-rotate failed for ${c.domain}:`, err.message);
    }
  }
  await telegram.notifyAutoRotated(rotations).catch(e => console.error('Telegram error:', e.message));
}

class DomainMonitor {
  constructor() {
    this.checker = new SafeBrowsingChecker();
    this.telegram = new TelegramNotifier();
    this.browserChecker = new BrowserChecker();
    this.browserScanRunning = false;
  }

  async addDomain(domain, notes = '', categoryId = null) {
    try {
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
      const [rows] = await db.execute('SELECT * FROM categories ORDER BY name');
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

  // Lookup API scan — all non-suspended active domains
  async scanDomains() {
    console.log('\n🔍 Starting domain safety scan...');

    try {
      const allDomains = await this.getActiveDomains();
      if (allDomains.length === 0) {
        console.log('ℹ️ No domains to scan');
        return { scanned: 0, safe: 0, flagged: 0, suspended: 0, newFlags: 0 };
      }

      // Skip suspended domains and banned (rotated-out) domains
      const domains = allDomains.filter(d => !d.scan_suspended && d.rotator_status !== 'banned');
      const suspendedCount = allDomains.filter(d => d.scan_suspended).length;

      if (!domains.length) {
        console.log(`ℹ️ All ${suspendedCount} domain(s) suspended — awaiting manual review`);
        return { scanned: 0, safe: 0, flagged: 0, suspended: suspendedCount, newFlags: 0 };
      }

      console.log(`📋 Scanning ${domains.length} domain(s)${suspendedCount ? ` (${suspendedCount} suspended)` : ''}...`);
      const domainUrls = domains.map(d => d.domain);
      const domainIds = domains.map(d => d.id);

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

      const recentByDomain = {};
      for (const row of recentScansRows) {
        (recentByDomain[row.domain_id] ??= []).push(row);
      }

      let safeCount = 0, flaggedCount = 0;
      const newlyFlagged = [], newlyCleared = [], newlySuspended = [];
      const toSetFlagged = [], toClearFlagged = [];
      const toLookupFlag = [], toLookupClear = [];
      const toSuspend = [];
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
          if (!domain.lookup_flagged) {
            toLookupFlag.push(domain.id);
          }
          // Both Lookup API and browser confirmed → suspend
          if (domain.browser_status === 'dangerous' && !domain.scan_suspended) {
            toSuspend.push(domain.id);
            newlySuspended.push({ domain: domain.domain, category: domain.category_name });
          }
        } else {
          safeCount++;
          if (domain.lookup_flagged) toLookupClear.push(domain.id);
          // Only clear if not browser-flagged and consistently safe in recent scans
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

      await Promise.all([
        toSetFlagged.length   && db.execute('UPDATE domains SET is_flagged = true WHERE id = ANY($1)', [toSetFlagged]),
        toClearFlagged.length && db.execute('UPDATE domains SET is_flagged = false, lookup_flagged = false WHERE id = ANY($1)', [toClearFlagged]),
        toLookupFlag.length   && db.execute('UPDATE domains SET lookup_flagged = true WHERE id = ANY($1)', [toLookupFlag]),
        toLookupClear.length  && db.execute('UPDATE domains SET lookup_flagged = false WHERE id = ANY($1)', [toLookupClear]),
        toSuspend.length      && db.execute('UPDATE domains SET scan_suspended = true WHERE id = ANY($1)', [toSuspend]),
      ].filter(Boolean));

      if (newlyFlagged.length) {
        const logRows = newlyFlagged.map(d => [d.domain, d.category || null, 'lookup_api', d.threats?.[0] || null]);
        const ph = logRows.map((_, i) => `($${i*4+1},$${i*4+2},$${i*4+3},$${i*4+4})`).join(',');
        await db.execute(
          `INSERT INTO flag_logs (domain, category, method, threat_type) VALUES ${ph}`,
          logRows.flat()
        );
      }

      if (scanRows.length) {
        const placeholders = scanRows.map((_, i) =>
          `($${i*5+1},$${i*5+2},$${i*5+3},$${i*5+4},$${i*5+5})`
        ).join(',');
        await db.execute(
          `INSERT INTO scan_results (domain_id, is_safe, threat_types, platform_types, threat_entry_types) VALUES ${placeholders}`,
          scanRows.flat()
        );
        await db.execute(
          `UPDATE domains SET last_lookup_check = NOW() WHERE id = ANY($1)`,
          [domainIds]
        );
      }

      if (toSetFlagged.length) await autoRotateNewlyFlagged(toSetFlagged, this.telegram);

      if (suspendedCount) console.log(`⏸ ${suspendedCount} domain(s) suspended (awaiting manual review)`);
      if (toSuspend.length) console.log(`🔒 ${toSuspend.length} domain(s) newly suspended (confirmed by both methods)`);
      console.log(`📊 ${safeCount} safe, ${flaggedCount} flagged`);

      if (newlyFlagged.length > 0) {
        await this.telegram.notifyFlaggedDomains(newlyFlagged).catch(e => console.error('Telegram error:', e.message));
      }
      if (newlyCleared.length > 0) {
        await this.telegram.notifyClearedDomains(newlyCleared).catch(e => console.error('Telegram error:', e.message));
      }
      if (newlySuspended.length > 0) {
        await this.telegram.notifySuspendedDomains(newlySuspended).catch(e => console.error('Telegram error:', e.message));
      }

      const [, pruned] = await db.execute(
        `DELETE FROM scan_results WHERE scan_date < NOW() - INTERVAL '7 days'`
      );
      if (pruned.rowCount > 0) console.log(`🗑️ Pruned ${pruned.rowCount} old scan record(s)`);

      console.log(`✨ Scan completed at ${new Date().toLocaleTimeString()}\n`);
      return { scanned: domains.length, safe: safeCount, flagged: flaggedCount, suspended: suspendedCount, newFlags: newlyFlagged.length };
    } catch (error) {
      console.error('❌ Scan error:', error.message);
      throw error;
    }
  }

  // Browser scan — priority domains only, sub-1-minute cycle
  async browserScanDomains() {
    if (this.browserScanRunning) {
      console.log('⏭️ Browser scan already running, skipping');
      return;
    }
    this.browserScanRunning = true;

    try {
      const allDomains = await this.getActiveDomains();

      // Only scan priority domains that aren't suspended or banned
      const domains = allDomains.filter(d => d.is_priority && !d.scan_suspended && d.rotator_status !== 'banned');

      if (!domains.length) {
        return; // silent — no priority domains configured yet
      }

      console.log(`\n🌐 Browser scan: ${domains.length} priority domain(s)...`);

      const domainUrls = domains.map(d => d.domain);
      const results = await this.browserChecker.checkDomains(domainUrls);

      const resultByDomain = {};
      for (const r of results) resultByDomain[r.domain] = r;

      const ids = [], statuses = [];
      const newDangerous = [], toSetFlagged = [], toSuspend = [], newlySuspended = [];

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
          // If Lookup API also already flagged → suspend immediately
          if (domain.lookup_flagged) {
            toSuspend.push(domain.id);
            newlySuspended.push({ domain: domain.domain, category: domain.category_name });
          }
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
        toSuspend.length && db.execute(
          'UPDATE domains SET scan_suspended = true WHERE id = ANY($1)', [toSuspend]
        ),
      ].filter(Boolean));

      if (toSetFlagged.length) await autoRotateNewlyFlagged(toSetFlagged, this.telegram);

      if (newDangerous.length) {
        const logRows = newDangerous.map(d => [d.domain, d.category || null, 'browser', 'CHROME_BROWSING']);
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
      if (newlySuspended.length) {
        await this.telegram.notifySuspendedDomains(newlySuspended).catch(e => console.error('Telegram error:', e.message));
      }
    } catch (error) {
      console.error('❌ Browser scan error:', error.message);
    } finally {
      this.browserScanRunning = false;
    }
  }

  // Manual scan for a flagged or suspended domain — called by user after external cleanup
  async manualScanDomain(domainId) {
    const [rows] = await db.execute(
      `SELECT d.*, c.name as category_name, c.color as category_color
       FROM domains d LEFT JOIN categories c ON d.category_id = c.id
       WHERE d.id = $1 AND d.is_active = true`,
      [domainId]
    );
    if (!rows.length) throw new Error('Domain not found');
    const domain = rows[0];

    if (!domain.scan_suspended && !domain.is_flagged) {
      throw new Error('Domain is not flagged or suspended');
    }

    console.log(`\n🔬 Manual scan for ${domain.domain}...`);

    // Lookup API check
    const lookupResults = await this.checker.checkDomains([domain.domain]);
    const lookup = lookupResults[domain.domain];
    const lookupClean = lookup.is_safe;

    // Browser check (if Chrome is alive)
    let browserStatus = domain.browser_status;
    if (this.browserChecker.context && this.browserChecker.page) {
      try {
        const browserResults = await this.browserChecker.checkDomains([domain.domain]);
        browserStatus = browserResults[0]?.status || 'error';
        await db.execute(
          'UPDATE domains SET browser_status = $1, last_browser_check = NOW() WHERE id = $2',
          [browserStatus, domainId]
        );
      } catch (e) {
        console.warn('[manual scan] browser check failed:', e.message);
      }
    }

    const browserClean = browserStatus !== 'dangerous';
    const isClean = lookupClean && browserClean;

    console.log(`🔬 ${domain.domain}: lookup=${lookupClean ? 'clean' : 'flagged'}, browser=${browserStatus}`);

    if (isClean) {
      await db.execute(
        `UPDATE domains SET
           is_flagged = false,
           scan_suspended = false,
           lookup_flagged = false,
           browser_status = $1
         WHERE id = $2`,
        [browserClean ? 'safe' : browserStatus, domainId]
      );

      console.log(`✅ ${domain.domain} is clean — flags cleared, monitoring resumed`);

      await this.telegram.notifyClearedDomains([{
        domain: domain.domain, category: domain.category_name, scanDate: new Date()
      }]).catch(e => console.error('Telegram error:', e.message));
    } else {
      console.log(`⚠️ ${domain.domain} still flagged — keeping suspended`);
    }

    return {
      clean: isClean,
      domain: domain.domain,
      lookupClean,
      browserStatus,
      threats: lookup.threats.map(t => t.threatType).filter(Boolean)
    };
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
          COUNT(DISTINCT CASE WHEN d.is_suspicious = true AND d.is_flagged = false THEN d.id END)::int AS suspicious_domains,
          COUNT(DISTINCT CASE WHEN d.scan_suspended = true THEN d.id END)::int AS suspended_domains,
          COUNT(DISTINCT CASE WHEN d.is_priority = true THEN d.id END)::int AS priority_domains
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
}

module.exports = DomainMonitor;
