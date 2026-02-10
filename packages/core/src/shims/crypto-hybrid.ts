/**
 * Crypto module shim using Web Crypto API + crypto-browserify fallback.
 *
 * Strategy:
 * - Use Web Crypto API for common algorithms (SHA-256, SHA-512, etc.) - faster and native
 * - Fall back to crypto-browserify for algorithms Web Crypto doesn't support (MD5, etc.)
 * - Use Web Crypto for random number generation (crypto.getRandomValues)
 */

declare module 'crypto-browserify';

import * as cryptoBrowserify from 'crypto-browserify';
import { Buffer } from 'buffer';

// Web Crypto API reference
const webCrypto = globalThis.crypto?.subtle;

// Algorithms supported by Web Crypto
const WEB_CRYPTO_HASHES: Record<string, string> = {
  'sha-1': 'SHA-1',
  'sha1': 'SHA-1',
  'sha-256': 'SHA-256',
  'sha256': 'SHA-256',
  'sha-384': 'SHA-384',
  'sha384': 'SHA-384',
  'sha-512': 'SHA-512',
  'sha512': 'SHA-512',
};

/**
 * Hybrid Hash - uses Web Crypto when available, falls back to crypto-browserify
 */
class HybridHash {
  private algorithm: string;
  private webCryptoAlg?: string;
  private _chunks: Uint8Array[] = [];
  private _fallback?: any;

  constructor(algorithm: string) {
    this.algorithm = algorithm.toLowerCase();
    this.webCryptoAlg = WEB_CRYPTO_HASHES[this.algorithm];

    // Use fallback if Web Crypto doesn't support this algorithm
    if (!this.webCryptoAlg || !webCrypto) {
      this._fallback = cryptoBrowserify.createHash(algorithm);
    }
  }

  update(data: string | Buffer | Uint8Array, encoding?: BufferEncoding): this {
    if (this._fallback) {
      this._fallback.update(data, encoding);
      return this;
    }

    const buffer = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : (Buffer.isBuffer(data) ? new Uint8Array(data) : data);

    this._chunks.push(buffer);
    return this;
  }

  async digest(encoding?: string): Promise<Buffer | string> {
    if (this._fallback) {
      return this._fallback.digest(encoding);
    }

    // Combine all chunks
    const totalLength = this._chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of this._chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Use Web Crypto
    const hashBuffer = await webCrypto!.digest(this.webCryptoAlg!, combined);
    const hashArray = new Uint8Array(hashBuffer);

    if (encoding === 'hex') {
      return Array.from(hashArray)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }

    if (encoding === 'base64') {
      return btoa(String.fromCharCode(...hashArray));
    }

    return Buffer.from(hashArray);
  }

  // Sync digest (falls back to crypto-browserify)
  digestSync(encoding?: string): Buffer | string {
    if (this._fallback) {
      return this._fallback.digest(encoding);
    }

    // Can't use Web Crypto synchronously, create fallback
    const fallback = cryptoBrowserify.createHash(this.algorithm);
    for (const chunk of this._chunks) {
      fallback.update(Buffer.from(chunk));
    }
    return fallback.digest(encoding);
  }
}

/**
 * Create hash - returns hybrid hash object
 */
export function createHash(algorithm: string): HybridHash {
  return new HybridHash(algorithm);
}

/**
 * Random bytes - uses Web Crypto (faster and more secure)
 */
export function randomBytes(size: number): Buffer;
export function randomBytes(size: number, callback: (err: Error | null, buf: Buffer) => void): void;
export function randomBytes(size: number, callback?: (err: Error | null, buf: Buffer) => void): Buffer | void {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  const buffer = Buffer.from(bytes);

  if (callback) {
    setImmediate(() => callback(null, buffer));
    return;
  }

  return buffer;
}

export function randomBytesSync(size: number): Buffer {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes);
}

/**
 * Random UUID - uses Web Crypto
 */
export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Random int
 */
export function randomInt(max: number): number;
export function randomInt(min: number, max: number): number;
export function randomInt(max: number, callback: (err: Error | null, n: number) => void): void;
export function randomInt(min: number, max: number, callback: (err: Error | null, n: number) => void): void;
export function randomInt(
  min: number | ((err: Error | null, n: number) => void),
  max?: number | ((err: Error | null, n: number) => void),
  callback?: (err: Error | null, n: number) => void
): number | void {
  let minVal = 0;
  let maxVal = 2 ** 48;
  let cb: ((err: Error | null, n: number) => void) | undefined;

  if (typeof min === 'function') {
    cb = min;
  } else if (typeof max === 'function') {
    cb = max;
    maxVal = min;
  } else {
    minVal = min;
    maxVal = max ?? (2 ** 48);
    cb = callback;
  }

  const range = maxVal - minVal;
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  const value = bytes.reduce((acc, byte, i) => acc + byte * (256 ** i), 0);
  const result = minVal + (value % range);

  if (cb) {
    setImmediate(() => cb(null, result));
    return;
  }

  return result;
}

/**
 * Async hash helpers
 */
export async function sha256(data: string | Uint8Array): Promise<Buffer> {
  const buffer = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data;
  const hash = await webCrypto!.digest('SHA-256', buffer);
  return Buffer.from(hash);
}

export async function sha512(data: string | Uint8Array): Promise<Buffer> {
  const buffer = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data;
  const hash = await webCrypto!.digest('SHA-512', buffer);
  return Buffer.from(hash);
}

// Re-export crypto-browserify functions
export const createHmac = cryptoBrowserify.createHmac;
export const createCipheriv = cryptoBrowserify.createCipheriv;
export const createDecipheriv = cryptoBrowserify.createDecipheriv;
export const createSign = cryptoBrowserify.createSign;
export const createVerify = cryptoBrowserify.createVerify;
export const createDiffieHellman = cryptoBrowserify.createDiffieHellman;
export const createDiffieHellmanGroup = cryptoBrowserify.createDiffieHellmanGroup;
export const createECDH = cryptoBrowserify.createECDH;
export const publicEncrypt = cryptoBrowserify.publicEncrypt;
export const privateDecrypt = cryptoBrowserify.privateDecrypt;
export const privateEncrypt = cryptoBrowserify.privateEncrypt;
export const publicDecrypt = cryptoBrowserify.publicDecrypt;
export const pbkdf2 = cryptoBrowserify.pbkdf2;
export const pbkdf2Sync = cryptoBrowserify.pbkdf2Sync;
export const getCiphers = cryptoBrowserify.getCiphers;
export const getHashes = cryptoBrowserify.getHashes;

// Constants
export const constants = cryptoBrowserify.constants || {};

export default {
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  createSign,
  createVerify,
  createDiffieHellman,
  createDiffieHellmanGroup,
  createECDH,
  publicEncrypt,
  privateDecrypt,
  privateEncrypt,
  publicDecrypt,
  pbkdf2,
  pbkdf2Sync,
  randomBytes,
  randomBytesSync,
  randomUUID,
  randomInt,
  getCiphers,
  getHashes,
  constants,
  // Async helpers
  sha256,
  sha512,
};
