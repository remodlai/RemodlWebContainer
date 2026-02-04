// SPDX-License-Identifier: MIT
/**
 * LibSQLBackend - ZenFS Backend factory for libSQL storage
 *
 * This implements the ZenFS Backend interface to create libSQL-backed filesystems.
 * It supports:
 * - Local embedded replicas (SQLite WASM in browser)
 * - Remote sync to libsql-server
 * - Template database forking for instant workspace setup
 *
 * Usage:
 * ```typescript
 * import { configure } from '@zenfs/core';
 * import { LibSQL } from './backends/libsql';
 *
 * await configure({
 *   mounts: {
 *     '/': {
 *       backend: LibSQL,
 *       organizationId: 'org-123',
 *       agentId: null, // or 'agent-456' for agent workspace
 *       syncUrl: 'http://libsql-server:8080/v1/namespaces/org-123/project',
 *       authToken: 'your-token',
 *     }
 *   }
 * });
 * ```
 */

import { createClient, type Client } from '@libsql/client';
import { LibSQLStore } from './store';
import type { LibSQLBackendOptions } from './types';

/**
 * StoreFS from ZenFS - we'll create instances of this
 * Import dynamically to avoid circular dependencies
 */
let StoreFS: any;

/**
 * Backend interface compatible with ZenFS
 */
export interface Backend<FS = unknown, TOptions = object> {
  name: string;
  options: Record<string, { type: string | readonly string[]; required: boolean }>;
  create(options: TOptions): FS | Promise<FS>;
  isAvailable?(config: TOptions): boolean | Promise<boolean>;
}

/**
 * LibSQLBackend creates libSQL-backed ZenFS filesystems
 *
 * Architecture:
 * ```
 * LibSQLBackend.create(options)
 *   ↓
 * createClient({ url, syncUrl, authToken })
 *   ↓
 * new LibSQLStore(client, options)
 *   ↓
 * new StoreFS(store)
 *   ↓
 * Ready-to-use FileSystem
 * ```
 */
export const LibSQLBackend: Backend<unknown, LibSQLBackendOptions> = {
  name: 'LibSQL',

  options: {
    url: { type: 'string', required: false },
    syncUrl: { type: 'string', required: false },
    authToken: { type: 'string', required: false },
    organizationId: { type: 'string', required: true },
    agentId: { type: ['string', 'undefined'], required: false },
    syncInterval: { type: 'number', required: false },
    label: { type: 'string', required: false },
    maxSize: { type: 'number', required: false },
  },

  /**
   * Create a new libSQL-backed filesystem
   */
  async create(options: LibSQLBackendOptions): Promise<unknown> {
    // Dynamically import StoreFS to avoid circular deps
    if (!StoreFS) {
      const zenfs = await import('@zenfs/core');
      // StoreFS might be in different locations depending on ZenFS version
      StoreFS = (zenfs as any).StoreFS || (zenfs as any).backends?.StoreFS;
      if (!StoreFS) {
        // If not exported, we'll create a minimal wrapper
        throw new Error('ZenFS StoreFS not found. Please ensure @zenfs/core is properly installed.');
      }
    }

    // Create libSQL client
    const client = await createLibSQLClient(options);

    // Create store
    const store = new LibSQLStore(client, options);

    // Initialize schema
    await store.initialize();

    // Ensure root directory exists
    await store.ensureRoot();

    // Create and return StoreFS
    const fs = new StoreFS(store);

    // Initialize the filesystem
    if (typeof fs.ready === 'function') {
      await fs.ready();
    }

    return fs;
  },

  /**
   * Check if libSQL is available in the current environment
   */
  async isAvailable(_config: LibSQLBackendOptions): Promise<boolean> {
    try {
      // Check if we can import the libSQL client
      const { createClient: _createClient } = await import('@libsql/client');
      return typeof _createClient === 'function';
    } catch {
      return false;
    }
  },
};

/**
 * Create a libSQL client with the given options
 *
 * Supports multiple modes:
 * 1. Local only: url="file:/path.db" (no sync)
 * 2. Remote only: url="http://server/..." (direct remote)
 * 3. Embedded replica: url="file:/path.db" + syncUrl (local with remote sync)
 */
async function createLibSQLClient(options: LibSQLBackendOptions): Promise<Client> {
  // Determine the URL - required by libSQL client
  let url: string;
  if (options.url) {
    url = options.url;
  } else if (options.syncUrl) {
    // If only syncUrl provided, use it as the main URL
    url = options.syncUrl;
  } else {
    // Default to in-memory for testing
    url = ':memory:';
  }

  // Build config object
  const config: Parameters<typeof createClient>[0] = { url };

  // Set sync URL for embedded replicas
  if (options.syncUrl && options.url && options.url.startsWith('file:')) {
    config.syncUrl = options.syncUrl;
    config.syncInterval = options.syncInterval ?? 60000; // Default: 1 minute
  }

  // Set auth token
  if (options.authToken) {
    config.authToken = options.authToken;
  }

  return createClient(config);
}

/**
 * Create a libSQL store without wrapping in StoreFS
 * Useful for direct database operations
 */
export async function createLibSQLStore(options: LibSQLBackendOptions): Promise<LibSQLStore> {
  const client = await createLibSQLClient(options);
  const store = new LibSQLStore(client, options);
  await store.initialize();
  await store.ensureRoot();
  return store;
}

/**
 * Fork a template namespace to create a new workspace
 *
 * Uses libsql-server Admin API:
 * POST /v1/namespaces/:template/fork/:to
 *
 * @param serverUrl - Base URL of libsql-server (e.g., "http://libsql-server:8080")
 * @param templateNamespace - Source template namespace
 * @param targetNamespace - Target namespace for the new workspace
 * @param authToken - Optional auth token
 * @returns Promise<boolean> - true if fork succeeded
 */
export async function forkTemplate(
  serverUrl: string,
  templateNamespace: string,
  targetNamespace: string,
  authToken?: string
): Promise<boolean> {
  const url = `${serverUrl}/v1/namespaces/${templateNamespace}/fork/${targetNamespace}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Fork failed:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Fork error:', error);
    return false;
  }
}

/**
 * Check if a namespace exists on libsql-server
 */
export async function namespaceExists(
  serverUrl: string,
  namespace: string,
  authToken?: string
): Promise<boolean> {
  const url = `${serverUrl}/v1/namespaces`;

  const headers: Record<string, string> = {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return false;

    const data = await response.json();
    const namespaces = data.namespaces || [];
    return namespaces.includes(namespace);
  } catch {
    return false;
  }
}

/**
 * Create a new namespace on libsql-server
 */
export async function createNamespace(
  serverUrl: string,
  namespace: string,
  authToken?: string
): Promise<boolean> {
  const url = `${serverUrl}/v1/namespaces/${namespace}/create`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
    });

    return response.ok;
  } catch {
    return false;
  }
}

// Export the backend as default and named
export { LibSQLBackend as LibSQL };
export default LibSQLBackend;
