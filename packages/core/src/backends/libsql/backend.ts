// SPDX-License-Identifier: MIT
/**
 * LibSQLBackend — ZenFS v2.4.4 Backend backed by libSQL
 *
 * Uses Async(FileSystem) mixin pattern:
 * - LibSQLFS extends Async(FileSystem) — implements async methods only
 * - Async() generates all *Sync methods via _sync (InMemory cache)
 * - No manual _cache Map — Async() handles crossCopy on ready()
 *
 * Schema: PRIMARY KEY (path), organization_id and agent_id as audit columns only.
 */

import { createClient, type Client } from '@libsql/client';
import type { LibSQLBackendOptions } from './types';
import { LibSQLStore } from './store';
import { Async, FileSystem, InMemory, type InodeLike, type CreationOptions } from '@zenfs/core';

/** Create an errno-compatible error (ZenFS v2 uses kerium's Exception; this is a compatible shim) */
function errnoError(code: string, path?: string, syscall?: string): Error {
    const err = Object.assign(new Error(`${code}: ${syscall || 'unknown'} '${path || ''}'`), { code, path, syscall });
    return err;
}

const DEFAULT_FILE_MODE = 0o100644; // 33188
const DEFAULT_DIR_MODE = 0o040755;  // 16877

/**
 * LibSQLFS — ZenFS v2.4.4 FileSystem backed by libSQL path-based storage.
 *
 * Extends Async(FileSystem): only async methods implemented here.
 * Async() provides all *Sync methods via _sync (InMemory instance).
 * ready() triggers crossCopy which preloads libSQL data into _sync.
 */
export class LibSQLFS extends Async(FileSystem) {
    _sync = InMemory.create({});

    private client: Client;
    private organizationId: string;
    private agentId: string | null;
    readonly label?: string;

    constructor(client: Client, options: LibSQLBackendOptions) {
        super(0x4c53, 'libsqlfs');
        this.client = client;
        this.organizationId = options.organizationId;
        this.agentId = options.agentId ?? null;
        this.label = options.label;
    }

    /**
     * Initialize schema and seed root directory.
     * Called before ready(), which triggers Async() crossCopy.
     */
    private async initialize(): Promise<void> {
        await this.client.execute(`
            CREATE TABLE IF NOT EXISTS files (
                path        TEXT PRIMARY KEY,
                content     BLOB,
                mode        INTEGER NOT NULL DEFAULT ${DEFAULT_FILE_MODE},
                uid         INTEGER NOT NULL DEFAULT 1000,
                gid         INTEGER NOT NULL DEFAULT 1000,
                size        INTEGER NOT NULL DEFAULT 0,
                atime       TEXT NOT NULL,
                mtime       TEXT NOT NULL,
                ctime       TEXT NOT NULL,
                birthtime   TEXT NOT NULL,
                organization_id TEXT,
                agent_id        TEXT
            )
        `);

        await this.client.execute(
            `CREATE INDEX IF NOT EXISTS idx_files_path_prefix ON files(path)`
        );

        // Ensure root directory exists
        const root = await this.client.execute(`SELECT 1 FROM files WHERE path = '/'`);
        if (!root.rows.length) {
            const now = new Date().toISOString();
            await this.client.execute({
                sql: `INSERT INTO files (path, content, mode, uid, gid, size, atime, mtime, ctime, birthtime, organization_id, agent_id)
                      VALUES ('/', NULL, ?, 1000, 1000, 0, ?, ?, ?, ?, ?, ?)`,
                args: [DEFAULT_DIR_MODE, now, now, now, now, this.organizationId, this.agentId],
            });
        }
    }

    /**
     * Override ready() to run initialize(), then let Async() crossCopy.
     */
    async ready(): Promise<void> {
        await this.initialize();
        await super.ready();
    }

    // -- async methods that Async(FileSystem) requires --

    async rename(oldPath: string, newPath: string): Promise<void> {
        await this.client.execute({
            sql: `UPDATE files SET path = ? WHERE path = ?`,
            args: [newPath, oldPath],
        });
    }

    async stat(path: string): Promise<InodeLike> {
        const result = await this.client.execute({
            sql: `SELECT mode, size, atime, mtime, ctime, birthtime, uid, gid FROM files WHERE path = ?`,
            args: [path],
        });

        if (!result.rows.length) {
            throw errnoError('ENOENT', path, 'stat');
        }

        const r = result.rows[0];
        return {
            mode: r.mode as number,
            size: r.size as number,
            atimeMs: new Date(r.atime as string).getTime(),
            mtimeMs: new Date(r.mtime as string).getTime(),
            ctimeMs: new Date(r.ctime as string).getTime(),
            birthtimeMs: new Date(r.birthtime as string).getTime(),
            uid: r.uid as number,
            gid: r.gid as number,
            ino: 0,
            nlink: 1,
        };
    }

    async touch(path: string, metadata: Partial<InodeLike>): Promise<void> {
        const now = new Date().toISOString();
        const atime = metadata.atimeMs ? new Date(metadata.atimeMs).toISOString() : now;
        const mtime = metadata.mtimeMs ? new Date(metadata.mtimeMs).toISOString() : now;
        const ctime = metadata.ctimeMs ? new Date(metadata.ctimeMs).toISOString() : now;

        await this.client.execute({
            sql: `UPDATE files SET atime = ?, mtime = ?, ctime = ?, organization_id = ?, agent_id = ? WHERE path = ?`,
            args: [atime, mtime, ctime, this.organizationId, this.agentId, path],
        });
    }

    async createFile(path: string, options: CreationOptions): Promise<InodeLike> {
        const now = new Date().toISOString();
        const mode = options.mode ?? DEFAULT_FILE_MODE;
        const uid = options.uid ?? 1000;
        const gid = options.gid ?? 1000;

        await this.client.execute({
            sql: `INSERT INTO files (path, content, mode, uid, gid, size, atime, mtime, ctime, birthtime, organization_id, agent_id)
                  VALUES (?, NULL, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT (path) DO UPDATE SET mode = excluded.mode, mtime = excluded.mtime, ctime = excluded.ctime`,
            args: [path, mode, uid, gid, now, now, now, now, this.organizationId, this.agentId],
        });

        return {
            mode, size: 0, uid, gid,
            atimeMs: Date.now(), mtimeMs: Date.now(), ctimeMs: Date.now(), birthtimeMs: Date.now(),
            ino: 0, nlink: 1,
        };
    }

    async unlink(path: string): Promise<void> {
        await this.client.execute({ sql: `DELETE FROM files WHERE path = ?`, args: [path] });
    }

    async rmdir(path: string): Promise<void> {
        await this.client.execute({ sql: `DELETE FROM files WHERE path = ?`, args: [path] });
    }

    async mkdir(path: string, options: CreationOptions): Promise<InodeLike> {
        const now = new Date().toISOString();
        const mode = options.mode ?? DEFAULT_DIR_MODE;
        const uid = options.uid ?? 1000;
        const gid = options.gid ?? 1000;

        await this.client.execute({
            sql: `INSERT INTO files (path, content, mode, uid, gid, size, atime, mtime, ctime, birthtime, organization_id, agent_id)
                  VALUES (?, NULL, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT (path) DO NOTHING`,
            args: [path, mode, uid, gid, now, now, now, now, this.organizationId, this.agentId],
        });

        return {
            mode, size: 0, uid, gid,
            atimeMs: Date.now(), mtimeMs: Date.now(), ctimeMs: Date.now(), birthtimeMs: Date.now(),
            ino: 0, nlink: 1,
        };
    }

    async readdir(path: string): Promise<string[]> {
        const prefix = path === '/' ? '/' : path.endsWith('/') ? path : path + '/';

        let sql: string;
        let args: any[];

        if (prefix === '/') {
            sql = `SELECT path FROM files WHERE path != '/' AND path LIKE '/%' AND path NOT LIKE '/%/%'`;
            args = [];
        } else {
            sql = `SELECT path FROM files WHERE path LIKE ? AND path NOT LIKE ?`;
            args = [prefix + '%', prefix + '%/%'];
        }

        const result = await this.client.execute({ sql, args });
        return result.rows
            .map(r => (r.path as string).slice(prefix.length))
            .filter(name => name.length > 0);
    }

    async link(_target: string, _link: string): Promise<void> {
        throw errnoError('ENOSYS', _target, 'link');
    }

    async sync(): Promise<void> {
        // no-op — libSQL has no buffering
    }

    async read(path: string, buffer: Uint8Array, start: number, end: number): Promise<void> {
        const result = await this.client.execute({
            sql: `SELECT content FROM files WHERE path = ?`,
            args: [path],
        });

        const raw = result.rows[0]?.content;
        if (raw === null || raw === undefined) return;

        let content: Uint8Array;
        if (raw instanceof Uint8Array) {
            content = raw;
        } else if (raw instanceof ArrayBuffer) {
            content = new Uint8Array(raw);
        } else if (ArrayBuffer.isView(raw)) {
            content = new Uint8Array((raw as ArrayBufferView).buffer, (raw as ArrayBufferView).byteOffset, (raw as ArrayBufferView).byteLength);
        } else if (typeof raw === 'string') {
            const binary = atob(raw);
            content = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) content[i] = binary.charCodeAt(i);
        } else {
            return;
        }

        const slice = content.subarray(start, end);
        buffer.set(slice);
    }

    async write(path: string, buffer: Uint8Array, offset: number): Promise<void> {
        // Read existing content, merge at offset, write back
        const result = await this.client.execute({
            sql: `SELECT content FROM files WHERE path = ?`,
            args: [path],
        });

        let existing = new Uint8Array(0);
        const raw = result.rows[0]?.content;
        if (raw instanceof Uint8Array) {
            existing = raw;
        } else if (raw instanceof ArrayBuffer) {
            existing = new Uint8Array(raw);
        } else if (ArrayBuffer.isView(raw)) {
            existing = new Uint8Array((raw as ArrayBufferView).buffer, (raw as ArrayBufferView).byteOffset, (raw as ArrayBufferView).byteLength);
        }

        const newSize = Math.max(existing.length, offset + buffer.length);
        const merged = new Uint8Array(newSize);
        merged.set(existing);
        merged.set(buffer, offset);

        const now = new Date().toISOString();
        await this.client.execute({
            sql: `INSERT INTO files (path, content, mode, uid, gid, size, atime, mtime, ctime, birthtime, organization_id, agent_id)
                  VALUES (?, ?, ${DEFAULT_FILE_MODE}, 1000, 1000, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT (path) DO UPDATE SET
                    content = excluded.content, size = excluded.size,
                    mtime = excluded.mtime, ctime = excluded.ctime,
                    organization_id = excluded.organization_id, agent_id = excluded.agent_id`,
            args: [path, merged, merged.length, now, now, now, now, this.organizationId, this.agentId],
        });
    }
}

// -------------------------------------------------------------------------
// LibSQLBackend — factory for ZenFS configure()
// -------------------------------------------------------------------------

/**
 * Backend interface compatible with ZenFS configure()
 */
export interface Backend<FS = unknown, TOptions = object> {
    name: string;
    options: Record<string, { type: string | readonly string[]; required: boolean }>;
    create(options: TOptions): FS | Promise<FS>;
    isAvailable?(config: TOptions): boolean | Promise<boolean>;
}

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
        // ready() is called by configure() — it runs initialize() then crossCopy
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
// Helpers (kept for textSearch and direct queries in container.ts)
// -------------------------------------------------------------------------

export async function createLibSQLStore(options: LibSQLBackendOptions): Promise<LibSQLStore> {
    const url = options.url || options.syncUrl || ':memory:';
    const client = createClient({ url, authToken: options.authToken });
    const store = new LibSQLStore(client, options);
    await store.initialize();
    await store.ensureRoot();
    return store;
}

export async function forkTemplate(serverUrl: string, templateNamespace: string, targetNamespace: string, authToken?: string): Promise<boolean> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    try {
        const response = await fetch(`${serverUrl}/v1/namespaces/${templateNamespace}/fork/${targetNamespace}`, { method: 'POST', headers });
        return response.ok;
    } catch { return false; }
}

export async function namespaceExists(serverUrl: string, namespace: string, authToken?: string): Promise<boolean> {
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    try {
        const response = await fetch(`${serverUrl}/v1/namespaces`, { headers });
        if (!response.ok) return false;
        const data = await response.json();
        return (data.namespaces || []).includes(namespace);
    } catch { return false; }
}

export async function createNamespace(serverUrl: string, namespace: string, authToken?: string): Promise<boolean> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    try {
        const response = await fetch(`${serverUrl}/v1/namespaces/${namespace}/create`, { method: 'POST', headers });
        return response.ok;
    } catch { return false; }
}

export { LibSQLBackend as LibSQL };
export default LibSQLBackend;
