import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

interface SocketEventHandlers {
    data: Array<(chunk: string) => void>
    end: Array<() => void>
    close: Array<() => void>
    error: Array<(error: Error) => void>
}

interface Socket {
    id: string
    eventHandlers: SocketEventHandlers
    remoteAddress: string
    remotePort: number
    localAddress: string
    localPort: number
    destroyed: boolean
}

interface ResponseEventHandlers {
    data: Array<(chunk: string) => void>
    end: Array<() => void>
}

export class MockNetworkSystem {
    private servers: Map<string, any> = new Map()
    private sockets: Map<string, Socket> = new Map()
    private context: QuickJSContext
    private nextSocketId: number = 1

    constructor(context: QuickJSContext) {
        this.context = context
    }

    createNetModule(): QuickJSHandle {
        const netModule = this.context.newObject()

        // Create TCP server
        const createServerHandle = this.context.newFunction("createServer", (optionsOrCallback: QuickJSHandle) => {
            const serverObj = this.context.newObject()
            let connectionCallback: QuickJSHandle | null = null

            // Handle both variants: createServer(callback) and createServer(options, callback)
            if (this.context.typeof(optionsOrCallback) === 'function') {
                connectionCallback = optionsOrCallback
            }
            // Server listen method
            const listenHandle = this.context.newFunction("listen", (portHandle, hostHandle, backlogOrCallback) => {
                const port = this.context.getNumber(portHandle)
                const host = (hostHandle && hostHandle !== this.context.undefined)
                    ? this.context.getString(hostHandle)
                    : 'localhost'

                let callback = backlogOrCallback
                if (this.context.typeof(hostHandle) === 'function') {
                    callback = hostHandle
                }

                this.servers.set(`${host}:${port}`, {
                    port,
                    host,
                    connectionCallback
                })

                if (callback && callback !== this.context.undefined) {
                    this.context.callFunction(callback, serverObj, [])
                }

                return serverObj
            })
            this.context.setProp(serverObj, "listen", listenHandle)
            listenHandle.dispose()

            // Close method
            const closeHandle = this.context.newFunction("close", (callbackHandle) => {
                // Clean up server
                const serverKey = Array.from(this.servers.entries())
                    .find(([_, server]) => server.connectionCallback === connectionCallback)?.[0]

                if (serverKey) {
                    this.servers.delete(serverKey)
                }

                if (callbackHandle && callbackHandle !== this.context.undefined) {
                    this.context.callFunction(callbackHandle, serverObj, [])
                }

                return serverObj
            })
            this.context.setProp(serverObj, "close", closeHandle)
            closeHandle.dispose()

            return serverObj
        })

        this.context.setProp(netModule, "createServer", createServerHandle)
        createServerHandle.dispose()

        // Add net.connect/createConnection methods
        const connectHandle = this.context.newFunction("connect", (options, connectListener) => {
            const opts = this.context.dump(options) as any
            const port = typeof opts === 'number' ? opts : opts.port
            const host = typeof opts === 'string' ? opts : (opts.host || 'localhost')

            const serverKey = `${host}:${port}`
            const server = this.servers.get(serverKey)

            if (!server) {
                throw new Error(`Cannot connect to ${serverKey}: no server listening`)
            }

            // Create client socket
            const clientLocalPort = 49152 + Math.floor(Math.random() * 16384)
            const { socketObj: clientSocket, socket: clientSocketData } = this.createSocketObj(
                host,
                port,
                'localhost',
                clientLocalPort
            )

            // Create server-side socket
            const { socketObj: serverSocket, socket: serverSocketData } = this.createSocketObj(
                'localhost',
                clientLocalPort,
                host,
                port
            )

            // Link the sockets for bidirectional communication
            const linkSockets = (source: Socket, target: Socket) => {
                source.eventHandlers.data = source.eventHandlers.data.concat(
                    (data: string) => target.eventHandlers.data.forEach(h => h(data))
                )
                source.eventHandlers.end = source.eventHandlers.end.concat(
                    () => target.eventHandlers.end.forEach(h => h())
                )
                source.eventHandlers.close = source.eventHandlers.close.concat(
                    () => target.eventHandlers.close.forEach(h => h())
                )
                source.eventHandlers.error = source.eventHandlers.error.concat(
                    (err: Error) => target.eventHandlers.error.forEach(h => h(err))
                )
            }

            linkSockets(clientSocketData, serverSocketData)
            linkSockets(serverSocketData, clientSocketData)

            // If server has connection callback, call it with server socket
            if (server.connectionCallback) {
                this.context.callFunction(server.connectionCallback, this.context.undefined, [serverSocket])
            }

            // Call connect listener if provided
            if (connectListener && connectListener !== this.context.undefined) {
                this.context.callFunction(connectListener, clientSocket, [])
            }

            serverSocket.dispose()
            return clientSocket
        })

        this.context.setProp(netModule, "connect", connectHandle)
        this.context.setProp(netModule, "createConnection", connectHandle)
        connectHandle.dispose()

        return netModule
    }
    createHttpModule(): QuickJSHandle {
        const httpModule = this.context.newObject()

        // Create HTTP server
        const createServerHandle = this.context.newFunction("createServer", (handlerHandle) => {
            const serverObj = this.context.newObject()

            // Add listen method
            const listenHandle = this.context.newFunction("listen", (portHandle, callbackHandle) => {
                const port = this.context.getNumber(portHandle)
                const host = 'localhost'

                this.servers.set(`${host}:${port}`, {
                    port,
                    host,
                    requestHandler: (req: any): any => {
                        // Create request object
                        const reqObj = this.context.newObject()
                        this.context.setProp(reqObj, "method", this.context.newString(req.method))
                        this.context.setProp(reqObj, "url", this.context.newString(req.url))

                        const headersObj = this.context.newObject()
                        for (const [key, value] of Object.entries(req.headers)) {
                            this.context.setProp(headersObj, key, this.context.newString(value as string))
                        }
                        this.context.setProp(reqObj, "headers", headersObj)
                        headersObj.dispose()

                        // Create response object with real event handling
                        const resObj = this.context.newObject()
                        const eventHandlers: ResponseEventHandlers = {
                            data: [],
                            end: []
                        }

                        // Create 'on' method for response
                        const onHandle = this.context.newFunction("on", (eventHandle, listenerHandle) => {
                            const event = this.context.getString(eventHandle)
                            if (event === 'data') {
                                eventHandlers.data.push((chunk: string) => {
                                    const chunkHandle = this.context.newString(chunk)
                                    this.context.callFunction(listenerHandle, resObj, [chunkHandle])
                                    chunkHandle.dispose()
                                })
                            } else if (event === 'end') {
                                eventHandlers.end.push(() => {
                                    this.context.callFunction(listenerHandle, resObj, [])
                                })
                            }
                            return resObj
                        })
                        this.context.setProp(resObj, "on", onHandle)
                        onHandle.dispose()

                        // Create writeHead method
                        const writeHeadHandle = this.context.newFunction("writeHead", (statusHandle, headersHandle) => {
                            const status = this.context.getNumber(statusHandle)
                            const headers = this.context.dump(headersHandle)

                            this.context.setProp(resObj, "statusCode", this.context.newNumber(status))
                            const responseHeadersObj = this.context.newObject()
                            for (const [key, value] of Object.entries(headers)) {
                                this.context.setProp(responseHeadersObj, key, this.context.newString(value as string))
                            }
                            this.context.setProp(resObj, "headers", responseHeadersObj)
                            responseHeadersObj.dispose()

                            return resObj
                        })
                        this.context.setProp(resObj, "writeHead", writeHeadHandle)
                        writeHeadHandle.dispose()

                        // Create write method - triggers 'data' event
                        const writeHandle = this.context.newFunction("write", (dataHandle) => {
                            const chunk = this.context.getString(dataHandle)
                            // Fire 'data' event for each registered handler
                            eventHandlers.data.forEach(handler => handler(chunk))
                            return resObj
                        })
                        this.context.setProp(resObj, "write", writeHandle)
                        writeHandle.dispose()

                        // Create end method - triggers final 'data' event if data provided and 'end' event
                        const endHandle = this.context.newFunction("end", (dataHandle) => {
                            if (dataHandle) {
                                const finalChunk = this.context.getString(dataHandle)
                                eventHandlers.data.forEach(handler => handler(finalChunk))
                            }
                            // Fire 'end' event for each registered handler
                            eventHandlers.end.forEach(handler => handler())
                            return resObj
                        })
                        this.context.setProp(resObj, "end", endHandle)
                        endHandle.dispose()

                        // Call the server's request handler
                        this.context.callFunction(handlerHandle, this.context.undefined, [reqObj, resObj])

                        reqObj.dispose()
                        resObj.dispose()
                    }
                })

                if (callbackHandle && callbackHandle !== this.context.undefined) {
                    this.context.callFunction(callbackHandle, serverObj, [])
                }

                return serverObj
            })

            this.context.setProp(serverObj, "listen", listenHandle)
            listenHandle.dispose()

            return serverObj
        })

        this.context.setProp(httpModule, "createServer", createServerHandle)
        createServerHandle.dispose()

        // Add http.request implementation
        const requestHandle = this.context.newFunction("request", (optionsHandle, callbackHandle) => {
            const options = this.context.dump(optionsHandle) as any
            const serverKey = `${options.hostname || 'localhost'}:${options.port}`
            const server = this.servers.get(serverKey)

            if (!server) {
                const errorObj = this.context.newError(`No server listening on ${serverKey}`)
                this.context.callFunction(callbackHandle, this.context.undefined, [errorObj])
                errorObj.dispose()
                return
            }

            // Create response object first
            const responseObj = this.context.newObject()
            const eventHandlers: ResponseEventHandlers = {
                data: [],
                end: []
            }

            // Add response event handling
            const onHandle = this.context.newFunction("on", (eventHandle, listenerHandle) => {
                const event = this.context.getString(eventHandle)
                if (event === 'data') {
                    eventHandlers.data.push((chunk: string) => {
                        const chunkHandle = this.context.newString(chunk)
                        this.context.callFunction(listenerHandle, responseObj, [chunkHandle])
                        chunkHandle.dispose()
                    })
                } else if (event === 'end') {
                    eventHandlers.end.push(() => {
                        this.context.callFunction(listenerHandle, responseObj, [])
                    })
                }
                return responseObj
            })
            this.context.setProp(responseObj, "on", onHandle)
            onHandle.dispose()

            // Call server handler with request tracking
            server.requestHandler({
                method: options.method || 'GET',
                url: `http://${options.hostname || 'localhost'}:${options.port}${options.path || '/'}`,
                headers: options.headers || {}
            })

            // Call the callback with the response object
            this.context.callFunction(callbackHandle, this.context.undefined, [responseObj])
            responseObj.dispose()
        })

        this.context.setProp(httpModule, "request", requestHandle)
        requestHandle.dispose()

        return httpModule
    }
    private createSocketObj(
        remoteAddress: string,
        remotePort: number,
        localAddress: string,
        localPort: number
    ): { socketObj: QuickJSHandle, socket: Socket } {
        const socketId = `socket_${this.nextSocketId++}`
        const socketObj = this.context.newObject()

        // Initialize socket data
        const socket: Socket = {
            id: socketId,
            eventHandlers: {
                data: [],
                end: [],
                close: [],
                error: []
            },
            remoteAddress,
            remotePort,
            localAddress,
            localPort,
            destroyed: false
        }

        this.sockets.set(socketId, socket)

        // Add socket properties
        this.context.setProp(socketObj, "remoteAddress", this.context.newString(remoteAddress))
        this.context.setProp(socketObj, "remotePort", this.context.newNumber(remotePort))
        this.context.setProp(socketObj, "localAddress", this.context.newString(localAddress))
        this.context.setProp(socketObj, "localPort", this.context.newNumber(localPort))

        // Add socket methods
        const onHandle = this.context.newFunction("on", (eventHandle, listenerHandle) => {
            const event = this.context.getString(eventHandle)

            switch (event) {
                case 'data':
                    socket.eventHandlers.data.push((chunk: string) => {
                        const chunkHandle = this.context.newString(chunk)
                        this.context.callFunction(listenerHandle, socketObj, [chunkHandle])
                        chunkHandle.dispose()
                    })
                    break
                case 'end':
                    socket.eventHandlers.end.push(() => {
                        this.context.callFunction(listenerHandle, socketObj, [])
                    })
                    break
                case 'close':
                    socket.eventHandlers.close.push(() => {
                        this.context.callFunction(listenerHandle, socketObj, [])
                    })
                    break
                case 'error':
                    socket.eventHandlers.error.push((error: Error) => {
                        const errorHandle = this.context.newError(error.message)
                        this.context.callFunction(listenerHandle, socketObj, [errorHandle])
                        errorHandle.dispose()
                    })
                    break
            }
            return socketObj
        })
        this.context.setProp(socketObj, "on", onHandle)
        onHandle.dispose()

        // Write method
        const writeHandle = this.context.newFunction("write", (dataHandle, encodingHandle, callbackHandle) => {
            const data = this.context.getString(dataHandle)

            // Simulate some basic backpressure
            const highWaterMark = 16384 // 16KB
            const shouldApplyBackpressure = data.length > highWaterMark

            // Schedule the write asynchronously
            setTimeout(() => {
                socket.eventHandlers.data.forEach(handler => handler(data))
                if (callbackHandle && callbackHandle !== this.context.undefined) {
                    this.context.callFunction(callbackHandle, socketObj, [])
                }
            }, 0)

            return (!shouldApplyBackpressure)? this.context.true : this.context.false 
        })
        this.context.setProp(socketObj, "write", writeHandle)
        writeHandle.dispose()

        // End method
        const endHandle = this.context.newFunction("end", (dataHandle) => {
            if (dataHandle && dataHandle !== this.context.undefined) {
                const finalData = this.context.getString(dataHandle)
                socket.eventHandlers.data.forEach(handler => handler(finalData))
            }

            socket.eventHandlers.end.forEach(handler => handler())
            socket.eventHandlers.close.forEach(handler => handler())
            socket.destroyed = true

            return socketObj
        })
        this.context.setProp(socketObj, "end", endHandle)
        endHandle.dispose()

        // Destroy method
        const destroyHandle = this.context.newFunction("destroy", (errorHandle) => {
            if (errorHandle && errorHandle !== this.context.undefined) {
                const error = new Error(this.context.getString(errorHandle))
                socket.eventHandlers.error.forEach(handler => handler(error))
            }

            socket.destroyed = true
            socket.eventHandlers.close.forEach(handler => handler())
            this.sockets.delete(socketId)

            return socketObj
        })
        this.context.setProp(socketObj, "destroy", destroyHandle)
        destroyHandle.dispose()

        return { socketObj, socket }
    }

    dispose() {
        this.servers.clear()
        this.sockets.clear()
    }
}
