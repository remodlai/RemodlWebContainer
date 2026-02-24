import type {
    WorkerMessage,
    WorkerResponse,
    WorkerInitOptions,
    WorkerResponseMessage
} from './types';

const LOG_PREFIX = '[WorkerBridge]';

export interface MessageHandler {
    (message: Omit<WorkerResponse, "id">): void;
}

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: number;
    sentAt: number;
    messageType: string;
}

export class WorkerBridge {
    private worker: Worker|undefined;
    private messageHandlers: Set<MessageHandler> = new Set();
    private pendingRequests: Map<string, PendingRequest> = new Map();
    private nextRequestId: number = 0;
    private initialized: boolean = false;
    private defaultTimeout: number = 30000;
    private baseUrl?: string;
    private bootTime?: number;

    constructor(baseUrl?: string) {
        console.log(`${LOG_PREFIX} constructor called`, { baseUrl, workerSupported: typeof Worker !== 'undefined' });
        if (typeof Worker === 'undefined') {
            throw new Error('Web Workers are not supported in this environment');
        }
        this.baseUrl = baseUrl;
    }
    async initialize(options: WorkerInitOptions): Promise<void> {
        console.log(`${LOG_PREFIX} initialize() called`, { alreadyInitialized: this.initialized, options });
        if (this.initialized) {
            throw new Error('Worker already initialized');
        }
        await this.boot();

        console.log(`${LOG_PREFIX} sending 'initialize' message to worker...`);
        const initStart = performance.now();
        await this.sendMessage({
            type: 'initialize',
            payload: options
        });
        console.log(`${LOG_PREFIX} worker initialized in ${(performance.now() - initStart).toFixed(1)}ms`);

        this.initialized = true;
    }

    async sendMessage(
        message: WorkerMessage,
        timeout: number = this.defaultTimeout
    ): Promise<WorkerResponseMessage> {
        if (!this.worker) {
            console.error(`${LOG_PREFIX} sendMessage() called but worker is not created`);
            throw new Error('Worker not initialized');
        }

        const id = (this.nextRequestId++).toString();
        console.log(`${LOG_PREFIX} sendMessage [${id}] type=${message.type}`, {
            payloadKeys: message.payload ? Object.keys(message.payload) : [],
            timeout,
            pendingCount: this.pendingRequests.size
        });

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                const pending = this.pendingRequests.get(id);
                const elapsed = pending ? (performance.now() - pending.sentAt).toFixed(1) : '?';
                console.error(`${LOG_PREFIX} TIMEOUT [${id}] type=${message.type} after ${elapsed}ms (limit: ${timeout}ms)`, {
                    pendingCount: this.pendingRequests.size,
                    allPending: Array.from(this.pendingRequests.entries()).map(([k, v]) => ({
                        id: k, type: v.messageType, age: (performance.now() - v.sentAt).toFixed(1) + 'ms'
                    }))
                });
                this.pendingRequests.delete(id);
                reject(new Error(`Request timeout after ${timeout}ms`));
            }, timeout);

            this.pendingRequests.set(id, {
                resolve,
                reject,
                timeout: timeoutId,
                sentAt: performance.now(),
                messageType: message.type
            });

            try {
                this.worker?.postMessage({ ...message, id });
            } catch (error) {
                console.error(`${LOG_PREFIX} postMessage failed [${id}] type=${message.type}`, error);
                clearTimeout(timeoutId);
                this.pendingRequests.delete(id);
                reject(error);
            }
        });
    }

    onMessage(handler: MessageHandler): () => void {
        this.messageHandlers.add(handler);
        console.log(`${LOG_PREFIX} message handler registered (total: ${this.messageHandlers.size})`);
        return () => {
            this.messageHandlers.delete(handler);
            console.log(`${LOG_PREFIX} message handler removed (total: ${this.messageHandlers.size})`);
        };
    }

    async dispose(): Promise<void> {
        console.log(`${LOG_PREFIX} dispose() called`, {
            pendingCount: this.pendingRequests.size,
            handlerCount: this.messageHandlers.size,
            hasWorker: !!this.worker
        });

        for (const [id, request] of this.pendingRequests.entries()) {
            clearTimeout(request.timeout);
            request.reject(new Error('Worker disposed'));
            this.pendingRequests.delete(id);
        }

        this.messageHandlers.clear();

        if (this.worker) {
            try {
                await this.sendMessage({
                    type: 'dispose'
                }).catch(() => { });
            } finally {
                this.worker.terminate();
                console.log(`${LOG_PREFIX} worker terminated`);
            }
        }
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    setDefaultTimeout(timeout: number): void {
        this.defaultTimeout = timeout;
    }

    // Helper functions
    private async boot() {
        this.bootTime = performance.now();
        console.log(`${LOG_PREFIX} boot() starting...`, {
            baseUrl: this.baseUrl,
            importMetaUrl: import.meta.url
        });

        try {
            // Use real worker file URL instead of blob to preserve URL context
            // Blob workers have no URL, which breaks import.meta.url resolution needed for QuickJS WASM loading
            let workerUrl: URL;
            if (this.baseUrl) {
                // Load worker from custom baseUrl (e.g., session Worker URL)
                workerUrl = new URL('/worker.global.js', this.baseUrl);
                console.log(`${LOG_PREFIX} using custom baseUrl for worker:`, workerUrl.href);
            } else {
                // Default: load from npm package
                workerUrl = new URL('@remodl-web-container/core/dist/worker.global.js', import.meta.url);
                console.log(`${LOG_PREFIX} using default package worker:`, workerUrl.href);
            }

            console.log(`${LOG_PREFIX} creating Worker with URL: ${workerUrl.href} (type: module)`);
            this.worker = new Worker(workerUrl, { type: 'module' });
            console.log(`${LOG_PREFIX} Worker object created in ${(performance.now() - this.bootTime).toFixed(1)}ms`);

            // Set up message handling
            this.setupMessageHandler();
            console.log(`${LOG_PREFIX} message handler attached`);
        } catch (error) {
            const elapsed = this.bootTime ? (performance.now() - this.bootTime).toFixed(1) : '?';
            console.error(`${LOG_PREFIX} boot() FAILED after ${elapsed}ms:`, error);
            throw error;
        }
    }

    private setupMessageHandler(): void {
        if (!this.worker) {
            throw new Error('Worker not initialized');
        }
        this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const { type, id, payload } = event.data;

            let error = undefined;
            if (type === 'error') {
                error = event.data.payload.error;
                console.error(`${LOG_PREFIX} received error message from worker`, { id, error });
            }

            // Handle request responses
            if (id && this.pendingRequests.has(id)) {
                const request = this.pendingRequests.get(id)!;
                const elapsed = (performance.now() - request.sentAt).toFixed(1);
                clearTimeout(request.timeout);
                this.pendingRequests.delete(id);

                if (error) {
                    console.error(`${LOG_PREFIX} response [${id}] type=${request.messageType} ERROR in ${elapsed}ms:`, error);
                    request.reject(new Error(error));
                } else {
                    console.log(`${LOG_PREFIX} response [${id}] type=${request.messageType} OK in ${elapsed}ms`, {
                        responseType: type,
                        payloadKeys: payload ? Object.keys(payload) : []
                    });
                    request.resolve({ type, id, payload });
                }
                return;
            }

            // Handle broadcast messages
            console.log(`${LOG_PREFIX} broadcast message type=${type}`, {
                id,
                payloadKeys: payload ? Object.keys(payload) : [],
                handlerCount: this.messageHandlers.size
            });
            this.messageHandlers.forEach(handler => {
                try {
                    handler(event.data);
                } catch (error) {
                    console.error(`${LOG_PREFIX} error in broadcast message handler:`, error);
                }
            });
        };

        this.worker.onerror = (error) => {
            console.error(`${LOG_PREFIX} worker onerror fired`, {
                message: error.message,
                filename: error.filename,
                lineno: error.lineno,
                colno: error.colno,
                error
            });
            this.broadcastError('Worker error: ' + error.message);
        };
    }

    private broadcastError(error: string): void {
        console.error(`${LOG_PREFIX} broadcastError:`, error, { handlerCount: this.messageHandlers.size });
        const errorMessage: Omit<WorkerResponse, "id"> = {
            type: 'error',
            payload: { error }
        };

        this.messageHandlers.forEach(handler => {
            try {
                handler(errorMessage);
            } catch (e) {
                console.error(`${LOG_PREFIX} error in error handler:`, e);
            }
        });
    }
}
