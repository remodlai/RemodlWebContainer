/**
 * CORS Proxy Worker for RemodlWebContainer
 *
 * Generic HTTP proxy that can deploy as:
 * - Cloudflare Worker (production): cors-proxy.remodl.workers.dev
 * - Kubernetes pod (VPC deployment)
 *
 * Forwards requests with CORS headers for cross-origin network access.
 */

interface Env {
  // Add any environment variables here
  ALLOWED_ORIGINS?: string; // Comma-separated list, or '*' for all
}

// CORS headers to add to all responses
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

// Methods we support
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // Validate method
    if (!ALLOWED_METHODS.includes(request.method)) {
      return new Response('Method not allowed', {
        status: 405,
        headers: CORS_HEADERS,
      });
    }

    // Get target URL from query parameter or header
    // Support multiple formats: ?url=, ?target=, or X-Proxy-Target header
    const targetUrl =
      url.searchParams.get('url') ||
      url.searchParams.get('target') ||
      request.headers.get('X-Proxy-Target');

    if (!targetUrl) {
      return new Response('Missing target URL (use ?url=, ?target=, or X-Proxy-Target header)', {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // Validate target URL
    let target: URL;
    try {
      target = new URL(targetUrl);
    } catch (e) {
      return new Response('Invalid target URL', {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // Block requests to internal/private IPs (security)
    const hostname = target.hostname;
    if (
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.') ||
      hostname.startsWith('192.168.') ||
      hostname === '0.0.0.0' ||
      hostname === '::1'
    ) {
      return new Response('Requests to private IPs are not allowed', {
        status: 403,
        headers: CORS_HEADERS,
      });
    }

    try {
      // Forward the request
      const proxyRequest = new Request(target.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      });

      // Remove origin-related headers that could cause issues
      proxyRequest.headers.delete('Origin');
      proxyRequest.headers.delete('Referer');

      // Fetch from target
      const response = await fetch(proxyRequest);

      // Clone response to modify headers
      const modifiedResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });

      // Add CORS headers
      Object.entries(CORS_HEADERS).forEach(([key, value]) => {
        modifiedResponse.headers.set(key, value);
      });

      return modifiedResponse;
    } catch (error) {
      console.error('Proxy error:', error);
      return new Response(
        JSON.stringify({
          error: 'Proxy request failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 502,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json',
          },
        }
      );
    }
  },
};
