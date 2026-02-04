import { createClient } from '@libsql/client';

const client = createClient({
  url: 'http://127.0.0.1:9010'
});

console.log('=== Testing libSQL Vector Search ===\n');

// Create a simple table with vector column
console.log('1. Creating table with vectors:');
await client.execute(`
  CREATE TABLE IF NOT EXISTS embeddings (
    id INTEGER PRIMARY KEY,
    content TEXT,
    embedding BLOB
  )
`);
console.log('✅ Table created');

// Insert some test vectors
console.log('\n2. Inserting test vectors:');
const testData = [
  { id: 1, content: 'authentication code', vector: [0.2, 0.5, 0.3, 0.8] },
  { id: 2, content: 'database query', vector: [0.7, 0.2, 0.1, 0.4] },
  { id: 3, content: 'user login', vector: [0.3, 0.6, 0.4, 0.9] },
  { id: 4, content: 'api endpoint', vector: [0.5, 0.3, 0.6, 0.2] }
];

for (const item of testData) {
  await client.execute({
    sql: 'INSERT OR REPLACE INTO embeddings VALUES (?, ?, vector(?))',
    args: [item.id, item.content, JSON.stringify(item.vector)]
  });
}
console.log('✅ Inserted 4 test vectors');

// Test vector distance functions
console.log('\n3. Testing distance functions:');
const query_vector = [0.25, 0.55, 0.35, 0.85];

const result = await client.execute({
  sql: `
    SELECT 
      id,
      content,
      vector_distance_cos(embedding, vector(?)) as cos_distance,
      vector_distance_l2(embedding, vector(?)) as l2_distance
    FROM embeddings
    ORDER BY cos_distance ASC
  `,
  args: [JSON.stringify(query_vector), JSON.stringify(query_vector)]
});

console.log('\nResults (ordered by cosine similarity):');
result.rows.forEach(row => {
  const cos = Number(row.cos_distance).toFixed(4);
  const l2 = Number(row.l2_distance).toFixed(4);
  console.log(`  ${row.content}: cos=${cos}, l2=${l2}`);
});

// Test vector extraction
console.log('\n4. Testing vector_extract:');
const extract = await client.execute({
  sql: `SELECT content, vector_extract(embedding, 0) as dim0 FROM embeddings LIMIT 2`
});
console.log('Extracted first dimension:', extract.rows);

// Check vector blob format
console.log('\n5. Vector blob format:');
const blob = await client.execute('SELECT embedding FROM embeddings WHERE id = 1');
console.log('Raw blob type:', typeof blob.rows[0].embedding);
console.log('Byte length:', blob.rows[0].embedding.byteLength);

// Test different vector precisions
console.log('\n6. Testing vector precisions:');
await client.execute('CREATE TEMP TABLE vector_test (v8 BLOB, v16 BLOB, v32 BLOB, v64 BLOB)');
await client.execute({
  sql: `INSERT INTO vector_test VALUES (
    vector8(?),
    vector16(?),
    vector32(?),
    vector64(?)
  )`,
  args: ['[0.1, 0.5, 0.9]', '[0.1, 0.5, 0.9]', '[0.1, 0.5, 0.9]', '[0.1, 0.5, 0.9]']
});

const sizes = await client.execute('SELECT length(v8) as v8_size, length(v16) as v16_size, length(v32) as v32_size, length(v64) as v64_size FROM vector_test');
console.log('Vector sizes (bytes):', sizes.rows[0]);
console.log('  vector8:  ~8-bit per dimension');
console.log('  vector16: ~16-bit per dimension');
console.log('  vector32: 32-bit float (default)');
console.log('  vector64: 64-bit float (double)');

// Cleanup
await client.execute('DROP TABLE embeddings');
await client.execute('DROP TABLE vector_test');

console.log('\n✅ Vector support is fully functional!');

await client.close();
