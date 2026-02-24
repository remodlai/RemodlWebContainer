/**
 * WebContainer - StackBlitz-compatible thin client API
 *
 * This is a thin client (~15KB) that creates a hidden iframe,
 * establishes a Comlink RPC bridge, and delegates all operations
 * to the runtime running inside the iframe.
 *
 * Drop-in replacement for @webcontainer/api.
 *
 * @example
 * ```typescript
 * import { WebContainer } from '@remodl-web-container/api';
 *
 * const container = await WebContainer.boot({ baseUrl: 'https://session.forge-api.remodl.ai' });
 * await container.fs.writeFile('/src/index.ts', 'console.log("hello")');
 * const process = await container.spawn('node', ['src/index.ts']);
 * ```
 */

import * as Comlink from 'comlink';
import type { FilesystemConfig } from './worker/types';

// --- Boot Options ---

export interface BootOptions {
  coep?: 'require-corp' | 'credentialless' | 'none';
  workdirName?: string;
  forwardPreviewErrors?: boolean | 'exceptions-only';
  filesystem?: FilesystemConfig;
  baseUrl?: string;
}

// Keep old name as alias
export type WebContainerBootOptions = BootOptions;

// --- Spawn Options ---

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string | number | boolean>;
  output?: boolean;
  terminal?: { cols: number; rows: number };
}

// --- FileSystem Types ---

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
export type FSWatchOptions = { encoding?: BufferEncoding | null; persistent?: boolean; recursive?: boolean } | string | null;

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

// --- FileSystemTree (for mount/export) ---

export interface FileSystemTree {
  [name: string]: DirectoryNode | FileNode | SymlinkNode;
}

export interface DirectoryNode {
  directory: FileSystemTree;
}

export interface FileNode {
  file: {
    contents: string | Uint8Array;
  };
}

export interface SymlinkNode {
  file: {
    symlink: string;
  };
}

// --- Export Options ---

export interface ExportOptions {
  format?: 'json' | 'binary' | 'zip';
  includes?: string[];
  excludes?: string[];
}

// --- Preview Types ---

export enum PreviewMessageType {
  UncaughtException = 'UncaughtException',
  UnhandledRejection = 'UnhandledRejection',
  ConsoleError = 'ConsoleError',
}

export interface BasePreviewMessage {
  previewId: string;
  port: number;
  pathname: string;
  search: string;
  hash: string;
}

export interface UncaughtExceptionMessage {
  type: PreviewMessageType.UncaughtException;
  message: string;
  stack: string | undefined;
}

export interface UnhandledRejectionMessage {
  type: PreviewMessageType.UnhandledRejection;
  message: string;
  stack: string | undefined;
}

export interface ConsoleErrorMessage {
  type: PreviewMessageType.ConsoleError;
  args: any[];
  stack: string;
}

export type PreviewMessage = (UncaughtExceptionMessage | UnhandledRejectionMessage | ConsoleErrorMessage) & BasePreviewMessage;

export interface PreviewScriptOptions {
  type?: 'module' | 'importmap';
  defer?: boolean;
  async?: boolean;
}

// --- Code Event Types ---

export type CodeEventType = 'open' | 'diff';

export interface CodeEventFile {
  filepath: string;
  line?: number;
  column?: number;
}

export interface CodeEvent {
  files: CodeEventFile[];
}

// --- Listener Types ---

export type Unsubscribe = () => void;
export type PortListener = (port: number, type: 'open' | 'close', url: string) => void;
export type ServerReadyListener = (port: number, url: string) => void;
export type PreviewMessageListener = (message: PreviewMessage) => void;
export type ErrorListener = (error: { message: string }) => void;
export type OpenListener = (text: string) => void;
export type CodeListener = (type: CodeEventType, event: CodeEvent) => void;

// --- Auth API ---

export interface AuthAPI {
  init(options: AuthInitOptions): { status: 'need-auth' | 'authorized' } | AuthFailedError;
  startAuthFlow(options?: { popup?: boolean }): void;
  loggedIn(): Promise<void>;
  logout(options?: { ignoreRevokeError?: boolean }): Promise<void>;
  on(event: 'logged-out', listener: () => void): Unsubscribe;
  on(event: 'auth-failed', listener: (reason: { error: string; description: string }) => void): Unsubscribe;
}

export interface AuthInitOptions {
  editorOrigin?: string;
  clientId: string;
  scope: string;
}

export interface AuthFailedError {
  status: 'auth-failed';
  error: string;
  description: string;
}

export const auth: AuthAPI = {
  init(_options: AuthInitOptions) { return { status: 'need-auth' as const }; },
  startAuthFlow(_options?: { popup?: boolean }) { console.warn('auth.startAuthFlow() not implemented'); },
  async loggedIn() { /* never resolves until implemented */ return new Promise(() => {}); },
  async logout(_options?: { ignoreRevokeError?: boolean }) { console.warn('auth.logout() not implemented'); },
  on(_event: string, _listener: any): Unsubscribe { return () => {}; },
};

// Re-export FilesystemConfig
export type { FilesystemConfig };

// --- Utilities ---

export function isPreviewMessage(message: any): message is PreviewMessage {
  return message && typeof message.type === 'string' && Object.values(PreviewMessageType).includes(message.type);
}

export function configureAPIKey(_key: string): void {
  // Will be used for iframe URL configuration when auth is implemented
}

// --- Internal conversion utils for mount/export ---

function toInternalFileSystemTree(tree: FileSystemTree): any {
  // StackBlitz internal format is the same as external for our purposes
  return tree;
}

function toExternalFileSystemTree(data: any): FileSystemTree {
  return data as FileSystemTree;
}

// --- Iframe + Comlink Boot Machinery ---

const decoder = new TextDecoder();
const encoder = new TextEncoder();

let bootPromise: Promise<void> | null = null;
let cachedServerPromise: Promise<any> | null = null;
let cachedBootOptions: BootOptions = {};

function serverFactory(options: BootOptions): { serverPromise: Promise<any> } {
  if (cachedServerPromise != null) {
    if (options.coep !== cachedBootOptions.coep) {
      console.warn(`Attempting to boot WebContainer with 'coep: ${options.coep}'`);
      console.warn(`First boot had 'coep: ${cachedBootOptions.coep}', new settings will not take effect!`);
    }
    return { serverPromise: cachedServerPromise };
  }

  // Build iframe URL
  const baseUrl = options.baseUrl || '';
  const iframeUrl = `${baseUrl}/headless`;

  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.setAttribute('allow', 'cross-origin-isolated');
  iframe.src = iframeUrl;

  cachedBootOptions = { ...options };
  cachedServerPromise = new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const { data } = event;
      if (data.type === 'init') {
        window.removeEventListener('message', onMessage);
        resolve(Comlink.wrap(event.ports[0]));
      }
      if (data.type === 'warning') {
        console[data.level as 'warn' | 'error']?.call(console, data.message);
      }
    };
    window.addEventListener('message', onMessage);
  });

  document.body.insertBefore(iframe, null);
  return { serverPromise: cachedServerPromise };
}

// --- DirEnt implementation ---

const DIR_ENTRY_TYPE_FILE = 1;
const DIR_ENTRY_TYPE_DIR = 2;

class DirEntImpl<T> implements DirEnt<T> {
  name: T;
  private _type: number;

  constructor(name: T, _type: number) {
    this.name = name;
    this._type = _type;
  }

  isFile(): boolean {
    return this._type === DIR_ENTRY_TYPE_FILE;
  }

  isDirectory(): boolean {
    return this._type === DIR_ENTRY_TYPE_DIR;
  }
}

// --- FSWatcher ---

class FSWatcherImpl implements IFSWatcher {
  private _closed = false;
  private _watcher: any;

  constructor(fsProxy: any, path: string, options: FSWatchOptions, listener?: FSWatchCallback) {
    const wrappedListener = listener
      ? Comlink.proxy((event: 'rename' | 'change', filename: string | Uint8Array) => {
          if (!this._closed && listener) {
            listener(event, filename);
          }
        })
      : undefined;

    fsProxy.watch(path, options, wrappedListener).then((watcher: any) => {
      this._watcher = watcher;
      if (this._closed) {
        this._watcher?.close();
      }
    }).catch(console.error);
  }

  close(): void {
    if (!this._closed) {
      this._closed = true;
      this._watcher?.close();
    }
  }
}

// --- FileSystemAPIClient (thin wrapper over Comlink proxy) ---

class FileSystemAPIClient implements FileSystemAPI {
  private _fs: any;
  _watchers = new Set<FSWatcherImpl>();

  constructor(fs: any) {
    this._fs = fs;
  }

  async readFile(path: string, encoding?: any): Promise<any> {
    return await this._fs.readFile(path, encoding);
  }

  async writeFile(path: string, data: string | Uint8Array, options?: any): Promise<void> {
    if (data instanceof Uint8Array) {
      const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      data = Comlink.transfer(new Uint8Array(buffer), [buffer]);
    }
    await this._fs.writeFile(path, data, options);
  }

  async readdir(path: string, options?: any): Promise<any> {
    const result = await this._fs.readdir(path, options);
    if (!result || result.length === 0) return result;

    // Check if results are DirEnt-like objects (have 'Symbol(type)' property)
    if (typeof result[0] === 'string' || result[0] instanceof Uint8Array) {
      return result;
    }

    return result.map((entry: any) => new DirEntImpl(entry.name, entry['Symbol(type)']));
  }

  async mkdir(path: string, options?: any): Promise<any> {
    return await this._fs.mkdir(path, options);
  }

  async rm(...args: any[]): Promise<void> {
    return this._fs.rm(...args);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    return await this._fs.rename(oldPath, newPath);
  }

  watch(path: string, optionsOrListener?: any, listener?: FSWatchCallback): IFSWatcher {
    let options: FSWatchOptions = null;
    let actualListener: FSWatchCallback | undefined;

    if (typeof optionsOrListener === 'function') {
      actualListener = optionsOrListener;
    } else {
      options = optionsOrListener;
      actualListener = listener;
    }

    const watcher = new FSWatcherImpl(this._fs, path, options, actualListener);
    this._watchers.add(watcher);
    return watcher;
  }

  async _teardown(): Promise<void> {
    await Promise.all([...this._watchers].map((w) => w.close()));
  }
}

// --- WebContainerProcess ---

function streamWithPush(): { stream: ReadableStream<string>; push: (item: string | null) => void } {
  let controller: ReadableStreamDefaultController<string> | null = null;
  const stream = new ReadableStream<string>({
    start(c) { controller = c; },
  });
  const push = (item: string | null) => {
    if (item != null) {
      controller?.enqueue(item);
    } else {
      controller?.close();
      controller = null;
    }
  };
  return { stream, push };
}

function binaryListener(listener: ((data: string | null) => void) | undefined): ((data: Uint8Array | null) => void) | undefined {
  if (listener == null) return undefined;
  return (data: Uint8Array | null) => {
    if (data instanceof Uint8Array) {
      listener(decoder.decode(data));
    } else if (data == null) {
      listener(null);
    }
  };
}

export class WebContainerProcess {
  output: ReadableStream<string>;
  input: WritableStream<string>;
  exit: Promise<number>;
  private _process: any;

  constructor(process: any, output: ReadableStream<string>) {
    this.output = output;
    this._process = process;
    this.input = new WritableStream({
      write: (data: string) => {
        this._process?.write(data).catch(() => {});
      },
    });
    this.exit = this._onExit();
  }

  kill(): void {
    this._process?.kill();
  }

  resize(dimensions: { cols: number; rows: number }): void {
    this._process?.resize(dimensions);
  }

  private async _onExit(): Promise<number> {
    try {
      return await this._process.onExit;
    } finally {
      this._process?.[Comlink.releaseProxy]();
      this._process = null;
    }
  }
}

// --- WebContainer (thin client) ---

export class WebContainer {
  private _instance: any;
  private _runtimeInfo: { path: string; cwd: string };

  fs: FileSystemAPI;

  /** @internal */
  static _instance: WebContainer | null = null;
  /** @internal */
  static _teardownPromise: Promise<void> | null = null;

  private _tornDown = false;
  private _unsubscribeFromTokenChangedListener = () => {};

  private constructor(instance: any, fs: any, _previewScript: any, runtimeInfo: { path: string; cwd: string }) {
    this._instance = instance;
    this._runtimeInfo = runtimeInfo;
    this.fs = new FileSystemAPIClient(fs);
  }

  async spawn(command: string, optionsOrArgs?: string[] | SpawnOptions, options?: SpawnOptions): Promise<WebContainerProcess> {
    let args: string[] = [];
    if (Array.isArray(optionsOrArgs)) {
      args = optionsOrArgs;
    } else {
      options = optionsOrArgs;
    }

    let output: ((data: string | null) => void) | undefined;
    let outputStream = new ReadableStream<string>();

    if (options?.output !== false) {
      const result = streamWithPush();
      output = result.push;
      outputStream = result.stream;
    }

    const wrappedOutput = output ? Comlink.proxy(binaryListener(output)!) : undefined;

    const process = await this._instance.run(
      {
        command,
        args,
        cwd: options?.cwd,
        env: options?.env,
        terminal: options?.terminal,
      },
      undefined, // stdout
      undefined, // stderr
      wrappedOutput,
    );

    return new WebContainerProcess(process, outputStream);
  }

  async export(path: string, options?: ExportOptions): Promise<FileSystemTree | Uint8Array> {
    const serializeOptions = {
      format: options?.format ?? 'json',
      includes: options?.includes,
      excludes: options?.excludes,
      external: true,
    };

    const result = await this._instance.serialize(path, serializeOptions);

    if (serializeOptions.format === 'json') {
      const data = JSON.parse(decoder.decode(result));
      return toExternalFileSystemTree(data);
    }
    return result;
  }

  on(event: 'port', listener: PortListener): Unsubscribe;
  on(event: 'server-ready', listener: ServerReadyListener): Unsubscribe;
  on(event: 'preview-message', listener: PreviewMessageListener): Unsubscribe;
  on(event: 'error', listener: ErrorListener): Unsubscribe;
  on(event: 'xdg-open', listener: OpenListener): Unsubscribe;
  on(event: 'code', listener: CodeListener): Unsubscribe;
  on(event: string, listener: (...args: any[]) => void): Unsubscribe {
    if (event === 'preview-message') {
      const originalListener = listener;
      listener = ((message: any) => {
        if (isPreviewMessage(message)) {
          originalListener(message);
        }
      });
    }

    let stopped = false;
    let unsubscribe: Unsubscribe = () => {};

    const wrapped = Comlink.proxy((...args: any[]) => {
      if (!stopped) listener(...args);
    });

    this._instance.on(event, wrapped).then((unsub: Unsubscribe) => {
      unsubscribe = unsub;
      if (stopped) unsubscribe();
    });

    return () => {
      stopped = true;
      unsubscribe();
    };
  }

  mount(snapshotOrTree: FileSystemTree | Uint8Array | ArrayBuffer, options?: { mountPoint?: string }): Promise<void> {
    const payload = snapshotOrTree instanceof Uint8Array
      ? snapshotOrTree
      : snapshotOrTree instanceof ArrayBuffer
        ? new Uint8Array(snapshotOrTree)
        : encoder.encode(JSON.stringify(toInternalFileSystemTree(snapshotOrTree)));

    return this._instance.loadFiles(
      Comlink.transfer(payload, [payload.buffer]),
      { mountPoints: options?.mountPoint },
    );
  }

  setPreviewScript(scriptSrc: string, options?: PreviewScriptOptions): Promise<void> {
    return this._instance.setPreviewScript(scriptSrc, options);
  }

  get path(): string {
    return this._runtimeInfo.path;
  }

  get workdir(): string {
    return this._runtimeInfo.cwd;
  }

  teardown(): void {
    if (this._tornDown) {
      throw new Error('WebContainer already torn down');
    }
    this._tornDown = true;
    this._unsubscribeFromTokenChangedListener();

    const teardownFn = async () => {
      try {
        await (this.fs as FileSystemAPIClient)._teardown();
        await this._instance.teardown();
      } finally {
        this._instance[Comlink.releaseProxy]();
        if (WebContainer._instance === this) {
          WebContainer._instance = null;
        }
      }
    };

    WebContainer._teardownPromise = teardownFn();
  }

  static async boot(options: BootOptions = {}): Promise<WebContainer> {
    await this._teardownPromise;
    WebContainer._teardownPromise = null;

    const { workdirName } = options;

    if (window.crossOriginIsolated && options.coep === 'none') {
      console.warn(
        `A Cross-Origin-Embedder-Policy header is required in cross origin isolated environments.\nSet the 'coep' option to 'require-corp'.`
      );
    }

    if (workdirName?.includes('/') || workdirName === '..' || workdirName === '.') {
      throw new Error('workdirName should be a valid folder name');
    }

    // Singleton guard
    while (bootPromise) {
      await bootPromise;
    }

    if (WebContainer._instance) {
      throw new Error('Only a single WebContainer instance can be booted');
    }

    const instancePromise = unsynchronizedBoot(options);
    bootPromise = instancePromise.then(() => {}).catch(() => {});

    try {
      const instance = await instancePromise;
      WebContainer._instance = instance;
      return instance;
    } finally {
      bootPromise = null;
    }
  }
}

async function unsynchronizedBoot(options: BootOptions): Promise<WebContainer> {
  const { serverPromise } = serverFactory(options);
  const server = await serverPromise;

  const instance = await server.build({
    host: window.location.host,
    version: '0.1.0',
    workdirName: options.workdirName,
    forwardPreviewErrors: options.forwardPreviewErrors,
    filesystem: options.filesystem,
    baseUrl: options.baseUrl,
  });

  const [fs, previewScript, runtimeInfo] = await Promise.all([
    instance.fs(),
    instance.previewScript(),
    instance.runtimeInfo(),
  ]);

  return new (WebContainer as any)(instance, fs, previewScript, runtimeInfo);
}

// --- Internal API (watchPaths, textSearch) ---

export interface WatchPathsOptions {
  include?: string[];
  exclude?: string[];
  includeContent?: boolean;
  excludeLargeContent?: number;
  gitignore?: string[];
  ignoreHiddenFiles?: boolean;
  ignoreHiddenFolders?: boolean;
}

export interface PathWatcherEvent {
  type: 'change' | 'add_file' | 'remove_file' | 'add_dir' | 'remove_dir' | 'update_directory';
  path: string;
  ino: number;
  mtime: number;
  buffer?: Uint8Array;
}

export interface TextSearchOptions {
  folders?: string[];
  homeDir?: string;
  includes?: string[];
  excludes?: string[];
  gitignore?: boolean;
  requireGit?: boolean;
  globalIgnoreFiles?: boolean;
  ignoreSymlinks?: boolean;
  resultLimit?: number;
  isRegex?: boolean;
  caseSensitive?: boolean;
  isWordMatch?: boolean;
  include?: string[];
  exclude?: string[];
  maxResults?: number;
  regex?: boolean;
}

export interface TextSearchMatch {
  preview: {
    text: string;
    matches: Array<{ startLineNumber: number }>;
  };
  ranges: Array<{
    startLineNumber: number;
    startColumn: number;
    endColumn: number;
  }>;
}

export type TextSearchOnProgressCallback = (filePath: string, matches: TextSearchMatch[]) => void;

export interface TextSearchResult {
  filePath: string;
  matches: TextSearchMatch[];
}
