// SPDX-License-Identifier: MIT
/**
 * LibSQLTransaction - Atomic operations for libSQL-backed ZenFS filesystem
 *
 * This provides path-based storage where:
 * - Keys are file paths (strings like '/src/main.ts')
 * - Values are Uint8Array data (file content)
 *
 * Why path-based instead of inode-based?
 * - libSQL already provides inode-level efficiency (no BLOB copy on UPDATE)
 * - watch() needs paths, not inode IDs
 * - Simpler schema, simpler code
 */

import type { Client } from '@libsql/client';
import type { LibSQLStore } from './store';
import type { FSChangeEvent } from './types';

/**
 * AsyncTransaction base class compatible with ZenFS
 * Path-based interface for filesystem operations
 */
export abstract class AsyncTransactionBase {
  protected asyncDone: Promise<unknown> = Promise.resolve();

  /**
   * Run an async operation from sync context
   */
  protected async(promise: Promise<unknown>): void {
    this.asyncDone = this.asyncDone.then(() => promise);
  }

  public abstract keys(): Promise<Iterable<string>>;
  public abstract get(path: string, offset: number, end?: number): Promise<Uint8Array | undefined>;
  public abstract getSync(path: string, offset: number, end?: number): Uint8Array | undefined;
  public abstract set(path: string, data: Uint8Array, offset: number): Promise<void>;
  public abstract setSync(path: string, data: Uint8Array, offset: number): void;
  public abstract remove(path: string): Promise<void>;
  public abstract removeSync(path: string): void;
}

/**
 * LibSQLTransaction provides atomic operations using libSQL
 *
 * Path-based storage where:
 * - keys are strings (file paths like '/src/main.ts')
 * - values are Uint8Array (file content)
 *
 * We store these in the 'files' table using path as the primary key.
 */
export class LibSQLTransaction extends AsyncTransactionBase {
  private cache: Map<string, Uint8Array | undefined> = new Map();
  private pendingWrites: Map<string, Uint8Array> = new Map();
  private pendingDeletes: Set<string> = new Set();
  private committed = false;

  constructor(
    public readonly store: LibSQLStore,
    private readonly client: Client,
    private readonly organizationId: string,
    private readonly agentId: string | null,
    private readonly onCommit?: (events: FSChangeEvent[]) => void
  ) {
    super();
  }

  /**
   * Get all keys (file paths) in the store
   */
  public async keys(): Promise<Iterable<string>> {
    await this.asyncDone;

    const result = await this.client.execute({
      sql: `SELECT path FROM files
            WHERE organization_id = ? AND (agent_id = ? OR (agent_id IS NULL AND ? IS NULL))`,
      args: [this.organizationId, this.agentId, this.agentId],
    });

    return result.rows.map((row) => row.path as string);
  }

  /**
   * Get data for a file path
   *
   * @param path - The file path to look up (e.g., '/src/main.ts')
   * @param offset - Start offset in the data
   * @param end - End offset (exclusive), or undefined for rest of data
   */
  public async get(path: string, offset: number, end?: number): Promise<Uint8Array | undefined> {
    await this.asyncDone;

    // Check pending deletes
    if (this.pendingDeletes.has(path)) {
      return undefined;
    }

    // Check pending writes
    if (this.pendingWrites.has(path)) {
      const data = this.pendingWrites.get(path)!;
      return this.sliceData(data, offset, end);
    }

    // Check cache
    if (this.cache.has(path)) {
      const cached = this.cache.get(path);
      return cached ? this.sliceData(cached, offset, end) : undefined;
    }

    // Query database
    const result = await this.client.execute({
      sql: `SELECT content FROM files
            WHERE path = ? AND organization_id = ?
            AND (agent_id = ? OR (agent_id IS NULL AND ? IS NULL))`,
      args: [path, this.organizationId, this.agentId, this.agentId],
    });

    if (result.rows.length === 0) {
      this.cache.set(path, undefined);
      return undefined;
    }

    const rawData = result.rows[0].content;
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

    this.cache.set(path, data);
    return data ? this.sliceData(data, offset, end) : undefined;
  }

  /**
   * Synchronous get - uses cache only
   * Throws EAGAIN if data not in cache
   */
  public getSync(path: string, offset: number, end?: number): Uint8Array | undefined {
    // Check pending deletes
    if (this.pendingDeletes.has(path)) {
      return undefined;
    }

    // Check pending writes first
    if (this.pendingWrites.has(path)) {
      const data = this.pendingWrites.get(path)!;
      return this.sliceData(data, offset, end);
    }

    // Check cache
    if (this.cache.has(path)) {
      const cached = this.cache.get(path);
      return cached ? this.sliceData(cached, offset, end) : undefined;
    }

    // Not in cache - trigger async load and throw EAGAIN
    this.async(this.get(path, offset, end));
    const error = new Error('EAGAIN: Resource temporarily unavailable');
    (error as any).code = 'EAGAIN';
    throw error;
  }

  /**
   * Set data for a file path
   *
   * @param path - The file path (e.g., '/src/main.ts')
   * @param data - The data to store
   * @param offset - Offset at which to write (0 for full replacement)
   */
  public async set(path: string, data: Uint8Array, offset: number): Promise<void> {
    await this.asyncDone;

    // Remove from deletes if present
    this.pendingDeletes.delete(path);

    // Handle partial writes
    let finalData: Uint8Array;
    if (offset === 0) {
      finalData = data;
    } else {
      // Need to merge with existing data
      const existing = await this.get(path, 0) ?? new Uint8Array(0);
      const newSize = Math.max(existing.length, offset + data.length);
      finalData = new Uint8Array(newSize);
      finalData.set(existing);
      finalData.set(data, offset);
    }

    this.pendingWrites.set(path, finalData);
    this.cache.set(path, finalData);
  }

  /**
   * Synchronous set - queues for async write
   */
  public setSync(path: string, data: Uint8Array, offset: number): void {
    this.async(this.set(path, data, offset));
  }

  /**
   * Remove a file path from the store
   */
  public async remove(path: string): Promise<void> {
    await this.asyncDone;
    this.pendingWrites.delete(path);
    this.pendingDeletes.add(path);
    this.cache.set(path, undefined);
  }

  /**
   * Synchronous remove - queues for async delete
   */
  public removeSync(path: string): void {
    this.async(this.remove(path));
  }

  /**
   * Commit all pending changes to the database
   */
  public async commit(): Promise<void> {
    if (this.committed) return;
    await this.asyncDone;

    const now = new Date().toISOString();
    const events: FSChangeEvent[] = [];
    const timestamp = Date.now();

    // Process all pending writes
    for (const [path, data] of this.pendingWrites) {
      await this.client.execute({
        sql: `INSERT INTO files (path, organization_id, agent_id, content, mode, uid, gid, size, atime, mtime, ctime, birthtime)
              VALUES (?, ?, ?, ?, 33188, 1000, 1000, ?, ?, ?, ?, ?)
              ON CONFLICT (path, organization_id, agent_id) DO UPDATE SET
                content = excluded.content,
                size = excluded.size,
                mtime = excluded.mtime,
                ctime = excluded.ctime`,
        args: [path, this.organizationId, this.agentId, data, data.length, now, now, now, now],
      });

      // Collect event for this write (path-based!)
      events.push({ eventType: 'change', path, timestamp });
    }

    // Process all pending deletes
    for (const path of this.pendingDeletes) {
      await this.client.execute({
        sql: `DELETE FROM files
              WHERE path = ? AND organization_id = ?
              AND (agent_id = ? OR (agent_id IS NULL AND ? IS NULL))`,
        args: [path, this.organizationId, this.agentId, this.agentId],
      });

      // Collect event for this delete ('rename' = deletion in Node.js convention)
      events.push({ eventType: 'rename', path, timestamp });
    }

    this.committed = true;
    this.pendingWrites.clear();
    this.pendingDeletes.clear();

    // Emit events AFTER all SQL succeeds
    if (events.length > 0 && this.onCommit) {
      this.onCommit(events);
    }
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
