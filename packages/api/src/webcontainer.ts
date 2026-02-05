/**
 * WebContainer - StackBlitz-compatible API
 *
 * RemodlWebContainer provides a drop-in replacement for @webcontainer/api.
 * This is the primary public API for the package.
 *
 * @example
 * ```typescript
 * import { WebContainer } from '@remodl-web-container/api';
 *
 * const container = await WebContainer.boot();
 * await container.fs.writeFile('/src/index.ts', 'console.log("hello")');
 * const process = await container.spawn('node', ['src/index.ts']);
 * ```
 */

import { ContainerManager } from './container/container';
import { VirtualProcess } from './process/process';
import { EventEmitter } from 'eventemitter3';
import type { FilesystemConfig } from './worker/types';

export interface WebContainerBootOptions {
  coep?: 'credentialless' | 'require-corp';
  workdirName?: string;
  forwardPreviewErrors?: boolean;
  /** libSQL filesystem configuration for persistence */
  filesystem?: FilesystemConfig;
}

// Re-export FilesystemConfig for consumers
export type { FilesystemConfig };

export type BufferEncoding = 'ascii' | 'utf8' | 'utf-8' | 'utf16le' | 'ucs2' | 'ucs-2' | 'base64' | 'base64url' | 'latin1' | 'binary' | 'hex';

export interface DirEnt<T> {
  name: T;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface IFSWatcher {
  close(): void;
}

export type FSWatchCallback = (event: 'rename' | 'change', filename: string | Uint8Array) => void;
export type FSWatchOptions = { encoding?: BufferEncoding | null; persistent?: boolean; recursive?: boolean; } | string | null;

export interface FileSystemAPI {
  readdir(path: string, options: 'buffer' | { encoding: 'buffer'; withFileTypes?: false }): Promise<Uint8Array[]>;
  readdir(path: string, options?: { encoding?: BufferEncoding | null; withFileTypes?: false } | BufferEncoding | null): Promise<string[]>;
  readdir(path: string, options: { encoding: 'buffer'; withFileTypes: true }): Promise<DirEnt<Uint8Array>[]>;
  readdir(path: string, options: { encoding?: BufferEncoding | null; withFileTypes: true }): Promise<DirEnt<string>[]>;

  readFile(path: string, encoding?: null): Promise<Uint8Array>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;

  writeFile(path: string, data: string | Uint8Array, options?: string | { encoding?: string | null } | null): Promise<void>;

  mkdir(path: string, options?: { recursive?: false }): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<string>;

  rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;

  watch(filename: string, options?: FSWatchOptions, listener?: FSWatchCallback): IFSWatcher;
  watch(filename: string, listener?: FSWatchCallback): IFSWatcher;
}

/**
 * WatchPathsOptions - options for internal.watchPaths()
 */
export interface WatchPathsOptions {
  include?: string[];
  exclude?: string[];
  includeContent?: boolean;
  excludeLargeContent?: number;
  gitignore?: string[];
  ignoreHiddenFiles?: boolean;
  ignoreHiddenFolders?: boolean;
}

/**
 * PathWatcherEvent - event emitted by watchPaths
 */
export interface PathWatcherEvent {
  type: 'change' | 'add_file' | 'remove_file' | 'add_dir' | 'remove_dir' | 'update_directory';
  path: string;
  ino: number;
  mtime: number;
  buffer?: Uint8Array;
}

/**
 * WebContainer - Primary API for RemodlWebContainer
 *
 * Drop-in replacement for StackBlitz @webcontainer/api
 */
export class WebContainer extends EventEmitter {
  private container: ContainerManager;
  private _workdirName: string;
  private previewScript: string | null = null;
  private _tornDown = false;
  private _unsubscribeFromTokenChangedListener = () => {};

  private constructor(container: ContainerManager, workdirName: string) {
    super();
    this.container = container;
    this._workdirName = workdirName;
  }

  /**
   * Boot the container
   */
  static async boot(options: WebContainerBootOptions = {}): Promise<WebContainer> {
    const workdirName = options.workdirName || '/home/project';

    // Create container with optional libSQL filesystem config
    const container = new ContainerManager({
      debug: false,
      maxProcesses: 20,
      memoryLimit: 1024 * 1024 * 1024, // 1GB
      filesystem: options.filesystem,  // Pass through libSQL config
      onServerListen: (port) => {
        // Server listening event
      },
      onServerClose: (port) => {
        // Server closed event
      },
    });

    // Wait for container to be ready
    await container.waitForReady();

    // Create working directory
    try {
      await container.createDirectory(workdirName);
    } catch (e) {
      // Directory might already exist
    }

    const webcontainer = new WebContainer(container, workdirName);

    return webcontainer;
  }

  /**
   * Set preview script
   */
  async setPreviewScript(script: string): Promise<void> {
    this.previewScript = script;
    // TODO: If needed, inject this into preview iframes
  }

  /**
   * Spawn a process
   */
  async spawn(command: string, args?: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<WebContainerProcess> {
    const process = await this.container.spawn(command, args || [], {
      cwd: options?.cwd || this._workdirName,
      env: options?.env,
    });

    return new WebContainerProcess(process);
  }

  /**
   * File system API
   */
  get fs(): FileSystemAPI {
    const self = this;
    return {
      readFile: async (path: string, encoding?: any): Promise<any> => {
        const content = await self.container.readFile(path);
        if (encoding === null || encoding === undefined) {
          // Return Uint8Array
          return new TextEncoder().encode(content);
        }
        return content;
      },

      writeFile: async (path: string, data: string | Uint8Array, options?: any): Promise<void> => {
        const content = typeof data === 'string' ? data : new TextDecoder().decode(data);
        await self.container.writeFile(path, content);
      },

      readdir: async (path: string, options?: any): Promise<any> => {
        const entries = await self.container.listDirectory(path);

        // Ensure entries is an array
        if (!Array.isArray(entries)) {
          console.warn('listDirectory returned non-array:', entries);
          return [];
        }

        // Check if options request withFileTypes
        const withFileTypes = typeof options === 'object' && options?.withFileTypes === true;

        if (withFileTypes) {
          // Return DirEnt objects
          return entries.map((name) => ({
            name,
            isDirectory: () => true, // TODO: Actually check file type
            isFile: () => false,
          }));
        }

        // Return string array
        return entries;
      },

      mkdir: async (path: string, options?: any): Promise<any> => {
        await self.container.createDirectory(path);
        // If recursive: true, return path, otherwise return void
        if (typeof options === 'object' && options?.recursive === true) {
          return path;
        }
      },

      rm: async (path: string, options?: { force?: boolean; recursive?: boolean }) => {
        await self.container.deleteFile(path, options?.recursive);
      },

      rename: async (oldPath: string, newPath: string) => {
        // Use container.rename if available, otherwise fallback to copy+delete
        if (self.container.rename) {
          await self.container.rename(oldPath, newPath);
        } else {
          const content = await self.container.readFile(oldPath);
          await self.container.writeFile(newPath, content);
          await self.container.deleteFile(oldPath);
        }
      },

      watch: (filename: string, optionsOrListener?: any, listener?: FSWatchCallback): IFSWatcher => {
        // Use container's watch method
        const actualListener = typeof optionsOrListener === 'function' ? optionsOrListener : listener;
        if (actualListener) {
          return self.container.watch(filename, actualListener);
        }
        return { close: () => {} };
      },
    } as FileSystemAPI;
  }

  /**
   * Get working directory name
   */
  get workdir(): string {
    return this._workdirName;
  }

  /**
   * Dispose/cleanup
   */
  async teardown(): Promise<void> {
    if (this._tornDown) return;
    this._tornDown = true;
    this._unsubscribeFromTokenChangedListener();
    await this.container.dispose();
  }

  /**
   * Internal API for advanced features like watchPaths
   */
  get internal(): WebContainerInternal {
    return new WebContainerInternal(this.container);
  }

  /**
   * Mount file tree
   */
  async mount(tree: any, options?: any): Promise<void> {
    // Mount file tree - not yet implemented
    throw new Error('mount() not yet implemented');
  }

  /**
   * Export file tree
   */
  async export(options?: any): Promise<any> {
    // Export file tree - not yet implemented
    throw new Error('export() not yet implemented');
  }

  /**
   * Path utilities
   */
  async path(filepath: string): Promise<string> {
    return filepath;
  }
}

/**
 * WebContainerInternal - internal API for file watching
 */
class WebContainerInternal {
  private container: ContainerManager;
  private watchers: Map<number, { callback: (events: PathWatcherEvent[]) => void; options: WatchPathsOptions }> = new Map();
  private watcherIdCounter = 0;

  constructor(container: ContainerManager) {
    this.container = container;
  }

  /**
   * Watch file paths for changes
   */
  watchPaths(options: WatchPathsOptions, cb: (events: PathWatcherEvent[]) => void): () => void {
    const watcherId = ++this.watcherIdCounter;
    this.watchers.set(watcherId, { callback: cb, options });

    // Set up watcher using container's watch() method
    // Watch root and filter based on include/exclude patterns
    const watcher = this.container.watch('/', (eventType, filename) => {
      if (!filename) return;

      const path = typeof filename === 'string' ? filename : new TextDecoder().decode(filename);

      // Check include patterns
      if (options.include && options.include.length > 0) {
        const matches = options.include.some(pattern => this.matchGlob(path, pattern));
        if (!matches) return;
      }

      // Check exclude patterns
      if (options.exclude && options.exclude.length > 0) {
        const excluded = options.exclude.some(pattern => this.matchGlob(path, pattern));
        if (excluded) return;
      }

      // Map event type
      let type: PathWatcherEvent['type'];
      if (eventType === 'rename') {
        type = 'add_file'; // Could be add or remove, simplify for now
      } else {
        type = 'change';
      }

      const event: PathWatcherEvent = {
        type,
        path,
        ino: 0, // We use path-based storage now
        mtime: Date.now(),
      };

      // If includeContent, read file content
      if (options.includeContent && type === 'change') {
        this.container.readFile(path).then(content => {
          event.buffer = new TextEncoder().encode(content);
          cb([event]);
        }).catch(() => {
          cb([event]);
        });
      } else {
        cb([event]);
      }
    });

    // Return dispose function
    return () => {
      this.watchers.delete(watcherId);
      watcher.close();
    };
  }

  /**
   * Simple glob pattern matching
   */
  private matchGlob(path: string, pattern: string): boolean {
    // Convert glob to regex
    const regexPattern = pattern
      .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<<DOUBLESTAR>>>/g, '.*')
      .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }
}

/**
 * WebContainerProcess - Process wrapper with ReadableStream/WritableStream
 */
export class WebContainerProcess {
  private process: VirtualProcess;
  public output: ReadableStream<string>;
  public input: WritableStream<string>;

  constructor(process: VirtualProcess) {
    this.process = process;

    // Create readable stream for output
    // Track stream state to prevent enqueue after close/error
    this.output = new ReadableStream({
      start: (controller) => {
        let streamEnded = false;

        process.on('output', (data) => {
          if (!streamEnded) {
            try {
              controller.enqueue(data.output);
            } catch (e) {
              // Stream already closed or errored
              streamEnded = true;
            }
          }
        });

        process.on('exit', () => {
          if (!streamEnded) {
            streamEnded = true;
            controller.close();
          }
        });

        process.on('error', (error) => {
          if (!streamEnded) {
            streamEnded = true;
            controller.error(error.error);
          }
        });
      },
    });

    // Create writable stream for input
    this.input = new WritableStream({
      write: async (chunk) => {
        await process.write(chunk);
      },
      close: async () => {
        // Input closed
      },
    });
  }

  get exit(): Promise<number> {
    return new Promise((resolve) => {
      this.process.on('exit', (data) => {
        resolve(data.exitCode ?? 0);
      });
    });
  }

  async kill(): Promise<void> {
    await this.process.kill();
  }
}
