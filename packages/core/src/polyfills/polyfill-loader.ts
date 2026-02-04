/**
 * Polyfill loader for QuickJS runtime
 * Loads the browserify bundle to provide Node.js built-ins
 */

import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Load Node.js polyfills bundle
 * This bundle provides: http, https, crypto, stream, buffer, events, util, path, url, querystring, zlib
 */
export function getPolyfillBundle(): string {
  const bundlePath = join(__dirname, 'node-polyfills-bundle.js');
  return readFileSync(bundlePath, 'utf-8');
}

/**
 * Get initialization code to set up the polyfills in QuickJS
 * This should be evaluated before any user code runs
 */
export function getPolyfillInitCode(): string {
  return `
// Load the browserify polyfill bundle
${getPolyfillBundle()}

// Export the require function to global scope
globalThis.require = require;

// Pre-load commonly used modules
const buffer = require('buffer');
const events = require('events');
const stream = require('stream');
const util = require('util');
const path = require('path');

// Make Buffer available globally (Node.js compatibility)
globalThis.Buffer = buffer.Buffer;

// Make process available (basic implementation)
if (!globalThis.process) {
  globalThis.process = {
    env: {},
    argv: [],
    platform: 'browser',
    nextTick: (fn) => Promise.resolve().then(fn),
    cwd: () => '/home/project',
    version: 'v18.0.0',
    versions: { node: '18.0.0' }
  };
}

console.log('[Polyfills] Node.js built-ins loaded successfully');
`;
}

/**
 * List of available polyfilled modules
 */
export const AVAILABLE_MODULES = [
  'http',
  'https',
  'crypto',
  'stream',
  'buffer',
  'events',
  'util',
  'path',
  'url',
  'querystring',
  'zlib'
] as const;

export type PolyfillModule = typeof AVAILABLE_MODULES[number];
