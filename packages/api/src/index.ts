// Primary WebContainer API (StackBlitz-compatible)
export { WebContainer, WebContainerProcess, auth } from './webcontainer';
export type {
  WebContainerBootOptions,
  FileSystemAPI,
  DirEnt,
  IFSWatcher,
  FSWatchCallback,
  FSWatchOptions,
  BufferEncoding,
  WatchPathsOptions,
  PathWatcherEvent,
  FilesystemConfig,  // libSQL filesystem configuration
  SpawnOptions,
  TextSearchOptions,
  TextSearchOnProgressCallback,
  TextSearchResult,
  AuthAPI,
} from './webcontainer';

// WebContainerComlink - stub for Comlink-based iframe communication
// Note: Comlink client not yet implemented (see Task #41)
// This stub allows test files to compile but throws at runtime
export class WebContainerComlink {
  // Stub properties to satisfy type checking
  public fs: any;
  public spawn: any;

  private constructor() {
    // Private constructor - use boot() instead
    this.fs = {
      writeFile: async () => { throw new Error('WebContainerComlink not implemented'); },
      readFile: async () => { throw new Error('WebContainerComlink not implemented'); },
      readdir: async () => { throw new Error('WebContainerComlink not implemented'); },
      mkdir: async () => { throw new Error('WebContainerComlink not implemented'); },
      rm: async () => { throw new Error('WebContainerComlink not implemented'); },
      rename: async () => { throw new Error('WebContainerComlink not implemented'); },
      watch: () => { throw new Error('WebContainerComlink not implemented'); },
    };
    this.spawn = async () => { throw new Error('WebContainerComlink not implemented'); };
  }

  static async boot(options?: any): Promise<WebContainerComlink> {
    console.warn('WebContainerComlink not yet implemented - use WebContainer.boot() instead');
    throw new Error('WebContainerComlink not implemented');
  }
}

// Lower-level APIs (for advanced usage)
export * from './container';
export * from './process';
export * from './worker';
