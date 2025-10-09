const mysql = require('mysql2/promise');
require('dotenv').config();

// Validate environment variables
if (!process.env.MYSQL_HOST) {
  console.error('Missing MYSQL_HOST environment variable');
}
if (!process.env.MYSQL_USER) {
  console.error('Missing MYSQL_USER environment variable');
}
if (!process.env.MYSQL_DATABASE) {
  console.error('Missing MYSQL_DATABASE environment variable');
}

// Parse host and port
let host = process.env.MYSQL_HOST;
let port = process.env.MYSQL_PORT || 3306;

// If host contains port (e.g., "host:3307"), split them
if (host && host.includes(':')) {
  const parts = host.split(':');
  host = parts[0];
  port = parseInt(parts[1]) || port;
}

console.log('Database config:', {
  host,
  port,
  user: process.env.MYSQL_USER,
  database: process.env.MYSQL_DATABASE
});

// For serverless, use smaller connection pool
const pool = mysql.createPool({
  host: host,
  port: port,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 2,  // Reduced for serverless
  maxIdle: 2,
  idleTimeout: 60000,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 30000,  // Increased timeout to 30 seconds
  acquireTimeout: 30000,
  // SSL support for cloud databases
  ssl: process.env.MYSQL_SSL === 'true' ? {
    rejectUnauthorized: false
  } : undefined
});

// Test connection on initialization (optional, for debugging)
pool.getConnection()
  .then(conn => {
    console.log('✅ Database connection pool created successfully');
    conn.release();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
    console.error('Host:', host);
    console.error('Port:', port);
    console.error('User:', process.env.MYSQL_USER);
    console.error('Database:', process.env.MYSQL_DATABASE);
  });

module.exports = pool;