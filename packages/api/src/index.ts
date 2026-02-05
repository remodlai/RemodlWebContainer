// Primary WebContainer API (StackBlitz-compatible)
export { WebContainer, WebContainerProcess } from './webcontainer';
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
} from './webcontainer';

// Lower-level APIs (for advanced usage)
export * from './container';
export * from './process';
export * from './worker';
