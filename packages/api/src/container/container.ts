import { WorkerBridge } from '../worker/bridge';
import { VirtualProcess } from '../process/process';
import { ContainerOptions, ContainerStats } from './types';
import { ProcessOptions } from '../process/types';
import { ProcessEvent } from '../process/types';
import { HostRequest, IframeBridge } from '../iframe/bridge';
import type { TextSearchPayload, TextSearchResultPayload, TextSearchMatchResult } from '../worker/types';

export interface IFSWatcher {
    close(): void;
}

export type FSWatchCallback = (eventType: string, filename: string | null) => void;

export interface FSWatchOptions {
    persistent?: boolean;
    recursive?: boolean;
    encoding?: string;
}

export class ContainerManager {
    private worker: WorkerBridge;
    private iframeBridge?: IframeBridge;
    private processes: Map<number, VirtualProcess>;
    private options: ContainerOptions;
    private ready: Promise<void>;
    private _isReady: boolean = false;
    private _disposed: boolean = false;
    private onServerListen?: (port: number) => void;
    private onServerClose?: (port: number) => void;
    private fileWatchers: Map<string, Set<FSWatchCallback>> = new Map();

    constructor(options: ContainerOptions = {}) {
        this.options = {
            debug: false,
            maxProcesses: 10,
            memoryLimit: 512 * 1024 * 1024, // 512MB
            ...options
        };

        this.processes = new Map();
        this.worker = new WorkerBridge(options.baseUrl);
        this.ready = this.initialize();
        this.onServerListen = options.onServerListen;
        this.onServerClose = options.onServerClose;
    }

    waitForReady(): Promise<void> {
        return this.ready;
    }

    private async initialize(): Promise<void> {
        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        try {
            // Initialize worker with options (including filesystem config if provided)
            await this.worker.initialize({
                debug: this.options.debug,
                memoryLimit: this.options.memoryLimit,
                filesystem: this.options.filesystem,  // Pass libSQL config to worker
            });

            // Set up worker message handlers
            this.worker.onMessage(this.handleWorkerMessage.bind(this));

            this._isReady = true;
        } catch (error) {
            this._disposed = true;
            throw error;
        }
    }

    private handleWorkerMessage(message: any): void {
        switch (message.type) {
            case 'processOutput':
                const process = this.processes.get(message.payload.pid);
                if (process) {
                    process.emit(ProcessEvent.OUTPUT, {
                        output: message.payload.output,
                        isError: message.payload.isError
                    });
                }
                break;

            case 'processExit':
                const exitingProcess = this.processes.get(message.payload.pid);
                if (exitingProcess) {
                    exitingProcess.emit(ProcessEvent.EXIT, {
                        exitCode: message.payload.exitCode
                    });
                    this.processes.delete(message.payload.pid);
                }
                break;

            case 'processError':
                const errorProcess = this.processes.get(message.payload.pid);
                if (errorProcess) {
                    errorProcess.emit(ProcessEvent.ERROR, {
                        error: new Error(message.payload.error)
                    });
                }
                break;

            case 'containerStats':
                // Handle container stats updates
                break;

            case 'containerError':
                // Handle container-level errors
                if (this.options.debug) {
                    console.error('Container error:', message.payload.error);
                }
                break;
            case 'onServerListen':
                if(this.options.onServerListen){
                    this.options.onServerListen(message.payload.port)
                }
                break;
            case 'onServerClose':
                if(this.options.onServerClose){
                    this.options.onServerClose(message.payload.port)
                }
                break;
            case 'fileChange':
                this.notifyWatchers(message.payload);
                break;
        }
    }

    /**
     * Notify registered watchers of file changes
     * Events now include the full path, enabling proper path matching
     */
    private notifyWatchers(event: { eventType: string; path: string; timestamp: number }): void {
        const changedPath = event.path;
        const filename = changedPath.split('/').pop() || changedPath;

        // Check each watcher to see if it matches the changed path
        this.fileWatchers.forEach((callbacks, watchedPath) => {
            let shouldNotify = false;

            if (watchedPath === '/') {
                // Root watcher receives all events
                shouldNotify = true;
            } else if (watchedPath === changedPath) {
                // Exact path match
                shouldNotify = true;
            } else if (changedPath.startsWith(watchedPath + '/')) {
                // Changed path is inside watched directory
                shouldNotify = true;
            }

            if (shouldNotify) {
                callbacks.forEach(cb => {
                    try {
                        cb(event.eventType, filename);
                    } catch (e) {
                        if (this.options.debug) console.error('Watcher callback error:', e);
                    }
                });
            }
        });
    }

    /**
     * Spawn a new process in the container
     */
    async spawn(
        command: string,
        args: string[] = [],
        options: ProcessOptions = {}
    ): Promise<VirtualProcess> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        if (this.processes.size >= this.options.maxProcesses!) {
            throw new Error(`Maximum process limit (${this.options.maxProcesses}) reached`);
        }

        try {
            const response = await this.worker.sendMessage({
                type: 'spawn',
                payload: {
                    command,
                    args,
                    options: {
                        cwd: options.cwd || '/',
                        env: options.env || {},
                    }
                }
            });

            if (response.type !== 'spawned') {
                throw new Error('Invalid worker response');
            }

            const process = new VirtualProcess(
                response.payload.pid,
                command,
                args,
                this.worker,
                options.cwd || '/project-fs'
            )

            this.processes.set(process.pid, process);
            return process;

        } catch (error: any) {
            throw new Error(`Failed to spawn process: ${error.message}`);
        }
    }

    /**
     * Get a running process by PID
     */
    getProcess(pid: number): VirtualProcess | undefined {
        return this.processes.get(pid);
    }

    /**
     * List all running processes
     */
    listProcesses(): VirtualProcess[] {
        return Array.from(this.processes.values());
    }

    /**
     * Get container statistics
     */
    async getStats(): Promise<ContainerStats> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        const response = await this.worker.sendMessage({
            type: 'getStats'
        });

        if (response.type === 'stats') {
            return response.payload;
        }
        throw new Error("Invalid response type")

    }

    /**
     * Kill all processes and clean up resources
     */
    async dispose(): Promise<void> {
        if (this._disposed) return;

        // Mark as disposed immediately to prevent new operations
        this._disposed = true;

        try {
            // Wait for container to be ready before disposing
            await this.ready;

            // Kill all processes
            const killPromises = Array.from(this.processes.values()).map(
                process => process.kill()
            );
            await Promise.all(killPromises);

            // Clear process map
            this.processes.clear();

            // Dispose worker
            await this.worker.dispose();

        } catch (error) {
            // Log error but don't throw, as we're disposing
            if (this.options.debug) {
                console.error('Error during container disposal:', error);
            }
        }
    }

    /**
     * Write a file to the container's filesystem
     */
    async writeFile(path: string, content: string): Promise<void> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        await this.worker.sendMessage({
            type: 'writeFile',
            payload: { path, content }
        });
    }

    /**
     * Read a file from the container's filesystem
     */
    async readFile(path: string): Promise<string> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        const response = await this.worker.sendMessage({
            type: 'readFile',
            payload: { path }
        });
        if (response.type !== 'fileRead') {
            throw new Error("Invalid response type");
        }
        return response.payload.content.toString();
    }
    async deleteFile(path: string, recursive?: boolean): Promise<void> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        try {
            await this.worker.sendMessage({
                type: 'deleteFile',
                payload: { path, recursive }
            });
        } catch (error: any) {
            throw new Error(`Failed to delete file: ${error.message}`);
        }
    }

    /**
     * Rename/move a file or directory
     */
    async rename(oldPath: string, newPath: string): Promise<void> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        try {
            await this.worker.sendMessage({
                type: 'rename',
                payload: { oldPath, newPath }
            });
        } catch (error: any) {
            throw new Error(`Failed to rename: ${error.message}`);
        }
    }

    /**
     * Watch for file changes
     * Registers a callback to be notified when files change.
     * Supports path matching:
     * - '/' watches all files
     * - '/src' watches all files in /src/ directory
     * - '/src/main.ts' watches a specific file
     */
    watch(
        filename: string,
        options?: FSWatchOptions | FSWatchCallback,
        listener?: FSWatchCallback
    ): IFSWatcher {
        // Normalize arguments (options is optional)
        const actualListener = typeof options === 'function' ? options : listener;
        const actualOptions = typeof options === 'object' ? options : {};

        if (!actualListener) {
            throw new Error('watch() requires a callback');
        }

        // Register watcher
        if (!this.fileWatchers.has(filename)) {
            this.fileWatchers.set(filename, new Set());
        }
        this.fileWatchers.get(filename)!.add(actualListener);

        if (this.options.debug) {
            console.log(`watch() registered for: ${filename}`);
        }

        let closed = false;
        const watcher: IFSWatcher = {
            close: () => {
                if (closed) return;
                closed = true;

                const callbacks = this.fileWatchers.get(filename);
                if (callbacks) {
                    callbacks.delete(actualListener);
                    if (callbacks.size === 0) {
                        this.fileWatchers.delete(filename);
                    }
                }

                if (this.options.debug) {
                    console.log(`watch() closed for: ${filename}`);
                }
            }
        };

        return watcher;
    }

    async listFiles(path?: string): Promise<string[]> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        try {
            const result = await this.worker.sendMessage({
                type: 'listFiles',
                payload: { path }
            });
            if (result.type !== 'fileList') {
                throw new Error("Invalid response type");
            }
            return result.payload.files;
        } catch (error: any) {
            throw new Error(`Failed to list files: ${error.message}`);
        }
    }

    async createDirectory(path: string): Promise<void> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        try {
            await this.worker.sendMessage({
                type: 'createDirectory',
                payload: { path }
            });
        } catch (error: any) {
            throw new Error(`Failed to create directory: ${error.message}`);
        }
    }

    async listDirectory(path: string): Promise<string[]> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        try {
            const result = await this.worker.sendMessage({
                type: 'listDirectory',
                payload: { path }
            });
            if (result.type !== 'directoryList') {
                throw new Error("Invalid response type");
            }
            return result.payload.directories;
        } catch (error: any) {
            throw new Error(`Failed to list directory: ${error.message}`);
        }
    }

    /**
     * Text search across files using FTS5 + fuzzy matching
     *
     * Search strategy:
     * 1. FTS5 MATCH for exact word matching with ranking
     * 2. Fuzzy fallback (fuzzy_damlev) for typo tolerance if no results
     *
     * @param query - Search query string
     * @param options - Search options (folders, includes, excludes, etc.)
     * @returns Search results with file paths, line numbers, and match context
     */
    async textSearch(
        query: string,
        options: TextSearchPayload['options'] = {}
    ): Promise<TextSearchResultPayload> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        try {
            const result = await this.worker.sendMessage({
                type: 'textSearch',
                payload: { query, options }
            });
            if (result.type !== 'textSearchResult') {
                throw new Error("Invalid response type");
            }
            return result.payload;
        } catch (error: any) {
            throw new Error(`Failed to search files: ${error.message}`);
        }
    }

    /**
     * Network Operations
     */
    async handleHttpRequest(request: HostRequest, port: number): Promise<Response> {
        const id = crypto.randomUUID();

        try {
            // Convert headers to plain object
            const headers: Record<string, string> = request.headers||{};

            // Get body if present
            let body: string | undefined;
            if (request.body) {
                body = await request.body;
            }

            const response = await this.worker.sendMessage({
                type: 'httpRequest',
                payload: {
                    request: {
                        id,
                        method: request.method,
                        url: request.url,
                        headers,
                        body,
                        port,
                        hostname:'localhost'
                    },
                    port
                }
            });

            if (response.type === 'networkError') {
                throw new Error(response.payload.response.error);
            }
            if (response.type === 'httpResponse') {
                let resData=response.payload.response;
                return new Response(resData.body, {
                    status: resData.status,
                    statusText: resData.statusText,
                    headers: resData.headers
                });
            }
            throw new Error(`Invalid response type: ${response.type}`);
        } catch (error: any) {
            throw new Error(`HTTP request failed: ${error.message}`);
        }
    }

    async listActiveServers() {
        try {
            const response = await this.worker.sendMessage({
                type: 'listServers'
            });
            if (response.type === 'serverList') {
                return response.payload;
            }
            throw new Error(`Invalid response type: ${response.type}`);
        } catch (error: any) {
            throw new Error(`List server failed: ${error.message}`);
        }

    }

    /**
     * Preview 
     */
    createPreview(options: {
        port: number;
        styles?: Partial<CSSStyleDeclaration>;
    }) {
        if (this.iframeBridge) {
            this.iframeBridge.dispose();
        }

        this.iframeBridge = new IframeBridge({
            port: options.port,
            onRequest: (req)=>this.handleHttpRequest(req,options.port), 
            styles: options.styles
        });
        return this.iframeBridge;
    }

    /**
     * Check if the container is ready
     */
    get isReady(): boolean {
        return this._isReady;
    }

    /**
     * Check if the container has been disposed
     */
    get isDisposed(): boolean {
        return this._disposed;
    }

    /**
     * Get the current process count
     */
    get processCount(): number {
        return this.processes.size;
    }

    /**
     * Get container options
     */
    get containerOptions(): Readonly<ContainerOptions> {
        return { ...this.options };
    }
}
