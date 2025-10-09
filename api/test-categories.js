const db = require('../db');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  try {
    console.log('🔍 Testing categories queries...');
    
    // Test 1: Simple query
    const [simpleTest] = await db.execute('SELECT * FROM categories');
    console.log('Simple query result:', simpleTest);
    
    // Test 2: Check if table exists
    const [tableCheck] = await db.execute(`
      SHOW TABLES LIKE 'categories'
    `);
    console.log('Table exists:', tableCheck);
    
    // Test 3: Count rows
    const [countResult] = await db.execute('SELECT COUNT(*) as total FROM categories');
    console.log('Total categories:', countResult[0].total);
    
    // Test 4: Complex query (like in API)
    const [complexResult] = await db.execute(`
      SELECT 
        c.id,
        c.name,
        c.color,
        c.created_at,
        COUNT(DISTINCT d.id) as domain_count
      FROM categories c
      LEFT JOIN domains d ON c.id = d.category_id AND d.is_active = true
      GROUP BY c.id, c.name, c.color, c.created_at
      ORDER BY c.name
    `);
    console.log('Complex query result:', complexResult);
    
    // Test 5: Check scan_results table
    const [scanTableCheck] = await db.execute(`
      SHOW TABLES LIKE 'scan_results'
    `);
    
    return res.status(200).json({
      debug: {
        simpleQueryCount: simpleTest.length,
        simpleQueryResult: simpleTest,
        tableExists: tableCheck.length > 0,
        totalCategories: countResult[0].total,
        complexQueryCount: complexResult.length,
        complexQueryResult: complexResult,
        scanResultsTableExists: scanTableCheck.length > 0
      }
    });
    
  } catch (error) {
    console.error('Debug error:', error);
    return res.status(500).json({
      error: error.message,
      code: error.code,
      stack: error.stack.split('\n').slice(0, 5)
    });
  }
};