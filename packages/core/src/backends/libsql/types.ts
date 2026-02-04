// SPDX-License-Identifier: MIT
/**
 * TypeScript interfaces for libSQL-backed ZenFS filesystem
 *
 * These types map to the 4 database tables:
 * - fs_inodes: File/directory content and metadata
 * - fs_dirents: Directory entries (name → inode mapping)
 * - fs_metadata: FileSystem-level metadata
 * - agent_memory: Vector search table for agent workspace
 */

/**
 * Row structure for fs_inodes table
 * Stores file content (data) and POSIX metadata
 */
export interface InodeRow {
  inode_id: number;
  organization_id: string;
  agent_id: string | null;
  data: Uint8Array | null;       // File content or directory listing JSON
  mode: number;                   // Permissions + type (16877=dir, 33188=file)
  uid: number;
  gid: number;
  size: number;
  nlink: number;                  // Hard link count
  atime: string;                  // ISO8601 timestamp
  mtime: string;
  ctime: string;
  birthtime: string;
  flags: number;                  // InodeFlags bitmask
}

/**
 * Row structure for fs_dirents table
 * Maps directory entry names to inode IDs
 */
export interface DirentRow {
  parent_inode: number;
  name: string;
  inode_id: number;
  organization_id: string;
  agent_id: string | null;
}

/**
 * Row structure for fs_metadata table
 * Stores FileSystemMetadata as JSON
 */
export interface MetadataRow {
  organization_id: string;
  agent_id: string | null;
  metadata: string;               // JSON string: FileSystemMetadata
}

/**
 * Row structure for agent_memory table
 * Vector search table for agent workspace semantic memory
 */
export interface AgentMemoryRow {
  id: string;
  content: string;
  embedding: Float32Array | null; // Jina v4: 1024 dimensions
  source_path: string | null;
  content_hash: string | null;
  category: string | null;
  created_at: string;
  metadata: string | null;        // JSON string
}

/**
 * POSIX mode constants for file type detection
 */
export const S_IFMT = 0o170000;   // File type mask
export const S_IFDIR = 0o040000; // Directory
export const S_IFREG = 0o100000; // Regular file
export const S_IFLNK = 0o120000; // Symbolic link

/**
 * Default mode values for convenience
 */
export const DEFAULT_DIR_MODE = S_IFDIR | 0o755;   // 16877
export const DEFAULT_FILE_MODE = S_IFREG | 0o644;  // 33188

/**
 * Root inode ID (always 0 in ZenFS)
 */
export const ROOT_INO = 0;

/**
 * Configuration options for LibSQLBackend
 */
export interface LibSQLBackendOptions {
  /**
   * URL for the local embedded replica file
   * Example: "file:/project.db" or "file:/agent-workspace.db"
   */
  url?: string;

  /**
   * URL for the remote libsql-server to sync with
   * Example: "http://libsql-server:8080/v1/namespaces/org-123/project"
   */
  syncUrl?: string;

  /**
   * Authentication token for remote sync
   */
  authToken?: string;

  /**
   * Organization ID for multi-tenant isolation
   */
  organizationId: string;

  /**
   * Agent ID (null for project filesystem, string for agent workspace)
   */
  agentId?: string | null;

  /**
   * Sync interval in milliseconds (default: 60000 = 1 minute)
   */
  syncInterval?: number;

  /**
   * Label for this store instance
   */
  label?: string;

  /**
   * Maximum storage size in bytes (for usage reporting)
   */
  maxSize?: number;
}

/**
 * FileSystemMetadata stored in fs_metadata table
 * Defines access scope, template info, and organization context
 */
export interface FileSystemMetadata {
  id: string;
  contextType: 'project' | 'agent-workspace';
  organization_id: string;
  creator_user_id: string;
  current_user_id: string;
  agentId?: string;

  access_scope: {
    is_shared: boolean;
    cross_agent_indexed: boolean;
    primary_agent?: string;
    allow_handoff: boolean;
    activate_agent_subconscious: boolean;
  };

  is_template: boolean;
  scope?: {
    category?: string;
    version?: string;
    tools?: string[];
    prompts?: string[];
    tags?: string[];
  };
}

/**
 * Helper to check if mode indicates a directory
 */
export function isDirectory(mode: number): boolean {
  return (mode & S_IFMT) === S_IFDIR;
}

/**
 * Helper to check if mode indicates a regular file
 */
export function isFile(mode: number): boolean {
  return (mode & S_IFMT) === S_IFREG;
}

/**
 * Helper to check if mode indicates a symbolic link
 */
export function isSymlink(mode: number): boolean {
  return (mode & S_IFMT) === S_IFLNK;
}

/**
 * Get current ISO8601 timestamp
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Create a default inode with sensible defaults
 */
export function createDefaultInode(
  inodeId: number,
  organizationId: string,
  agentId: string | null,
  mode: number = DEFAULT_FILE_MODE,
  data: Uint8Array | null = null
): InodeRow {
  const now = nowISO();
  return {
    inode_id: inodeId,
    organization_id: organizationId,
    agent_id: agentId,
    data,
    mode,
    uid: 1000,
    gid: 1000,
    size: data?.byteLength ?? 0,
    nlink: 1,
    atime: now,
    mtime: now,
    ctime: now,
    birthtime: now,
    flags: 0,
  };
}
