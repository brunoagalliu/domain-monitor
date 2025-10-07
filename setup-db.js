const mysql = require('mysql2/promise');
require('dotenv').config();

async function setupDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
  });

  try {
    // Create database
    await connection.execute(`CREATE DATABASE IF NOT EXISTS ${process.env.MYSQL_DATABASE}`);
    await connection.execute(`USE ${process.env.MYSQL_DATABASE}`);

    // Create domains table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS domains (
        id INT AUTO_INCREMENT PRIMARY KEY,
        domain VARCHAR(255) UNIQUE NOT NULL,
        added_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        notes TEXT,
        INDEX idx_domain (domain),
        INDEX idx_active (is_active)
      )
    `);

    // Create scan results table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS scan_results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        domain_id INT,
        scan_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_safe BOOLEAN,
        threat_types JSON,
        platform_types JSON,
        threat_entry_types JSON,
        raw_response JSON,
        FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
        INDEX idx_domain_id (domain_id),
        INDEX idx_scan_date (scan_date),
        INDEX idx_is_safe (is_safe)
      )
    `);

    console.log('✅ Database setup completed successfully!');
    console.log('📋 Tables created:');
    console.log('   - domains (stores your monitored domains)');
    console.log('   - scan_results (stores scan history and threat data)');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error);
  } finally {
    await connection.end();
  }
}

setupDatabase();