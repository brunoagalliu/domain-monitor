const TelegramNotifier = require('./telegram-notifier');
require('dotenv').config();

async function testTelegram() {
  console.log('🧪 Testing Telegram Integration...\n');

  const telegram = new TelegramNotifier();

  try {
    // Step 1: Verify configuration
    console.log('1️⃣ Verifying Telegram bot configuration...');
    const bot = await telegram.verifyConfiguration();
    console.log(`   ✅ Bot verified: @${bot.username}`);
    console.log(`   📝 Bot name: ${bot.first_name}\n`);

    // Step 2: Send test message
    console.log('2️⃣ Sending test message...');
    await telegram.sendTestMessage();
    console.log('   ✅ Test message sent!\n');

    // Step 3: Send sample flagged domain alert
    console.log('3️⃣ Sending sample flagged domain alert...');
    const sampleFlaggedDomains = [
      {
        domain: 'malicious-example.com',
        category: 'Production',
        threats: ['MALWARE', 'SOCIAL_ENGINEERING'],
        scanDate: new Date()
      },
      {
        domain: 'suspicious-site.com',
        category: 'Staging',
        threats: ['UNWANTED_SOFTWARE'],
        scanDate: new Date()
      }
    ];
    
    await telegram.notifyFlaggedDomains(sampleFlaggedDomains);
    console.log('   ✅ Sample alert sent!\n');

    // Step 4: Send scan summary
    console.log('4️⃣ Sending scan summary...');
    await telegram.sendScanSummary({
      scanned: 25,
      safe: 23,
      flagged: 2,
      newFlags: 2
    });
    console.log('   ✅ Summary sent!\n');

    console.log('✨ All tests passed! Check your Telegram for messages.\n');
    console.log('📱 Configuration:');
    console.log(`   Bot Token: ${process.env.TELEGRAM_BOT_TOKEN ? '✅ Set' : '❌ Missing'}`);
    console.log(`   Chat ID: ${process.env.TELEGRAM_CHAT_ID ? '✅ Set' : '❌ Missing'}`);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('\n💡 Make sure you have set:');
    console.error('   - TELEGRAM_BOT_TOKEN in your .env file');
    console.error('   - TELEGRAM_CHAT_ID in your .env file');
    console.error('\n📖 See setup instructions in the guide.');
    process.exit(1);
  }

  process.exit(0);
}

testTelegram();