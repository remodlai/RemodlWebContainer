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


interface ProcessEventData {
    stdout?: string;
    stderr?: string;
    error?: Error;
    pid?: number;
    exitCode?: number;
}

export interface ContainerOptions {
    debug?: boolean;
    onServerListen?: (port: number) => void;
    onServerClose?: (port: number) => void;
}

export interface SpawnOptions {
    cwd?: string;
    env?: Record<string, string>;
}

/**
 * Main RemodlWebContainer class
 */
export class RemodlWebContainer {
    private fileSystem: IFileSystem;
    private processManager: ProcessManager;
    private processRegistry: ProcessRegistry;
    private outputCallbacks: ((output: string) => void)[] = [];
    readonly networkManager: NetworkManager;
    private debugMode: boolean;
    constructor(options: ContainerOptions = {}) {
        this.debugMode = options.debug || false;
        this.fileSystem = new ZenFSCore();
        this.processManager = new ProcessManager();
        this.processRegistry = new ProcessRegistry();
        this.networkManager = new NetworkManager({
            getProcess: (pid: number) => this.processManager.getProcess(pid),
            onServerListen:(port)=>{
                if (options.onServerListen) {
                    options.onServerListen(port);
                }
            },
            onServerClose:(port)=>{
                if (options.onServerClose) {
                    options.onServerClose(port);
                }
            }
        });

        // Register default process executors
        this.processRegistry.registerExecutor(
            'javascript',
            new NodeProcessExecutor(this.fileSystem, this.networkManager)
        );
        this.processRegistry.registerExecutor(
            'shell',
            new ShellProcessExecutor(this.fileSystem)
        );
        this.debugLog('Container initialized');
    }
    private debugLog(...args: any[]): void {
        if (this.debugMode) {
            console.log('[Container]', ...args);
        }
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
