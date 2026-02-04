import { createClient } from '@libsql/client';

const client = createClient({
  url: 'http://127.0.0.1:9010'
});

console.log('=== libSQL Built-in Vector Support Summary ===\n');

// Create table
await client.execute('DROP TABLE IF EXISTS embeddings');
await client.execute(`
  CREATE TABLE embeddings (
    id INTEGER PRIMARY KEY,
    content TEXT,
    embedding BLOB
  )
`);

// Insert test vectors (simulating Jina embeddings)
const testData = [
  { id: 1, content: 'JWT authentication implementation', vector: [0.2, 0.5, 0.3, 0.8, 0.1, 0.9, 0.4, 0.7] },
  { id: 2, content: 'Database connection pooling', vector: [0.7, 0.2, 0.1, 0.4, 0.6, 0.3, 0.8, 0.5] },
  { id: 3, content: 'User login validation', vector: [0.3, 0.6, 0.4, 0.9, 0.2, 0.8, 0.5, 0.7] },
  { id: 4, content: 'REST API endpoint handler', vector: [0.5, 0.3, 0.6, 0.2, 0.7, 0.4, 0.9, 0.3] }
];

for (const item of testData) {
  await client.execute({
    sql: 'INSERT INTO embeddings VALUES (?, ?, vector32(?))',
    args: [item.id, item.content, JSON.stringify(item.vector)]
  });
}

console.log('✅ Created table with 4 vectors (dimension=8)\n');

// Test semantic search
console.log('SEMANTIC SEARCH TEST:');
console.log('Query: "authentication with tokens"\n');

const query = [0.25, 0.55, 0.35, 0.85, 0.15, 0.88, 0.42, 0.68];

const results = await client.execute({
  sql: `
    SELECT
      content,
      vector_distance_cos(embedding, vector32(?)) as similarity
    FROM embeddings
    ORDER BY similarity ASC
    LIMIT 3
  `,
  args: [JSON.stringify(query)]
});

console.log('Top 3 Results:');
results.rows.forEach((row, i) => {
  const score = (1 - Number(row.similarity)).toFixed(4);
  console.log(`  ${i+1}. ${row.content}`);
  console.log(`     Similarity: ${score}\n`);
});

// Test vector sizes
console.log('VECTOR PRECISION OPTIONS:');
await client.execute('DROP TABLE IF EXISTS precision_test');
await client.execute('CREATE TABLE precision_test (id TEXT, v BLOB)');

const testVec = Array(1024).fill(0).map((_, i) => Math.random());
const vecStr = JSON.stringify(testVec);

const precisions = [
  ['8-bit quantized', 'vector8'],
  ['16-bit float', 'vector16'],
  ['32-bit float (default)', 'vector32'],
  ['64-bit float', 'vector64']
];

for (const [type, func] of precisions) {
  await client.execute({
    sql: `INSERT INTO precision_test VALUES (?, ${func}(?))`,
    args: [type, vecStr]
  });
}

const sizes = await client.execute(`
  SELECT id, length(v) as bytes, CAST(length(v) AS REAL) / 1024 as kb
  FROM precision_test
`);

sizes.rows.forEach(row => {
  console.log(`  ${row.id}: ${row.bytes} bytes (${Number(row.kb).toFixed(2)} KB)`);
});

// Summary
console.log('\n=== AVAILABLE FEATURES ===\n');
console.log('✅ Vector storage: vector(), vector8(), vector16(), vector32(), vector64()');
console.log('✅ Distance metrics: vector_distance_cos(), vector_distance_l2()');
console.log('✅ FTS5: Full-text search');
console.log('✅ JSON1: JSON functions');
console.log('✅ R*Tree: Spatial indexing');
console.log('✅ UUID: uuid() function\n');

console.log('❌ NOT AVAILABLE:');
console.log('❌ vec0 virtual table (sqlite-vec extension)');
console.log('❌ Crypto functions (SQLean Crypto)');
console.log('❌ Text functions (SQLean Text)');
console.log('❌ Fuzzy matching (SQLean Fuzzy)\n');

console.log('RECOMMENDATION:');
console.log('- Use built-in vector() functions for storage');
console.log('- Use vector_distance_cos() for similarity search');
console.log('- Use vector32() for Jina v4 embeddings (1024 dims = 4KB per vector)');
console.log('- Add SQLean extensions for text/crypto/fuzzy if needed\n');

// Cleanup
await client.execute('DROP TABLE embeddings');
await client.execute('DROP TABLE precision_test');

await client.close();
