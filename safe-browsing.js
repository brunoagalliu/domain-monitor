// safe-browsing.js
const axios = require('axios');
require('dotenv').config();

class SafeBrowsingChecker {
  constructor() {
    this.apiKey = process.env.GOOGLE_API_KEY;
    this.baseUrl = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';
  }

  async checkDomains(domains) {
    if (!this.apiKey) {
      throw new Error('Google API Key not configured. Please set GOOGLE_API_KEY in .env file');
    }

    if (domains.length === 0) {
      return {};
    }

    // Format domains for the API
    const threatEntries = domains.map(domain => ({
      url: domain.startsWith('http') ? domain : `http://${domain}`
    }));

    const requestBody = {
      client: {
        clientId: 'domain-safety-monitor',
        clientVersion: '1.0.0'
      },
      threatInfo: {
        threatTypes: [
          'MALWARE',
          'SOCIAL_ENGINEERING',
          'UNWANTED_SOFTWARE',
          'POTENTIALLY_HARMFUL_APPLICATION'
        ],
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: threatEntries
      }
    };

    try {
      console.log(`🔍 Checking ${domains.length} domain(s) with Google Safe Browsing...`);
      
      const response = await axios.post(
        `${this.baseUrl}?key=${this.apiKey}`,
        requestBody
      );

      // Initialize all domains as safe
      const results = {};
      domains.forEach(domain => {
        results[domain] = {
          is_safe: true,
          threats: []
        };
      });

      // If matches exist, mark those domains as flagged
      if (response.data.matches) {
        console.log(`⚠️ Found ${response.data.matches.length} flagged domain(s)`);
        
        response.data.matches.forEach(match => {
          const url = match.threat.url;
          const domain = domains.find(d => 
            url.includes(d.replace(/^https?:\/\//, ''))
          );
          
          if (domain) {
            results[domain] = {
              is_safe: false,
              threats: [{
                threatType: match.threatType,
                platformType: match.platformType,
                threatEntryType: match.threatEntryType,
                cacheDuration: match.cacheDuration
              }]
            };
          }
        });
      } else {
        console.log('✅ All domains are safe');
      }

      return results;
    } catch (error) {
      console.error('❌ Safe Browsing API Error:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = SafeBrowsingChecker;