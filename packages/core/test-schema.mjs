import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';

const client = createClient({
  url: 'http://127.0.0.1:9010'
});

console.log('Connected to sqld on port 9010');

// Read and execute schema
const schema = readFileSync('/tmp/create-schema.sql', 'utf8');
const statements = schema.split(';').filter(s => s.trim());

for (const statement of statements) {
  if (statement.trim()) {
    console.log(`Executing: ${statement.trim().substring(0, 50)}...`);
    await client.execute(statement);
  }
}

console.log('\n✅ Schema created successfully!');

// Verify tables
const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table'");
console.log('\nTables created:');
tables.rows.forEach(row => console.log(`  - ${row.name}`));

client.close();
