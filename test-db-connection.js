const mysql = require('mysql2/promise');
require('dotenv').config();

async function testConnection() {
  console.log('Testing database connection...');
  
  // Parse host and port
  let host = process.env.MYSQL_HOST;
  let port = process.env.MYSQL_PORT || 3306;
  
  if (host && host.includes(':')) {
    const parts = host.split(':');
    host = parts[0];
    port = parseInt(parts[1]) || port;
  }
  
  console.log('Host:', host);
  console.log('Port:', port);
  console.log('User:', process.env.MYSQL_USER);
  console.log('Database:', process.env.MYSQL_DATABASE);
  console.log('SSL:', process.env.MYSQL_SSL || 'false');
  console.log('');

  const configs = [
    {
      name: 'Standard connection',
      config: {
        host: host,
        port: port,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        connectTimeout: 10000
      }
    },
    {
      name: 'With SSL',
      config: {
        host: host,
        port: port,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        connectTimeout: 10000,
        ssl: {
          rejectUnauthorized: false
        }
      }
    }
  ];

  for (const { name, config } of configs) {
    console.log(`\n🔄 Trying: ${name}...`);
    
    try {
      const connection = await mysql.createConnection(config);
      console.log('✅ Connected successfully!');
      
      const [rows] = await connection.execute('SELECT 1 as test, NOW() as server_time');
      console.log('✅ Query test passed:', rows);
      
      await connection.end();
      console.log('✅ Connection closed properly');
      console.log('\n🎉 SUCCESS! Use this configuration.');
      return;
      
    } catch (error) {
      console.error('❌ Failed with this config');
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      
      if (error.code === 'ENOTFOUND') {
        console.log('💡 Hostname not found. Check MYSQL_HOST format.');
      } else if (error.code === 'ETIMEDOUT') {
        console.log('💡 Connection timed out. Check:');
        console.log('   1. Database server is running');
        console.log('   2. Port is correct');
        console.log('   3. Firewall allows connections from your IP');
        console.log('   4. Try adding SSL (MYSQL_SSL=true)');
      } else if (error.code === 'ECONNREFUSED') {
        console.log('💡 Connection refused. Check port number and if database is running.');
      } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
        console.log('💡 Access denied. Check username and password.');
      }
    }
  }
  
  console.log('\n❌ All connection attempts failed.');
  console.log('\n📋 Troubleshooting checklist:');
  console.log('1. Is the database server accessible from this machine?');
  console.log('2. Is the port correct? (default MySQL is 3306)');
  console.log('3. Does the firewall allow connections from your IP?');
  console.log('4. Are username/password correct?');
  console.log('5. Does the database exist?');
  console.log('6. For cloud databases: Have you whitelisted your IP or allowed all (0.0.0.0/0)?');
}

testConnection();