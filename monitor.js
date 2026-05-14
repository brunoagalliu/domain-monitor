const { execute: dbExecute } = require('./db');
const db = { execute: dbExecute };
const SafeBrowsingChecker = require('./safe-browsing');
const SafeBrowsingUpdateClient = require('./lib/safebrowsing-update');
const TelegramNotifier = require('./telegram-notifier');
require('dotenv').config();

class DomainMonitor {
  constructor() {
    this.checker = new SafeBrowsingChecker();
    this.updateClient = new SafeBrowsingUpdateClient(db);
    this.telegram = new TelegramNotifier();
    this.updateClientReady = false;
  }

  async ensureUpdateClient() {
    if (this.updateClientReady) return;
    await this.updateClient.init();
    this.updateClientReady = true;
    // Fetch threat lists immediately if empty
    await this.updateClient.fetchUpdates();
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

      // Run both APIs in parallel
      await this.ensureUpdateClient();
      const [lookupResults, updateResults] = await Promise.all([
        this.checker.checkDomains(domainUrls),
        this.updateClient.checkDomains(domainUrls)
      ]);

      let safeCount = 0, flaggedCount = 0, suspiciousCount = 0;
      const newlyFlagged = [], newlyCleared = [], newlySuspicious = [];

      for (const domain of domains) {
        const lookup = lookupResults[domain.domain];
        const updateMatch = updateResults[domain.domain]; // { threatType } or undefined

        const lookupFlagged = !lookup.is_safe;
        const updateFlagged = !!updateMatch;

        // Fetch last 10 scan results for cleared confirmation
        const [recentScans] = await db.execute(
          `SELECT is_safe FROM scan_results WHERE domain_id = $1 ORDER BY id DESC LIMIT 10`,
          [domain.id]
        );
        const allSafe = recentScans.length >= 10 && recentScans.every(s => s.is_safe === true);
        const last3Safe = recentScans.length >= 3 && recentScans.slice(0, 3).every(s => s.is_safe === true);

        if (lookupFlagged) {
          // ── Lookup API flagged ──────────────────────────────────────
          flaggedCount++;
          if (!domain.is_flagged) {
            await db.execute(
              `UPDATE domains SET is_flagged = true, is_suspicious = false WHERE id = $1`,
              [domain.id]
            );
            newlyFlagged.push({
              domain: domain.domain,
              category: domain.category_name,
              threats: lookup.threats.map(t => t.threatType).filter(Boolean),
              scanDate: new Date()
            });
          } else if (domain.is_suspicious) {
            // Upgrade: was suspicious, now confirmed flagged
            await db.execute(
              `UPDATE domains SET is_flagged = true, is_suspicious = false WHERE id = $1`,
              [domain.id]
            );
          }
        } else if (updateFlagged && !domain.is_flagged) {
          // ── Update API flagged, Lookup still safe → suspicious ──────
          suspiciousCount++;
          if (!domain.is_suspicious) {
            await db.execute(
              `UPDATE domains SET is_suspicious = true WHERE id = $1`,
              [domain.id]
            );
            newlySuspicious.push({
              domain: domain.domain,
              category: domain.category_name,
              threatType: updateMatch.threatType,
              scanDate: new Date()
            });
          }
        } else {
          // ── Both APIs say safe ──────────────────────────────────────
          safeCount++;

          if (domain.is_flagged && allSafe) {
            await db.execute(
              `UPDATE domains SET is_flagged = false WHERE id = $1`,
              [domain.id]
            );
            newlyCleared.push({ domain: domain.domain, category: domain.category_name, scanDate: new Date() });
          }

          if (domain.is_suspicious && !updateFlagged && last3Safe) {
            await db.execute(
              `UPDATE domains SET is_suspicious = false WHERE id = $1`,
              [domain.id]
            );
          }
        }

        // Save scan result
        await db.execute(
          `INSERT INTO scan_results (domain_id, is_safe, threat_types, platform_types, threat_entry_types)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            domain.id,
            lookup.is_safe,
            JSON.stringify(lookup.threats.map(t => t.threatType).filter(Boolean)),
            JSON.stringify(lookup.threats.map(t => t.platformType).filter(Boolean)),
            JSON.stringify(lookup.threats.map(t => t.threatEntryType).filter(Boolean))
          ]
        );

        const statusIcon = lookupFlagged ? '🚨' : updateFlagged ? '⚠️' : '✅';
        const statusLabel = lookupFlagged ? 'FLAGGED' : updateFlagged ? 'SUSPICIOUS' : 'SAFE';
        console.log(`${statusIcon} ${domain.domain}: ${statusLabel}`);
      }

      console.log(`📊 ${safeCount} safe, ${flaggedCount} flagged, ${suspiciousCount} suspicious`);

      // Telegram notifications
      if (newlyFlagged.length > 0) {
        await this.telegram.notifyFlaggedDomains(newlyFlagged).catch(e => console.error('Telegram error:', e.message));
      }
      if (newlySuspicious.length > 0) {
        await this.telegram.notifySuspiciousDomains(newlySuspicious).catch(e => console.error('Telegram error:', e.message));
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
      return { scanned: domains.length, safe: safeCount, flagged: flaggedCount, suspicious: suspiciousCount, newFlags: newlyFlagged.length };
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
}

module.exports = DomainMonitor;