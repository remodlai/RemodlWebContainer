// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

/**
 * internalBinding() provides access to Node.js internal C++ bindings.
 *
 * In RemodlWebContainer, these bindings are implemented using:
 * - Browser APIs (crypto, timers, etc.)
 * - libSQL/ZenFS (fs operations)
 * - WebSocket/SSE shims (network operations)
 * - QuickJS-ng native modules (when available)
 *
 * Total bindings: 60
 * Extracted from Node.js source files in RemodlWebContainer.
 */

// Import shims (will be resolved at build time)
// For now, these are placeholders that will be replaced with actual implementations

/**
 * Registry of all internal bindings
 */
const bindings = {
  // === Async & Event Loop ===
  async_wrap: {
    // Async resource tracking
    Providers: {},
    setupHooks() {},
    pushAsyncContext() {},
    popAsyncContext() {},
  },

  // === Buffer & Binary ===
  buffer: {
    // Buffer utilities (use Browser ArrayBuffer/Uint8Array)
    copy(source, target, targetStart, sourceStart, sourceEnd) {
      const src = new Uint8Array(source.buffer || source, sourceStart, sourceEnd - sourceStart);
      const tgt = new Uint8Array(target.buffer || target, targetStart);
      tgt.set(src);
      return src.length;
    },
    compare(buf1, buf2) {
      const a = new Uint8Array(buf1);
      const b = new Uint8Array(buf2);
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
      }
      return a.length - b.length;
    },
    fill(buffer, value, start, end) {
      const buf = new Uint8Array(buffer);
      buf.fill(value, start, end);
    },
    indexOf(buffer, value, byteOffset, encoding) {
      // Simplified implementation
      const buf = new Uint8Array(buffer);
      if (typeof value === 'number') {
        return buf.indexOf(value, byteOffset);
      }
      // For string/buffer values, convert and search
      return -1; // TODO: Implement full search
    },
  },

  blob: {
    // Blob API (use Browser Blob)
    createBlob(parts, options) {
      return new Blob(parts, options);
    },
  },

  // === Network - DNS ===
  cares_wrap: {
    // DNS resolution (implemented via dns-http shim)
    getaddrinfo() {},
    getnameinfo() {},
    queryA() {},
    queryAaaa() {},
    queryCname() {},
    queryMx() {},
    queryNs() {},
    queryTxt() {},
    querySrv() {},
    queryPtr() {},
    querySoa() {},
    queryNaptr() {},
    canonicalizeIP(ip) {
      // Basic IP canonicalization
      return ip;
    },
  },

  // === Configuration ===
  config: {
    // Node.js build configuration
    hasInspector: false,
    hasTracing: false,
    hasNodeOptions: false,
    hasIntl: true,
    hasSmallICU: false,
    hasOpenSSL: true, // Via crypto-hybrid shim
  },

  // === Constants ===
  constants: {
    // OS, fs, crypto constants
    os: {
      signals: {},
      errno: {},
      dlopen: {},
      priority: {},
    },
    fs: {
      O_RDONLY: 0,
      O_WRONLY: 1,
      O_RDWR: 2,
      O_CREAT: 64,
      O_EXCL: 128,
      O_TRUNC: 512,
      O_APPEND: 1024,
      S_IFMT: 61440,
      S_IFREG: 32768,
      S_IFDIR: 16384,
      S_IFLNK: 40960,
      // Add more as needed
    },
    crypto: {
      defaultCipherList: 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256',
    },
  },

  // === VM & Context ===
  contextify: {
    // VM context creation (stub - QuickJS handles this)
    makeContext() {},
    isContext() { return false; },
  },

  // === Crypto ===
  crypto: {
    // Import from crypto-hybrid.ts
    // Placeholder - will be populated from shim
    getCiphers() { return []; },
    getHashes() { return ['sha256', 'sha512', 'md5']; },
    getRootCertificates() { return []; },
    getSSLCiphers() { return []; },
  },

  // === Encoding ===
  encoding_binding: {
    // Text encoding/decoding
    decode(buffer, encoding) {
      const decoder = new TextDecoder(encoding);
      return decoder.decode(buffer);
    },
    encode(str, encoding) {
      const encoder = new TextEncoder();
      return encoder.encode(str);
    },
  },

  // === Errors ===
  errors: {
    // Error utilities
    triggerUncaughtException() {},
  },

  // === Filesystem ===
  fs: (() => {
    // Import ZenFS at module scope
    // Note: This will be available after configure() is called
    let zenfs;
    try {
      zenfs = require('@zenfs/core').fs;
    } catch (e) {
      // ZenFS not yet configured, will be set later
      zenfs = null;
    }

    // Helper: Get ZenFS instance
    const getFS = () => {
      if (!zenfs) {
        try {
          zenfs = require('@zenfs/core').fs;
        } catch (e) {
          throw new Error('ZenFS not configured. Call configure() first.');
        }
      }
      return zenfs;
    };

    // FSReqCallback class for async operations
    class FSReqCallback {
      constructor() {
        this.oncomplete = null;
        this.context = null;
      }
    }

    // Stats values arrays (used by Node.js fs.Stats)
    // 18 fields × 2 slots each = 36 total
    // Fields: dev, ino, mode, nlink, uid, gid, rdev, size, blksize, blocks,
    //         atimeMs, mtimeMs, ctimeMs, birthtimeMs, atime, mtime, ctime, birthtime
    const kFsStatsFieldsNumber = 18;
    const statValues = new Float64Array(36);  // 18 fields × 2 slots
    const bigintStatValues = new BigInt64Array(36);
    const statFsValues = new Float64Array(14);  // For statfs()
    const bigintStatFsValues = new BigInt64Array(14);

    // Helper: Convert ZenFS stats to statValues array
    const fillStatValues = (stats) => {
      statValues[0] = stats.dev || 0;
      statValues[1] = stats.mode || 0;
      statValues[2] = stats.nlink || 1;
      statValues[3] = stats.uid || 0;
      statValues[4] = stats.gid || 0;
      statValues[5] = stats.rdev || 0;
      statValues[6] = stats.blksize || 4096;
      statValues[7] = stats.ino || 0;
      statValues[8] = stats.size || 0;
      statValues[9] = stats.blocks || 0;
      statValues[10] = stats.atimeMs || Date.now();
      statValues[11] = stats.mtimeMs || Date.now();
      statValues[12] = stats.ctimeMs || Date.now();
      statValues[13] = stats.birthtimeMs || Date.now();
      return statValues;
    };

    // Helper: Execute async operation with req callback
    const asyncOp = (fn, req) => {
      if (req && req.oncomplete) {
        try {
          const result = fn();
          // Call oncomplete asynchronously
          setImmediate(() => {
            req.oncomplete(null, result);
          });
        } catch (err) {
          setImmediate(() => {
            req.oncomplete(err);
          });
        }
      } else {
        // Sync operation
        return fn();
      }
    };

    return {
      // === Special Exports ===
      FSReqCallback,
      statValues,
      bigintStatValues,
      statFsValues,
      bigintStatFsValues,
      kFsStatsFieldsNumber,

      // === File Operations ===

      // open(path, flags, mode, req?)
      open(path, flags, mode, req) {
        const fs = getFS();
        const operation = () => {
          return fs.openSync(path, flags, mode);
        };
        return asyncOp(operation, req);
      },

      // close(fd, req?)
      close(fd, req) {
        const fs = getFS();
        const operation = () => {
          fs.closeSync(fd);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // read(fd, buffer, offset, length, position, req?)
      read(fd, buffer, offset, length, position, req) {
        const fs = getFS();
        const operation = () => {
          return fs.readSync(fd, buffer, offset, length, position);
        };
        return asyncOp(operation, req);
      },

      // write(fd, buffer, offset, length, position, req?)
      write(fd, buffer, offset, length, position, req) {
        const fs = getFS();
        const operation = () => {
          return fs.writeSync(fd, buffer, offset, length, position);
        };
        return asyncOp(operation, req);
      },

      // writeBuffer(fd, buffer, offset, length, position, req?)
      writeBuffer(fd, buffer, offset, length, position, req) {
        // Alias for write
        return this.write(fd, buffer, offset, length, position, req);
      },

      // writeString(fd, string, position, encoding, req?)
      writeString(fd, string, position, encoding, req) {
        const fs = getFS();
        const operation = () => {
          const buffer = Buffer.from(string, encoding);
          return fs.writeSync(fd, buffer, 0, buffer.length, position);
        };
        return asyncOp(operation, req);
      },

      // === Stat Operations ===

      // stat(path, useBigint, req?)
      stat(path, useBigint, req) {
        const fs = getFS();
        const operation = () => {
          const stats = fs.statSync(path);
          return fillStatValues(stats);
        };
        return asyncOp(operation, req);
      },

      // lstat(path, useBigint, req?)
      lstat(path, useBigint, req) {
        const fs = getFS();
        const operation = () => {
          const stats = fs.lstatSync(path);
          return fillStatValues(stats);
        };
        return asyncOp(operation, req);
      },

      // fstat(fd, useBigint, req?)
      fstat(fd, useBigint, req) {
        const fs = getFS();
        const operation = () => {
          const stats = fs.fstatSync(fd);
          return fillStatValues(stats);
        };
        return asyncOp(operation, req);
      },

      // internalModuleStat(path) - Special sync stat for module loading
      internalModuleStat(path) {
        const fs = getFS();
        try {
          const stats = fs.statSync(path);
          if (stats.isFile()) return 0;
          if (stats.isDirectory()) return 1;
          return -1;
        } catch (e) {
          return -1; // File doesn't exist
        }
      },

      // === Directory Operations ===

      // mkdir(path, mode, recursive, req?)
      mkdir(path, mode, recursive, req) {
        const fs = getFS();
        const operation = () => {
          fs.mkdirSync(path, { mode, recursive });
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // rmdir(path, req?)
      rmdir(path, req) {
        const fs = getFS();
        const operation = () => {
          fs.rmdirSync(path);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // readdir(path, encoding, withFileTypes, req?)
      readdir(path, encoding, withFileTypes, req) {
        const fs = getFS();
        const operation = () => {
          const options = { encoding, withFileTypes };
          return fs.readdirSync(path, options);
        };
        return asyncOp(operation, req);
      },

      // === File Manipulation ===

      // unlink(path, req?)
      unlink(path, req) {
        const fs = getFS();
        const operation = () => {
          fs.unlinkSync(path);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // rename(oldPath, newPath, req?)
      rename(oldPath, newPath, req) {
        const fs = getFS();
        const operation = () => {
          fs.renameSync(oldPath, newPath);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // link(existingPath, newPath, req?)
      link(existingPath, newPath, req) {
        const fs = getFS();
        const operation = () => {
          fs.linkSync(existingPath, newPath);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // symlink(target, path, type, req?)
      symlink(target, path, type, req) {
        const fs = getFS();
        const operation = () => {
          fs.symlinkSync(target, path, type);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // readlink(path, encoding, req?)
      readlink(path, encoding, req) {
        const fs = getFS();
        const operation = () => {
          return fs.readlinkSync(path, encoding);
        };
        return asyncOp(operation, req);
      },

      // === Permission & Attributes ===

      // chmod(path, mode, req?)
      chmod(path, mode, req) {
        const fs = getFS();
        const operation = () => {
          fs.chmodSync(path, mode);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // fchmod(fd, mode, req?)
      fchmod(fd, mode, req) {
        const fs = getFS();
        const operation = () => {
          fs.fchmodSync(fd, mode);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // chown(path, uid, gid, req?)
      chown(path, uid, gid, req) {
        const fs = getFS();
        const operation = () => {
          fs.chownSync(path, uid, gid);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // fchown(fd, uid, gid, req?)
      fchown(fd, uid, gid, req) {
        const fs = getFS();
        const operation = () => {
          fs.fchownSync(fd, uid, gid);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // lchown(path, uid, gid, req?)
      lchown(path, uid, gid, req) {
        const fs = getFS();
        const operation = () => {
          fs.lchownSync(path, uid, gid);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // === Timestamps ===

      // utimes(path, atime, mtime, req?)
      utimes(path, atime, mtime, req) {
        const fs = getFS();
        const operation = () => {
          fs.utimesSync(path, atime, mtime);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // futimes(fd, atime, mtime, req?)
      futimes(fd, atime, mtime, req) {
        const fs = getFS();
        const operation = () => {
          fs.futimesSync(fd, atime, mtime);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // lutimes(path, atime, mtime, req?)
      lutimes(path, atime, mtime, req) {
        const fs = getFS();
        const operation = () => {
          fs.lutimesSync(path, atime, mtime);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // === File Content ===

      // truncate(path, length, req?)
      truncate(path, length, req) {
        const fs = getFS();
        const operation = () => {
          fs.truncateSync(path, length);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // ftruncate(fd, length, req?)
      ftruncate(fd, length, req) {
        const fs = getFS();
        const operation = () => {
          fs.ftruncateSync(fd, length);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // === Existence & Access ===

      // access(path, mode, req?)
      access(path, mode, req) {
        const fs = getFS();
        const operation = () => {
          fs.accessSync(path, mode);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // exists(path, req?) - Deprecated but still used
      exists(path, req) {
        const fs = getFS();
        const operation = () => {
          try {
            fs.accessSync(path);
            return true;
          } catch (e) {
            return false;
          }
        };
        return asyncOp(operation, req);
      },

      // === Realpath ===

      // realpath(path, encoding, req?)
      realpath(path, encoding, req) {
        const fs = getFS();
        const operation = () => {
          return fs.realpathSync(path, { encoding });
        };
        return asyncOp(operation, req);
      },

      // === Sync Operations ===

      // fsync(fd, req?)
      fsync(fd, req) {
        const fs = getFS();
        const operation = () => {
          fs.fsyncSync(fd);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // fdatasync(fd, req?)
      fdatasync(fd, req) {
        const fs = getFS();
        const operation = () => {
          fs.fdatasyncSync(fd);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // === Copy ===

      // copyFile(src, dest, mode, req?)
      copyFile(src, dest, mode, req) {
        const fs = getFS();
        const operation = () => {
          fs.copyFileSync(src, dest, mode);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // === Optimized Reads ===

      // readFileUtf8(path, flags) - Optimized UTF-8 read
      readFileUtf8(path, flags) {
        const fs = getFS();
        return fs.readFileSync(path, 'utf-8');
      },

      // === Other ===

      // mkdtemp(prefix, encoding, req?)
      mkdtemp(prefix, encoding, req) {
        const fs = getFS();
        const operation = () => {
          return fs.mkdtempSync(prefix, { encoding });
        };
        return asyncOp(operation, req);
      },

      // rm(path, options, req?)
      rm(path, options, req) {
        const fs = getFS();
        const operation = () => {
          fs.rmSync(path, options);
          return undefined;
        };
        return asyncOp(operation, req);
      },

      // cp(src, dest, options, req?)
      cp(src, dest, options, req) {
        const fs = getFS();
        const operation = () => {
          fs.cpSync(src, dest, options);
          return undefined;
        };
        return asyncOp(operation, req);
      },
    };
  })(),

  fs_dir: {
    // Directory operations
    opendir() {},
    read() {},
    close() {},
  },

  fs_event_wrap: {
    // fs.watch implementation
    FSEvent() {},
  },

  // === HTTP ===
  http2: {
    // HTTP/2 implementation (stub)
    Http2Session() {},
    Http2Stream() {},
  },

  http_parser: {
    // HTTP parser (basic implementation)
    HTTPParser() {},
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
    ConnectionsList: function ConnectionsList() {
      this._list = [];
    },
  },

  // === Internationalization ===
  icu: {
    // ICU utilities
    getStringWidth() { return 1; },
  },

  // === Inspector ===
  inspector: {
    // DevTools inspector (stub)
    open() {},
    close() {},
    url() { return null; },
  },

  // === Modules ===
  module_wrap: {
    // ES module wrapper
    ModuleWrap() {},
  },

  builtins: {
    // List of built-in modules
    getCategoryNames() { return []; },
    getModuleCategories() { return {}; },
  },

  // === OS ===
  os: {
    // OS utilities
    getHostname() { return 'webcontainer'; },
    getOSRelease() { return '0.0.0'; },
    getOSType() { return 'WebContainer'; },
    getTotalMem() { return 0; },
    getFreeMem() { return 0; },
    getCPUs() { return []; },
    getLoadAvg() { return [0, 0, 0]; },
    getUptime() { return 0; },
    getUserInfo() { return { username: 'user', uid: 1000, gid: 1000 }; },
    getPriority() { return 0; },
    setPriority() {},
  },

  // === Performance ===
  performance: {
    // Performance APIs
    now() { return performance.now(); },
    timeOrigin: performance.timeOrigin,
  },

  // === Permissions ===
  permission: {
    // Permission model (stub)
    has() { return false; },
  },

  // === Network Wraps (WebSocket/SSE shims) ===
  pipe_wrap: {
    Pipe() {},
  },

  tcp_wrap: {
    // TCP via WebSocket shim
    TCP() {},
  },

  udp_wrap: {
    // UDP via SSE shim
    UDP() {},
  },

  tls_wrap: {
    // TLS via WebSocket shim
    TLSWrap() {},
  },

  tty_wrap: {
    // TTY (stub)
    TTY() {},
    isTTY() { return false; },
  },

  // === Process ===
  process_methods: {
    // Process utilities
    _debugEnd() {},
    _debugProcess() {},
  },

  process_wrap: {
    // Child process (via child-process-websocket shim)
    Process() {},
  },

  spawn_sync: {
    // Synchronous spawn (not supported)
    spawn() {
      throw new Error('spawn_sync not supported in browser');
    },
  },

  // === Profiler ===
  profiler: {
    // V8 profiler (stub)
    startProfiling() {},
    stopProfiling() {},
  },

  // === Report ===
  report: {
    // Diagnostic report (stub)
    writeReport() {},
  },

  // === SEA (Single Executable Application) ===
  sea: {
    // SEA utilities
    isSea() { return false; },
    getAsset() { return null; },
  },

  // === Serialization ===
  serdes: {
    // Serialization/deserialization
    serialize(value) {
      // Use structured clone algorithm
      return new Uint8Array([]);
    },
    deserialize(buffer) {
      return null;
    },
  },

  // === Signals ===
  signal_wrap: {
    // Signal handling (limited in browser)
    Signal() {},
  },

  // === Streams ===
  stream_pipe: {
    // Stream piping
    Pipe() {},
  },

  stream_wrap: {
    // Stream wrapping
    StreamWrap() {},
    WriteWrap() {},
  },

  js_stream: {
    // JS stream utilities
    JSStream() {},
  },

  // === String Decoder ===
  string_decoder: {
    // String decoding utilities
    decode(buffer, encoding) {
      const decoder = new TextDecoder(encoding);
      return decoder.decode(buffer);
    },
  },

  // === Symbols ===
  symbols: {
    // Internal symbols
    async_id_symbol: Symbol('asyncId'),
    handle_onclose_symbol: Symbol('onclose'),
    owner_symbol: Symbol('owner'),
  },

  // === Task Queue ===
  task_queue: {
    // Microtask queue
    enqueueMicrotask(fn) {
      queueMicrotask(fn);
    },
  },

  // === Timers ===
  timers: {
    // Timer utilities
    setTimeout: setTimeout.bind(globalThis),
    setInterval: setInterval.bind(globalThis),
    clearTimeout: clearTimeout.bind(globalThis),
    clearInterval: clearInterval.bind(globalThis),
  },

  // === Trace Events ===
  trace_events: {
    // Trace events (stub)
    CategorySet() {},
    getEnabledCategories() { return ''; },
  },

  // === Types ===
  types: {
    // Type checking utilities
    isArrayBuffer(value) { return value instanceof ArrayBuffer; },
    isArrayBufferView(value) { return ArrayBuffer.isView(value); },
    isAsyncFunction(value) {
      return typeof value === 'function' && value.constructor.name === 'AsyncFunction';
    },
    isDataView(value) { return value instanceof DataView; },
    isDate(value) { return value instanceof Date; },
    isMap(value) { return value instanceof Map; },
    isMapIterator(value) { return false; }, // TODO
    isPromise(value) { return value instanceof Promise; },
    isRegExp(value) { return value instanceof RegExp; },
    isSet(value) { return value instanceof Set; },
    isSetIterator(value) { return false; }, // TODO
    isTypedArray(value) {
      return ArrayBuffer.isView(value) && !(value instanceof DataView);
    },
    isUint8Array(value) { return value instanceof Uint8Array; },
    isWeakMap(value) { return value instanceof WeakMap; },
    isWeakSet(value) { return value instanceof WeakSet; },
  },

  // === URL ===
  url: {
    // URL parsing (use Browser URL API)
    parse(url) {
      try {
        return new URL(url);
      } catch {
        return null;
      }
    },
  },

  // === Util ===
  util: {
    // Utility functions
    getSystemErrorName(err) {
      return `Unknown system error ${err}`;
    },
    getSystemErrorMap() {
      return new Map();
    },
  },

  // === UV (libuv) ===
  uv: {
    // libuv bindings (stub)
    errname(err) { return 'UNKNOWN'; },
  },

  // === V8 ===
  v8: {
    // V8 engine utilities
    getHeapStatistics() {
      return {
        total_heap_size: 0,
        total_heap_size_executable: 0,
        total_physical_size: 0,
        total_available_size: 0,
        used_heap_size: 0,
        heap_size_limit: 0,
        malloced_memory: 0,
        peak_malloced_memory: 0,
        does_zap_garbage: 0,
      };
    },
    setFlagsFromString() {},
  },

  internal_only_v8: {
    // Internal V8 (stub)
    startupSnapshot: {},
  },

  // === WASI ===
  wasi: {
    // WebAssembly System Interface (stub)
    WASI() {},
  },

  wasm_web_api: {
    // WebAssembly Web API
    compile: WebAssembly.compile.bind(WebAssembly),
    instantiate: WebAssembly.instantiate.bind(WebAssembly),
  },

  // === Watchdog ===
  watchdog: {
    // Watchdog timer (stub)
    startTimer() {},
    stopTimer() {},
  },

  // === Worker Threads ===
  worker: {
    // Worker thread utilities (stub)
    Worker() {},
    MessageChannel() {},
    MessagePort() {},
  },

  messaging: {
    // Worker messaging (stub)
    postMessage() {},
  },

  // === Block List ===
  block_list: {
    // IP block list (stub)
    BlockList() {},
  },

  // === Heap Utils ===
  heap_utils: {
    // Heap utilities (stub)
    getHeapSnapshot() { return null; },
  },

  // === Mksnapshot ===
  mksnapshot: {
    // Snapshot creation (stub)
    createSnapshot() {},
  },

  // === Options ===
  options: {
    // CLI options (stub)
    getOptions() { return {}; },
  },

  // === Credentials (Unix only) ===
  credentials: {
    // User/group credentials (stub)
    getuid() { return 1000; },
    geteuid() { return 1000; },
    getgid() { return 1000; },
    getegid() { return 1000; },
    getgroups() { return [1000]; },
  },

  // === Zlib ===
  zlib: {
    // Zlib compression (use pako or browser APIs)
    createDeflate() {},
    createInflate() {},
    createGzip() {},
    createGunzip() {},
  },
};

/**
 * Main internalBinding function
 * @param {string} name - Name of the binding to load
 * @returns {object} The binding object
 */
function internalBinding(name) {
  if (!bindings.hasOwnProperty(name)) {
    throw new Error(`No such binding: ${name}`);
  }

  return bindings[name];
}

// For debugging: list all available bindings
internalBinding.bindings = Object.keys(bindings).sort();

module.exports = internalBinding;
