const mysql = require('mysql2/promise');
const { Pool } = require('pg');
require('dotenv').config();

async function migrateData() {
  const mysqlConn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  const pg = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Migrate categories first, build old->new ID map
    let categoryIdMap = {};
    try {
      const [categories] = await mysqlConn.query('SELECT id, name, color FROM categories');
      console.log(`Found ${categories.length} categories`);
      for (const cat of categories) {
        const result = await pg.query(
          `INSERT INTO categories (name, color) VALUES ($1, $2)
           ON CONFLICT (name) DO UPDATE SET color = EXCLUDED.color RETURNING id`,
          [cat.name, cat.color || '#667eea']
        );
        categoryIdMap[cat.id] = result.rows[0].id;
      }
      console.log(`✅ Migrated ${categories.length} categories`);
    } catch (err) {
      console.warn('⚠️  No categories table or empty:', err.message);
    }

    // Migrate active domains
    let columns = 'id, domain, notes, category_id, is_active';
    try {
      await mysqlConn.query('SELECT is_flagged FROM domains LIMIT 1');
      columns += ', is_flagged';
    } catch (_) {
      // is_flagged column doesn't exist in old DB
    }

    const [domains] = await mysqlConn.query(
      `SELECT ${columns} FROM domains WHERE is_active = 1`
    );
    console.log(`Found ${domains.length} active domains`);

    let inserted = 0;
    let skipped = 0;
    for (const d of domains) {
      const newCategoryId = d.category_id ? (categoryIdMap[d.category_id] || null) : null;
      const result = await pg.query(
        `INSERT INTO domains (domain, notes, category_id, is_active, is_flagged)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (domain) DO NOTHING`,
        [d.domain, d.notes || '', newCategoryId, true, !!d.is_flagged]
      );
      if (result.rowCount > 0) inserted++;
      else skipped++;
    }

    console.log(`✅ Inserted ${inserted} domains (${skipped} already existed)`);
    console.log('\n🎉 Data migration complete!');
  } finally {
    await mysqlConn.end();
    await pg.end();
  }
}

migrateData().catch(err => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
