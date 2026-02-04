import { createClient } from '@libsql/client';

const client = createClient({
  url: 'http://127.0.0.1:9010'
});

console.log('=== Exploring Vector Extension ===\n');

// Test what vector() does
console.log('1. Testing vector() function:');
try {
  const result = await client.execute("SELECT vector('[1.0, 2.0, 3.0]') as v");
  console.log('Result:', result.rows[0]);
  console.log('Type:', typeof result.rows[0].v);
} catch (e) {
  console.log('Error:', e.message);
}

// Check vector_top_k module
console.log('\n2. Checking vector_top_k virtual table:');
try {
  const result = await client.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS test_vector_top_k USING vector_top_k(
      embedding(3)
    )
  `);
  console.log('✅ Created vector_top_k table');
  
  // Try to insert
  await client.execute("INSERT INTO test_vector_top_k VALUES (1, vector('[1.0, 2.0, 3.0]'))");
  console.log('✅ Inserted vector');
  
  // Try to query
  const rows = await client.execute("SELECT * FROM test_vector_top_k");
  console.log('Rows:', rows.rows);
  
  await client.execute('DROP TABLE test_vector_top_k');
} catch (e) {
  console.log('Error:', e.message);
}

// List all available functions
console.log('\n3. Searching for vector-related functions:');
try {
  const result = await client.execute("SELECT name FROM pragma_function_list() WHERE name LIKE '%vector%'");
  console.log('Vector functions:', result.rows.map(r => r.name));
} catch (e) {
  console.log('Error:', e.message);
}

// Check for UUID functions
console.log('\n4. UUID functions:');
try {
  const result = await client.execute("SELECT uuid() as id");
  console.log('UUID:', result.rows[0]);
} catch (e) {
  console.log('Error:', e.message);
}

// Check what modules provide
console.log('\n5. Module details:');
const modules = await client.execute('SELECT * FROM pragma_module_list()');
console.log('\nAll modules:');
modules.rows.forEach(m => {
  console.log(`  - ${m.name}`);
});

await client.close();
