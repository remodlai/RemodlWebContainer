import { createClient } from '@libsql/client';

const client = createClient({
  url: 'http://127.0.0.1:9010'
});

console.log('=== Checking libSQL Extensions ===\n');

// Check SQLite version and compile options
console.log('1. SQLite Version:');
const version = await client.execute('SELECT sqlite_version() as version');
console.log(version.rows[0]);

console.log('\n2. Compile Options:');
const options = await client.execute('PRAGMA compile_options');
console.log(options.rows.slice(0, 20).map(r => r.compile_options).join('\n'));

// Check for FTS5
console.log('\n3. FTS5 (Full-Text Search):');
try {
  await client.execute('CREATE VIRTUAL TABLE IF NOT EXISTS test_fts USING fts5(content)');
  await client.execute('DROP TABLE test_fts');
  console.log('✅ FTS5 available');
} catch (e) {
  console.log('❌ FTS5 not available:', e.message);
}

// Check for JSON1
console.log('\n4. JSON1 (JSON functions):');
try {
  const result = await client.execute("SELECT json('{}') as test");
  console.log('✅ JSON1 available');
} catch (e) {
  console.log('❌ JSON1 not available:', e.message);
}

// Check for R*Tree
console.log('\n5. R*Tree (Spatial indexing):');
try {
  await client.execute('CREATE VIRTUAL TABLE IF NOT EXISTS test_rtree USING rtree(id, minX, maxX, minY, maxY)');
  await client.execute('DROP TABLE test_rtree');
  console.log('✅ R*Tree available');
} catch (e) {
  console.log('❌ R*Tree not available:', e.message);
}

// Check for loaded extensions
console.log('\n6. Loaded Extensions:');
try {
  const result = await client.execute('SELECT * FROM pragma_module_list() ORDER BY name');
  console.log(result.rows.map(r => `  - ${r.name}`).join('\n'));
} catch (e) {
  console.log('Could not query modules:', e.message);
}

// Check what functions are available
console.log('\n7. Available Functions (sample):');
try {
  const result = await client.execute('SELECT * FROM pragma_function_list() WHERE name LIKE "json%" OR name LIKE "fts%" LIMIT 20');
  console.log(result.rows.map(r => `  - ${r.name}(${r.narg} args)`).join('\n'));
} catch (e) {
  console.log('Could not query functions:', e.message);
}

// Check for vector/crypto extensions
console.log('\n8. Checking for additional extensions:');

const extensionsToCheck = [
  { name: 'vec0', test: 'CREATE VIRTUAL TABLE test_vec USING vec0(embedding float[3])' },
  { name: 'crypto', test: "SELECT sha256('test')" },
  { name: 'uuid', test: "SELECT uuid()" },
  { name: 'vector', test: "SELECT vector('[1,2,3]')" }
];

for (const ext of extensionsToCheck) {
  try {
    await client.execute(ext.test);
    if (ext.test.includes('CREATE')) {
      await client.execute(`DROP TABLE test_${ext.name}`);
    }
    console.log(`✅ ${ext.name} available`);
  } catch (e) {
    console.log(`❌ ${ext.name} not available`);
  }
}

console.log('\n=== Done ===');
await client.close();
