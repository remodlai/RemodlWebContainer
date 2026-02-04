// SPDX-License-Identifier: MIT
/**
 * LibSQLStore - ZenFS Store implementation backed by libSQL
 *
 * This implements the ZenFS Store interface using libSQL as the storage backend.
 * It supports both local embedded replicas (SQLite WASM) and remote sync to libsql-server.
 *
 * Key concepts:
 * - Store is a key-value interface (id → Uint8Array)
 * - ZenFS StoreFS uses two IDs per inode: ino (metadata) and data (content)
 * - All operations go through transactions for atomicity
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

    // Create tables if they don't exist
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS fs_inodes (
        inode_id INTEGER NOT NULL,
        organization_id TEXT NOT NULL,
        agent_id TEXT,
        data BLOB,
        mode INTEGER NOT NULL DEFAULT 33188,
        uid INTEGER NOT NULL DEFAULT 1000,
        gid INTEGER NOT NULL DEFAULT 1000,
        size INTEGER NOT NULL DEFAULT 0,
        nlink INTEGER NOT NULL DEFAULT 1,
        atime TEXT NOT NULL,
        mtime TEXT NOT NULL,
        ctime TEXT NOT NULL,
        birthtime TEXT NOT NULL,
        flags INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (inode_id, organization_id, agent_id)
      )
    `);

    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_fs_inodes_org_agent
      ON fs_inodes(organization_id, agent_id)
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS fs_dirents (
        parent_inode INTEGER NOT NULL,
        name TEXT NOT NULL,
        inode_id INTEGER NOT NULL,
        organization_id TEXT NOT NULL,
        agent_id TEXT,
        PRIMARY KEY (parent_inode, name, organization_id, agent_id)
      )
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
   * Check if a root inode exists
   */
  public async hasRoot(): Promise<boolean> {
    const result = await this.client.execute({
      sql: `SELECT 1 FROM fs_inodes
            WHERE inode_id = 0 AND organization_id = ?
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

    // Create root inode (ino=0)
    // Mode 16877 = S_IFDIR | 0755 (directory with rwxr-xr-x)
    await this.client.execute({
      sql: `INSERT INTO fs_inodes (inode_id, organization_id, agent_id, data, mode, uid, gid, size, nlink, atime, mtime, ctime, birthtime, flags)
            VALUES (0, ?, ?, ?, 16877, 1000, 1000, 0, 2, ?, ?, ?, ?, 0)`,
      args: [this.organizationId, this.agentId, new TextEncoder().encode('{}'), now, now, now, now],
    });

    // Create data node for root directory (id=1)
    // This stores the directory listing as JSON
    await this.client.execute({
      sql: `INSERT INTO fs_inodes (inode_id, organization_id, agent_id, data, mode, uid, gid, size, nlink, atime, mtime, ctime, birthtime, flags)
            VALUES (1, ?, ?, ?, 16877, 1000, 1000, 2, 1, ?, ?, ?, ?, 0)`,
      args: [this.organizationId, this.agentId, new TextEncoder().encode('{}'), now, now, now, now],
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
}
