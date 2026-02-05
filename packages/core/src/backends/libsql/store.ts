// SPDX-License-Identifier: MIT
/**
 * LibSQLStore - ZenFS Store implementation backed by libSQL
 *
 * This implements the ZenFS Store interface using libSQL as the storage backend.
 * It supports both local embedded replicas (SQLite WASM) and remote sync to libsql-server.
 *
 * Key concepts:
 * - Store is a path-based interface (path → Uint8Array)
 * - All operations go through transactions for atomicity
 * - watch() events use paths (not inode IDs) for easy matching
 */

import type { Client } from '@libsql/client';
import { LibSQLTransaction } from './transaction';
import { BrowserEventEmitter } from '../../process/base/event-emmiter';
import type { LibSQLBackendOptions, FSChangeEvent, FSChangeCallback } from './types';

/**
 * Usage information for the store
 */
export interface UsageInfo {
  totalSpace: number;
  freeSpace: number;
}

/**
 * Store flags for optimization hints
 */
export type StoreFlag = 'partial';

/**
 * Store interface compatible with ZenFS
 */
export interface Store {
  readonly type?: number;
  readonly name: string;
  readonly label?: string;
  readonly uuid?: string;
  readonly flags?: readonly StoreFlag[];

  sync(): Promise<void>;
  transaction(): LibSQLTransaction;
  usage?(): UsageInfo;
}

/**
 * LibSQLStore implements the ZenFS Store interface
 *
 * Architecture:
 * - Uses @libsql/client for database operations
 * - Supports embedded replicas (local SQLite) with remote sync
 * - All read/write operations go through transactions
 * - Implements the simple key-value interface expected by StoreFS
 */
export class LibSQLStore implements Store {
  public readonly type = 0x6c737173; // 'lsqs' in hex
  public readonly name = 'libsqlfs';
  public readonly label?: string;
  public readonly uuid?: string;
  public readonly flags: readonly StoreFlag[] = ['partial']; // We support partial reads/writes

  private readonly client: Client;
  private readonly organizationId: string;
  private readonly agentId: string | null;
  private readonly maxSize: number;
  private initialized = false;
  private eventEmitter: BrowserEventEmitter = new BrowserEventEmitter();

  constructor(
    client: Client,
    options: LibSQLBackendOptions
  ) {
    this.client = client;
    this.organizationId = options.organizationId;
    this.agentId = options.agentId ?? null;
    this.label = options.label;
    this.maxSize = options.maxSize ?? 4 * 1024 * 1024 * 1024; // 4 GiB default
  }

  /**
   * Initialize the database schema if needed
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create files table (path-based storage)
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        agent_id TEXT,
        content BLOB,
        mode INTEGER NOT NULL DEFAULT 33188,
        uid INTEGER NOT NULL DEFAULT 1000,
        gid INTEGER NOT NULL DEFAULT 1000,
        size INTEGER NOT NULL DEFAULT 0,
        atime TEXT NOT NULL,
        mtime TEXT NOT NULL,
        ctime TEXT NOT NULL,
        birthtime TEXT NOT NULL,
        canonical_path TEXT,
        PRIMARY KEY (path, organization_id, agent_id)
      )
    `);

    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_files_org_agent
      ON files(organization_id, agent_id)
    `);

    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_files_path_prefix
      ON files(path, organization_id, agent_id)
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS fs_metadata (
        organization_id TEXT NOT NULL,
        agent_id TEXT,
        metadata TEXT NOT NULL,
        PRIMARY KEY (organization_id, agent_id)
      )
    `);

    this.initialized = true;
  }

  /**
   * Sync the embedded replica with the remote server
   * For libSQL embedded replicas, this triggers a sync operation
   */
  public async sync(): Promise<void> {
    // If the client has a sync method (embedded replica), call it
    if ('sync' in this.client && typeof this.client.sync === 'function') {
      await this.client.sync();
    }
  }

  /**
   * Create a new transaction for atomic operations
   *
   * ZenFS StoreFS uses transactions for all operations:
   * - tx.get(id, offset, end) - read data
   * - tx.set(id, data, offset) - write data
   * - tx.remove(id) - delete data
   * - tx.commit() - persist changes
   */
  public transaction(): LibSQLTransaction {
    return new LibSQLTransaction(
      this,
      this.client,
      this.organizationId,
      this.agentId,
      (events) => this.handleCommitEvents(events)
    );
  }

  /**
   * Handle events from committed transactions
   */
  private handleCommitEvents(events: FSChangeEvent[]): void {
    for (const event of events) {
      this.eventEmitter.emit('change', event);
    }
  }

  /**
   * Subscribe to file change events
   * @returns Unsubscribe function
   */
  public onFileChange(callback: FSChangeCallback): () => void {
    this.eventEmitter.on('change', callback);
    return () => this.eventEmitter.off('change', callback);
  }

  /**
   * Get storage usage information
   */
  public usage(): UsageInfo {
    // We could query the database for actual size, but for now return estimates
    return {
      totalSpace: this.maxSize,
      freeSpace: this.maxSize, // TODO: Calculate actual usage
    };
  }

  /**
   * Get the libSQL client (for advanced operations)
   */
  public getClient(): Client {
    return this.client;
  }

  /**
   * Get organization ID
   */
  public getOrganizationId(): string {
    return this.organizationId;
  }

  /**
   * Get agent ID
   */
  public getAgentId(): string | null {
    return this.agentId;
  }

  /**
   * Check if a root directory exists
   */
  public async hasRoot(): Promise<boolean> {
    const result = await this.client.execute({
      sql: `SELECT 1 FROM files
            WHERE path = '/' AND organization_id = ?
            AND (agent_id = ? OR (agent_id IS NULL AND ? IS NULL))`,
      args: [this.organizationId, this.agentId, this.agentId],
    });
    return result.rows.length > 0;
  }

  /**
   * Create root directory if it doesn't exist
   * Called by StoreFS during initialization
   */
  public async ensureRoot(): Promise<void> {
    const hasRoot = await this.hasRoot();
    if (hasRoot) return;

    const now = new Date().toISOString();

    // Create root directory entry
    // Mode 16877 = S_IFDIR | 0755 (directory with rwxr-xr-x)
    await this.client.execute({
      sql: `INSERT INTO files (path, organization_id, agent_id, content, mode, uid, gid, size, atime, mtime, ctime, birthtime)
            VALUES ('/', ?, ?, NULL, 16877, 1000, 1000, 0, ?, ?, ?, ?)`,
      args: [this.organizationId, this.agentId, now, now, now, now],
    });
  }

  /**
   * Close the store and release resources
   */
  public async close(): Promise<void> {
    // Sync before closing
    await this.sync();

    // Close the client if it has a close method
    if ('close' in this.client && typeof this.client.close === 'function') {
      await this.client.close();
    }
  }

  /**
   * Text search using FTS5 with fuzzy fallback
   *
   * Search strategy:
   * 1. FTS5 MATCH for fast, indexed word matching
   * 2. Fuzzy fallback (fuzzy_damlev) for typo tolerance if no results
   *
   * @param query - Search query string
   * @param options - Search options
   * @returns Array of search matches with line information
   */
  public async textSearch(
    query: string,
    options: {
      folders?: string[];
      includes?: string[];
      excludes?: string[];
      caseSensitive?: boolean;
      isRegex?: boolean;
      resultLimit?: number;
      fuzzyThreshold?: number;
    } = {}
  ): Promise<{
    matches: Array<{
      path: string;
      lineNumber: number;
      lineContent: string;
      matchStart: number;
      matchEnd: number;
    }>;
    truncated: boolean;
  }> {
    const limit = options.resultLimit || 500;
    const fuzzyThreshold = options.fuzzyThreshold ?? 2;
    const matches: Array<{
      path: string;
      lineNumber: number;
      lineContent: string;
      matchStart: number;
      matchEnd: number;
    }> = [];

    try {
      // Build folder filter
      let folderFilter = '';
      const folderArgs: string[] = [];
      if (options.folders && options.folders.length > 0) {
        const folderClauses = options.folders.map((folder, i) => {
          folderArgs.push(folder.endsWith('/') ? `${folder}%` : `${folder}/%`);
          return `f.path LIKE ?`;
        });
        folderFilter = `AND (${folderClauses.join(' OR ')})`;
      }

      // Build exclude filter
      let excludeFilter = '';
      const excludeArgs: string[] = [];
      if (options.excludes && options.excludes.length > 0) {
        for (const pattern of options.excludes) {
          // Convert glob to SQL LIKE pattern
          const likePattern = pattern
            .replace(/\*\*/g, '%')
            .replace(/\*/g, '%')
            .replace(/\?/g, '_');
          excludeArgs.push(likePattern);
          excludeFilter += ` AND f.path NOT LIKE ?`;
        }
      }

      // First, try FTS5 search
      const ftsQuery = options.isRegex ? query : query.replace(/['"]/g, '');
      const ftsResult = await this.client.execute({
        sql: `
          SELECT f.path, f.content
          FROM files f
          INNER JOIN files_fts fts ON f.rowid = fts.rowid
          WHERE fts.content MATCH ?
          AND f.organization_id = ?
          AND (f.agent_id = ? OR (f.agent_id IS NULL AND ? IS NULL))
          AND f.mode & 61440 = 32768  -- Regular files only (S_IFREG)
          ${folderFilter}
          ${excludeFilter}
          LIMIT ?
        `,
        args: [
          ftsQuery,
          this.organizationId,
          this.agentId,
          this.agentId,
          ...folderArgs,
          ...excludeArgs,
          limit,
        ],
      });

      // Process FTS results
      for (const row of ftsResult.rows) {
        const path = row.path as string;
        const content = row.content as string | null;

        if (!content) continue;

        // Find matching lines
        const lines = content.split('\n');
        const searchLower = options.caseSensitive ? query : query.toLowerCase();

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum];
          const lineLower = options.caseSensitive ? line : line.toLowerCase();

          let matchIndex = lineLower.indexOf(searchLower);
          while (matchIndex !== -1) {
            matches.push({
              path,
              lineNumber: lineNum + 1,
              lineContent: line,
              matchStart: matchIndex,
              matchEnd: matchIndex + query.length,
            });

            if (matches.length >= limit) break;
            matchIndex = lineLower.indexOf(searchLower, matchIndex + 1);
          }

          if (matches.length >= limit) break;
        }

        if (matches.length >= limit) break;
      }

      // If no FTS results and fuzzy is enabled, try fuzzy search on paths
      if (matches.length === 0 && fuzzyThreshold > 0) {
        const fuzzyResult = await this.client.execute({
          sql: `
            SELECT path, content
            FROM files
            WHERE organization_id = ?
            AND (agent_id = ? OR (agent_id IS NULL AND ? IS NULL))
            AND mode & 61440 = 32768
            AND (
              fuzzy_damlev(path, ?) <= ?
              OR path LIKE '%' || ? || '%'
            )
            ${folderFilter}
            ${excludeFilter}
            LIMIT ?
          `,
          args: [
            this.organizationId,
            this.agentId,
            this.agentId,
            query,
            fuzzyThreshold,
            query,
            ...folderArgs,
            ...excludeArgs,
            limit,
          ],
        });

        for (const row of fuzzyResult.rows) {
          const path = row.path as string;
          const content = row.content as string | null;

          if (!content) continue;

          const lines = content.split('\n');
          const searchLower = options.caseSensitive ? query : query.toLowerCase();

          for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            const lineLower = options.caseSensitive ? line : line.toLowerCase();

            const matchIndex = lineLower.indexOf(searchLower);
            if (matchIndex !== -1) {
              matches.push({
                path,
                lineNumber: lineNum + 1,
                lineContent: line,
                matchStart: matchIndex,
                matchEnd: matchIndex + query.length,
              });

              if (matches.length >= limit) break;
            }
          }

          if (matches.length >= limit) break;
        }
      }

      return {
        matches,
        truncated: matches.length >= limit,
      };
    } catch (error) {
      console.error('textSearch error:', error);
      // If FTS5 table doesn't exist yet, return empty results
      return { matches: [], truncated: false };
    }
  }
}
