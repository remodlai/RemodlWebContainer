/**
 * Net module shim using WebSocket for bidirectional TCP socket streaming.
 *
 * Architecture:
 * - Each net.Socket creates a WebSocket connection to gateway
 * - Gateway proxies to real server-side TCP socket
 * - Bidirectional: Browser ↔ WebSocket ↔ Gateway ↔ TCP Socket ↔ Remote
 *
 * No Temporal workflows - gateway handles socket proxying directly.
 */

import { EventEmitter } from 'events';
import { Buffer } from 'buffer';

const GATEWAY_WS = process.env.GATEWAY_WS_URL || 'ws://localhost:8000';

interface SocketOptions {
  fd?: number;
  allowHalfOpen?: boolean;
  readable?: boolean;
  writable?: boolean;
}

interface ConnectOptions {
  port: number;
  host?: string;
  localAddress?: string;
  localPort?: number;
  family?: 4 | 6;
  hints?: number;
  lookup?: Function;
  timeout?: number;
}

export class Socket extends EventEmitter {
  public connecting: boolean = false;
  public destroyed: boolean = false;
  public readable: boolean = true;
  public writable: boolean = true;
  public remoteAddress: string | null = null;
  public remotePort: number | null = null;
  public remoteFamily: string | null = null;
  public localAddress: string = '127.0.0.1';
  public localPort: number = 0;

  private _ws: WebSocket | null = null;
  private _socketId: string | null = null;

  constructor(options?: SocketOptions) {
    super();
    // Socket can be created with options or empty
  }

  connect(port: number, host?: string, connectListener?: () => void): this;
  connect(port: number, connectListener?: () => void): this;
  connect(options: ConnectOptions, connectListener?: () => void): this;
  connect(port: number | ConnectOptions, host?: string | (() => void), connectListener?: () => void): this {
    let connectOptions: ConnectOptions;

    // Normalize arguments
    if (typeof port === 'object') {
      connectOptions = port;
      connectListener = host as (() => void) | undefined;
    } else {
      if (typeof host === 'function') {
        connectListener = host;
        host = undefined;
      }
      connectOptions = {
        port,
        host: host as string | undefined,
      };
    }

    if (connectListener) {
      this.once('connect', connectListener);
    }

    this.connecting = true;
    this.remoteAddress = connectOptions.host || 'localhost';
    this.remotePort = connectOptions.port;
    this.remoteFamily = connectOptions.family === 6 ? 'IPv6' : 'IPv4';

    this._doConnect(connectOptions);
    return this;
  }

  private async _doConnect(options: ConnectOptions): Promise<void> {
    try {
      // Generate socket ID
      this._socketId = `net-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Connect via WebSocket to gateway
      this._ws = new WebSocket(`${GATEWAY_WS}/ws/net/${this._socketId}`);

      // Send connection parameters as first message
      this._ws.onopen = () => {
        this._ws!.send(JSON.stringify({
          type: 'connect',
          host: options.host || 'localhost',
          port: options.port,
          timeout: options.timeout,
        }));
      };

      this._ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case 'connect':
              this.connecting = false;
              this.localPort = msg.localPort || 0;
              this.emit('connect');
              break;

            case 'data':
              const buffer = Buffer.from(msg.data);
              this.emit('data', buffer);
              break;

            case 'end':
              this.readable = false;
              this.emit('end');
              break;

            case 'close':
              this.destroyed = true;
              this.readable = false;
              this.writable = false;
              this.emit('close', msg.hadError || false);
              break;

            case 'error':
              this.emit('error', new Error(msg.message || 'Socket error'));
              break;

            case 'timeout':
              this.emit('timeout');
              break;
          }
        } catch (err) {
          this.emit('error', err);
        }
      };

      this._ws.onerror = (event) => {
        this.connecting = false;
        this.emit('error', new Error('WebSocket connection failed'));
      };

      this._ws.onclose = () => {
        if (!this.destroyed) {
          this.destroyed = true;
          this.readable = false;
          this.writable = false;
          this.emit('close', false);
        }
      };
    } catch (err) {
      this.connecting = false;
      this.emit('error', err);
    }
  }

  write(data: Buffer | Uint8Array | string): boolean;
  write(data: Buffer | Uint8Array | string, encoding?: BufferEncoding): boolean;
  write(data: Buffer | Uint8Array | string, callback?: (err?: Error) => void): boolean;
  write(data: Buffer | Uint8Array | string, encoding?: BufferEncoding | ((err?: Error) => void), callback?: (err?: Error) => void): boolean {
    let enc: BufferEncoding | undefined;
    let cb: ((err?: Error) => void) | undefined;

    if (typeof encoding === 'function') {
      cb = encoding;
    } else {
      enc = encoding;
      cb = callback;
    }

    if (this.destroyed) {
      const err = new Error('Socket is closed');
      if (cb) cb(err);
      return false;
    }

    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      const err = new Error('Socket not connected');
      if (cb) cb(err);
      return false;
    }

    this._doWrite(data, enc, cb);
    return true;
  }

  private async _doWrite(
    data: Buffer | Uint8Array | string,
    encoding?: BufferEncoding,
    callback?: (err?: Error) => void
  ): Promise<void> {
    try {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, encoding);

      this._ws!.send(JSON.stringify({
        type: 'write',
        data: Array.from(buffer),
      }));

      if (callback) callback();
    } catch (err) {
      if (callback) callback(err as Error);
      this.emit('error', err);
    }
  }

  end(): this;
  end(data: Buffer | Uint8Array | string): this;
  end(data: Buffer | Uint8Array | string, encoding?: BufferEncoding): this;
  end(callback?: () => void): this;
  end(data?: Buffer | Uint8Array | string | (() => void), encoding?: BufferEncoding | (() => void), callback?: () => void): this {
    let endData: Buffer | Uint8Array | string | undefined;
    let enc: BufferEncoding | undefined;
    let cb: (() => void) | undefined;

    if (typeof data === 'function') {
      cb = data;
    } else {
      endData = data;
      if (typeof encoding === 'function') {
        cb = encoding;
      } else {
        enc = encoding;
        cb = callback;
      }
    }

    if (endData) {
      this.write(endData, enc);
    }

    this._doEnd(cb);
    return this;
  }

  private async _doEnd(callback?: () => void): Promise<void> {
    try {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify({ type: 'end' }));
      }

      this.writable = false;
      if (callback) callback();
    } catch (err) {
      if (callback) callback();
    }
  }

  destroy(error?: Error): this {
    if (this.destroyed) return this;

    this.destroyed = true;
    this.readable = false;
    this.writable = false;

    if (this._ws) {
      if (this._ws.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify({ type: 'destroy' }));
      }
      this._ws.close();
      this._ws = null;
    }

    if (error) this.emit('error', error);
    this.emit('close', !!error);

    return this;
  }

  setTimeout(timeout: number, callback?: () => void): this {
    if (callback) this.once('timeout', callback);

    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ type: 'setTimeout', timeout }));
    }

    return this;
  }

  setNoDelay(noDelay: boolean = true): this {
    // No-op in WebSocket proxy mode
    return this;
  }

  setKeepAlive(enable?: boolean, initialDelay?: number): this {
    // No-op in WebSocket proxy mode
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  get bytesRead(): number {
    return 0; // Not tracked in proxy mode
  }

  get bytesWritten(): number {
    return 0; // Not tracked in proxy mode
  }
}

export class Server extends EventEmitter {
  public listening: boolean = false;

  private _serverId: string | null = null;
  private _port: number = 0;
  private _host: string = '0.0.0.0';

  constructor(connectionListener?: (socket: Socket) => void) {
    super();
    if (connectionListener) {
      this.on('connection', connectionListener);
    }
  }

  listen(port: number, hostname?: string, backlog?: number, callback?: () => void): this;
  listen(port: number, hostname?: string, callback?: () => void): this;
  listen(port: number, callback?: () => void): this;
  listen(options: { port?: number; host?: string; backlog?: number; exclusive?: boolean }, callback?: () => void): this;
  listen(port: any, hostname?: any, backlog?: any, callback?: any): this {
    let listenPort: number | undefined;
    let listenHost: string | undefined;
    let listenCallback: (() => void) | undefined;

    // Normalize arguments
    if (typeof port === 'object') {
      listenPort = port.port;
      listenHost = port.host;
      listenCallback = hostname;
    } else {
      listenPort = port;
      if (typeof hostname === 'function') {
        listenCallback = hostname;
      } else if (typeof backlog === 'function') {
        listenHost = hostname;
        listenCallback = backlog;
      } else {
        listenHost = hostname;
        listenCallback = callback;
      }
    }

    if (listenCallback) {
      this.once('listening', listenCallback);
    }

    this._doListen(listenPort, listenHost);
    return this;
  }

  private async _doListen(port?: number, host?: string): Promise<void> {
    try {
      const res = await fetch(`${GATEWAY_WS.replace('ws://', 'http://').replace('wss://', 'https://')}/api/net/listen`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Caller-ID': (globalThis as any).__REMODL_CALLER_ID__ || 'unknown',
        },
        body: JSON.stringify({
          port,
          host: host || '0.0.0.0',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Listen failed');
      }

      const data = await res.json();
      this._serverId = data.serverId;
      this._port = port || data.port || 0;
      this._host = host || '0.0.0.0';
      this.listening = true;
      this.emit('listening');

      // Note: Connection handling would require additional WebSocket for incoming connections
      // This is a simplified implementation
    } catch (err) {
      this.emit('error', err);
    }
  }

  close(callback?: (err?: Error) => void): this {
    if (callback) this.once('close', callback);

    if (this._serverId) {
      fetch(`${GATEWAY_WS.replace('ws://', 'http://').replace('wss://', 'https://')}/api/net/close/${this._serverId}`, {
        method: 'POST',
        headers: {
          'X-Caller-ID': (globalThis as any).__REMODL_CALLER_ID__ || 'unknown',
        },
      }).catch(() => {});

      this._serverId = null;
    }

    this.listening = false;
    this.emit('close');
    return this;
  }

  address(): { port: number; family: string; address: string } | null {
    if (!this.listening) return null;
    return {
      port: this._port,
      family: 'IPv4',
      address: this._host,
    };
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}

export function createConnection(port: number, host?: string, connectListener?: () => void): Socket;
export function createConnection(options: ConnectOptions, connectListener?: () => void): Socket;
export function createConnection(port: number | ConnectOptions, host?: string | (() => void), connectListener?: () => void): Socket {
  const socket = new Socket();

  if (typeof port === 'object') {
    return socket.connect(port, host as (() => void) | undefined);
  } else {
    return socket.connect(port, host as string | undefined, connectListener);
  }
}

export const connect = createConnection;

export function createServer(options?: any, connectionListener?: (socket: Socket) => void): Server {
  if (typeof options === 'function') {
    connectionListener = options;
    options = {};
  }
  return new Server(connectionListener);
}

export function isIP(input: string): number {
  if (isIPv4(input)) return 4;
  if (isIPv6(input)) return 6;
  return 0;
}

export function isIPv4(input: string): boolean {
  return /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(input);
}

export function isIPv6(input: string): boolean {
  return /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(input);
}

export { Socket, Server };

export default {
  Socket,
  Server,
  createConnection,
  connect,
  createServer,
  isIP,
  isIPv4,
  isIPv6,
};
