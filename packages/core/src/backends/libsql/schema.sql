-- libSQL Schema for ZenFS Filesystem Backend
--
-- This schema supports both Project FS and Agent Workspace FS
-- using inode-based storage with directory entries
--
-- Tables:
--   fs_inodes  - Inode data (file content + metadata)
--   fs_dirents - Directory entries (name → inode mapping)
--   fs_metadata - FileSystem-level metadata (access_scope, templates)
--   agent_memory - Vector search table (Agent Workspace only)

-- ============================================================
-- TABLE: fs_inodes
-- Stores file/directory content and POSIX metadata
-- ============================================================
CREATE TABLE IF NOT EXISTS fs_inodes (
  inode_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  agent_id TEXT,                          -- NULL for project FS
  data BLOB,                              -- File content or directory listing JSON
  mode INTEGER NOT NULL DEFAULT 33188,    -- Permissions + type (16877=dir, 33188=file)
  uid INTEGER NOT NULL DEFAULT 1000,
  gid INTEGER NOT NULL DEFAULT 1000,
  size INTEGER NOT NULL DEFAULT 0,
  nlink INTEGER NOT NULL DEFAULT 1,       -- Hard link count
  atime TEXT NOT NULL,                    -- ISO8601 timestamp
  mtime TEXT NOT NULL,
  ctime TEXT NOT NULL,
  birthtime TEXT NOT NULL,
  flags INTEGER NOT NULL DEFAULT 0,       -- InodeFlags bitmask
  PRIMARY KEY (inode_id, organization_id, agent_id)
);

-- Index for fast org/agent lookups
CREATE INDEX IF NOT EXISTS idx_fs_inodes_org_agent
ON fs_inodes(organization_id, agent_id);

-- ============================================================
-- TABLE: fs_dirents
-- Maps directory entry names to inode IDs
-- ============================================================
CREATE TABLE IF NOT EXISTS fs_dirents (
  parent_inode INTEGER NOT NULL,
  name TEXT NOT NULL,
  inode_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  agent_id TEXT,                          -- NULL for project FS
  PRIMARY KEY (parent_inode, name, organization_id, agent_id),
  FOREIGN KEY (inode_id, organization_id, agent_id)
    REFERENCES fs_inodes(inode_id, organization_id, agent_id)
    ON DELETE CASCADE
);

-- Index for child lookups
CREATE INDEX IF NOT EXISTS idx_fs_dirents_inode
ON fs_dirents(inode_id, organization_id, agent_id);

-- ============================================================
-- TABLE: fs_metadata
-- FileSystem-level metadata (access_scope, templates, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS fs_metadata (
  organization_id TEXT NOT NULL,
  agent_id TEXT,                          -- NULL for project FS
  metadata TEXT NOT NULL,                 -- JSON string: FileSystemMetadata
  PRIMARY KEY (organization_id, agent_id)
);

-- ============================================================
-- TABLE: agent_memory
-- Vector search table for agent workspace semantic memory
-- Only used in Agent Workspace FS (not Project FS)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_memory (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  content TEXT NOT NULL,
  embedding F32_BLOB(1024),               -- Jina v4: 1024 dimensions
  source_path TEXT,
  content_hash TEXT UNIQUE,               -- Prevent duplicates
  category TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT                           -- JSON string for extra data
);

-- Vector index for semantic search (DiskANN)
-- Note: Only works with libsql-server, not plain SQLite
CREATE INDEX IF NOT EXISTS agent_memory_vector_idx ON agent_memory(
  libsql_vector_idx(embedding, 'metric=cosine', 'compress_neighbors=float16')
);

-- Full-text search index for keyword queries
CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts USING fts5(
  content,
  category,
  content=agent_memory,
  content_rowid=rowid
);

-- Trigger to keep FTS in sync with agent_memory
CREATE TRIGGER IF NOT EXISTS agent_memory_fts_insert AFTER INSERT ON agent_memory BEGIN
  INSERT INTO agent_memory_fts(rowid, content, category)
  VALUES (new.rowid, new.content, new.category);
END;

CREATE TRIGGER IF NOT EXISTS agent_memory_fts_delete AFTER DELETE ON agent_memory BEGIN
  INSERT INTO agent_memory_fts(agent_memory_fts, rowid, content, category)
  VALUES ('delete', old.rowid, old.content, old.category);
END;

CREATE TRIGGER IF NOT EXISTS agent_memory_fts_update AFTER UPDATE ON agent_memory BEGIN
  INSERT INTO agent_memory_fts(agent_memory_fts, rowid, content, category)
  VALUES ('delete', old.rowid, old.content, old.category);
  INSERT INTO agent_memory_fts(rowid, content, category)
  VALUES (new.rowid, new.content, new.category);
END;

-- ============================================================
-- INITIAL DATA: Root directory (inode 0)
-- Must be inserted when creating a new filesystem
-- ============================================================
-- INSERT INTO fs_inodes (inode_id, organization_id, agent_id, data, mode, uid, gid, size, nlink, atime, mtime, ctime, birthtime, flags)
-- VALUES (0, :org_id, :agent_id, '{}', 16877, 1000, 1000, 0, 2, datetime('now'), datetime('now'), datetime('now'), datetime('now'), 0);
--
-- INSERT INTO fs_inodes (inode_id, organization_id, agent_id, data, mode, uid, gid, size, nlink, atime, mtime, ctime, birthtime, flags)
-- VALUES (1, :org_id, :agent_id, '{}', 16877, 1000, 1000, 0, 2, datetime('now'), datetime('now'), datetime('now'), datetime('now'), 0);
