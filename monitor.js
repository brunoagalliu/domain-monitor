// monitor.js
const db = require('./db');
const SafeBrowsingChecker = require('./safe-browsing');
require('dotenv').config();

class DomainMonitor {
  constructor() {
    this.checker = new SafeBrowsingChecker();
  }

  async addDomain(domain, notes = '') {
    try {
      // Clean the domain (remove protocol if present)
      domain = domain.replace(/^https?:\/\//, '').toLowerCase();
      
      const [result] = await db.execute(
        'INSERT INTO domains (domain, notes) VALUES (?, ?) ON DUPLICATE KEY UPDATE notes = ?, is_active = true',
        [domain, notes, notes]
      );
      
      console.log(`✅ Domain added: ${domain}`);
      return result.insertId;
    } catch (error) {
      console.error('Error adding domain:', error);
      throw error;
    }
  }

  async getActiveDomains() {
    try {
      const [rows] = await db.execute(
        'SELECT * FROM domains WHERE is_active = true ORDER BY domain'
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
        return { scanned: 0, safe: 0, flagged: 0 };
      }

      console.log(`📋 Scanning ${domains.length} domain(s)...`);
      
      const domainUrls = domains.map(d => d.domain);
      const results = await this.checker.checkDomains(domainUrls);
      
      let safeCount = 0;
      let flaggedCount = 0;

      // Save results for each domain
      for (const domain of domains) {
        const result = results[domain.domain];
        
        if (result.is_safe) {
          safeCount++;
        } else {
          flaggedCount++;
        }
        
        // Save scan result to database
        await db.execute(
          `INSERT INTO scan_results 
           (domain_id, is_safe, threat_types, platform_types, threat_entry_types, raw_response) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            domain.id,
            result.is_safe,
            JSON.stringify(result.threats.map(t => t.threatType || null).filter(Boolean)),
            JSON.stringify(result.threats.map(t => t.platformType || null).filter(Boolean)),
            JSON.stringify(result.threats.map(t => t.threatEntryType || null).filter(Boolean)),
            JSON.stringify(result)
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
      console.log(`✨ Scan completed at ${new Date().toLocaleTimeString()}\n`);
      
      return { 
        scanned: domains.length, 
        safe: safeCount, 
        flagged: flaggedCount 
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
        LIMIT ?
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
          COUNT(DISTINCT CASE WHEN sr.is_safe = 1 THEN d.id END) as safe_domains,
          COUNT(DISTINCT CASE WHEN sr.is_safe = 0 THEN d.id END) as flagged_domains
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