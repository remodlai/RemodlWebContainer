/**
 * DGRAM (UDP) module shim using HTTP POST for sending + SSE for receiving.
 *
 * UDP is connectionless and message-oriented:
 * - Send: HTTP POST to gateway (one-shot)
 * - Receive: SSE (Server-Sent Events) stream for incoming packets
 *
 * No Temporal workflows - gateway handles UDP operations directly.
 */

import { EventEmitter } from 'events';
import { Buffer } from 'buffer';

const GATEWAY_URL = process.env.GATEWAY_API_URL || 'http://localhost:8000';

interface UdpSocketOptions {
  type: 'udp4' | 'udp6';
  reuseAddr?: boolean;
  ipv6Only?: boolean;
  recvBufferSize?: number;
  sendBufferSize?: number;
}

interface RemoteInfo {
  address: string;
  family: 'IPv4' | 'IPv6';
  port: number;
  size: number;
}

class Socket extends EventEmitter {
  public type: 'udp4' | 'udp6';
  private _socketId: string | null = null;
  private _eventSource: EventSource | null = null;
  private _address: { address: string; family: string; port: number } | null = null;

  constructor(type: 'udp4' | 'udp6', callback?: (msg: Buffer, rinfo: RemoteInfo) => void) {
    super();
    this.type = type;

    if (callback) {
      this.on('message', callback);
    }
  }

  bind(port?: number): void;
  bind(port: number, address?: string): void;
  bind(port: number, address: string, callback?: () => void): void;
  bind(options: { port?: number; address?: string; exclusive?: boolean }): void;
  bind(port: any, address?: any, callback?: any): void {
    let bindPort: number | undefined;
    let bindAddress: string | undefined;
    let bindCallback: (() => void) | undefined;

    // Normalize arguments
    if (typeof port === 'object') {
      bindPort = port.port;
      bindAddress = port.address;
      bindCallback = address;
    } else {
      bindPort = port;
      if (typeof address === 'function') {
        bindCallback = address;
      } else {
        bindAddress = address;
        bindCallback = callback;
      }
    }

    if (bindCallback) {
      this.once('listening', bindCallback);
    }

    this._doBind(bindPort, bindAddress);
  }

  private async _doBind(port?: number, address?: string): Promise<void> {
    try {
      const res = await fetch(`${GATEWAY_URL}/api/dgram/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Caller-ID': (globalThis as any).__REMODL_CALLER_ID__ || 'unknown',
        },
        body: JSON.stringify({
          type: this.type,
          port,
          address: address || (this.type === 'udp4' ? '0.0.0.0' : '::'),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Bind failed');
      }

      const data = await res.json();
      this._socketId = data.socketId;
      this._address = {
        address: address || (this.type === 'udp4' ? '0.0.0.0' : '::'),
        family: this.type === 'udp4' ? 'IPv4' : 'IPv6',
        port: data.port || port || 0,
      };

      this.emit('listening');

      // Start SSE stream for incoming packets
      this._startReceiving();
    } catch (err) {
      this.emit('error', err);
    }
  }

  private _startReceiving(): void {
    if (!this._socketId) return;

    // Connect to SSE stream for incoming UDP packets
    this._eventSource = new EventSource(`${GATEWAY_URL}/sse/dgram/${this._socketId}`);

    this._eventSource.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const buffer = Buffer.from(msg.data);
        const rinfo: RemoteInfo = {
          address: msg.address,
          family: msg.family || 'IPv4',
          port: msg.port,
          size: buffer.length,
        };
        this.emit('message', buffer, rinfo);
      } catch (err) {
        this.emit('error', err);
      }
    };

    this._eventSource.onerror = (err) => {
      this.emit('error', new Error('SSE connection error'));
    };
  }

  send(
    msg: Buffer | Uint8Array | string,
    port: number,
    address: string,
    callback?: (err: Error | null, bytes?: number) => void
  ): void;
  send(
    msg: Buffer | Uint8Array | string,
    offset: number,
    length: number,
    port: number,
    address: string,
    callback?: (err: Error | null, bytes?: number) => void
  ): void;
  send(msg: any, offset: any, length?: any, port?: any, address?: any, callback?: any): void {
    let msgBuffer: Buffer;
    let sendOffset = 0;
    let sendLength: number;
    let sendPort: number;
    let sendAddress: string;
    let sendCallback: ((err: Error | null, bytes?: number) => void) | undefined;

    // Normalize arguments (dgram has complex overloads)
    if (typeof offset === 'number' && typeof length === 'number') {
      // send(msg, offset, length, port, address, callback)
      msgBuffer = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
      sendOffset = offset;
      sendLength = length;
      sendPort = port;
      sendAddress = address;
      sendCallback = callback;
    } else {
      // send(msg, port, address, callback)
      msgBuffer = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
      sendLength = msgBuffer.length;
      sendPort = offset;
      sendAddress = length;
      sendCallback = port;
    }

    this._doSend(msgBuffer, sendOffset, sendLength, sendPort, sendAddress, sendCallback);
  }

  private async _doSend(
    msg: Buffer,
    offset: number,
    length: number,
    port: number,
    address: string,
    callback?: (err: Error | null, bytes?: number) => void
  ): Promise<void> {
    if (!this._socketId) {
      const err = new Error('Socket not bound');
      if (callback) callback(err);
      else this.emit('error', err);
      return;
    }

    try {
      const data = msg.slice(offset, offset + length);

      const res = await fetch(`${GATEWAY_URL}/api/dgram/send/${this._socketId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Caller-ID': (globalThis as any).__REMODL_CALLER_ID__ || 'unknown',
        },
        body: JSON.stringify({
          data: Array.from(data),
          port,
          address,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Send failed');
      }

      if (callback) callback(null, length);
    } catch (err) {
      if (callback) callback(err as Error);
      else this.emit('error', err);
    }
  }

  close(callback?: () => void): void {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }

    if (this._socketId) {
      fetch(`${GATEWAY_URL}/api/dgram/close/${this._socketId}`, {
        method: 'POST',
        headers: {
          'X-Caller-ID': (globalThis as any).__REMODL_CALLER_ID__ || 'unknown',
        },
      }).catch(() => {});

      this._socketId = null;
    }

    if (callback) {
      this.once('close', callback);
    }
    this.emit('close');
  }

  address(): { address: string; family: string; port: number } | Record<string, never> {
    return this._address || {};
  }

  // Configuration methods (mostly no-ops in browser)
  setBroadcast(flag: boolean): void {
    // No-op
  }

  setTTL(ttl: number): void {
    // No-op
  }

  setMulticastTTL(ttl: number): void {
    // No-op
  }

  setMulticastLoopback(flag: boolean): void {
    // No-op
  }

  addMembership(multicastAddress: string, multicastInterface?: string): void {
    // No-op
  }

  dropMembership(multicastAddress: string, multicastInterface?: string): void {
    // No-op
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}

export function createSocket(type: 'udp4' | 'udp6', callback?: (msg: Buffer, rinfo: RemoteInfo) => void): Socket;
export function createSocket(options: UdpSocketOptions, callback?: (msg: Buffer, rinfo: RemoteInfo) => void): Socket;
export function createSocket(
  type: 'udp4' | 'udp6' | UdpSocketOptions,
  callback?: (msg: Buffer, rinfo: RemoteInfo) => void
): Socket {
  const socketType = typeof type === 'string' ? type : type.type;
  return new Socket(socketType, callback);
}

export { Socket };

export default {
  createSocket,
  Socket,
};
