import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten"

export class HTTPModule {
    private context: QuickJSContext
    private requestHandler?: (req: Request) => Promise<Response>
    private onServerStart: (port: number) => void

    constructor(context: QuickJSContext, onServerStart: (port: number) => void) {
        this.context = context
        this.onServerStart = onServerStart
    }

    setupHttpModule(): QuickJSHandle {

        const httpModule = this.context.newObject()

        // Create Server class that supports chaining
        const serverClass = this.context.newFunction("Server", () => {
            const server = this.context.newObject()

            // Implement server.listen() with chaining
            const listenFn = this.context.newFunction("listen", (portHandle, hostHandle, callbackHandle) => {
                try {
                    let callback = callbackHandle;
                    if (!callback && typeof hostHandle !== 'undefined' &&
                        this.context.typeof(hostHandle) === 'function') {
                        callback = hostHandle;
                    }

                    const port = this.context.getNumber(portHandle);
                    this.onServerStart(port)
                    if (callback && callback !== this.context.undefined) {
                        this.context.callFunction(callback, this.context.undefined, []);
                    }

                    return server;
                } catch (error) {
                    console.error('Error in listen():', error);
                    return server;
                }
            })
            this.context.setProp(server, "listen", listenFn)
            listenFn.dispose()

            // Implement write() method with proper error handling
            const writeFn = this.context.newFunction("write", (chunk) => {
                try {
                    let content = '';
                    if (this.context.typeof(chunk) === 'object') {
                        content = JSON.stringify(this.context.dump(chunk));
                    } else {
                        content = this.context.getString(chunk);
                    }
                    return this.context.newString(content);
                } catch (error) {
                    console.error('Error in write():', error);
                    return this.context.newString('');
                }
            })

            // Implement end() method with proper cleanup
            const endFn = this.context.newFunction("end", (chunk) => {
                if (chunk) {
                    const writeResult = this.context.callFunction(writeFn, server, [chunk]);
                    if (!writeResult.error) {
                        writeResult.value.dispose();
                    }
                }
                return this.context.undefined;
            })

            // Store these methods to be used when creating response objects
            this.context.setProp(server, "__writeImpl", writeFn)
            this.context.setProp(server, "__endImpl", endFn)
            writeFn.dispose()
            endFn.dispose()

            return server
        })

        // Create http.createServer() that supports both callback and chaining
        const createServerFn = this.context.newFunction("createServer", (handler) => {
            // Properly handle the server creation result
            const serverResult = this.context.callFunction(serverClass, this.context.undefined, []);
            if (serverResult.error) {
                // Handle error case
                console.error('Failed to create server:', this.context.dump(serverResult.error));
                return this.context.undefined;
            }
            const server = serverResult.value;

            if (handler) {
                this.requestHandler = async (req: Request): Promise<Response> => {
                    // Create request object with all necessary properties
                    const reqObj = this.context.newObject()
                    this.context.setProp(reqObj, "method", this.context.newString(req.method))
                    this.context.setProp(reqObj, "url", this.context.newString(req.url))

                    // Handle headers
                    // If using standard Request type:
                    const headers = this.context.newObject()
                    if (req.headers instanceof Headers) {
                        // Using Headers object
                        req.headers.forEach((value, key) => {
                            this.context.setProp(headers, key.toLowerCase(), this.context.newString(value))
                        })
                    } else if (typeof req.headers === 'object') {
                        // Using plain object
                        for (const [key, value] of Object.entries(req.headers)) {
                            this.context.setProp(headers, key.toLowerCase(), this.context.newString(value as string))
                        }
                    }
                    this.context.setProp(reqObj, "headers", headers)
                    headers.dispose()

                    // Create response object
                    let responseBody = ''
                    let statusCode = 200
                    const responseHeaders: Record<string, string> = {}

                    const resObj = this.context.newObject()

                    // Implement res.writeHead()
                    const writeHeadFn = this.context.newFunction("writeHead", (code, headers) => {
                        statusCode = this.context.getNumber(code)
                        if (headers) {
                            const headerObj = this.context.dump(headers) as Record<string, string>
                            Object.assign(responseHeaders, headerObj)
                        }
                        return resObj
                    })
                    this.context.setProp(resObj, "writeHead", writeHeadFn)
                    writeHeadFn.dispose()

                    // Implement res.write()
                    const writeImpl = this.context.getProp(server, "__writeImpl")
                    const writeFn = this.context.newFunction("write", (chunk) => {
                        const result = this.context.callFunction(writeImpl, resObj, [chunk])
                        if (!result.error) {
                            responseBody += this.context.getString(result.value)
                            result.value.dispose()
                        }
                        return resObj
                    })
                    this.context.setProp(resObj, "write", writeFn)
                    writeFn.dispose()
                    writeImpl.dispose()

                    // Implement res.end()
                    const endImpl = this.context.getProp(server, "__endImpl")
                    const responsePromise = new Promise<Response>(resolve => {
                        const endFn = this.context.newFunction("end", (chunk) => {
                            if (chunk) {
                                const result = this.context.callFunction(writeImpl, resObj, [chunk])
                                if (!result.error) {
                                    responseBody += this.context.getString(result.value)
                                    result.value.dispose()
                                }
                            }

                            resolve(new Response(responseBody, {
                                status: statusCode,
                                headers: responseHeaders
                            }))

                            return this.context.callFunction(endImpl, resObj, [])
                        })
                        this.context.setProp(resObj, "end", endFn)
                        endFn.dispose()
                    })
                    endImpl.dispose()

                    try {
                        // Call the handler
                        this.context.callFunction(handler, this.context.undefined, [reqObj, resObj])
                    } finally {
                        // Ensure cleanup happens even if handler throws
                        reqObj.dispose()
                        resObj.dispose()
                    }

                    return responsePromise
                }
            }

            return server
        })

        this.context.setProp(httpModule, "createServer", createServerFn)
        createServerFn.dispose()
        serverClass.dispose()

        return httpModule
    }

    async handleRequest(req: Request): Promise<Response> {
        if (!this.requestHandler) {
            throw new Error("No request handler registered")
        }
        return this.requestHandler(req)
    }
}
