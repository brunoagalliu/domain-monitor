const { execute: dbExecute } = require('./db');
const db = { execute: dbExecute };
const SafeBrowsingChecker = require('./safe-browsing');
const TelegramNotifier = require('./telegram-notifier');
require('dotenv').config();

class DomainMonitor {
  constructor() {
    this.checker = new SafeBrowsingChecker();
    this.telegram = new TelegramNotifier();
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
    console.log('─'.repeat(50));
    
    try {
      const domains = await this.getActiveDomains();
      
      if (domains.length === 0) {
        console.log('ℹ️ No domains to scan');
        return { scanned: 0, safe: 0, flagged: 0, newFlags: 0 };
      }

      console.log(`📋 Scanning ${domains.length} domain(s)...`);
      
      const domainUrls = domains.map(d => d.domain);
      const results = await this.checker.checkDomains(domainUrls);
      
      let safeCount = 0;
      let flaggedCount = 0;
      let newlyFlaggedDomains = [];
      let newlyClearedDomains = [];

      // Save results for each domain
      for (const domain of domains) {
        const result = results[domain.domain];

        // Fetch last 10 scan results to confirm cleared
        const [recentScans] = await db.execute(
          `SELECT is_safe FROM scan_results
           WHERE domain_id = $1
           ORDER BY id DESC
           LIMIT 10`,
          [domain.id]
        );

        const isConfirmedCleared = recentScans.length >= 10 && recentScans.every(s => s.is_safe === true);

        if (result.is_safe) {
          safeCount++;
          if (domain.is_flagged && isConfirmedCleared) {
            await db.execute(`UPDATE domains SET is_flagged = false WHERE id = $1`, [domain.id]);
            newlyClearedDomains.push({
              domain: domain.domain,
              category: domain.category_name,
              scanDate: new Date()
            });
          }
        } else {
          flaggedCount++;
          if (!domain.is_flagged) {
            await db.execute(`UPDATE domains SET is_flagged = true WHERE id = $1`, [domain.id]);
            newlyFlaggedDomains.push({
              domain: domain.domain,
              category: domain.category_name,
              threats: result.threats.map(t => t.threatType || null).filter(Boolean),
              scanDate: new Date()
            });
          }
        }

        // Save scan result to database
        await db.execute(
          `INSERT INTO scan_results
           (domain_id, is_safe, threat_types, platform_types, threat_entry_types)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            domain.id,
            result.is_safe,
            JSON.stringify(result.threats.map(t => t.threatType || null).filter(Boolean)),
            JSON.stringify(result.threats.map(t => t.platformType || null).filter(Boolean)),
            JSON.stringify(result.threats.map(t => t.threatEntryType || null).filter(Boolean))
          ]
        );

        // Log result for each domain
        if (result.is_safe) {
          console.log(`✅ ${domain.domain}: SAFE`);
        } else {
          console.log(`🚨 ${domain.domain}: FLAGGED`);
          if (result.threats.length > 0) {
            result.threats.forEach(threat => {
              console.log(`   └─ Threat: ${threat.threatType}`);
            });
          }
        }
      }

      console.log('─'.repeat(50));
      console.log(`📊 Scan Summary: ${safeCount} safe, ${flaggedCount} flagged`);
      
      // Send Telegram notification for newly flagged domains
      if (newlyFlaggedDomains.length > 0) {
        console.log(`📱 Sending Telegram alert for ${newlyFlaggedDomains.length} newly flagged domain(s)...`);
        try {
          await this.telegram.notifyFlaggedDomains(newlyFlaggedDomains);
          console.log('✅ Telegram notification sent');
        } catch (error) {
          console.error('⚠️ Telegram notification failed:', error.message);
        }
      }

      // Send Telegram notification for cleared domains
      if (newlyClearedDomains.length > 0) {
        console.log(`📱 Sending Telegram alert for ${newlyClearedDomains.length} cleared domain(s)...`);
        try {
          await this.telegram.notifyClearedDomains(newlyClearedDomains);
          console.log('✅ Telegram cleared notification sent');
        } catch (error) {
          console.error('⚠️ Telegram notification failed:', error.message);
        }
      }

      // Prune scan results older than 7 days
      const [, pruneResult] = await db.execute(
        `DELETE FROM scan_results WHERE scan_date < NOW() - INTERVAL '7 days'`
      );
      if (pruneResult.rowCount > 0) {
        console.log(`🗑️ Pruned ${pruneResult.rowCount} old scan record(s)`);
      }

      console.log(`✨ Scan completed at ${new Date().toLocaleTimeString()}\n`);
      
      return {
        scanned: domains.length,
        safe: safeCount,
        flagged: flaggedCount,
        newFlags: newlyFlaggedDomains.length,
        cleared: newlyClearedDomains.length
      };
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
          COUNT(DISTINCT d.id) as total_domains,
          COUNT(DISTINCT CASE WHEN sr.is_safe = true THEN d.id END) as safe_domains,
          COUNT(DISTINCT CASE WHEN sr.is_safe = false THEN d.id END) as flagged_domains
        FROM domains d
        LEFT JOIN scan_results sr ON d.id = sr.domain_id 
          AND sr.id = (
            SELECT MAX(sr2.id) 
            FROM scan_results sr2 
            WHERE sr2.domain_id = d.id
          )
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