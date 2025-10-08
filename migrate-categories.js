const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  });

  try {
    console.log('Starting migration to add categories...');
    
    // Create categories table if it doesn't exist
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        color VARCHAR(7) DEFAULT '#667eea',
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_name (name)
      )
    `);
    console.log('✅ Categories table created/verified');

    // Check if category_id column exists
    const [columns] = await connection.execute(
      "SHOW COLUMNS FROM domains LIKE 'category_id'"
    );

    if (columns.length === 0) {
      // Add category_id column to domains table
      await connection.execute(`
        ALTER TABLE domains 
        ADD COLUMN category_id INT DEFAULT NULL,
        ADD FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
        ADD INDEX idx_category (category_id)
      `);
      console.log('✅ Added category_id column to domains table');
    } else {
      console.log('ℹ️ category_id column already exists');
    }

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
    console.log('✅ Default categories added');

    console.log('🎉 Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await connection.end();
  }
}

migrate();