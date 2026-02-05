-- libSQL Schema for ZenFS Filesystem Backend
--
-- This schema supports both Project FS and Agent Workspace FS
-- using path-based storage (simpler than inode-based)
--
-- Tables:
--   files        - File/directory content and metadata (path as key)
--   fs_metadata  - FileSystem-level metadata (access_scope, templates)
--   agent_memory - Vector search table (Agent Workspace only)
--
-- Why path-based instead of inode-based?
--   - libSQL already provides inode-level efficiency (no BLOB copy on UPDATE)
--   - watch() needs paths, not inode IDs
--   - Simpler schema, simpler code
--   - Hard links can be supported via canonical_path column if needed

-- ============================================================
-- TABLE: files
-- Stores file/directory content and POSIX metadata
-- Path is the primary key for direct lookups
-- ============================================================
CREATE TABLE IF NOT EXISTS files (
  path TEXT NOT NULL,                     -- Full path: '/src/main.ts'
  organization_id TEXT NOT NULL,
  agent_id TEXT,                          -- NULL for project FS
  content BLOB,                           -- File content (NULL for directories)
  mode INTEGER NOT NULL DEFAULT 33188,    -- Permissions + type (16877=dir, 33188=file)
  uid INTEGER NOT NULL DEFAULT 1000,
  gid INTEGER NOT NULL DEFAULT 1000,
  size INTEGER NOT NULL DEFAULT 0,
  atime TEXT NOT NULL,                    -- ISO8601 timestamp
  mtime TEXT NOT NULL,
  ctime TEXT NOT NULL,
  birthtime TEXT NOT NULL,
  canonical_path TEXT,                    -- For hard links: points to canonical path, or NULL
  PRIMARY KEY (path, organization_id, agent_id)
);

-- Index for fast org/agent lookups (list all files for an org/agent)
CREATE INDEX IF NOT EXISTS idx_files_org_agent
ON files(organization_id, agent_id);

-- Index for directory listing (find all files in a directory)
-- Uses path prefix matching: WHERE path LIKE '/src/%' AND path NOT LIKE '/src/%/%'
CREATE INDEX IF NOT EXISTS idx_files_path_prefix
ON files(path, organization_id, agent_id);

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
-- TABLE: files_fts (FTS5 Virtual Table)
-- Full-text search for file content (user search UI)
-- Supports FTS5 MATCH queries with ranking
-- ============================================================
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
  path,
  content,
  content=files,
  content_rowid=rowid
);

-- Triggers to keep FTS in sync with files table
CREATE TRIGGER IF NOT EXISTS files_fts_insert AFTER INSERT ON files BEGIN
  INSERT INTO files_fts(rowid, path, content)
  VALUES (new.rowid, new.path, new.content);
END;

CREATE TRIGGER IF NOT EXISTS files_fts_delete AFTER DELETE ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, path, content)
  VALUES ('delete', old.rowid, old.path, old.content);
END;

CREATE TRIGGER IF NOT EXISTS files_fts_update AFTER UPDATE ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, path, content)
  VALUES ('delete', old.rowid, old.path, old.content);
  INSERT INTO files_fts(rowid, path, content)
  VALUES (new.rowid, new.path, new.content);
END;

-- ============================================================
-- INITIAL DATA: Root directory
-- Must be inserted when creating a new filesystem
-- ============================================================
-- INSERT INTO files (path, organization_id, agent_id, content, mode, uid, gid, size, atime, mtime, ctime, birthtime)
-- VALUES ('/', :org_id, :agent_id, NULL, 16877, 1000, 1000, 0, datetime('now'), datetime('now'), datetime('now'), datetime('now'));
