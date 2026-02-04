// SPDX-License-Identifier: MIT
/**
 * LibSQLTransaction - Atomic operations for libSQL-backed ZenFS filesystem
 *
 * This extends ZenFS's AsyncTransaction to use libSQL for storage.
 * The Store uses a key-value interface where:
 * - Keys are inode IDs (numbers)
 * - Values are Uint8Array data (serialized Inode or file content)
 *
 * ZenFS uses TWO ids per inode:
 * - inode.ino: stores the Inode metadata (serialized Inode struct)
 * - inode.data: stores the file content (or directory listing JSON)
 *
 * These are allocated sequentially: if ino=2, then data=3
 */

import type { Client, Transaction as LibSQLTx } from '@libsql/client';
import type { LibSQLStore } from './store';

/**
 * AsyncTransaction base class compatible with ZenFS
 * We implement this ourselves since we're not importing from @zenfs/core
 */
export abstract class AsyncTransactionBase {
  protected asyncDone: Promise<unknown> = Promise.resolve();

  /**
   * Run an async operation from sync context
   */
  protected async(promise: Promise<unknown>): void {
    this.asyncDone = this.asyncDone.then(() => promise);
  }

  public abstract keys(): Promise<Iterable<number>>;
  public abstract get(id: number, offset: number, end?: number): Promise<Uint8Array | undefined>;
  public abstract getSync(id: number, offset: number, end?: number): Uint8Array | undefined;
  public abstract set(id: number, data: Uint8Array, offset: number): Promise<void>;
  public abstract setSync(id: number, data: Uint8Array, offset: number): void;
  public abstract remove(id: number): Promise<void>;
  public abstract removeSync(id: number): void;
}

/**
 * LibSQLTransaction provides atomic operations using libSQL
 *
 * Key insight: ZenFS Store interface is a simple key-value store where:
 * - keys are numbers (inode IDs or data IDs)
 * - values are Uint8Array (raw bytes)
 *
 * We store these in fs_inodes table using inode_id as the key.
 * For simplicity, we use the 'data' column for all storage,
 * treating inode metadata and file content identically as blobs.
 */
export class LibSQLTransaction extends AsyncTransactionBase {
  private cache: Map<number, Uint8Array | undefined> = new Map();
  private pendingWrites: Map<number, Uint8Array> = new Map();
  private pendingDeletes: Set<number> = new Set();
  private committed = false;

  constructor(
    public readonly store: LibSQLStore,
    private readonly client: Client,
    private readonly organizationId: string,
    private readonly agentId: string | null
  ) {
    super();
  }

  /**
   * Get all keys (inode IDs) in the store
   */
  public async keys(): Promise<Iterable<number>> {
    await this.asyncDone;

    const result = await this.client.execute({
      sql: `SELECT DISTINCT inode_id FROM fs_inodes
            WHERE organization_id = ? AND (agent_id = ? OR (agent_id IS NULL AND ? IS NULL))`,
      args: [this.organizationId, this.agentId, this.agentId],
    });

    return result.rows.map((row) => row.inode_id as number);
  }

  /**
   * Get data for an inode ID
   *
   * @param id - The inode ID (or data ID) to look up
   * @param offset - Start offset in the data
   * @param end - End offset (exclusive), or undefined for rest of data
   */
  public async get(id: number, offset: number, end?: number): Promise<Uint8Array | undefined> {
    await this.asyncDone;

    // Check pending deletes
    if (this.pendingDeletes.has(id)) {
      return undefined;
    }

    // Check pending writes
    if (this.pendingWrites.has(id)) {
      const data = this.pendingWrites.get(id)!;
      return this.sliceData(data, offset, end);
    }

    // Check cache
    if (this.cache.has(id)) {
      const cached = this.cache.get(id);
      return cached ? this.sliceData(cached, offset, end) : undefined;
    }

    // Query database
    const result = await this.client.execute({
      sql: `SELECT data FROM fs_inodes
            WHERE inode_id = ? AND organization_id = ?
            AND (agent_id = ? OR (agent_id IS NULL AND ? IS NULL))`,
      args: [id, this.organizationId, this.agentId, this.agentId],
    });

    if (result.rows.length === 0) {
      this.cache.set(id, undefined);
      return undefined;
    }

    const rawData = result.rows[0].data;
    let data: Uint8Array | undefined;

    if (rawData === null || rawData === undefined) {
      data = undefined;
    } else if (rawData instanceof Uint8Array) {
      data = rawData;
    } else if (rawData instanceof ArrayBuffer) {
      data = new Uint8Array(rawData);
    } else if (typeof rawData === 'string') {
      // Handle base64-encoded data from some libSQL clients
      data = this.decodeBase64(rawData);
    } else if (ArrayBuffer.isView(rawData)) {
      // Handle other TypedArray views
      data = new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength);
    } else {
      // Last resort: try to handle as array-like with unknown type
      console.warn('Unknown data type from libSQL:', typeof rawData);
      data = undefined;
    }

    this.cache.set(id, data);
    return data ? this.sliceData(data, offset, end) : undefined;
  }

  /**
   * Synchronous get - uses cache only
   * Throws EAGAIN if data not in cache
   */
  public getSync(id: number, offset: number, end?: number): Uint8Array | undefined {
    // Check pending deletes
    if (this.pendingDeletes.has(id)) {
      return undefined;
    }

    // Check pending writes first
    if (this.pendingWrites.has(id)) {
      const data = this.pendingWrites.get(id)!;
      return this.sliceData(data, offset, end);
    }

    // Check cache
    if (this.cache.has(id)) {
      const cached = this.cache.get(id);
      return cached ? this.sliceData(cached, offset, end) : undefined;
    }

    // Not in cache - trigger async load and throw EAGAIN
    this.async(this.get(id, offset, end));
    const error = new Error('EAGAIN: Resource temporarily unavailable');
    (error as any).code = 'EAGAIN';
    throw error;
  }

  /**
   * Set data for an inode ID
   *
   * @param id - The inode ID (or data ID)
   * @param data - The data to store
   * @param offset - Offset at which to write (0 for full replacement)
   */
  public async set(id: number, data: Uint8Array, offset: number): Promise<void> {
    await this.asyncDone;

    // Remove from deletes if present
    this.pendingDeletes.delete(id);

    // Handle partial writes
    let finalData: Uint8Array;
    if (offset === 0) {
      finalData = data;
    } else {
      // Need to merge with existing data
      const existing = await this.get(id, 0) ?? new Uint8Array(0);
      const newSize = Math.max(existing.length, offset + data.length);
      finalData = new Uint8Array(newSize);
      finalData.set(existing);
      finalData.set(data, offset);
    }

    this.pendingWrites.set(id, finalData);
    this.cache.set(id, finalData);
  }

  /**
   * Synchronous set - queues for async write
   */
  public setSync(id: number, data: Uint8Array, offset: number): void {
    this.async(this.set(id, data, offset));
  }

  /**
   * Remove an inode ID from the store
   */
  public async remove(id: number): Promise<void> {
    await this.asyncDone;
    this.pendingWrites.delete(id);
    this.pendingDeletes.add(id);
    this.cache.set(id, undefined);
  }

  /**
   * Synchronous remove - queues for async delete
   */
  public removeSync(id: number): void {
    this.async(this.remove(id));
  }

  /**
   * Commit all pending changes to the database
   */
  public async commit(): Promise<void> {
    if (this.committed) return;
    await this.asyncDone;

    const now = new Date().toISOString();

    // Process all pending writes
    for (const [id, data] of this.pendingWrites) {
      await this.client.execute({
        sql: `INSERT INTO fs_inodes (inode_id, organization_id, agent_id, data, mode, uid, gid, size, nlink, atime, mtime, ctime, birthtime, flags)
              VALUES (?, ?, ?, ?, 33188, 1000, 1000, ?, 1, ?, ?, ?, ?, 0)
              ON CONFLICT (inode_id, organization_id, agent_id) DO UPDATE SET
                data = excluded.data,
                size = excluded.size,
                mtime = excluded.mtime,
                ctime = excluded.ctime`,
        args: [id, this.organizationId, this.agentId, data, data.length, now, now, now, now],
      });
    }

    // Process all pending deletes
    for (const id of this.pendingDeletes) {
      await this.client.execute({
        sql: `DELETE FROM fs_inodes
              WHERE inode_id = ? AND organization_id = ?
              AND (agent_id = ? OR (agent_id IS NULL AND ? IS NULL))`,
        args: [id, this.organizationId, this.agentId, this.agentId],
      });
    }

    this.committed = true;
    this.pendingWrites.clear();
    this.pendingDeletes.clear();
  }

  /**
   * Abort - discard pending changes
   */
  public abort(): void {
    this.committed = true;
    this.pendingWrites.clear();
    this.pendingDeletes.clear();
    this.cache.clear();
  }

  /**
   * Slice data according to offset/end
   */
  private sliceData(data: Uint8Array, offset: number, end?: number): Uint8Array {
    if (offset === 0 && end === undefined) {
      return data;
    }
    return data.subarray(offset, end);
  }

  /**
   * Decode base64 string to Uint8Array
   */
  private decodeBase64(str: string): Uint8Array {
    // Browser-compatible base64 decoding
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Symbol.asyncDispose for using/await using
   */
  async [Symbol.asyncDispose](): Promise<void> {
    if (!this.committed) {
      this.abort();
    }
  }

  /**
   * Symbol.dispose for using
   */
  [Symbol.dispose](): void {
    if (!this.committed) {
      this.abort();
    }
  }
}
