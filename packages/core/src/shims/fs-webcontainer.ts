/**
 * fs shim that proxies to webcontainer.fs
 *
 * This is used by npm packages in the browser bundle that call fs.
 * All operations go through the WebContainer's ZenFS instance.
 */

let _webcontainer: { fs: any } | null = null;

export function setWebContainer(wc: { fs: any }): void {
  _webcontainer = wc;
}

function getFS(): any {
  if (!_webcontainer) {
    throw new Error('WebContainer not initialized. Call setWebContainer() first.');
  }
  return _webcontainer.fs;
}

// Async API (promises)
export const promises = {
  async readFile(path: string, options?: any): Promise<Uint8Array | string> {
    return getFS().readFile(path, options);
  },

  async writeFile(path: string, data: string | Uint8Array, options?: any): Promise<void> {
    return getFS().writeFile(path, data, options);
  },

  async readdir(path: string, options?: any): Promise<string[]> {
    return getFS().readdir(path, options);
  },

  async mkdir(path: string, options?: any): Promise<void> {
    return getFS().mkdir(path, options);
  },

  async rm(path: string, options?: any): Promise<void> {
    return getFS().rm(path, options);
  },

  async stat(path: string): Promise<any> {
    return getFS().stat(path);
  },

  async rename(oldPath: string, newPath: string): Promise<void> {
    return getFS().rename(oldPath, newPath);
  },

  async unlink(path: string): Promise<void> {
    return getFS().rm(path);
  },

  async rmdir(path: string): Promise<void> {
    return getFS().rm(path, { recursive: false });
  },

  async access(path: string): Promise<void> {
    // Check if file exists by trying to stat
    await getFS().stat(path);
  },

  async copyFile(src: string, dest: string): Promise<void> {
    const content = await getFS().readFile(src);
    await getFS().writeFile(dest, content);
  },
};

// Callback API (wraps promises)
type Callback<T> = (err: Error | null, result?: T) => void;

export function readFile(path: string, callback: Callback<Uint8Array | string>): void;
export function readFile(path: string, options: any, callback: Callback<Uint8Array | string>): void;
export function readFile(path: string, options: any, callback?: Callback<Uint8Array | string>): void {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  promises.readFile(path, options)
    .then(data => callback?.(null, data))
    .catch(err => callback?.(err));
}

export function writeFile(path: string, data: string | Uint8Array, callback: Callback<void>): void;
export function writeFile(path: string, data: string | Uint8Array, options: any, callback: Callback<void>): void;
export function writeFile(path: string, data: string | Uint8Array, options: any, callback?: Callback<void>): void {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  promises.writeFile(path, data, options)
    .then(() => callback?.(null))
    .catch(err => callback?.(err));
}

export function readdir(path: string, callback: Callback<string[]>): void;
export function readdir(path: string, options: any, callback: Callback<string[]>): void;
export function readdir(path: string, options: any, callback?: Callback<string[]>): void {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  promises.readdir(path, options)
    .then(files => callback?.(null, files))
    .catch(err => callback?.(err));
}

export function mkdir(path: string, callback: Callback<void>): void;
export function mkdir(path: string, options: any, callback: Callback<void>): void;
export function mkdir(path: string, options: any, callback?: Callback<void>): void {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  promises.mkdir(path, options)
    .then(() => callback?.(null))
    .catch(err => callback?.(err));
}

export function stat(path: string, callback: Callback<any>): void {
  promises.stat(path)
    .then(stats => callback(null, stats))
    .catch(err => callback(err));
}

export function unlink(path: string, callback: Callback<void>): void {
  promises.unlink(path)
    .then(() => callback(null))
    .catch(err => callback(err));
}

export function rmdir(path: string, callback: Callback<void>): void {
  promises.rmdir(path)
    .then(() => callback(null))
    .catch(err => callback(err));
}

export function rename(oldPath: string, newPath: string, callback: Callback<void>): void {
  promises.rename(oldPath, newPath)
    .then(() => callback(null))
    .catch(err => callback(err));
}

export function access(path: string, callback: Callback<void>): void;
export function access(path: string, mode: number, callback: Callback<void>): void;
export function access(path: string, mode: number | Callback<void>, callback?: Callback<void>): void {
  if (typeof mode === 'function') {
    callback = mode;
  }
  promises.access(path)
    .then(() => callback?.(null))
    .catch(err => callback?.(err));
}

export function copyFile(src: string, dest: string, callback: Callback<void>): void {
  promises.copyFile(src, dest)
    .then(() => callback(null))
    .catch(err => callback(err));
}

// Sync versions - throw (not supported in browser async context)
export function readFileSync(): never {
  throw new Error('readFileSync not supported. Use fs.promises.readFile() or callback API.');
}

export function writeFileSync(): never {
  throw new Error('writeFileSync not supported. Use fs.promises.writeFile() or callback API.');
}

export function readdirSync(): never {
  throw new Error('readdirSync not supported. Use fs.promises.readdir() or callback API.');
}

export function mkdirSync(): never {
  throw new Error('mkdirSync not supported. Use fs.promises.mkdir() or callback API.');
}

export function statSync(): never {
  throw new Error('statSync not supported. Use fs.promises.stat() or callback API.');
}

export function existsSync(): never {
  throw new Error('existsSync not supported. Use fs.promises.access() or callback API.');
}

// Constants
export const constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
};

export default {
  promises,
  readFile,
  writeFile,
  readdir,
  mkdir,
  stat,
  unlink,
  rmdir,
  rename,
  access,
  copyFile,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  statSync,
  existsSync,
  constants,
  setWebContainer,
};
