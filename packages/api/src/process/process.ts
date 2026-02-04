import { WorkerBridge } from "../worker/bridge";
import { ContainerManager } from "../container/";
import { BrowserEventEmitter,  } from "./events";
import { ProcessStats, ProcessEvent, ProcessEventMap } from "./types";

export class VirtualProcess extends BrowserEventEmitter {
    readonly pid: number;
    readonly command: string;
    readonly args: string[];

    private worker: WorkerBridge;
    private _exitCode: number | null = null;
    private _startTime: Date;
    private _endTime?: Date;
    private _isRunning: boolean = true;

    // Stream API for Forge terminal integration
    private _input?: WritableStream<string>;
    private _output?: ReadableStream<string>;
    private _outputController?: ReadableStreamDefaultController<string>;

    // Separate stdout/stderr streams for API compatibility
    private _stdout?: ReadableStream<string>;
    private _stdoutController?: ReadableStreamDefaultController<string>;
    private _stderr?: ReadableStream<string>;
    private _stderrController?: ReadableStreamDefaultController<string>;

    // Per-process working directory
    private _cwd: string;

    // Exit promise for awaiting process completion
    private _exitPromise: Promise<number>;
    private _exitResolve!: (exitCode: number) => void;

    constructor(
        pid: number,
        command: string,
        args: string[],
        worker: WorkerBridge,
        cwd: string = '/project-fs'
    ) {
        super();
        this.pid = pid;
        this.command = command;
        this.args = args;
        this.worker = worker;
        this._cwd = cwd;
        this._startTime = new Date();

        // Set max listeners to avoid memory leaks
        this.setMaxListeners(100);

        // Set up exit promise
        this._exitPromise = new Promise<number>((resolve) => {
            this._exitResolve = resolve;
        });

        // Set up output stream bridging from events
        this._setupOutputStream();

        // Set up separate stdout/stderr streams
        this._setupStdoutStderr();
    }

    /**
     * Set up the output stream that bridges from ProcessEvent.OUTPUT
     */
    private _setupOutputStream(): void {
        this._output = new ReadableStream<string>({
            start: (controller) => {
                this._outputController = controller;

                // Bridge OUTPUT events to the stream
                this.on(ProcessEvent.OUTPUT, ({ output }) => {
                    try {
                        controller.enqueue(output);
                    } catch {
                        // Stream may be closed
                    }
                });

                // Close stream on process exit
                this.on(ProcessEvent.EXIT, () => {
                    try {
                        controller.close();
                    } catch {
                        // Stream may already be closed
                    }
                });

                // Error the stream on process error
                this.on(ProcessEvent.ERROR, ({ error }) => {
                    try {
                        controller.error(error);
                    } catch {
                        // Stream may already be closed
                    }
                });
            },
            cancel: () => {
                // If stream is cancelled, kill the process
                this.kill();
            }
        });
    }

    /**
     * Set up separate stdout and stderr streams
     */
    private _setupStdoutStderr(): void {
        // stdout stream - only receives non-error output
        this._stdout = new ReadableStream<string>({
            start: (controller) => {
                this._stdoutController = controller;

                // Bridge OUTPUT events where isError is false
                this.on(ProcessEvent.OUTPUT, ({ output, isError }) => {
                    if (!isError) {
                        try {
                            controller.enqueue(output);
                        } catch {
                            // Stream may be closed
                        }
                    }
                });

                // Close stream on process exit
                this.on(ProcessEvent.EXIT, () => {
                    try {
                        controller.close();
                    } catch {
                        // Stream may already be closed
                    }
                });

                // Error the stream on process error
                this.on(ProcessEvent.ERROR, ({ error }) => {
                    try {
                        controller.error(error);
                    } catch {
                        // Stream may already be closed
                    }
                });
            },
            cancel: () => {
                // Don't kill process on stdout cancel - stderr might still be active
            }
        });

        // stderr stream - only receives error output
        this._stderr = new ReadableStream<string>({
            start: (controller) => {
                this._stderrController = controller;

                // Bridge OUTPUT events where isError is true
                this.on(ProcessEvent.OUTPUT, ({ output, isError }) => {
                    if (isError) {
                        try {
                            controller.enqueue(output);
                        } catch {
                            // Stream may be closed
                        }
                    }
                });

                // Close stream on process exit
                this.on(ProcessEvent.EXIT, () => {
                    try {
                        controller.close();
                    } catch {
                        // Stream may already be closed
                    }
                });

                // Error the stream on process error
                this.on(ProcessEvent.ERROR, ({ error }) => {
                    try {
                        controller.error(error);
                    } catch {
                        // Stream may already be closed
                    }
                });
            },
            cancel: () => {
                // Don't kill process on stderr cancel - stdout might still be active
            }
        });
    }

    /**
     * Input stream for writing to the process stdin
     * Usage: process.input.getWriter().write('data')
     */
    get input(): WritableStream<string> {
        if (!this._input) {
            this._input = new WritableStream<string>({
                write: async (chunk) => {
                    await this.write(chunk);
                },
                close: () => {
                    // Could signal EOF to process if needed
                },
                abort: () => {
                    this.kill();
                }
            });
        }
        return this._input;
    }

    /**
     * Output stream for reading process stdout
     * Usage: process.output.pipeTo(writable) or process.output.getReader()
     */
    get output(): ReadableStream<string> {
        return this._output!;
    }

    /**
     * Stdout stream for reading only stdout (non-error) output
     * Usage: process.stdout.pipeTo(writable) or process.stdout.getReader()
     */
    get stdout(): ReadableStream<string> {
        return this._stdout!;
    }

    /**
     * Stderr stream for reading only stderr (error) output
     * Usage: process.stderr.pipeTo(writable) or process.stderr.getReader()
     */
    get stderr(): ReadableStream<string> {
        return this._stderr!;
    }

    /**
     * Promise that resolves with the exit code when the process exits
     * Usage: const exitCode = await process.exit;
     */
    get exit(): Promise<number> {
        return this._exitPromise;
    }

    /**
     * Resize the terminal dimensions
     * @param dimensions - Object with cols and rows
     */
    async resize(dimensions: { cols: number; rows: number }): Promise<void> {
        if (!this._isRunning) return;

        await this.worker.sendMessage({
            type: 'resize',
            payload: {
                pid: this.pid,
                cols: dimensions.cols,
                rows: dimensions.rows
            }
        });
    }

    /**
     * Write input to the process
     */
    async write(input: string): Promise<void> {
        if (!this._isRunning) {
            throw new Error('Process is not running');
        }

        await this.worker.sendMessage({
            type: 'writeInput',
            payload: {
                pid: this.pid,
                input
            }
        });
    }

    /**
     * Kill the process
     */
    async kill(): Promise<void> {
        if (!this._isRunning) return;

        await this.worker.sendMessage({
            type: 'terminate',
            payload: {
                pid: this.pid
            }
        });

        this._isRunning = false;
        this._endTime = new Date();
        this._exitCode = -1;
        this._exitResolve(this._exitCode);
        this.emit(ProcessEvent.EXIT, { exitCode: this._exitCode });
    }

    /**
     * Internal method to set exit code (called when process exits normally)
     * @internal
     */
    _setExitCode(code: number): void {
        if (!this._isRunning) return;

        this._isRunning = false;
        this._endTime = new Date();
        this._exitCode = code;
        this._exitResolve(code);
        this.emit(ProcessEvent.EXIT, { exitCode: code });
    }

    /**
     * Get process statistics
     */
    getStats(): ProcessStats {
        return {
            pid: this.pid,
            command: this.command,
            args: this.args,
            status: this._isRunning ? 'running' : 'exited',
            exitCode: this._exitCode,
            startTime: this._startTime,
            endTime: this._endTime,
            uptime: this._endTime ?
                this._endTime.getTime() - this._startTime.getTime() :
                Date.now() - this._startTime.getTime()
        };
    }

    /**
     * Type-safe event emitter methods
     */
    on<K extends keyof ProcessEventMap>(
        event: K,
        listener: (data: ProcessEventMap[K]) => void
    ): this {
        return super.on(event, listener);
    }

    once<K extends keyof ProcessEventMap>(
        event: K,
        listener: (data: ProcessEventMap[K]) => void
    ): this {
        return super.once(event, listener);
    }

    off<K extends keyof ProcessEventMap>(
        event: K,
        listener: (data: ProcessEventMap[K]) => void
    ): this {
        return super.off(event, listener);
    }

    emit<K extends keyof ProcessEventMap>(
        event: K,
        data: ProcessEventMap[K]
    ): boolean {
        return super.emit(event, data);
    }

    /**
     * Getters for process state
     */
    get isRunning(): boolean {
        return this._isRunning;
    }

    get exitCode(): number | null {
        return this._exitCode;
    }

    get startTime(): Date {
        return this._startTime;
    }

    get endTime(): Date | undefined {
        return this._endTime;
    }

    get uptime(): number {
        return this._endTime ?
            this._endTime.getTime() - this._startTime.getTime() :
            Date.now() - this._startTime.getTime();
    }

    /**
     * Get the current working directory for this process
     */
    get cwd(): string {
        return this._cwd;
    }

    /**
     * Change the working directory for this process
     * @param path - Absolute or relative path to change to
     */
    async chdir(path: string): Promise<void> {
        // Resolve relative paths against current cwd
        let newPath: string;
        if (path.startsWith('/')) {
            newPath = path;
        } else {
            newPath = `${this._cwd}/${path}`.replace(/\/+/g, '/');
        }

        // Normalize path (remove trailing slashes except for root)
        newPath = newPath.replace(/\/+$/, '') || '/';

        // TODO: Could validate path exists via worker message
        this._cwd = newPath;
    }
}
