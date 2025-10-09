// api/debug.js
// TEMPORARILY add this file to diagnose connection issues
// DELETE after fixing the problem

module.exports = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    
    try {
      // Check environment variables (without exposing passwords)
      const envCheck = {
        MYSQL_HOST: process.env.MYSQL_HOST ? '✅ Set' : '❌ Missing',
        MYSQL_PORT: process.env.MYSQL_PORT || '3306 (default)',
        MYSQL_USER: process.env.MYSQL_USER ? '✅ Set' : '❌ Missing',
        MYSQL_PASSWORD: process.env.MYSQL_PASSWORD ? '✅ Set' : '❌ Missing',
        MYSQL_DATABASE: process.env.MYSQL_DATABASE ? '✅ Set' : '❌ Missing',
        MYSQL_SSL: process.env.MYSQL_SSL || 'not set',
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ? '✅ Set' : '❌ Missing',
      };
  
      // Parse host/port
      let host = process.env.MYSQL_HOST;
      let port = process.env.MYSQL_PORT || 3306;
      
      if (host && host.includes(':')) {
        const parts = host.split(':');
        host = parts[0];
        port = parseInt(parts[1]) || port;
      }
  
      const dbConfig = {
        host,
        port,
        user: process.env.MYSQL_USER,
        database: process.env.MYSQL_DATABASE,
        hasPassword: !!process.env.MYSQL_PASSWORD,
        ssl: process.env.MYSQL_SSL === 'true'
      };
  
      // Try to import and test connection
      let connectionTest = 'Not tested';
      try {
        const db = require('../db');
        const [result] = await db.execute('SELECT 1 as test');
        connectionTest = result[0].test === 1 ? '✅ SUCCESS' : '❌ FAILED';
      } catch (dbError) {
        connectionTest = `❌ ERROR: ${dbError.message}`;
      }
  
      res.status(200).json({
        environment: envCheck,
        parsedConfig: dbConfig,
        connectionTest,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: error.message,
        stack: error.stack
      });
    }
  };