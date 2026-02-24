# CORS Proxy Worker

Generic HTTP proxy for cross-origin requests in RemodlWebContainer.

## Features

- ✅ Supports GET, POST, PUT, DELETE, PATCH
- ✅ Forwards headers and body
- ✅ Adds CORS headers to all responses
- ✅ Blocks requests to private IPs (security)
- ✅ Deploys to Cloudflare Workers or Kubernetes

## Usage

### From WebContainer

```typescript
// Configure in WebContainer
internal.setCORSProxy({
  address: 'https://cors-proxy.remodl.workers.dev'
});

// Make a proxied request
const response = await fetch('https://cors-proxy.remodl.workers.dev?url=' + encodeURIComponent(targetUrl));
```

### Direct Usage

```bash
# GET request
curl "https://cors-proxy.remodl.workers.dev?url=https://api.example.com/data"

# POST request
curl -X POST "https://cors-proxy.remodl.workers.dev?url=https://api.example.com/data" \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'
```

## Deployment

### Cloudflare Workers (Production)

```bash
# Install dependencies
npm install

# Deploy to production
npm run deploy

# Deploy to dev environment
npm run deploy:dev

# Test locally
npm run dev

# View logs
npm run tail
```

**Production URL:** `https://cors-proxy.remodl.workers.dev`

### Kubernetes (VPC Deployment)

```bash
# Apply the deployment
kubectl apply -f k8s-deployment.yaml

# Verify deployment
kubectl get pods -l app=cors-proxy
kubectl get service cors-proxy

# Get service URL
kubectl get service cors-proxy -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

## Security

- **Blocks private IPs:** Prevents SSRF attacks by blocking localhost, 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
- **Method validation:** Only allows GET, POST, PUT, DELETE, PATCH, OPTIONS
- **Origin stripping:** Removes Origin and Referer headers to prevent leaking

## Configuration

Set environment variables in `wrangler.toml`:

```toml
[env.production.vars]
ALLOWED_ORIGINS = "*"  # Or comma-separated list of origins
```

## Monitoring

```bash
# View real-time logs (Cloudflare)
wrangler tail --env production

# View metrics in Cloudflare dashboard
# https://dash.cloudflare.com/workers
```

## Error Responses

| Status | Description |
|--------|-------------|
| 400 | Missing or invalid `url` parameter |
| 403 | Request to private IP blocked |
| 405 | Method not allowed |
| 502 | Proxy request failed |

## Development

```bash
# Start local dev server
npm run dev

# Test locally
curl "http://localhost:8787?url=https://httpbin.org/get"
```
