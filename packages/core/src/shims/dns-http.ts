/**
 * DNS module shim using simple HTTP requests to gateway.
 *
 * DNS operations are one-shot queries (no streaming), so simple HTTP is sufficient.
 * No Temporal workflows - gateway handles DNS queries directly.
 */

const GATEWAY_URL = process.env.GATEWAY_API_URL || 'http://localhost:8000';

interface DnsLookupResult {
  address: string;
  family: 4 | 6;
}

interface DnsResolveResult {
  addresses: string[];
}

async function dnsRequest<T>(method: string, args: Record<string, any>): Promise<T> {
  const res = await fetch(`${GATEWAY_URL}/api/dns/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Caller-ID': (globalThis as any).__REMODL_CALLER_ID__ || 'unknown',
    },
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    const err = await res.json();
    const error = new Error(err.message || 'DNS lookup failed');
    (error as any).code = err.code || 'ENOTFOUND';
    throw error;
  }

  return res.json();
}

// Callback-style API
type DnsCallback<T> = (err: Error | null, result?: T) => void;

export function lookup(hostname: string, callback: DnsCallback<string>): void;
export function lookup(hostname: string, options: any, callback: DnsCallback<string>): void;
export function lookup(hostname: string, options: any, callback?: DnsCallback<string>): void {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  dnsRequest<DnsLookupResult>('lookup', { hostname, options })
    .then(result => callback?.(null, result.address))
    .catch(err => callback?.(err));
}

export function resolve(hostname: string, callback: DnsCallback<string[]>): void;
export function resolve(hostname: string, rrtype: string, callback: DnsCallback<string[]>): void;
export function resolve(hostname: string, rrtype: string | DnsCallback<string[]>, callback?: DnsCallback<string[]>): void {
  if (typeof rrtype === 'function') {
    callback = rrtype;
    rrtype = 'A';
  }

  dnsRequest<DnsResolveResult>('resolve', { hostname, rrtype })
    .then(result => callback?.(null, result.addresses))
    .catch(err => callback?.(err));
}

export function resolve4(hostname: string, callback: DnsCallback<string[]>): void;
export function resolve4(hostname: string, options: any, callback: DnsCallback<string[]>): void;
export function resolve4(hostname: string, options: any, callback?: DnsCallback<string[]>): void {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  dnsRequest<DnsResolveResult>('resolve4', { hostname, options })
    .then(result => callback?.(null, result.addresses))
    .catch(err => callback?.(err));
}

export function resolve6(hostname: string, callback: DnsCallback<string[]>): void;
export function resolve6(hostname: string, options: any, callback: DnsCallback<string[]>): void;
export function resolve6(hostname: string, options: any, callback?: DnsCallback<string[]>): void {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  dnsRequest<DnsResolveResult>('resolve6', { hostname, options })
    .then(result => callback?.(null, result.addresses))
    .catch(err => callback?.(err));
}

export function resolveMx(hostname: string, callback: DnsCallback<any[]>): void {
  dnsRequest('resolveMx', { hostname })
    .then(result => callback(null, result))
    .catch(err => callback(err));
}

export function resolveTxt(hostname: string, callback: DnsCallback<string[][]>): void {
  dnsRequest('resolveTxt', { hostname })
    .then(result => callback(null, result))
    .catch(err => callback(err));
}

export function resolveSrv(hostname: string, callback: DnsCallback<any[]>): void {
  dnsRequest('resolveSrv', { hostname })
    .then(result => callback(null, result))
    .catch(err => callback(err));
}

export function resolveNs(hostname: string, callback: DnsCallback<string[]>): void {
  dnsRequest('resolveNs', { hostname })
    .then(result => callback(null, result))
    .catch(err => callback(err));
}

export function resolveCname(hostname: string, callback: DnsCallback<string[]>): void {
  dnsRequest('resolveCname', { hostname })
    .then(result => callback(null, result))
    .catch(err => callback(err));
}

export function reverse(ip: string, callback: DnsCallback<string[]>): void {
  dnsRequest('reverse', { ip })
    .then(result => callback(null, result))
    .catch(err => callback(err));
}

// Promise-based API
export const promises = {
  lookup: (hostname: string, options?: any) =>
    dnsRequest<DnsLookupResult>('lookup', { hostname, options }),

  resolve: (hostname: string, rrtype: string = 'A') =>
    dnsRequest<DnsResolveResult>('resolve', { hostname, rrtype }),

  resolve4: (hostname: string, options?: any) =>
    dnsRequest<DnsResolveResult>('resolve4', { hostname, options }),

  resolve6: (hostname: string, options?: any) =>
    dnsRequest<DnsResolveResult>('resolve6', { hostname, options }),

  resolveMx: (hostname: string) =>
    dnsRequest('resolveMx', { hostname }),

  resolveTxt: (hostname: string) =>
    dnsRequest('resolveTxt', { hostname }),

  resolveSrv: (hostname: string) =>
    dnsRequest('resolveSrv', { hostname }),

  resolveNs: (hostname: string) =>
    dnsRequest('resolveNs', { hostname }),

  resolveCname: (hostname: string) =>
    dnsRequest('resolveCname', { hostname }),

  reverse: (ip: string) =>
    dnsRequest('reverse', { ip }),
};

// Error codes
export const NODATA = 'ENODATA';
export const FORMERR = 'EFORMERR';
export const SERVFAIL = 'ESERVFAIL';
export const NOTFOUND = 'ENOTFOUND';
export const REFUSED = 'EREFUSED';
export const CONNREFUSED = 'ECONNREFUSED';
export const TIMEOUT = 'ETIMEOUT';

export default {
  lookup,
  resolve,
  resolve4,
  resolve6,
  resolveMx,
  resolveTxt,
  resolveSrv,
  resolveNs,
  resolveCname,
  reverse,
  promises,
  NODATA,
  FORMERR,
  SERVFAIL,
  NOTFOUND,
  REFUSED,
  CONNREFUSED,
  TIMEOUT,
};
