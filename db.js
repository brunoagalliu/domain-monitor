const mysql = require('mysql2/promise');
require('dotenv').config();

// Validate environment variables
const requiredVars = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_DATABASE'];
const missingVars = requiredVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars.join(', '));
  throw new Error(`Missing environment variables: ${missingVars.join(', ')}`);
}

// Parse host and port
let host = process.env.MYSQL_HOST;
let port = parseInt(process.env.MYSQL_PORT) || 3306;

// If host contains port (e.g., "host:3307"), split them
if (host && host.includes(':')) {
  const parts = host.split(':');
  host = parts[0];
  port = parseInt(parts[1]) || port;
}

// Database configuration
const dbConfig = {
  host: host,
  port: port,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 5,        // Increased slightly for serverless
  maxIdle: 2,
  idleTimeout: 60000,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 30000,     // 30 seconds
  // SSL configuration
  ssl: process.env.MYSQL_SSL === 'true' ? {
    rejectUnauthorized: true
  } : undefined
};

console.log('📊 Database Configuration:');
console.log('  Host:', host);
console.log('  Port:', port);
console.log('  User:', process.env.MYSQL_USER);
console.log('  Database:', process.env.MYSQL_DATABASE);
console.log('  SSL:', process.env.MYSQL_SSL === 'true' ? 'enabled' : 'disabled');

// Create connection pool
let pool;
try {
  pool = mysql.createPool(dbConfig);
  console.log('✅ Database connection pool created');
} catch (error) {
  console.error('❌ Failed to create connection pool:', error.message);
  throw error;
}

// Test connection on initialization (with better error handling)
pool.getConnection()
  .then(conn => {
    console.log('✅ Database test connection successful');
    return conn.execute('SELECT 1 as test');
  })
  .then(([rows, fields]) => {
    console.log('✅ Database query test successful');
  })
  .catch(err => {
    console.error('❌ Database connection test failed:');
    console.error('   Error Code:', err.code);
    console.error('   Error Message:', err.message);
    console.error('   Error Number:', err.errno);
    
    // Common error codes and solutions
    if (err.code === 'ECONNREFUSED') {
      console.error('   🔍 Solution: Check if MySQL host and port are correct');
    } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('   🔍 Solution: Check username and password');
    } else if (err.code === 'ENOTFOUND') {
      console.error('   🔍 Solution: Check if hostname is correct');
    } else if (err.code === 'ETIMEDOUT') {
      console.error('   🔍 Solution: Check firewall rules and network access');
    }
  })
  .finally(() => {
    // Don't close pool here, keep it open for requests
  });

// Export pool for use in other modules
module.exports = pool;