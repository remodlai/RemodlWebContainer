// SPDX-License-Identifier: MIT
/**
 * libSQL Backend for ZenFS
 *
 * Provides a libSQL-backed filesystem storage for ZenFS,
 * supporting embedded replicas with remote sync to libsql-server.
 *
 * @example
 * ```typescript
 * import { configure } from '@zenfs/core';
 * import { LibSQL } from '@remodl-web-container/core/backends/libsql';
 *
 * await configure({
 *   mounts: {
 *     '/': {
 *       backend: LibSQL,
 *       organizationId: 'org-123',
 *       syncUrl: 'http://libsql-server:8080/v1/namespaces/project',
 *       authToken: 'token',
 *     }
 *   }
 * });
 * ```
 *
 * @packageDocumentation
 */

// Backend and factory functions
export {
  LibSQLBackend,
  LibSQL,
  createLibSQLStore,
  forkTemplate,
  namespaceExists,
  createNamespace,
  type Backend,
} from './backend';

// Store implementation
export { LibSQLStore, type Store, type StoreFlag, type UsageInfo } from './store';

// Transaction implementation
export { LibSQLTransaction, AsyncTransactionBase } from './transaction';

// Type definitions
export {
  // Row interfaces
  type InodeRow,
  type DirentRow,
  type MetadataRow,
  type AgentMemoryRow,
  // Configuration
  type LibSQLBackendOptions,
  type FileSystemMetadata,
  // Constants
  S_IFMT,
  S_IFDIR,
  S_IFREG,
  S_IFLNK,
  DEFAULT_DIR_MODE,
  DEFAULT_FILE_MODE,
  ROOT_INO,
  // Helper functions
  isDirectory,
  isFile,
  isSymlink,
  nowISO,
  createDefaultInode,
} from './types';

// Default export is the backend
export { LibSQLBackend as default } from './backend';
