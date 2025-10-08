const db = require('../db');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  const checks = {
    timestamp: new Date().toISOString(),
    environment: {
      MYSQL_HOST: process.env.MYSQL_HOST ? '✅ Set' : '❌ Missing',
      MYSQL_USER: process.env.MYSQL_USER ? '✅ Set' : '❌ Missing',
      MYSQL_PASSWORD: process.env.MYSQL_PASSWORD ? '✅ Set' : '❌ Missing',
      MYSQL_DATABASE: process.env.MYSQL_DATABASE ? '✅ Set' : '❌ Missing',
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ? '✅ Set' : '❌ Missing',
    },
    database: {
      connection: 'Testing...'
    }
  };

  // Test database connection
  try {
    await db.execute('SELECT 1');
    checks.database.connection = '✅ Connected';
    checks.database.status = 'OK';
  } catch (error) {
    checks.database.connection = '❌ Failed';
    checks.database.error = error.message;
    checks.database.code = error.code;
  }

  return res.status(200).json(checks);
};