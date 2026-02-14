# API Surface Audit: RemodlWebContainer vs StackBlitz @webcontainer/api

**Date:** 2026-02-14
**StackBlitz version:** 1.6.1
**Source files compared:**
- Ours: `packages/api/src/webcontainer.ts`
- Theirs: `resources/stackblitz-webcontainer-api/package/dist/index.js` + `index.d.ts` + `entities.d.ts`

---

## Architecture Pattern

| Aspect | StackBlitz | Ours | Status |
|--------|-----------|------|--------|
| Boot creates hidden iframe | Yes (`serverFactory`) | No (direct `ContainerManager`) | GAP - Task #67 |
| Comlink for cross-iframe RPC | Yes (vendored) | No | GAP - Task #67 |
| Singleton enforcement | Yes (`_instance` static, throws if booted twice) | No | GAP |
| Teardown awaits before re-boot | Yes (`_teardownPromise`) | No | GAP |
| `serverFactory` caches iframe/server | Yes (`cachedServerPromise`) | N/A | GAP - Task #67 |
| `server.build()` returns instance | Yes | N/A | GAP - Task #67 |
| `instance.fs()` returns FS proxy | Yes (separate Comlink proxy) | No (inline object) | GAP - Task #67 |
| `instance.runtimeInfo()` returns path/cwd | Yes | No | GAP |
| Auth token forwarding to runtime | Yes (`setCredentials`) | No | GAP |

---

## WebContainer Class Methods

### boot(options)

| Feature | StackBlitz | Ours | Status |
|---------|-----------|------|--------|
| `coep` option: `'require-corp' \| 'credentialless' \| 'none'` | Yes | Partial (`'none'` missing) | MINOR GAP |
| `workdirName` validation (no `/`, `..`, `.`) | Yes | No | GAP |
| `forwardPreviewErrors` (bool or `'exceptions-only'`) | Yes | Bool only | MINOR GAP |
| Singleton guard (throws if already booted) | Yes | No | GAP |
| Awaits previous teardown | Yes | No | GAP |
| `experimentalNode` option | Yes (undocumented) | No | LOW PRIORITY |

### spawn(command, args?, options?)

| Feature | StackBlitz | Ours | Status |
|---------|-----------|------|--------|
| Overload: `spawn(cmd, opts)` without args | Yes | No (args required or `[]`) | MINOR GAP |
| `options.output` (disable output stream) | Yes | No | GAP |
| `options.env` values: `string \| number \| boolean` | Yes | `string` only | MINOR GAP |
| Separate `stdout`/`stderr` streams | Yes (in impl, undocumented) | No | GAP |
| Binary-to-string decoding via `binaryListener` | Yes | Manual in process | OK |
| Comlink.proxy for output callbacks | Yes | N/A | N/A until Task #67 |

### mount(snapshotOrTree, options?)

| Feature | StackBlitz | Ours | Status |
|---------|-----------|------|--------|
| Accept `FileSystemTree` object | Yes (converts via `toInternalFileSystemTree`) | No (`throw`) | GAP |
| Accept `Uint8Array` binary snapshot | Yes | No (`throw`) | GAP |
| Accept `ArrayBuffer` | Yes | No (`throw`) | GAP |
| `options.mountPoint` | Yes | No | GAP |
| `Comlink.transfer` for binary payload | Yes | N/A | N/A until Task #67 |

### export(path, options?)

| Feature | StackBlitz | Ours | Status |
|---------|-----------|------|--------|
| `format: 'json'` returns `FileSystemTree` | Yes | No (`throw`) | GAP |
| `format: 'binary'` returns `Uint8Array` | Yes | No (`throw`) | GAP |
| `format: 'zip'` | Yes | No | GAP |
| `includes`/`excludes` glob patterns | Yes | No | GAP |
| Calls `_instance.serialize()` | Yes | N/A | GAP |

### on(event, listener)

| Event | StackBlitz | Ours | Status |
|-------|-----------|------|--------|
| `'port'` (port, type, url) | Yes | No | GAP |
| `'server-ready'` (port, url) | Yes | No | GAP |
| `'preview-message'` (PreviewMessage) | Yes | No | GAP |
| `'error'` ({message}) | Yes | No | GAP |
| `'xdg-open'` (text) | Yes | No | GAP |
| `'code'` (type, event) | Yes | No | GAP |
| Returns `Unsubscribe` function | Yes | No (uses EventEmitter) | GAP |
| Wraps listener with `Comlink.proxy` | Yes | N/A | N/A until Task #67 |

### setPreviewScript(scriptSrc, options?)

| Feature | StackBlitz | Ours | Status |
|---------|-----------|------|--------|
| `scriptSrc` string | Yes | Partial (stores locally, no forwarding) | GAP |
| `options.type`: `'module' \| 'importmap'` | Yes | No | GAP |
| `options.defer` / `options.async` | Yes | No | GAP |
| Delegates to `_instance.setPreviewScript` | Yes | No | GAP |

### Properties

| Property | StackBlitz | Ours | Status |
|----------|-----------|------|--------|
| `path` (PATH env var) | Yes (from `runtimeInfo`) | No | GAP |
| `workdir` | Yes (from `runtimeInfo.cwd`) | Yes (from `_workdirName`) | OK |
| `fs` (FileSystemAPI) | Yes (FileSystemAPIClient instance) | Yes (inline object) | OK (different impl) |

### teardown()

| Feature | StackBlitz | Ours | Status |
|---------|-----------|------|--------|
| Throws if already torn down | Yes | Returns silently | MINOR GAP |
| `fs._teardown()` | Yes | No | GAP |
| `Comlink.releaseProxy` | Yes | N/A | N/A until Task #67 |
| Clears singleton `_instance` | Yes | No | GAP |
| Synchronous (void return) | Yes | Async (returns Promise) | MISMATCH |

---

## FileSystemAPI

| Method | StackBlitz | Ours | Status |
|--------|-----------|------|--------|
| `readFile(path)` returns `Uint8Array` | Yes (native) | Yes (encodes string) | WORKS but inefficient |
| `readFile(path, encoding)` returns string | Yes | Yes | OK |
| `writeFile(path, data, options?)` | Yes, Comlink.transfer for Uint8Array | Yes | OK |
| `readdir(path)` returns `string[]` | Yes | Yes | OK |
| `readdir(path, {withFileTypes: true})` returns `DirEnt[]` | Yes (proper file/dir detection) | Partial (hardcoded `isDirectory: true`) | GAP |
| `readdir(path, 'buffer')` returns `Uint8Array[]` | Yes | No | GAP |
| `mkdir(path)` | Yes | Yes | OK |
| `mkdir(path, {recursive: true})` returns path | Yes | Yes | OK |
| `rm(path, options?)` | Yes | Yes | OK |
| `rename(oldPath, newPath)` | Yes | Yes (with fallback) | OK |
| `watch(path, options?, listener?)` | Yes (FSWatcher class with proper lifecycle) | Partial (simple object) | MINOR GAP |

### FSWatcher (watch return value)

| Feature | StackBlitz | Ours | Status |
|---------|-----------|------|--------|
| `close()` method | Yes (async, proper teardown) | Yes (sync) | MINOR GAP |
| Tracks all watchers in `_watchers` Set | Yes | No | GAP |
| `_teardown()` releases Comlink proxies | Yes | N/A | N/A until Task #67 |

---

## WebContainerProcess

| Feature | StackBlitz | Ours | Status |
|---------|-----------|------|--------|
| `output` ReadableStream<string> | Yes | Yes | OK |
| `input` WritableStream<string> | Yes | Yes | OK |
| `exit` Promise<number> | Yes | Yes | OK |
| `kill()` | Yes (sync, void) | Yes (async) | MINOR MISMATCH |
| `resize(dimensions)` | Yes | Yes | OK |
| `stdout` ReadableStream (separate) | Yes (undocumented) | No | LOW PRIORITY |
| `stderr` ReadableStream (separate) | Yes (undocumented) | No | LOW PRIORITY |
| Comlink.releaseProxy on exit | Yes | N/A | N/A until Task #67 |

---

## Exported Types & Utilities

| Export | StackBlitz | Ours | Status |
|--------|-----------|------|--------|
| `FileSystemTree` / `DirectoryNode` / `FileNode` / `SymlinkNode` | Yes | No | GAP |
| `configureAPIKey(key)` | Yes | No | GAP (may not need) |
| `auth` (AuthAPI) | Yes (full OAuth + PKCE) | Stub | OK for now |
| `PreviewMessageType` enum | Yes | No | GAP |
| `PreviewMessage` types | Yes | No | GAP |
| `ExportOptions` type | Yes | No | GAP |
| `CodeEventType` / `CodeEvent` | Yes | No | GAP |
| `Unsubscribe` type | Yes | No | GAP |
| `isPreviewMessage` util | Yes | No | GAP |
| `toExternalFileSystemTree` / `toInternalFileSystemTree` | Yes | No | GAP (needed for mount/export) |

---

## Summary

### Critical Gaps (must fix for Task #67 thin client refactor)

1. **Architecture**: No iframe + Comlink pattern (entire boot flow different)
2. **Singleton enforcement**: No guard against multiple boots
3. **mount()**: Not implemented (throws) - needs `FileSystemTree` + snapshot support
4. **export()**: Not implemented (throws)
5. **on() events**: No event subscription (`port`, `server-ready`, `error`, etc.)
6. **path property**: Missing (needs `runtimeInfo` from server)
7. **FileSystemTree types**: Missing (`DirectoryNode`, `FileNode`, `SymlinkNode`)
8. **toInternalFileSystemTree / toExternalFileSystemTree**: Missing conversion utils

### Minor Gaps (can address incrementally)

1. `readdir` with `withFileTypes` hardcodes `isDirectory: true`
2. `spawn` doesn't support `options.output = false`
3. `teardown` is async instead of sync
4. `kill()` is async instead of sync
5. No `workdirName` validation
6. No `PreviewMessage` types or `PreviewScriptOptions`

### Not Needed Yet

1. Full OAuth auth (stub is fine for now)
2. `configureAPIKey` (StackBlitz-specific)
3. `experimentalNode` boot option
4. Separate `stdout`/`stderr` streams (undocumented in StackBlitz)
