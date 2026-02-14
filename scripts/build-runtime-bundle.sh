#!/bin/bash
set -e

# Navigate to RemodlWebContainer root
cd "$(dirname "$0")/.."

# Create dist directory if it doesn't exist
mkdir -p dist

# 1. Build all packages (thin client + core)
pnpm build

echo "--- Building thin client (npm package) ---"
# Thin client is already built by pnpm build (packages/api/dist/index.js)
echo "Thin client: packages/api/dist/index.js"

echo "--- Building runtime bundle (iframe entry) ---"

# 2. Bundle RUNTIME (runtime-entry.ts + all implementation code + comlink)
npx esbuild packages/api/src/runtime-entry.ts \
  --bundle \
  --format=esm \
  --outfile=dist/runtime-bundle.temp.js \
  --minify

# 3. Generate content hash from built bundle
HASH=$(cat dist/runtime-bundle.temp.js | sha256sum | cut -c1-8)

# 4. Rename with hash
mv dist/runtime-bundle.temp.js dist/runtime-bundle.$HASH.js

echo "Runtime bundle: dist/runtime-bundle.$HASH.js"
echo "$HASH" > dist/bundle-hash.txt
echo "Hash saved to: dist/bundle-hash.txt"

# 5. Copy headless.html template
cp packages/runtime/headless.html dist/headless.html

echo ""
echo "=== Build complete ==="
echo "Thin client (npm):  packages/api/dist/index.js"
echo "Runtime bundle:     dist/runtime-bundle.$HASH.js"
echo "Headless template:  dist/headless.html"
echo ""
echo "Ready for upload: dist/runtime-bundle.$HASH.js + dist/headless.html"
