#!/bin/bash
set -e

# Cloudflare API deployment (vibesdk pattern)
ACCOUNT_ID="f57c62ea815daeec36339bec6b31f3ee"
API_TOKEN="${CLOUDFLARE_API_TOKEN}"
NAMESPACE="remodl-webcontainer"
SCRIPT_NAME="test-session"

# Bundle the Worker
cd "$(dirname "$0")/../workers/user-worker-template"
echo "📦 Bundling Worker..."
mkdir -p dist
npx esbuild index.ts --bundle --format=esm --platform=browser --outfile=dist/index.js

# Upload to dispatch namespace via API
echo "🚀 Uploading to dispatch namespace..."
curl -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/dispatch/namespaces/${NAMESPACE}/scripts/${SCRIPT_NAME}" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -F 'metadata={
    "main_module": "index.js",
    "compatibility_date": "2025-08-10",
    "compatibility_flags": ["nodejs_compat"],
    "bindings": [
      {
        "type": "r2_bucket",
        "name": "ASSETS",
        "bucket_name": "remodl-webcontainer-assets"
      }
    ],
    "vars": {
      "SESSION_ID": "test-session",
      "ORG_ID": "org-test",
      "USER_ID": "user-test"
    }
  };type=application/json' \
  -F 'index.js=@dist/index.js;filename=index.js;type=application/javascript+module'

echo ""
echo "✅ Worker deployed"
echo "🌐 https://test-session.forge-api.remodl.ai"
