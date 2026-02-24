import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten"

interface HttpServer {
    handlerFn: string
    requestHandlers: Set<Function>
}

interface PendingRequest {
    resolve: (response: any) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
}

/**
 * HTTPMock provides HTTP server mocking capabilities within a QuickJS context.
 * It allows intercepting and handling HTTP requests in an isolated environment.
 */
export class HTTPModule {
    private httpServers = new Map<number, HttpServer>()
    private pendingRequests = new Map<string, PendingRequest>()
    private registarServer: (pid: number, port: number) => void
    constructor(
        private context: QuickJSContext,
        onServerStart: (pid: number, port: number) => void,
        private pid: number,
    ) {
        this.registarServer = onServerStart
        this.setupHttp()
    }

    private setupHttp() {
        // Initialize the HTTP module structure in QuickJS
        const httpModuleCode = `
      const originalRequire = require;
      
      // Server registry to track all created HTTP servers
      globalThis.__httpServers = new Map();

      const httpModule = {
        createServer(handler) {
          const server = {
            handlers: new Set(),
            
            on(event, fn) {
              if (event === 'request') {
                this.handlers.add(fn);
              }
              return this;
            },

            listen(port, callback) {
              // Register server handlers with global registry
              globalThis.__registerHttpServer(port, this.handlers);
              
              if (typeof callback === 'function') {
                callback();
              }
              return this;
            }
          };

          if (typeof handler === 'function') {
            server.on('request', handler);
          }

          return server;
        }
      };

      // Override require to provide mock HTTP module
      globalThis.require = function(module) {
        if (module === 'http') {
          return httpModule;
        }
        return originalRequire(module);
      };
    `
        this.context.evalCode(httpModuleCode)

        // Setup server registration handler
        this.setupServerRegistration()

        // Setup response handling infrastructure
        this.setupResponseHandling()
    }

    private setupServerRegistration() {
        const registerServer = this.context.newFunction(
            "__registerHttpServer",
            (portHandle: QuickJSHandle, handlersHandle: QuickJSHandle) => {
                try {
                    const port = this.context.getNumber(portHandle)
                    const handlers = new Set<Function>()

                    this.httpServers.set(port, {
                        handlerFn: `__httpHandlers_${port}`,
                        requestHandlers: handlers
                    })

                    // Register with container
                    this.registarServer(this.pid, port)

                    return this.context.undefined
                } catch (error) {
                    console.error('Error registering server:', error)
                    throw error
                }
            }
        )

        this.context.setProp(this.context.global, "__registerHttpServer", registerServer)
        registerServer.dispose()
    }

    private setupResponseHandling() {
        // Setup response and request classes in QuickJS
        const responseCode = `
      class ServerResponse {
        constructor(requestId) {
          this.requestId = requestId;
          this.statusCode = 200;
          this.headers = {};
          this._chunks = [];
          this._ended = false;
        }

        writeHead(status, headers) {
          if (!this._ended) {
            this.statusCode = status;
            if (headers) {
              Object.assign(this.headers, headers);
            }
          }
          return this;
        }

        setHeader(name, value) {
          if (!this._ended) {
            this.headers[name] = value;
          }
          return this;
        }

        write(chunk) {
          if (!this._ended && chunk != null) {
            this._chunks.push(String(chunk));
          }
          return true;
        }

        end(data) {
          if (!this._ended) {
            if (data != null) {
              this.write(data);
            }
            this._ended = true;
            
            globalThis.__sendResponse(this.requestId, {
              statusCode: this.statusCode,
              headers: this.headers,
              body: this._chunks.join('')
            });
          }
        }
      }

      class IncomingMessage {
        constructor(method, url, headers, body) {
          this.method = method;
          this.url = url;
          this.headers = headers;
          this.body = body;
        }
      }

      globalThis.ServerResponse = ServerResponse;
      globalThis.IncomingMessage = IncomingMessage;
    `
        this.context.evalCode(responseCode)

        // Setup response sender
        const sendResponse = this.context.newFunction(
            "__sendResponse",
            (requestIdHandle: QuickJSHandle, responseDataHandle: QuickJSHandle) => {
                try {
                    const requestId = this.context.getString(requestIdHandle)
                    const responseData = this.context.dump(responseDataHandle)

                    const pending = this.pendingRequests.get(requestId)
                    if (pending) {
                        clearTimeout(pending.timeout)
                        pending.resolve(responseData)
                        this.pendingRequests.delete(requestId)
                    }

                    return this.context.undefined
                } catch (error) {
                    console.error('Error sending response:', error)
                    throw error
                }
            }
        )

        this.context.setProp(this.context.global, "__sendResponse", sendResponse)
        sendResponse.dispose()
    }

    async handleHttpRequest(request: Request): Promise<Response> {
        const url = new URL(request.url)
        const port = parseInt(url.port) || 80

        const server = this.httpServers.get(port)
        if (!server) {
            return new Response(`No server listening on port ${port}`, { status: 404 })
        }

        const requestId = Math.random().toString(36).slice(2)

        try {
            const responsePromise = new Promise<any>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    const pending = this.pendingRequests.get(requestId)
                    if (pending) {
                        this.pendingRequests.delete(requestId)
                        reject(new Error('Request timeout after 30 seconds'))
                    }
                }, 30000)

                this.pendingRequests.set(requestId, { resolve, reject, timeout })
            })

            const body = request.body ? await request.text() : undefined
            const result = this.context.evalCode(`
        (() => {
          try {
            const req = new IncomingMessage(
              ${JSON.stringify(request.method)},
              ${JSON.stringify(url.pathname + url.search)},
              ${JSON.stringify(this.getHeaders(request.headers))},
              ${body ? JSON.stringify(body) : 'undefined'}
            );
            const res = new ServerResponse(${JSON.stringify(requestId)});

            const server = globalThis.__httpServers.get(${port});
            if (server && server.handlers) {
              for (const handler of server.handlers) {
                handler(req, res);
              }
            }

            return { success: true };
          } catch (error) {
            return { 
              success: false, 
              error: error?.message || 'Unknown error'
            };
          }
        })()
      `)

            if (result.error) {
                throw this.context.dump(result.error)
            }

            const response = await responsePromise
            return new Response(response.body, {
                status: response.statusCode,
                headers: response.headers
            })

        } catch (error:any) {
            console.error('Error handling request:', error)
            return new Response(
                `Internal server error: ${error.message}`,
                { status: 500, headers: { 'Content-Type': 'text/plain' } }
            )
        }
    }

    private getHeaders(headers: Record<string, string> | Headers) {
        // Handle headers
        // If using standard Request type:
        let newHeaders:any = {}
        if (headers instanceof Headers) {
            // Using Headers object
            headers.forEach((value, key) => {
                newHeaders[key.toLowerCase() as string] =value
            })
        } else if (typeof headers === 'object') {
            // Using plain object
            for (const [key, value] of Object.entries(headers)) {
                newHeaders[key.toLowerCase() as string] = value as string
            }
        }
    }

    /**
     * Cleans up any remaining pending requests and server registrations
     */
    dispose() {
        // Clear all pending requests
        for (const [requestId, pending] of this.pendingRequests.entries()) {
            clearTimeout(pending.timeout)
            pending.reject(new Error('HTTP Mock disposed'))
            this.pendingRequests.delete(requestId)
        }

        // Clear server registrations
        this.httpServers.clear()
    }
}
