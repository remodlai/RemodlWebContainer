/**
 * Child process module shim using WebSocket for stdin/stdout/stderr streaming.
 *
 * Architecture:
 * - spawn() creates WebSocket connection to gateway
 * - Gateway spawns real process server-side
 * - stdin: Browser → WebSocket → Gateway → Process stdin
 * - stdout/stderr: Process → Gateway → WebSocket → Browser streams
 *
 * No Temporal workflows - gateway handles process lifecycle directly.
 */

import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';
import { Buffer } from 'buffer';

const GATEWAY_URL = process.env.GATEWAY_API_URL || 'http://localhost:8000';
const GATEWAY_WS = process.env.GATEWAY_WS_URL || 'ws://localhost:8000';

interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  argv0?: string;
  stdio?: string | any[];
  detached?: boolean;
  uid?: number;
  gid?: number;
  shell?: boolean | string;
  windowsVerbatimArguments?: boolean;
  windowsHide?: boolean;
  timeout?: number;
  killSignal?: string | number;
}

export class ChildProcess extends EventEmitter {
  public stdin: Writable;
  public stdout: Readable;
  public stderr: Readable;
  public pid: number | null = null;
  public exitCode: number | null = null;
  public signalCode: string | null = null;
  public killed: boolean = false;
  public connected: boolean = false;
  public spawnfile: string = '';
  public spawnargs: string[] = [];

  private _ws: WebSocket | null = null;
  private _processId: string | null = null;

  constructor() {
    super();

    // Create writable stdin stream
    this.stdin = new Writable({
      write: (chunk, encoding, callback) => {
        this._writeStdin(chunk).then(() => callback()).catch(callback);
      }
    });

    // Create readable stdout/stderr streams
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
  }

  async _spawn(command: string, args: string[] = [], options: SpawnOptions = {}): Promise<void> {
    this.spawnfile = command;
    this.spawnargs = [command, ...args];

    try {
      // First, spawn the process via HTTP to get process ID
      const res = await fetch(`${GATEWAY_URL}/api/process/spawn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Caller-ID': (globalThis as any).__REMODL_CALLER_ID__ || 'unknown',
        },
        body: JSON.stringify({
          command,
          args,
          cwd: options.cwd,
          env: options.env,
          shell: options.shell,
          timeout: options.timeout,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Spawn failed');
      }

      const data = await res.json();
      this._processId = data.processId;
      this.pid = data.pid || Math.floor(Math.random() * 10000);
      this.connected = true;
      this.emit('spawn');

      // Connect WebSocket for stdio streaming
      this._connectStreams();
    } catch (err) {
      this.emit('error', err);
    }
  }

  private _connectStreams(): void {
    if (!this._processId) return;

    // WebSocket for bidirectional stdio communication
    this._ws = new WebSocket(`${GATEWAY_WS}/ws/process/${this._processId}`);

    this._ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'stdout':
            const stdoutBuffer = Buffer.from(msg.data);
            this.stdout.push(stdoutBuffer);
            break;

          case 'stderr':
            const stderrBuffer = Buffer.from(msg.data);
            this.stderr.push(stderrBuffer);
            break;

          case 'exit':
            this.stdout.push(null); // End stdout stream
            this.stderr.push(null); // End stderr stream
            this.exitCode = msg.code ?? 0;
            this.signalCode = msg.signal || null;
            this.connected = false;
            this.emit('exit', this.exitCode, this.signalCode);
            this.emit('close', this.exitCode, this.signalCode);
            break;

          case 'error':
            this.emit('error', new Error(msg.message || 'Process error'));
            break;
        }
      } catch (err) {
        this.emit('error', err);
      }
    };

    this._ws.onerror = () => {
      this.emit('error', new Error('WebSocket connection failed'));
    };

    this._ws.onclose = () => {
      if (this.connected) {
        this.connected = false;
        this.stdout.push(null);
        this.stderr.push(null);
        if (this.exitCode === null) {
          this.exitCode = 1; // Unexpected close
        }
        this.emit('exit', this.exitCode, this.signalCode);
        this.emit('close', this.exitCode, this.signalCode);
      }
    };
  }

  private async _writeStdin(data: Buffer | Uint8Array | string): Promise<void> {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

    this._ws.send(JSON.stringify({
      type: 'stdin',
      data: Array.from(buffer),
    }));
  }

  kill(signal: string | number = 'SIGTERM'): boolean {
    if (this.killed) return false;

    if (this._processId) {
      fetch(`${GATEWAY_URL}/api/process/kill/${this._processId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Caller-ID': (globalThis as any).__REMODL_CALLER_ID__ || 'unknown',
        },
        body: JSON.stringify({ signal }),
      }).catch(() => {});
    }

    this.killed = true;
    return true;
  }

  disconnect(): void {
    this.connected = false;
    this.emit('disconnect');
  }

  send(message: any, sendHandle?: any, options?: any, callback?: (error: Error | null) => void): boolean {
    // IPC not supported in browser
    const err = new Error('IPC not supported in browser');
    if (callback) callback(err);
    return false;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}

export function spawn(command: string, args?: string[], options?: SpawnOptions): ChildProcess;
export function spawn(command: string, options?: SpawnOptions): ChildProcess;
export function spawn(command: string, args?: string[] | SpawnOptions, options?: SpawnOptions): ChildProcess {
  const child = new ChildProcess();

  let spawnArgs: string[] = [];
  let spawnOptions: SpawnOptions = {};

  if (Array.isArray(args)) {
    spawnArgs = args;
    spawnOptions = options || {};
  } else if (args) {
    spawnOptions = args;
  }

  child._spawn(command, spawnArgs, spawnOptions);
  return child;
}

export function exec(
  command: string,
  options?: SpawnOptions | ((error: Error | null, stdout: string, stderr: string) => void),
  callback?: (error: Error | null, stdout: string, stderr: string) => void
): ChildProcess {
  let execOptions: SpawnOptions = {};
  let execCallback: ((error: Error | null, stdout: string, stderr: string) => void) | undefined;

  if (typeof options === 'function') {
    execCallback = options;
  } else {
    execOptions = options || {};
    execCallback = callback;
  }

  const child = spawn(execOptions.shell || '/bin/sh', ['-c', command], execOptions);

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => {
    stdout += data.toString();
    if (execOptions.maxBuffer && stdout.length > execOptions.maxBuffer) {
      child.kill();
    }
  });

  child.stderr.on('data', (data) => {
    stderr += data.toString();
    if (execOptions.maxBuffer && stderr.length > execOptions.maxBuffer) {
      child.kill();
    }
  });

  child.on('error', (err) => {
    if (execCallback) execCallback(err, stdout, stderr);
  });

  child.on('close', (code, signal) => {
    if (execCallback) {
      if (code !== 0) {
        const err = new Error(`Command failed: ${command}`) as any;
        err.code = code;
        err.signal = signal;
        err.killed = child.killed;
        execCallback(err, stdout, stderr);
      } else {
        execCallback(null, stdout, stderr);
      }
    }
  });

  return child;
}

export function execFile(
  file: string,
  args?: string[] | SpawnOptions | ((error: Error | null, stdout: string, stderr: string) => void),
  options?: SpawnOptions | ((error: Error | null, stdout: string, stderr: string) => void),
  callback?: (error: Error | null, stdout: string, stderr: string) => void
): ChildProcess {
  let execArgs: string[] = [];
  let execOptions: SpawnOptions = {};
  let execCallback: ((error: Error | null, stdout: string, stderr: string) => void) | undefined;

  if (typeof args === 'function') {
    execCallback = args;
  } else if (Array.isArray(args)) {
    execArgs = args;
    if (typeof options === 'function') {
      execCallback = options;
    } else {
      execOptions = options || {};
      execCallback = callback;
    }
  } else if (args) {
    execOptions = args;
    execCallback = options as ((error: Error | null, stdout: string, stderr: string) => void) | undefined;
  }

  const child = spawn(file, execArgs, execOptions);

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => (stdout += data.toString()));
  child.stderr.on('data', (data) => (stderr += data.toString()));

  child.on('error', (err) => execCallback?.(err, stdout, stderr));
  child.on('close', (code) => {
    if (code !== 0) {
      const err = new Error(`Command failed: ${file}`) as any;
      err.code = code;
      execCallback?.(err, stdout, stderr);
    } else {
      execCallback?.(null, stdout, stderr);
    }
  });

  return child;
}

export function fork(modulePath: string, args: string[] = [], options: SpawnOptions = {}): ChildProcess {
  console.warn('fork() not fully supported in browser. Using spawn() instead.');
  return spawn(process.execPath || 'node', [modulePath, ...args], options);
}

// Sync versions - not supported in browser
export function execSync(): never {
  throw new Error('execSync not supported in browser. Use exec() with async/await.');
}

export function execFileSync(): never {
  throw new Error('execFileSync not supported in browser. Use execFile() with async/await.');
}

export function spawnSync(): never {
  throw new Error('spawnSync not supported in browser. Use spawn() with async/await.');
}

export { ChildProcess };

export default {
  spawn,
  exec,
  execFile,
  fork,
  execSync,
  execFileSync,
  spawnSync,
  ChildProcess,
};
