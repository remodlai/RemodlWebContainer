import { ChildProcessPayload, ChildProcessResult, Process, ProcessEvent, ProcessExecutor, ProcessInfo, ProcessRegistry, ProcessTree, SpawnChildEventData } from "./process";
import { VirtualFileSystem } from "./filesystem/virtual-fs";
import { ProcessManager } from "./process/manager";
import { NodeProcessExecutor } from "./process/executors/node";
import { ShellProcessExecutor } from "./process/executors/shell";
import { IFileSystem } from "./filesystem";
import { ZenFSCore } from "./filesystem/zenfs-core";
import { NetworkManager } from "network/manager";
import { ServerType, VirtualServer } from "./network/types";
import { NetworkStats } from "./network/types";
import { HostRequest } from "process/executors/node/modules/network-module";
import { configure } from '@zenfs/core';
import { LibSQLBackend, type LibSQLBackendOptions } from "./backends/libsql";
import { LibSQLStore } from "./backends/libsql/store";
import { createClient } from '@libsql/client';
import { builtinSources, nodeBuiltinSources } from './builtins';


interface ProcessEventData {
    stdout?: string;
    stderr?: string;
    error?: Error;
    pid?: number;
    exitCode?: number;
}

/**
 * Configuration for libSQL-backed filesystem
 * Mirrors the type in packages/api/src/worker/types.ts
 */
export interface FilesystemConfig {
    organizationId: string;
    userId: string;
    agentId: string;
    sessionId: string;
    projectId?: string;
    syncUrl: string;
    authToken?: string;
}

export interface ContainerOptions {
    debug?: boolean;
    onServerListen?: (port: number) => void;
    onServerClose?: (port: number) => void;
    /** libSQL filesystem configuration (optional - falls back to ZenFSCore if not provided) */
    filesystem?: FilesystemConfig;
}

export interface SpawnOptions {
    cwd?: string;
    env?: Record<string, string>;
}

/**
 * Result of parallel initialization activities
 */
interface InitializationResult {
    fileSystem: IFileSystem;
    agentWorkspaceReady: boolean;
    projectStore?: LibSQLStore;  // For direct queries like textSearch
    agentStore?: LibSQLStore;
}

/**
 * Main RemodlWebContainer class
 *
 * Uses factory pattern for safe async initialization.
 * All dependencies are fully initialized before the object is available.
 *
 * @example
 * ```typescript
 * // Without libSQL (in-memory)
 * const container = await RemodlWebContainer.create({ debug: true });
 *
 * // With libSQL backend
 * const container = await RemodlWebContainer.create({
 *   filesystem: {
 *     organizationId: 'org-123',
 *     userId: 'user-456',
 *     agentId: 'agent-default',
 *     sessionId: crypto.randomUUID(),
 *     syncUrl: 'http://localhost:9010',
 *   }
 * });
 * ```
 */
export class RemodlWebContainer {
    private fileSystem: IFileSystem;
    private processManager: ProcessManager;
    private processRegistry: ProcessRegistry;
    private outputCallbacks: ((output: string) => void)[] = [];
    readonly networkManager: NetworkManager;
    private debugMode: boolean;
    private filesystemConfig?: FilesystemConfig;
    // LibSQL stores for direct queries (textSearch, etc.)
    private projectStore?: LibSQLStore;
    private agentStore?: LibSQLStore;

    /**
     * Private constructor - use RemodlWebContainer.create() instead
     *
     * All parameters are fully initialized before construction.
     */
    private constructor(
        fileSystem: IFileSystem,
        processManager: ProcessManager,
        processRegistry: ProcessRegistry,
        networkManager: NetworkManager,
        options: ContainerOptions = {},
        projectStore?: LibSQLStore,
        agentStore?: LibSQLStore
    ) {
        this.debugMode = options.debug || false;
        this.filesystemConfig = options.filesystem;
        this.fileSystem = fileSystem;
        this.processManager = processManager;
        this.processRegistry = processRegistry;
        this.networkManager = networkManager;
        this.projectStore = projectStore;
        this.agentStore = agentStore;
    }

    /**
     * Factory method to create a fully-initialized container
     *
     * Implements saga pattern:
     * 1. Start all initialization activities in parallel
     * 2. Wait for all to complete
     * 3. Validate all subsystems are ready
     * 4. Construct and return the container
     */
    static async create(options: ContainerOptions = {}): Promise<RemodlWebContainer> {
        const debug = options.debug || false;
        const log = (...args: any[]) => {
            if (debug) console.log('[Container.create]', ...args);
        };

        log('Starting container initialization...');

        // ============================================================
        // ACTIVITY 1: Initialize filesystem (async for libSQL)
        // ============================================================
        const filesystemActivity = RemodlWebContainer.initializeFilesystem(options, log);

        // ============================================================
        // ACTIVITY 2: Create process infrastructure (sync but grouped)
        // ============================================================
        const processManager = new ProcessManager();
        const processRegistry = new ProcessRegistry();
        log('Process infrastructure created');

        // ============================================================
        // WAIT FOR ALL ACTIVITIES
        // ============================================================
        const [initResult] = await Promise.all([
            filesystemActivity,
            // Add more parallel activities here as needed
        ]);

        log('All activities completed');

        // ============================================================
        // CREATE NETWORK MANAGER (needs processManager reference)
        // ============================================================
        const networkManager = new NetworkManager({
            getProcess: (pid: number) => processManager.getProcess(pid),
            onServerListen: (port) => {
                if (options.onServerListen) {
                    options.onServerListen(port);
                }
            },
            onServerClose: (port) => {
                if (options.onServerClose) {
                    options.onServerClose(port);
                }
            }
        });
        log('Network manager created');

        // ============================================================
        // REGISTER PROCESS EXECUTORS (needs filesystem + networkManager)
        // ============================================================
        processRegistry.registerExecutor(
            'javascript',
            new NodeProcessExecutor(initResult.fileSystem, networkManager)
        );
        processRegistry.registerExecutor(
            'shell',
            new ShellProcessExecutor(initResult.fileSystem)
        );
        log('Process executors registered');

        // ============================================================
        // VALIDATION: Ensure all subsystems are ready
        // ============================================================
        RemodlWebContainer.validateInitialization(initResult, processManager, processRegistry, networkManager, log);

        // ============================================================
        // CONSTRUCT CONTAINER (everything is ready)
        // ============================================================
        const container = new RemodlWebContainer(
            initResult.fileSystem,
            processManager,
            processRegistry,
            networkManager,
            options,
            initResult.projectStore,
            initResult.agentStore
        );

        log('Container created successfully');
        return container;
    }

    /**
     * Initialize filesystem - either libSQL-backed or default in-memory
     */
    private static async initializeFilesystem(
        options: ContainerOptions,
        log: (...args: any[]) => void
    ): Promise<InitializationResult> {
        if (options.filesystem) {
            log('Initializing libSQL filesystem...');
            return await RemodlWebContainer.initializeLibSQLFilesystem(options.filesystem, log);
        } else {
            log('Using default in-memory ZenFS');
            const fileSystem = new ZenFSCore();

            // Copy builtin files even in default mode
            await RemodlWebContainer.copyBuiltinFiles(fileSystem, log);

            return {
                fileSystem,
                agentWorkspaceReady: false, // No agent workspace in default mode
            };
        }
    }

    /**
     * Initialize libSQL-backed filesystem with dual mounts
     */
    private static async initializeLibSQLFilesystem(
        config: FilesystemConfig,
        log: (...args: any[]) => void
    ): Promise<InitializationResult> {
        // Build namespace paths
        const projectNamespace = `org-${config.organizationId}/project-${config.projectId || 'default'}`;
        const agentNamespace = `org-${config.organizationId}/session-${config.sessionId}`;

        log('Configuring mounts:', {
            projectNamespace,
            agentNamespace,
            syncUrl: config.syncUrl,
        });

        // Build mount configuration
        const projectOptions: LibSQLBackendOptions = {
            url: `file:/project-${config.projectId || 'default'}.db`,
            syncUrl: config.syncUrl ? `${config.syncUrl}/v1/namespaces/${projectNamespace}` : undefined,
            authToken: config.authToken,
            organizationId: config.organizationId,
            agentId: null, // Project FS has no agent
            label: 'project',
        };

        const agentOptions: LibSQLBackendOptions = {
            url: `file:/agent-${config.sessionId}.db`,
            syncUrl: config.syncUrl ? `${config.syncUrl}/v1/namespaces/${agentNamespace}` : undefined,
            authToken: config.authToken,
            organizationId: config.organizationId,
            agentId: config.agentId,
            label: 'agent-workspace',
        };

        try {
            // Create libSQL clients for direct query access (textSearch, etc.)
            const projectClient = createClient({
                url: projectOptions.url || ':memory:',
                syncUrl: projectOptions.syncUrl,
                authToken: projectOptions.authToken,
            });
            const agentClient = createClient({
                url: agentOptions.url || ':memory:',
                syncUrl: agentOptions.syncUrl,
                authToken: agentOptions.authToken,
            });

            // Create stores for direct query access
            const projectStore = new LibSQLStore(projectClient, projectOptions);
            const agentStore = new LibSQLStore(agentClient, agentOptions);

            // Initialize stores (creates schema if needed)
            await projectStore.initialize();
            await agentStore.initialize();
            log('LibSQL stores initialized for direct queries');

            // Configure ZenFS with dual mounts
            await configure({
                mounts: {
                    '/': {
                        backend: LibSQLBackend,
                        ...projectOptions,
                    } as any,
                    '/.agent-workspace': {
                        backend: LibSQLBackend,
                        ...agentOptions,
                    } as any,
                },
            });

            log('ZenFS configured with libSQL mounts');

            // Create ZenFSCore - it will use the configured global fs
            const fileSystem = new ZenFSCore();

            // Ensure agent workspace directories exist
            await RemodlWebContainer.ensureAgentWorkspaceStructure(fileSystem, log);

            // Copy builtin files to ZenFS
            await RemodlWebContainer.copyBuiltinFiles(fileSystem, log);

            log('libSQL filesystem initialization complete');

            return {
                fileSystem,
                agentWorkspaceReady: true,
                projectStore,
                agentStore,
            };
        } catch (error) {
            log('libSQL filesystem initialization failed:', error);
            log('Falling back to in-memory ZenFS');

            // Fall back to in-memory ZenFS
            return {
                fileSystem: new ZenFSCore(),
                agentWorkspaceReady: false,
            };
        }
    }

    /**
     * Ensure the agent workspace has the expected directory structure
     */
    private static async ensureAgentWorkspaceStructure(
        fileSystem: IFileSystem,
        log: (...args: any[]) => void
    ): Promise<void> {
        const dirs = [
            '/.agent-workspace/memory',
            '/.agent-workspace/memory/agent',
            '/.agent-workspace/memory/agent/shared',
            '/.agent-workspace/conversations',
            '/.agent-workspace/analysis',
            '/.agent-workspace/planning',
            '/.agent-workspace/drafts',
            '/.agent-workspace/logs',
            '/.agent-workspace/bin',
        ];

        for (const dir of dirs) {
            try {
                if (!fileSystem.fileExists(dir)) {
                    fileSystem.createDirectory(dir);
                    log(`Created directory: ${dir}`);
                }
            } catch (e) {
                // Directory might already exist
                log(`Directory already exists or error: ${dir}`);
            }
        }
    }

    /**
     * Copy Node.js builtin files to ZenFS for runtime access
     */
    private static async copyBuiltinFiles(
        fileSystem: IFileSystem,
        log: (...args: any[]) => void
    ): Promise<void> {
        try {
            // Create /builtins directory
            if (!fileSystem.fileExists('/builtins')) {
                fileSystem.createDirectory('/builtins');
                log('Created /builtins directory');
            }

            // Use static imports from builtins index (bundled at build time)
            fileSystem.writeFile('/builtins/primordials.js', builtinSources['primordials.js']);
            fileSystem.writeFile('/builtins/internalBinding.cjs', builtinSources['internalBinding.cjs']);
            log('Copied primordials and internalBinding');

            // Copy ALL Node.js builtin source files from static imports
            log('Copying Node.js builtin files...');

            let copiedCount = 0;
            for (const [path, content] of Object.entries(nodeBuiltinSources)) {
                const targetPath = `/builtins/node/${path}`;

                // Ensure parent directory exists
                const dirPath = targetPath.substring(0, targetPath.lastIndexOf('/'));
                if (dirPath && !fileSystem.fileExists(dirPath)) {
                    fileSystem.createDirectory(dirPath);
                }

                fileSystem.writeFile(targetPath, content);
                copiedCount++;
            }

            log(`Copied ${copiedCount} Node.js builtin files`);
        } catch (error) {
            log('Error copying builtin files:', error);
            // Non-fatal - will fall back to stubs
        }
    }

    /**
     * Validate that all subsystems are properly initialized
     * Throws if any validation fails
     */
    private static validateInitialization(
        initResult: InitializationResult,
        processManager: ProcessManager,
        processRegistry: ProcessRegistry,
        networkManager: NetworkManager,
        log: (...args: any[]) => void
    ): void {
        log('Validating initialization...');

        // Validate filesystem
        if (!initResult.fileSystem) {
            throw new Error('Filesystem initialization failed: fileSystem is null');
        }

        // Validate process infrastructure
        if (!processManager) {
            throw new Error('Process manager initialization failed');
        }
        if (!processRegistry) {
            throw new Error('Process registry initialization failed');
        }

        // Validate network manager
        if (!networkManager) {
            throw new Error('Network manager initialization failed');
        }

        // Validate executors are registered
        const jsExecutor = processRegistry.findExecutor('node');
        const shellExecutor = processRegistry.findExecutor('sh');
        if (!jsExecutor) {
            log('Warning: JavaScript executor not registered');
        }
        if (!shellExecutor) {
            log('Warning: Shell executor not registered');
        }

        log('Validation passed');
    }

    private debugLog(...args: any[]): void {
        if (this.debugMode) {
            console.log('[Container]', ...args);
        }
    }

    /**
     * @deprecated Use RemodlWebContainer.create() instead
     * Kept for backward compatibility - immediately resolves
     */
    async waitForInit(): Promise<void> {
        // With factory pattern, container is always fully initialized
        return Promise.resolve();
    }

    /**
     * Network Operations
     */
    async handleHttpRequest(request: HostRequest, port: number): Promise<Response> {
        this.debugLog(`HTTP Request: ${request.method} ${request.url} (Port: ${port})`);
        try {
            const response = await this.networkManager.handleRequest(request, port);
            this.debugLog(`HTTP Response: ${response.status} ${response.statusText}`);
            return response;
        } catch (error) {
            this.debugLog(`HTTP Error:`, error);
            return new Response(
                error instanceof Error ? error.message : 'Internal Server Error',
                { status: 500 }
            );
        }
    }

    registerServer(pid: number, port: number, type: ServerType, options: VirtualServer['options'] = {}): string {
        this.debugLog(`Registering ${type} server on port ${port} for process ${pid}`);
        return this.networkManager.registerServer(pid, port, type, options);
    }

    unregisterServer(port: number, type: ServerType): void {
        this.debugLog(`Unregistering server ${type}:${port}`);
        this.networkManager.unregisterServer(port, type);
    }

    getNetworkStats(): NetworkStats {
        return this.networkManager.getNetworkStats();
    }

    listServers(): VirtualServer[] {
        return this.networkManager.listServers();
    }



    /**
     * File system operations
     */
    writeFile(path: string, content: string): void {
        this.fileSystem.writeFile(path, content);
    }

    readFile(path: string): string | undefined {
        return this.fileSystem.readFile(path);
    }

    deleteFile(path: string): void {
        this.fileSystem.deleteFile(path);
    }

    listFiles(basePath: string = '/'): string[] {
        return this.fileSystem.listFiles(basePath);
    }

    createDirectory(path: string): void {
        this.fileSystem.createDirectory(path);
    }

    deleteDirectory(path: string): void {
        this.fileSystem.deleteDirectory(path);
    }

    listDirectory(path: string): string[] {
        return this.fileSystem.listDirectory(path);
    }

    /**
     * Text search using FTS5 + fuzzy matching
     *
     * Requires libSQL backend. Falls back to empty results if not available.
     *
     * @param query - Search query string
     * @param options - Search options
     * @returns Search results with file paths, line numbers, and match context
     */
    async textSearch(
        query: string,
        options: {
            folders?: string[];
            includes?: string[];
            excludes?: string[];
            caseSensitive?: boolean;
            isRegex?: boolean;
            resultLimit?: number;
            fuzzyThreshold?: number;
        } = {}
    ): Promise<{
        matches: Array<{
            path: string;
            lineNumber: number;
            lineContent: string;
            matchStart: number;
            matchEnd: number;
        }>;
        truncated: boolean;
    }> {
        // Use project store for text search (searches user's codebase)
        if (this.projectStore) {
            this.debugLog('textSearch: using libSQL FTS5 + fuzzy search');
            return this.projectStore.textSearch(query, options);
        }

        // Fallback: no libSQL backend, return empty results
        this.debugLog('textSearch: libSQL backend not available, returning empty results');
        return { matches: [], truncated: false };
    }

    /**
     * Process operations
     */
    async spawn(executablePath: string, args: string[] = [], parentPid?: number,options: SpawnOptions = {}): Promise<Process> {
        const executor = this.processRegistry.findExecutor(executablePath);
        if (!executor) {
            throw new Error(`No executor found for: ${executablePath}`);
        }

        const pid = this.processManager.getNextPid();
        const process = await executor.execute({
            executable: executablePath,
            args,
            cwd: options.cwd || '/',
            env: options.env || {}
        }, pid, parentPid);

        // Set up general process handlers
        this.setupProcessEventHandlers(process);

        // Set up child process spawning for all processes
        this.setupChildProcessSpawning(process);

        // Add process to manager and start it
        this.processManager.addProcess(process);
        process.start().catch(console.error);

        return process;
    }

    private setupProcessEventHandlers(process: Process): void {
        process.addEventListener(ProcessEvent.MESSAGE, (data: ProcessEventData) => {
            if (data.stdout) {
                this.notifyOutput(data.stdout);
            }
            if (data.stderr) {
                this.notifyOutput(data.stderr);
            }
        });

        process.addEventListener(ProcessEvent.ERROR, (data: ProcessEventData) => {
            if (data.error) {
                this.notifyOutput(`Error: ${data.error.message}\n`);
            }
        });

        process.addEventListener(ProcessEvent.EXIT, (data) => {
            if (data.exitCode) {
                this.notifyOutput(`Process exited with code: ${data.exitCode}\n`);
            }
        });

    }
    registerProcessExecutor(type: string, executor: ProcessExecutor): void {
        this.processRegistry.registerExecutor(type, executor);
    }

    /**
     * Register an output callback
     */
    onOutput(callback: (output: string) => void): () => void {
        this.outputCallbacks.push(callback);
        return () => {
            this.outputCallbacks = this.outputCallbacks.filter(cb => cb !== callback);
        };
    }

    private notifyOutput(output: string): void {
        this.outputCallbacks.forEach(callback => callback(output));
    }

    getProcess(pid: number): Process | undefined {
        return this.processManager.getProcess(pid);
    }

    listProcesses(): Process[] {
        return this.processManager.listProcesses();
    }

    /**
     * Get information about a process
     */
    getProcessInfo(process: Process): ProcessInfo {
        const stats = process.getStats();
        return {
            pid: stats.pid,
            ppid: stats.ppid,
            type: stats.type,
            state: stats.state,
            executablePath: stats.executablePath,
            args: stats.args,
            startTime: stats.startTime,
            endTime: stats.endTime,
            uptime: process.uptime ?? undefined
        };
    }
    // Add method to get child processes
    getChildProcesses(parentPid: number): Process[] {
        return this.processManager.listProcesses()
            .filter(process => process.parentPid === parentPid);
    }

    /**
     * Get process tree for a given process
     */
    getProcessTree(pid: number): ProcessTree {
        const process = this.processManager.getProcess(pid);
        if (!process) {
            throw new Error(`Process ${pid} not found`);
        }

        return {
            info: this.getProcessInfo(process),
            children: this.getChildProcesses(pid)
                .map(child => this.getProcessTree(child.pid))
        };
    }

    /**
     * Get full process tree starting from init process
     */
    getFullProcessTree(): ProcessTree[] {
        // Get all top-level processes (those without parent)
        const topLevelProcesses = this.processManager.listProcesses()
            .filter(process => !process.parentPid);

        return topLevelProcesses.map(process => this.getProcessTree(process.pid));
    }

    /**
     * Print process tree (useful for debugging)
     */
    printProcessTree(tree: ProcessTree, indent: string = ''): string {
        const { info } = tree;
        let output = `${indent}${info.pid} ${info.executablePath} (${info.state})`;

        if (info.uptime !== undefined) {
            output += ` - uptime: ${info.uptime}ms`;
        }
        output += '\n';

        for (const child of tree.children) {
            output += this.printProcessTree(child, indent + '  ');
        }

        return output;
    }
    /**
     * Terminate a process and all its children
     */
    async terminateProcessTree(pid: number): Promise<void> {
        const children = this.getChildProcesses(pid);

        // First terminate all children
        await Promise.all(
            children.map(child => this.terminateProcessTree(child.pid))
        );

        // Then terminate the process itself
        const process = this.processManager.getProcess(pid);
        if (process) {
            await process.terminate();
            this.processManager.removeProcess(pid);
        }
    }

    private setupChildProcessSpawning(process: Process): void {
        process.addEventListener(ProcessEvent.SPAWN_CHILD, (data: SpawnChildEventData) => {
            this.spawnChildProcess(process.pid, data.payload, data.callback);
        });
    }

    private async spawnChildProcess(
        parentPid: number,
        payload: ChildProcessPayload,
        callback: (result: ChildProcessResult) => void
    ): Promise<void> {

        let childPid:number|null=null
        try {
            const parentProcess = this.processManager.getProcess(parentPid);
            if (!parentProcess) {
                throw new Error(`Parent process ${parentPid} not found`);
            }



            // Spawn the child process
            const childProcess = await this.spawn(
                payload.executable,
                payload.args,
                parentPid  // Pass parent PID
            );
            childPid=childProcess.pid

            // Set up event handlers for the child process
            childProcess.addEventListener(ProcessEvent.MESSAGE, (data: ProcessEventData) => {
                parentProcess.emit(ProcessEvent.MESSAGE, { ...data });
            });

            childProcess.addEventListener(ProcessEvent.ERROR, (data: ProcessEventData) => {
                if (data.error) {
                    parentProcess.emit(ProcessEvent.MESSAGE, { stderr: data.error.message + '\n' });

                }
            });

            childProcess.addEventListener(ProcessEvent.EXIT, (data) => {
                callback({
                    stdout:"",
                    stderr:"",
                    exitCode: data.exitCode ?? 1
                });

                // Clean up the process
                this.processManager.removeProcess(childProcess.pid);
            });


        } catch (error: any) {
            if (childPid){
                this.processManager.removeProcess(childPid);
            }
            callback({
                stdout: '',
                stderr: error.message,
                exitCode: 1
            });
        }
    }


    /**
     * Container Lifecycle
     */
    async dispose(): Promise<void> {
        this.debugLog('Disposing container');

        // Stop all network servers
        for (const server of this.listServers()) {
            this.networkManager.unregisterServer(server.port, server.type);
        }

        // Kill all processes
        await this.processManager.killAll();

        // Clear output callbacks
        this.outputCallbacks = [];

        // Dispose network manager
        this.networkManager.dispose();

        this.debugLog('Container disposed');
    }
}
