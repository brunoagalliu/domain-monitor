const mysql = require('mysql2/promise');
require('dotenv').config();

async function setupDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
  });

  try {
    // Create database (with backticks to handle special characters)
    const dbName = process.env.MYSQL_DATABASE;
    await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    await connection.execute(`USE \`${dbName}\``);

    // Create categories table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        color VARCHAR(7) DEFAULT '#667eea',
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_name (name)
      )
    `);

    // Create domains table with category support
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS domains (
        id INT AUTO_INCREMENT PRIMARY KEY,
        domain VARCHAR(255) UNIQUE NOT NULL,
        category_id INT DEFAULT NULL,
        added_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        notes TEXT,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
        INDEX idx_domain (domain),
        INDEX idx_active (is_active),
        INDEX idx_category (category_id)
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

    // Insert default categories
    await connection.execute(`
      INSERT IGNORE INTO categories (name, color) VALUES 
        ('Production', '#48bb78'),
        ('Staging', '#ed8936'),
        ('Development', '#4299e1'),
        ('Client Sites', '#9f7aea'),
        ('Personal', '#667eea'),
        ('Other', '#a0aec0')
    `);

    console.log('✅ Database setup completed successfully!');
    console.log('📋 Tables created:');
    console.log('   - categories (organize domains into groups)');
    console.log('   - domains (stores your monitored domains)');
    console.log('   - scan_results (stores scan history and threat data)');
    console.log('✨ Default categories added: Production, Staging, Development, Client Sites, Personal, Other');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error);
  } finally {
    await connection.end();
  }
}

setupDatabase();