# libSQL Backend for ZenFS

A libSQL-backed storage backend for ZenFS, enabling persistent filesystem storage with embedded replicas and remote sync capabilities.

## Features

- **Embedded Replicas**: Local SQLite WASM with automatic sync to libsql-server
- **Dual Filesystem Support**: Works for both Project FS and Agent Workspace FS
- **Template Forking**: Instant workspace creation via database forking (<100ms)
- **Vector Search**: Built-in support for semantic memory (Agent Workspace)
- **Full-Text Search**: FTS5 support for keyword queries
- **POSIX Semantics**: Inode-based storage with proper permissions and timestamps

## Installation

The `@libsql/client` package is required as a peer dependency:

```bash
pnpm add @libsql/client
```

## Usage

### Basic Usage

```typescript
import { configure } from '@zenfs/core';
import { LibSQL } from '@remodl-web-container/core/backends/libsql';

await configure({
  mounts: {
    '/': {
      backend: LibSQL,
      organizationId: 'org-123',
      agentId: null,  // null for Project FS, string for Agent Workspace
      syncUrl: 'http://libsql-server:8080/v1/namespaces/project',
      authToken: 'your-auth-token',
    }
  }
});

// Now use fs normally
import { fs } from '@zenfs/core';
await fs.promises.writeFile('/hello.txt', 'Hello, World!');
const content = await fs.promises.readFile('/hello.txt', 'utf-8');
```

### Dual Filesystem (Project + Agent Workspace)

```typescript
import { configure } from '@zenfs/core';
import { LibSQL } from '@remodl-web-container/core/backends/libsql';

await configure({
  mounts: {
    // Project FS - user's codebase
    '/project': {
      backend: LibSQL,
      organizationId: 'org-123',
      agentId: null,
      url: 'file:/project.db',
      syncUrl: 'http://libsql-server:8080/v1/namespaces/org-123/project',
      authToken: projectToken,
    },

    // Agent Workspace FS - agent's internal work (hidden)
    '/.agent-workspace': {
      backend: LibSQL,
      organizationId: 'org-123',
      agentId: 'agent-456',
      url: 'file:/agent-workspace.db',
      syncUrl: 'http://libsql-server:8080/v1/namespaces/org-123/agent-456',
      authToken: agentToken,
    }
  }
});
```

### Template Forking

Create new workspaces instantly by forking template databases:

```typescript
import { forkTemplate, createLibSQLStore } from '@remodl-web-container/core/backends/libsql';

// Fork template to create new agent workspace
const success = await forkTemplate(
  'http://libsql-server:8080',
  'agent-workspace-base',        // Source template
  `agent-${agentId}`,            // Target namespace
  authToken
);

if (success) {
  // Create store pointing to forked namespace
  const store = await createLibSQLStore({
    organizationId: 'org-123',
    agentId: agentId,
    url: 'file:/agent-workspace.db',
    syncUrl: `http://libsql-server:8080/v1/namespaces/agent-${agentId}`,
    authToken,
  });
}
```

## Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `organizationId` | `string` | Yes | Organization ID for multi-tenant isolation |
| `agentId` | `string \| null` | No | Agent ID (null for Project FS) |
| `url` | `string` | No | Local database URL (e.g., `file:/project.db`) |
| `syncUrl` | `string` | No | Remote libsql-server URL for sync |
| `authToken` | `string` | No | Authentication token for remote sync |
| `syncInterval` | `number` | No | Sync interval in ms (default: 60000) |
| `label` | `string` | No | Label for this store instance |
| `maxSize` | `number` | No | Maximum storage size in bytes |

## Database Schema

The backend uses 4 tables:

### fs_inodes
Stores file/directory content and POSIX metadata (mode, uid, gid, timestamps, etc.)

### fs_dirents
Maps directory entry names to inode IDs (parent_inode, name → inode_id)

### fs_metadata
Stores filesystem-level metadata as JSON (access_scope, template info)

### agent_memory
Vector search table for agent semantic memory (1024-dim embeddings, FTS5)

## Architecture

```
ZenFS API (fs.readFile, fs.writeFile, etc.)
  ↓
StoreFS (ZenFS core filesystem using Store interface)
  ↓
LibSQLStore (key-value interface: id → Uint8Array)
  ↓
LibSQLTransaction (atomic operations with commit/abort)
  ↓
@libsql/client (embedded replica)
  ├─ Local: SQLite WASM (fast reads)
  └─ Remote: libsql-server HTTP (durable writes)
```

## Read/Write Flow

**Reads (Fast, Local):**
1. ZenFS calls `tx.get(inodeId, offset, end)`
2. LibSQLTransaction queries local SQLite WASM
3. Returns Uint8Array immediately

**Writes (Durable, Synced):**
1. ZenFS calls `tx.set(inodeId, data, offset)`
2. LibSQLTransaction caches write
3. On `tx.commit()`, writes to local SQLite
4. libSQL client automatically syncs to server

## Template Structure

Agent workspace templates include pre-configured directories:

```
/.agent-workspace/
├── bin/          # CLI tools
├── analysis/     # Code analysis
├── planning/     # Implementation plans
├── cache/        # Cached data
├── experiments/  # Experimental code
├── memory/       # Semantic memory
├── drafts/       # Draft implementations
└── logs/         # Activity logs
```

## API Reference

### LibSQLBackend

Factory for creating libSQL-backed filesystems:

```typescript
import { LibSQL } from '@remodl-web-container/core/backends/libsql';

// Use with ZenFS configure
await configure({
  mounts: { '/': { backend: LibSQL, ...options } }
});
```

### createLibSQLStore

Create a store directly (without StoreFS wrapper):

```typescript
import { createLibSQLStore } from '@remodl-web-container/core/backends/libsql';

const store = await createLibSQLStore(options);
const tx = store.transaction();
// ... use transaction
```

### forkTemplate

Fork a template namespace:

```typescript
import { forkTemplate } from '@remodl-web-container/core/backends/libsql';

await forkTemplate(serverUrl, templateNamespace, targetNamespace, authToken);
```

### namespaceExists / createNamespace

Manage namespaces on libsql-server:

```typescript
import { namespaceExists, createNamespace } from '@remodl-web-container/core/backends/libsql';

if (!await namespaceExists(serverUrl, namespace, token)) {
  await createNamespace(serverUrl, namespace, token);
}
```

## Testing

```bash
cd RemodlWebContainer/packages/core
pnpm test src/backends/libsql/
```

## License

MIT
