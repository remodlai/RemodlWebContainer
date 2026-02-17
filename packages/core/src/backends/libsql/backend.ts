// SPDX-License-Identifier: MIT
/**
 * LibSQLBackend — ZenFS Backend backed by libSQL
 *
 * Extends FileSystem directly (NOT StoreFS) so ZenFS uses our path-based API.
 * StoreFS requires get(id: bigint) — incompatible with our path-based files table.
 *
 * Pattern:
 *   openFile  → SELECT content from DB → return PreloadFile (in-memory handle)
 *   createFile → INSERT empty row     → return PreloadFile (in-memory handle)
 *   sync      → UPDATE content in DB  ← called by PreloadFile on close/flush
 *
 * See: dev-notes/docs/remodl-webcontainer/ZENFS-BACKEND-INTEGRATION.md
 */

import { createClient, type Client } from '@libsql/client';
import type { LibSQLBackendOptions } from './types';
import { LibSQLStore } from './store';

// ZenFS internal imports — @zenfs/core maps "./*" → "./dist/*"
import { FileSystem, type FileSystemMetadata } from '@zenfs/core/filesystem.js';
import { Stats } from '@zenfs/core/stats.js';
import { PreloadFile } from '@zenfs/core/file.js';
import { ErrnoError } from '@zenfs/core/error.js';

/**
 * Backend interface compatible with ZenFS configure()
 */
export interface Backend<FS = unknown, TOptions = object> {
    name: string;
    options: Record<string, { type: string | readonly string[]; required: boolean }>;
    create(options: TOptions): FS | Promise<FS>;
    isAvailable?(config: TOptions): boolean | Promise<boolean>;
}

/**
 * LibSQLFS — ZenFS FileSystem backed by libSQL path-based storage.
 *
 * All file operations go against the `files` table.
 *
 * Sync API: backed by a Map<path, Stats> that is populated on every async
 * operation. When ZenFS calls statSync/existsSync, we return from the Map.
 * If the path isn't in the Map yet, we throw ENOENT (not ENOSYS) so ZenFS
 * treats it as "doesn't exist" rather than "broken filesystem".
 */
export class LibSQLFS extends FileSystem {
    private client: Client;
    private organizationId: string;
    private agentId: string | null;
    readonly label?: string;

    /** Live record of what we know is true right now. Key = path. */
    private _cache: Map<string, Stats> = new Map();

    constructor(client: Client, options: LibSQLBackendOptions) {
        super();
        this.client = client;
        this.organizationId = options.organizationId;
        this.agentId = options.agentId ?? null;
        this.label = options.label;
    }

    metadata(): FileSystemMetadata {
        return {
            name: 'libsqlfs',
            readonly: false,
            totalSpace: 0,
            freeSpace: 0,
            noResizableBuffers: false,
            noAsyncCache: false,
            type: 0x6c73716c,
        };
    }

    /**
     * Initialize schema and ensure root directory exists.
     * Called by LibSQLBackend.create() before returning the FS.
     */
    async initialize(): Promise<void> {
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
                PRIMARY KEY (path, organization_id, agent_id)
            )
        `);

        await this.client.execute(`
            CREATE INDEX IF NOT EXISTS idx_files_org_path
            ON files(organization_id, path)
        `);

        // Ensure root directory exists
        const root = await this.client.execute({
            sql: `SELECT 1 FROM files WHERE path = '/' AND organization_id = ?
                  AND (agent_id = ? OR (agent_id IS NULL AND ? IS NULL))`,
            args: [this.organizationId, this.agentId, this.agentId],
        });

        if (!root.rows.length) {
            const now = new Date().toISOString();
            await this.client.execute({
                sql: `INSERT INTO files (path, organization_id, agent_id, content, mode, uid, gid, size, atime, mtime, ctime, birthtime)
                      VALUES ('/', ?, ?, NULL, 16877, 1000, 1000, 0, ?, ?, ?, ?)`,
                args: [this.organizationId, this.agentId, now, now, now, now],
            });
        }
    }

    // -------------------------------------------------------------------------
    // stat
    // -------------------------------------------------------------------------

    async stat(path: string): Promise<Stats> {
        const result = await this.client.execute({
            sql: `SELECT mode, size, atime, mtime, ctime, birthtime, uid, gid
                  FROM files WHERE path = ? AND organization_id = ?
                  AND (agent_id = ? OR (agent_id IS NULL AND ? IS NULL))`,
            args: [path, this.organizationId, this.agentId, this.agentId],
        });

        if (!result.rows.length) {
            throw ErrnoError.With('ENOENT', path, 'stat');
        }

        const r = result.rows[0];
        const stats = new Stats({
            mode: r.mode as number,
            size: r.size as number,
            atimeMs: new Date(r.atime as string).getTime(),
            mtimeMs: new Date(r.mtime as string).getTime(),
            ctimeMs: new Date(r.ctime as string).getTime(),
            birthtimeMs: new Date(r.birthtime as string).getTime(),
            uid: r.uid as number,
            gid: r.gid as number,
            ino: 0,
        });

        this._cache.set(path, stats);
        return stats;
    }

    statSync(path: string): Stats {
        const cached = this._cache.get(path);
        if (cached) return cached;
        throw ErrnoError.With('ENOENT', path, 'statSync');
    }

    // -------------------------------------------------------------------------
    // openFile — load from DB, return PreloadFile
    // -------------------------------------------------------------------------

    async openFile(path: string, flag: string): Promise<PreloadFile<LibSQLFS>> {
        const stats = await this.stat(path);

        const result = await this.client.execute({
            sql: `SELECT content FROM files WHERE path = ? AND organization_id = ?
                  AND (agent_id = ? OR (agent_id IS NULL AND ? IS NULL))`,
            args: [path, this.organizationId, this.agentId, this.agentId],
        });

        const raw = result.rows[0]?.content;
        let buffer: Uint8Array;

        if (raw === null || raw === undefined) {
            buffer = new Uint8Array(0);
        } else if (raw instanceof Uint8Array) {
            buffer = raw;
        } else if (raw instanceof ArrayBuffer) {
            buffer = new Uint8Array(raw);
        } else if (ArrayBuffer.isView(raw)) {
            buffer = new Uint8Array((raw as ArrayBufferView).buffer, (raw as ArrayBufferView).byteOffset, (raw as ArrayBufferView).byteLength);
        } else if (typeof raw === 'string') {
            const binary = atob(raw);
            buffer = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
        } else {
            buffer = new Uint8Array(0);
        }

        return new PreloadFile<LibSQLFS>(this, path, flag, stats, buffer);
    }

    openFileSync(_path: string, _flag: string): PreloadFile<LibSQLFS> {
        throw ErrnoError.With('ENOSYS', _path, 'openFileSync');
    }

    // -------------------------------------------------------------------------
    // createFile — insert empty row, return PreloadFile
    // -------------------------------------------------------------------------

    async createFile(path: string, flag: string, mode: number): Promise<PreloadFile<LibSQLFS>> {
        const now = new Date().toISOString();
        await this.client.execute({
            sql: `INSERT INTO files (path, organization_id, agent_id, content, mode, uid, gid, size, atime, mtime, ctime, birthtime)
                  VALUES (?, ?, ?, NULL, ?, 1000, 1000, 0, ?, ?, ?, ?)
                  ON CONFLICT (path, organization_id, agent_id) DO UPDATE SET
                    mode = excluded.mode, mtime = excluded.mtime, ctime = excluded.ctime`,
            args: [path, this.organizationId, this.agentId, mode, now, now, now, now],
        });

        const stats = await this.stat(path); // also populates cache
        return new PreloadFile<LibSQLFS>(this, path, flag, stats, new Uint8Array(0));
    }

    createFileSync(_path: string, _flag: string, _mode: number): PreloadFile<LibSQLFS> {
        throw ErrnoError.With('ENOSYS', _path, 'createFileSync');
    }

    // -------------------------------------------------------------------------
    // sync — flush PreloadFile buffer back to libSQL (called on file close)
    // -------------------------------------------------------------------------

    async sync(path: string, data: Uint8Array, stats: Readonly<Stats>): Promise<void> {
        const now = new Date().toISOString();
        const mtime = stats.mtimeMs ? new Date(stats.mtimeMs as number).toISOString() : now;
        const atime = stats.atimeMs ? new Date(stats.atimeMs as number).toISOString() : now;
        const btime = stats.birthtimeMs ? new Date(stats.birthtimeMs as number).toISOString() : now;

        await this.client.execute({
            sql: `INSERT INTO files (path, organization_id, agent_id, content, mode, uid, gid, size, atime, mtime, ctime, birthtime)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT (path, organization_id, agent_id) DO UPDATE SET
                    content = excluded.content,
                    size = excluded.size,
                    mode = excluded.mode,
                    uid = excluded.uid,
                    gid = excluded.gid,
                    atime = excluded.atime,
                    mtime = excluded.mtime,
                    ctime = excluded.ctime`,
            args: [
                path, this.organizationId, this.agentId,
                data,
                stats.mode as number,
                stats.uid as number,
                stats.gid as number,
                data.length,
                atime, mtime, now, btime,
            ],
        });
    }

    syncSync(_path: string, _data: Uint8Array, _stats: Readonly<Stats>): void {
        throw ErrnoError.With('ENOSYS', _path, 'syncSync');
    }

    // -------------------------------------------------------------------------
    // readdir — immediate children only
    // -------------------------------------------------------------------------

    async readdir(path: string): Promise<string[]> {
        const prefix = path === '/' ? '/' : path.endsWith('/') ? path : path + '/';

        let sql: string;
        let args: any[];

        if (prefix === '/') {
            // Root: children are paths like /foo (no second slash)
            sql = `SELECT path FROM files
                   WHERE organization_id = ?
                   AND (agent_id = ? OR (agent_id IS NULL AND ? IS NULL))
                   AND path != '/'
                   AND path LIKE '/%'
                   AND path NOT LIKE '/%/%'`;
            args = [this.organizationId, this.agentId, this.agentId];
        } else {
            sql = `SELECT path FROM files
                   WHERE organization_id = ?
                   AND (agent_id = ? OR (agent_id IS NULL AND ? IS NULL))
                   AND path LIKE ?
                   AND path NOT LIKE ?`;
            args = [
                this.organizationId, this.agentId, this.agentId,
                prefix + '%',
                prefix + '%/%',
            ];
        }

        const result = await this.client.execute({ sql, args });
        return result.rows.map(r => {
            const full = r.path as string;
            return full.slice(prefix.length);
        }).filter(name => name.length > 0);
    }

    readdirSync(_path: string): string[] {
        throw ErrnoError.With('ENOSYS', _path, 'readdirSync');
    }

    // -------------------------------------------------------------------------
    // mkdir
    // -------------------------------------------------------------------------

    async mkdir(path: string, mode: number): Promise<void> {
        const now = new Date().toISOString();
        await this.client.execute({
            sql: `INSERT OR IGNORE INTO files (path, organization_id, agent_id, content, mode, uid, gid, size, atime, mtime, ctime, birthtime)
                  VALUES (?, ?, ?, NULL, ?, 1000, 1000, 0, ?, ?, ?, ?)`,
            args: [path, this.organizationId, this.agentId, mode || 16877, now, now, now, now],
        });
    }

    mkdirSync(_path: string, _mode: number): void {
        throw ErrnoError.With('ENOSYS', _path, 'mkdirSync');
    }

    // -------------------------------------------------------------------------
    // unlink / rmdir
    // -------------------------------------------------------------------------

    async unlink(path: string): Promise<void> {
        await this.client.execute({
            sql: `DELETE FROM files WHERE path = ? AND organization_id = ?
                  AND (agent_id = ? OR (agent_id IS NULL AND ? IS NULL))`,
            args: [path, this.organizationId, this.agentId, this.agentId],
        });
    }

    unlinkSync(_path: string): void {
        throw ErrnoError.With('ENOSYS', _path, 'unlinkSync');
    }

    async rmdir(path: string): Promise<void> {
        await this.unlink(path);
    }

    rmdirSync(_path: string): void {
        throw ErrnoError.With('ENOSYS', _path, 'rmdirSync');
    }

    // -------------------------------------------------------------------------
    // rename
    // -------------------------------------------------------------------------

    async rename(oldPath: string, newPath: string): Promise<void> {
        await this.client.execute({
            sql: `UPDATE files SET path = ? WHERE path = ? AND organization_id = ?
                  AND (agent_id = ? OR (agent_id IS NULL AND ? IS NULL))`,
            args: [newPath, oldPath, this.organizationId, this.agentId, this.agentId],
        });
    }

    renameSync(_oldPath: string, _newPath: string): void {
        throw ErrnoError.With('ENOSYS', _oldPath, 'renameSync');
    }

    // -------------------------------------------------------------------------
    // link — not supported (no symlinks in libSQL FS)
    // -------------------------------------------------------------------------

    async link(_target: string, _link: string): Promise<void> {
        throw ErrnoError.With('ENOSYS', _target, 'link');
    }

    linkSync(_target: string, _link: string): void {
        throw ErrnoError.With('ENOSYS', _target, 'linkSync');
    }
}

// -------------------------------------------------------------------------
// LibSQLBackend — factory for ZenFS configure()
// -------------------------------------------------------------------------

export const LibSQLBackend: Backend<LibSQLFS, LibSQLBackendOptions> = {
    name: 'LibSQL',

    options: {
        url: { type: 'string', required: false },
        syncUrl: { type: 'string', required: false },
        authToken: { type: 'string', required: false },
        organizationId: { type: 'string', required: true },
        agentId: { type: ['string', 'undefined'], required: false },
        label: { type: 'string', required: false },
        maxSize: { type: 'number', required: false },
    },

    async create(options: LibSQLBackendOptions): Promise<LibSQLFS> {
        const url = options.url || options.syncUrl || ':memory:';
        const client = createClient({ url, authToken: options.authToken });
        const fs = new LibSQLFS(client, options);
        await fs.initialize();
        return fs;
    },

    async isAvailable(): Promise<boolean> {
        try {
            const { createClient: _c } = await import('@libsql/client');
            return typeof _c === 'function';
        } catch {
            return false;
        }
    },
};

// -------------------------------------------------------------------------
// Helpers (kept for use by container.ts textSearch and other direct queries)
// -------------------------------------------------------------------------

export async function createLibSQLStore(options: LibSQLBackendOptions): Promise<LibSQLStore> {
    const url = options.url || options.syncUrl || ':memory:';
    const client = createClient({ url, authToken: options.authToken });
    const store = new LibSQLStore(client, options);
    await store.initialize();
    await store.ensureRoot();
    return store;
}

export async function forkTemplate(
    serverUrl: string,
    templateNamespace: string,
    targetNamespace: string,
    authToken?: string
): Promise<boolean> {
    const url = `${serverUrl}/v1/namespaces/${templateNamespace}/fork/${targetNamespace}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    try {
        const response = await fetch(url, { method: 'POST', headers });
        return response.ok;
    } catch {
        return false;
    }
}

export async function namespaceExists(
    serverUrl: string,
    namespace: string,
    authToken?: string
): Promise<boolean> {
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    try {
        const response = await fetch(`${serverUrl}/v1/namespaces`, { headers });
        if (!response.ok) return false;
        const data = await response.json();
        return (data.namespaces || []).includes(namespace);
    } catch {
        return false;
    }
}

export async function createNamespace(
    serverUrl: string,
    namespace: string,
    authToken?: string
): Promise<boolean> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    try {
        const response = await fetch(`${serverUrl}/v1/namespaces/${namespace}/create`, {
            method: 'POST', headers,
        });
        return response.ok;
    } catch {
        return false;
    }
}

export { LibSQLBackend as LibSQL };
export default LibSQLBackend;
