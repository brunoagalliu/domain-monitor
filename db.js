const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

const RETRYABLE = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST']);

async function execute(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return [result.rows, result];
  } catch (err) {
    if (RETRYABLE.has(err.code)) {
      const result = await pool.query(sql, params);
      return [result.rows, result];
    }
    throw err;
  }
}

module.exports = { execute, pool };
