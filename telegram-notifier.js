const axios = require('axios');
require('dotenv').config();

class TelegramNotifier {
  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = process.env.TELEGRAM_CHAT_ID;
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  /**
   * Send a message to Telegram
   */
  async sendMessage(text, options = {}) {
    if (!this.botToken || !this.chatId) {
      console.warn('⚠️ Telegram not configured. Skipping notification.');
      return null;
    }

    try {
      const response = await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: this.chatId,
        text: text,
        parse_mode: options.parseMode || 'HTML',
        disable_web_page_preview: options.disablePreview || true,
        ...options
      });

      console.log('✅ Telegram notification sent');
      return response.data;
    } catch (error) {
      console.error('❌ Telegram notification failed:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Format and send flagged domain alert
   */
  async notifyFlaggedDomains(flaggedDomains) {
    if (!flaggedDomains || flaggedDomains.length === 0) {
      return null;
    }

    const message = this.formatFlaggedDomainsMessage(flaggedDomains);
    return await this.sendMessage(message);
  }

  /**
   * Format flagged domains into a nice Telegram message
   */
  formatFlaggedDomainsMessage(domains) {
    const emoji = '🚨';
    const count = domains.length;
    const plural = count === 1 ? 'domain has' : 'domains have';

    let message = `${emoji} <b>SECURITY ALERT</b> ${emoji}\n\n`;
    message += `<b>${count} ${plural} been flagged by Google Safe Browsing!</b>\n\n`;

    domains.forEach((domain, index) => {
      message += `${index + 1}. <b>${domain.domain}</b>\n`;
      
      if (domain.category) {
        message += `   📁 Category: ${domain.category}\n`;
      }

      if (domain.threats && domain.threats.length > 0) {
        message += `   ⚠️ Threats: ${domain.threats.join(', ')}\n`;
      }

      if (domain.scanDate) {
        const date = new Date(domain.scanDate).toLocaleString();
        message += `   🕐 Detected: ${date}\n`;
      }

      message += `\n`;
    });

    message += `\n🔗 <a href="${process.env.DASHBOARD_URL || 'https://your-domain.vercel.app'}">View Dashboard</a>`;
    message += `\n\n<i>Automated alert from Domain Safety Monitor</i>`;

    return message;
  }

  /**
   * Send scan summary
   */
  async sendScanSummary(summary) {
    const { scanned, safe, flagged, newFlags } = summary;
    
    let message = '📊 <b>Scan Complete</b>\n\n';
    message += `✅ Safe: ${safe}\n`;
    message += `🚨 Flagged: ${flagged}\n`;
    message += `📋 Total Scanned: ${scanned}\n`;

    if (newFlags > 0) {
      message += `\n⚠️ <b>${newFlags} NEW FLAG(S) DETECTED!</b>`;
    }

    return await this.sendMessage(message);
  }

  /**
   * Send test message
   */
  async sendTestMessage() {
    const message = `✅ <b>Telegram Integration Active</b>\n\nYour Domain Safety Monitor is connected and ready to send alerts!`;
    return await this.sendMessage(message);
  }

  /**
   * Verify bot configuration
   */
  async verifyConfiguration() {
    if (!this.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN not configured');
    }

    if (!this.chatId) {
      throw new Error('TELEGRAM_CHAT_ID not configured');
    }

    try {
      const response = await axios.get(`${this.baseUrl}/getMe`);
      console.log('✅ Telegram bot verified:', response.data.result.username);
      return response.data.result;
    } catch (error) {
      console.error('❌ Telegram verification failed:', error.message);
      throw new Error('Invalid Telegram bot token');
    }
  }
}

module.exports = TelegramNotifier;