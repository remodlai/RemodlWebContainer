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
  fs: {
    // Implemented via libSQL/ZenFS backend
    // Placeholder - actual implementation in fs-webcontainer.ts
    open() {},
    close() {},
    read() {},
    write() {},
    stat() {},
    lstat() {},
    fstat() {},
    readdir() {},
    mkdir() {},
    rmdir() {},
    unlink() {},
    rename() {},
    // Add more as needed
  },

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
