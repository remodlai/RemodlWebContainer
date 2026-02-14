#!/bin/bash
# libSQL Bottomless Replication Configuration
# Source this file before starting sqld: source scripts/libsql-env.sh

export SQLD_NODE=primary
export SQLD_ENABLE_NAMESPACES=true
export SQLD_ENABLE_BOTTOMLESS_REPLICATION=true

# R2 Bottomless Configuration
export LIBSQL_BOTTOMLESS_BUCKET=remodl-libsql-backups
export LIBSQL_BOTTOMLESS_ENDPOINT=https://f57c62ea815daeec36339bec6b31f3ee.r2.cloudflarestorage.com
export LIBSQL_BOTTOMLESS_AWS_ACCESS_KEY_ID=d92b80827eefe1b1235ea6293ee03042
export LIBSQL_BOTTOMLESS_AWS_SECRET_ACCESS_KEY=549f3476170404490767400909b4bfef5e0e4baeb33690035d538bf77cde4aab
export LIBSQL_BOTTOMLESS_AWS_DEFAULT_REGION=auto

echo "✅ libSQL environment variables set"
echo "Run: sqld --http-listen-addr 127.0.0.1:9010 --db-path /tmp/sqld-test.db"
