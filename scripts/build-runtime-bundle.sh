#!/bin/bash
set -e

# Navigate to RemodlWebContainer root
cd "$(dirname "$0")/.."

# Build packages
pnpm build

# Create dist directory if it doesn't exist
mkdir -p dist

# Bundle API (which re-exports Core) into single IIFE
npx esbuild packages/api/dist/index.js \
  --bundle \
  --format=iife \
  --global-name=RemodlWebContainer \
  --outfile=dist/remodl-webcontainer.temp.js \
  --minify

# Generate content hash from built bundle
HASH=$(cat dist/remodl-webcontainer.temp.js | shasum -a 256 | cut -c1-8)

# Rename with hash
mv dist/remodl-webcontainer.temp.js dist/remodl-webcontainer.$HASH.js

echo "✅ Built: dist/remodl-webcontainer.$HASH.js"
echo "$HASH" > dist/bundle-hash.txt
echo "📝 Hash saved to: dist/bundle-hash.txt"
