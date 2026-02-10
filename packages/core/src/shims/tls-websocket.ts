/**
 * TLS module shim using WebSocket for secure socket streaming.
 *
 * Extends net.Socket with TLS-specific features.
 * Gateway handles TLS handshake and encryption server-side.
 */

import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
import * as net from './net-websocket';

const GATEWAY_WS = process.env.GATEWAY_WS_URL || 'ws://localhost:8000';

interface TlsOptions {
  host?: string;
  port: number;
  servername?: string;
  rejectUnauthorized?: boolean;
  ca?: string | Buffer | Array<string | Buffer>;
  cert?: string | Buffer;
  key?: string | Buffer;
  minVersion?: string;
  maxVersion?: string;
}

export class TLSSocket extends net.Socket {
  public authorized: boolean = false;
  public authorizationError: Error | null = null;
  public encrypted: boolean = true;

  private _tlsOptions: TlsOptions = {} as TlsOptions;
  private _peerCertificate: any = null;
  private _cipher: any = null;
  private _protocol: string | null = null;

  constructor(socket?: net.Socket, options?: TlsOptions) {
    super();
    if (options) {
      this._tlsOptions = options;
    }
  }

  getPeerCertificate(detailed?: boolean): any {
    return this._peerCertificate || {};
  }

  getCipher(): any {
    return this._cipher || {
      name: 'TLS_AES_256_GCM_SHA384',
      version: 'TLSv1.3'
    };
  }

  getProtocol(): string {
    return this._protocol || 'TLSv1.3';
  }

  getSession(): Buffer | undefined {
    // Session resumption not supported in browser proxy
    return undefined;
  }

  isSessionReused(): boolean {
    return false;
  }

  renegotiate(options: any, callback?: (err: Error | null) => void): boolean {
    if (callback) {
      callback(new Error('Renegotiation not supported'));
    }
    return false;
  }

  setMaxSendFragment(size: number): boolean {
    // No-op in proxy mode
    return true;
  }
}

export function connect(port: number, host?: string, options?: TlsOptions, callback?: () => void): TLSSocket;
export function connect(port: number, options?: TlsOptions, callback?: () => void): TLSSocket;
export function connect(options: TlsOptions, callback?: () => void): TLSSocket;
export function connect(port: number | TlsOptions, host?: string | TlsOptions | (() => void), options?: TlsOptions | (() => void), callback?: () => void): TLSSocket {
  let tlsOptions: TlsOptions;
  let connectCallback: (() => void) | undefined;

  // Normalize arguments
  if (typeof port === 'object') {
    tlsOptions = port;
    connectCallback = host as (() => void) | undefined;
  } else {
    if (typeof host === 'object') {
      tlsOptions = { ...host, port };
      connectCallback = options as (() => void) | undefined;
    } else {
      tlsOptions = {
        port,
        host: host as string | undefined,
        ...(typeof options === 'object' ? options : {}),
      };
      connectCallback = typeof options === 'function' ? options : callback;
    }
  }

  const socket = new TLSSocket(undefined, tlsOptions);

  if (connectCallback) {
    socket.once('secureConnect', connectCallback);
  }

  (async () => {
    try {
      // Generate socket ID
      const socketId = `tls-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Connect via WebSocket
      const ws = new WebSocket(`${GATEWAY_WS}/ws/tls/${socketId}`);

      (socket as any)._ws = ws;
      (socket as any)._socketId = socketId;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'connect',
          host: tlsOptions.host || tlsOptions.servername || 'localhost',
          port: tlsOptions.port,
          servername: tlsOptions.servername,
          rejectUnauthorized: tlsOptions.rejectUnauthorized !== false,
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case 'secureConnect':
              socket.connecting = false;
              socket.authorized = msg.authorized ?? false;
              socket.authorizationError = msg.authorizationError ? new Error(msg.authorizationError) : null;
              (socket as any)._peerCertificate = msg.peerCertificate;
              (socket as any)._cipher = msg.cipher;
              (socket as any)._protocol = msg.protocol;
              socket.emit('secureConnect');
              socket.emit('connect');
              break;

            case 'data':
              const buffer = Buffer.from(msg.data);
              socket.emit('data', buffer);
              break;

            case 'end':
              socket.readable = false;
              socket.emit('end');
              break;

            case 'close':
              socket.destroyed = true;
              socket.readable = false;
              socket.writable = false;
              socket.emit('close', msg.hadError || false);
              break;

            case 'error':
              socket.emit('error', new Error(msg.message || 'TLS socket error'));
              break;
          }
        } catch (err) {
          socket.emit('error', err);
        }
      };

      ws.onerror = () => {
        socket.connecting = false;
        socket.emit('error', new Error('TLS WebSocket connection failed'));
      };

      ws.onclose = () => {
        if (!socket.destroyed) {
          socket.destroyed = true;
          socket.readable = false;
          socket.writable = false;
          socket.emit('close', false);
        }
      };
    } catch (err) {
      socket.emit('error', err);
    }
  })();

  return socket;
}

export function createServer(options?: any, secureConnectionListener?: (socket: TLSSocket) => void): never {
  throw new Error('TLS server not supported in browser');
}

export function createSecureContext(options?: any): any {
  // Return options as-is (server-side will handle)
  return options || {};
}

export default {
  connect,
  createServer,
  createSecureContext,
  TLSSocket,
};
