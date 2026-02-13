import { ServerType } from '../../../network/types';
import { IFileSystem } from '../../../filesystem';
import { Process, ProcessEvent, ProcessState, ProcessType } from '../../base';
import {  QuickJSContext, QuickJSHandle, newQuickJSAsyncWASMModuleFromVariant, newVariant } from 'quickjs-emscripten';
import { NetworkManager } from '../../../network/manager';
// Previous variants (standard QuickJS, now replaced with custom QuickJS-ng)
// import variant from "@jitl/quickjs-singlefile-browser-release-sync"
// import variant from "@jitl/quickjs-asmjs-mjs-release-sync"
// import variant from "@jitl/quickjs-singlefile-browser-release-asyncify"

// Custom QuickJS-ng with 14 qjs-modules (stream, child_process, path, etc.)
import variant from "@jitl/quickjs-ng-wasmfile-release-asyncify"
import { HTTPModule } from './modules/http';
import { HostRequest, NetworkModule, statusCodeToStatusText } from './modules/network-module';

export class NodeProcess extends Process {
    private fileSystem: IFileSystem;
    private networkManager: NetworkManager;
    private httpModule: QuickJSHandle|undefined;
    private networkModule: NetworkModule|undefined; 
    private context: QuickJSContext|undefined;
    constructor(
        pid: number,
        executablePath: string,
        args: string[],
        fileSystem: IFileSystem,
        networkManager: NetworkManager,
        parantPid?: number,
        cwd?: string
    ) {
        super(pid, ProcessType.JAVASCRIPT, executablePath, args, parantPid,cwd);
        this.fileSystem = fileSystem;
        this.networkManager = networkManager;
    }
    

    async execute(): Promise<void> {
        try {
            // Configure WASM file location using newVariant() API
            const customVariant = newVariant(variant, {
                locateFile: (fileName: string, prefix: string) => {
                    if (fileName.endsWith('.wasm')) {
                        // WASM file is served from Session Workers R2 at /wasm/ prefix
                        return '/wasm/emscripten-module.wasm';
                    }
                    return prefix + fileName;
                }
            });

            const QuickJS = await newQuickJSAsyncWASMModuleFromVariant(customVariant)

            const runtime = QuickJS.newRuntime();
            // Set up module loader
            runtime.setModuleLoader((moduleName, ctx) => {
                try {
                    const resolvedPath = this.fileSystem.resolveModulePath(moduleName, this.cwd);
                    const content = this.fileSystem.readFile(resolvedPath);

                    if (content === undefined) {
                        return { error: new Error(`Module not found: ${moduleName}`) };
                    }
                    return { value: content };
                } catch (error: any) {
                    return { error };
                }
            }, (baseModuleName, requestedName) => {
                try {
                    // Get base directory from baseModuleName or use cwd
                    let basePath = baseModuleName ?
                        baseModuleName.substring(0, baseModuleName.lastIndexOf('/')) :
                        this.cwd;

                    basePath=this.fileSystem.normalizePath(basePath||this.cwd||"/");

                    const resolvedPath = this.fileSystem.resolveModulePath(requestedName, basePath);
                    return { value: resolvedPath };
                } catch (error: any) {
                    return { error };
                }
            });

            const context = runtime.newContext();
            this.context = context;
            this.networkModule = new NetworkModule(context,(port:number)=>{
                console.log('registering server',port)

                this.networkManager.registerServer(this.pid, port, 'http', { host: '0.0.0.0' })
            }, (port: number) => {
                this.networkManager.unregisterServer(port, 'http')
            }, true);
            this.httpModule =this.networkModule.createHttpModule()

            // this.context = context;
            this.setupRequire(context);

            // Inject Node.js internal globals (primordials and internalBinding)
            this.setupNodeInternals(context);

            // Set up console.log and other console methods
            const consoleObj = context.newObject();

            // Console.log
            const logFn = context.newFunction("log", (...args) => {
                const output = args.map(arg => `${context.dump(arg)}`).join(" ") + "\n";
                this.emit(ProcessEvent.MESSAGE, { stdout: output });
            });
            context.setProp(consoleObj, "log", logFn);

            // Console.debug
            const debugFn = context.newFunction("debug", (...args) => {
                const output = args.map(arg => `${context.dump(arg)}`).join(" ") + "\n";
                this.emit(ProcessEvent.MESSAGE, { stderr: output });
            });
            context.setProp(consoleObj, "debug", debugFn);

            // Console.error
            const errorFn = context.newFunction("error", (...args) => {
                const output = args.map(arg => `${context.dump(arg)}`).join(" ") + "\n";
                this.emit(ProcessEvent.MESSAGE, { stderr: output });
            });
            context.setProp(consoleObj, "error", errorFn);

            context.setProp(context.global, "console", consoleObj);

            // Clean up function handles
            logFn.dispose();
            errorFn.dispose();
            consoleObj.dispose();

            // Set up process.argv
            const processObj = context.newObject();
            const argvArray = context.newArray();

            const fullArgs = ['node', this.executablePath, ...this.args];
            for (let i = 0; i < fullArgs.length; i++) {
                const argHandle = context.newString(fullArgs[i]);
                context.setProp(argvArray, i, argHandle);
                argHandle.dispose();
            }

            context.setProp(processObj, 'argv', argvArray);
            context.setProp(context.global, 'process', processObj);

            argvArray.dispose();
            processObj.dispose();

            try {
                // Get the file content
                let content = this.fileSystem.readFile(this.executablePath);
                if (!content) {
                    throw new Error(`File not found: ${this.executablePath}`);
                }
                let firstLine = content.split('\n')[0];
                // Remove shebang if present
                if (firstLine.startsWith('#!')) {
                    content = content.split('\n').slice(1).join('\n');
                }

                // Execute the code
                const result = context.evalCode(content, this.executablePath, { type: 'module' });

                // Handle any pending promises
                while (runtime.hasPendingJob()) {
                    const jobResult = runtime.executePendingJobs(10);
                    if (jobResult.error) {
                        throw context.dump(jobResult.error);
                    }
                }

                if (result.error) {
                    throw context.dump(result.error);
                }
                result.value.dispose();
                this._exitCode = 0;
                this._state = ProcessState.COMPLETED;
            } catch (error) {
                this._exitCode = 1;
                this._state = ProcessState.FAILED;
                const errorMessage = typeof error === 'string' ? error : JSON.stringify(error, null, 2);
                this.emit(ProcessEvent.MESSAGE, { stderr: errorMessage });
            } finally {
                context.dispose();
                // runtime.;
                this.emit(ProcessEvent.EXIT, { pid: this.pid, exitCode: this._exitCode });
            }
        } catch (error: any) {
            console.error('[NodeProcess] Execution failed:', error);
            console.error('[NodeProcess] Error type:', typeof error);
            console.error('[NodeProcess] Error details:', JSON.stringify(error, null, 2));
            this._state = ProcessState.FAILED;
            this._exitCode = 1;
            const errorMessage = typeof error === 'string' ? error : JSON.stringify(error, null, 2);
            this.emit(ProcessEvent.ERROR, { pid: this.pid, error: errorMessage });
            this.emit(ProcessEvent.EXIT, { pid: this.pid, exitCode: this._exitCode });
        }
    }

    private setupRequire(context:QuickJSContext) {
        // Create the require function
        const requireFn = context.newFunction("require", (moduleId) => {
            const id = context.getString(moduleId)

            // Special case: http module
            if(id === 'http' && this.networkModule){
                this.httpModule = this.networkModule.createHttpModule()
                return this.httpModule.dup()
            }

            // Check if this is a Node.js builtin module
            // Builtins: 'fs', 'path', 'buffer', etc. OR internal modules: 'internal/errors', etc.
            if (!id.startsWith('./') && !id.startsWith('/')) {
                // Try to resolve as Node.js builtin first
                let builtinPath: string | null = null;

                if (id.startsWith('internal/')) {
                    // Internal module: internal/errors -> /builtins/node/internal/errors.js
                    builtinPath = `/builtins/node/${id}.js`;
                } else if (id.startsWith('node:')) {
                    // node: prefix: node:fs -> /builtins/node/fs.js
                    builtinPath = `/builtins/node/${id.slice(5)}.js`;
                } else {
                    // Check if it's a core Node.js module (fs, path, buffer, etc.)
                    // Try loading from /builtins/node/
                    builtinPath = `/builtins/node/${id}.js`;
                }

                // Try to load the builtin
                if (builtinPath) {
                    try {
                        const builtinCode = this.fileSystem.readFile(builtinPath);
                        if (builtinCode) {
                            // Wrap in CommonJS and evaluate
                            const wrappedCode = `(function(exports, require, module, __filename, __dirname) {
                                ${builtinCode}
                            })`;

                            const result = context.evalCode(wrappedCode, builtinPath);
                            if (result.error) {
                                throw new Error(`Failed to eval ${builtinPath}: ${context.dump(result.error)}`);
                            }

                            // Create module object
                            const moduleObj = context.newObject();
                            const exportsObj = context.newObject();
                            context.setProp(moduleObj, 'exports', exportsObj);

                            // Call the wrapper function
                            const callResult = context.callFunction(result.value, context.undefined, exportsObj, requireFn, moduleObj);
                            result.value.dispose();

                            if (callResult.error) {
                                throw new Error(`Failed to execute ${builtinPath}: ${context.dump(callResult.error)}`);
                            }
                            callResult.value.dispose();

                            // Return module.exports
                            const exports = context.getProp(moduleObj, 'exports');
                            moduleObj.dispose();
                            exportsObj.dispose();

                            return exports;
                        }
                    } catch (e) {
                        // Builtin not found or failed to load, try node_modules
                    }
                }
            }

            // If not a built-in module, try to load as a regular module
            try {
                // Convert the require path to a module path
                let modulePath = id
                if (!id.startsWith('./') && !id.startsWith('/')) {
                    // For bare imports like 'lodash', prefix with /node_modules/
                    modulePath = `/node_modules/${id}`
                }

                // Use evalCode with module type to load the module
                const result = context.evalCode(
                    `import('${modulePath}').then(m => m.default || m)`,
                    'dynamic-import.js',
                    { type: 'module' }
                )

                // Check for evaluation errors
                if (result.error) {
                    throw new Error(`Failed to load module ${id}: ${context.dump(result.error)}`)
                }

                // Get the promise state to handle both sync and async modules
                const promiseState = context.getPromiseState(result.value)
                result.value.dispose()

                if (promiseState.type === 'fulfilled') {
                    return promiseState.value
                } else if (promiseState.type === 'rejected') {
                    const error = context.dump(promiseState.error)
                    promiseState.error.dispose()
                    throw new Error(`Module load failed: ${error}`)
                } else {
                    throw new Error(`Module loading is pending: ${id}`)
                }
            } catch (error:any) {
                // Add some context to the error
                throw new Error(`Cannot find module '${id}': ${error.message}`)
            }
        })

        // Add require to the global scope
        context.setProp(context.global, "require", requireFn)
        requireFn.dispose()

        // Also set up module and exports objects for CommonJS modules
        const moduleObj = context.newObject()
        const exportsObj = context.newObject()
        context.setProp(moduleObj, "exports", exportsObj)
        context.setProp(context.global, "module", moduleObj)
        context.setProp(context.global, "exports", exportsObj)
        moduleObj.dispose()
        exportsObj.dispose()
    }

    private setupNodeInternals(context: QuickJSContext) {
        // Load primordials from actual builtin file - NO STUBS ALLOWED
        const primordialsCode = this.fileSystem.readFile('/builtins/primordials.js');
        if (!primordialsCode) {
            throw new Error('CRITICAL: /builtins/primordials.js not found in filesystem. Builtin files must be provisioned during container initialization.');
        }

        const primordialsResult = context.evalCode(primordialsCode, 'primordials.js');
        if (primordialsResult.error) {
            const error = context.dump(primordialsResult.error);
            primordialsResult.error.dispose();
            throw new Error(`Failed to evaluate primordials.js: ${error}`);
        }

        context.setProp(context.global, 'primordials', primordialsResult.value);
        primordialsResult.value.dispose();

        // Load internalBinding from actual builtin file - NO STUBS ALLOWED
        const bindingCode = this.fileSystem.readFile('/builtins/internalBinding.cjs');
        if (!bindingCode) {
            throw new Error('CRITICAL: /builtins/internalBinding.cjs not found in filesystem. Builtin files must be provisioned during container initialization.');
        }

        const bindingResult = context.evalCode(bindingCode, 'internalBinding.cjs');
        if (bindingResult.error) {
            const error = context.dump(bindingResult.error);
            bindingResult.error.dispose();
            throw new Error(`Failed to evaluate internalBinding.cjs: ${error}`);
        }

        context.setProp(context.global, 'internalBinding', bindingResult.value);
        bindingResult.value.dispose();
    }

    async handleHttpRequest(request: HostRequest): Promise<Response> {
        return new Promise((resolve, reject) => {
            try {
                if (this.httpModule === undefined) {
                    reject (new Error('HTTP module not initialized'));
                    return
                }
                if (this.context == undefined) {
                    reject(new Error("No context found") )
                    return
                }
                let reqObj = NetworkModule.hostRequestToHandle(this.context, {
                    port: request.port,
                    path: request.path,
                    method: request.method,
                    headers: request.headers,
                    body: request.body
                })

                const callbackHandle = this.context.newFunction("callback", (resHandle) => {
                    try {
                        if(this.context==undefined){
                            reject(new Error("No context found"))
                            return
                        }
                        // log('Response received, setting up event handlers')
                        let responseData = ''
                        let resObj = resHandle.dup()
                        const onHandle = this.context.getProp(resObj, "on")

                        const dataListenerHandle = this.context.newFunction("dataListener", (chunkHandle) => {
                            const chunk = this.context?.getString(chunkHandle)
                            // log('Received data chunk', { length: chunk.length })
                            responseData += chunk
                        })

                        const endListenerHandle = this.context.newFunction("endListener", () => {
                            if (this.context == undefined) {
                                reject(new Error("No context found"))
                                return
                            }
                            // log('Response complete', { responseLength: responseData.length })
                            let resObjDup = resObj.dup()
                            let res=this.context.dump(resObjDup)
                            resolve(new Response(responseData, {
                                status: res.status,
                                statusText: statusCodeToStatusText(res.status),
                                headers: res.headers,
                            }))
                            dataListenerHandle?.dispose()
                            endListenerHandle?.dispose()
                        })

                        let resObjDataDup = resObj.dup()
                        this.context.callFunction(onHandle, resObjDataDup, [
                            this.context.newString("data"),
                            dataListenerHandle
                        ])

                        let resObjEndDup = resObj.dup()
                        this.context.callFunction(onHandle, resObjEndDup, [
                            this.context.newString("end"),
                            endListenerHandle
                        ])

                        onHandle.dispose()
                    } catch (error) {
                        // log('Error in response callback', error)
                        reject(error)
                    }
                })

                // log('Initiating request')
                const httpHandle = this.context.getProp(this.context.global, "http")
                const requestHandle = this.context.getProp(httpHandle, "request")

                this.context.callFunction(requestHandle, this.context.undefined, [reqObj, callbackHandle])

                // Cleanup handles
                requestHandle.dispose()
                httpHandle.dispose()
                callbackHandle.dispose()
                reqObj.dispose()

            } catch (error) {
                // log('Error making request', error)
                reject(error)
            }
        })
    }

    async terminate(): Promise<void> {
        if (this._state !== ProcessState.RUNNING) {
            return;
        }

        // this.running = false;
        this._state = ProcessState.TERMINATED;
        this._exitCode = -1;
        this.emit(ProcessEvent.EXIT, { pid: this.pid, exitCode: this._exitCode });
    }
}
