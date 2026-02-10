declare module '@remodl-web-container/core/worker-code' {
    const workerCode: string;
    export default workerCode;
}

export type SpawnPayload = {
    command: string;
    args: string[];
    parentPid?: number;
    options: {
        cwd: string;
        env: Record<string, string>;
    };
};

export type SpawnedPayload = {
    pid: number;
};

export type ProcessOutputPayload = {
    pid: number;
    output: string;
    isError: boolean;
};

export type ProcessExitPayload = {
    pid: number;
    exitCode: number;
};

export type ProcessErrorPayload = {
    pid: number;
    error: string;
};

/**
 * Configuration for libSQL-backed filesystem
 */
export interface FilesystemConfig {
    /** Organization ID from Keycloak */
    organizationId: string;
    /** User ID (sub claim from Keycloak) */
    userId: string;
    /** Agent ID - which agent co-worker is active */
    agentId: string;
    /** Session ID - unique per WebContainer boot */
    sessionId: string;
    /** Project ID (optional, for project FS namespace) */
    projectId?: string;
    /** libsql-server sync URL (e.g., http://localhost:9010) */
    syncUrl: string;
    /** Auth token for libsql-server */
    authToken?: string;
}

export interface WorkerInitOptions {
    debug?: boolean;
    memoryLimit?: number;
    /** libSQL filesystem configuration (optional - falls back to ZenFSCore if not provided) */
    filesystem?: FilesystemConfig;
}
export interface HttpRequestPayload {
    id: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
    path:string;
    hostname?:string;
}

export interface HttpResponsePayload {
    id: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body?: string;
}

export interface NetworkErrorPayload {
    id: string;
    error: string;
}

export interface GetServersResponsePayload {
    ports: number[];
}

export interface ServerListenPayload {
    port: number;
}

export interface ServerClosePayload {
    port: number;
}


export interface FileSystemPayload {
    writeFile: {
        path: string;
        content: string;
    };
    readFile: {
        path: string;
    };
    deleteFile: {
        path: string;
        recursive?: boolean;
    };
    listFiles: {
        path?: string;
    };
    createDirectory: {
        path: string;
    };
    listDirectory: {
        path: string;
    };
    deleteDirectory: {
        path: string;
    };
}


// Worker Message Types
export interface WorkerMessageBase {
    type: string;
    id?: string;
}

export type WorkerRequestMessage =
    | { type: 'initialize'; payload: WorkerInitOptions }
    | { type: 'spawn'; payload: SpawnPayload }
    | { type: 'writeInput'; payload: { pid: number; input: string } }
    | { type: 'terminate'; payload: { pid: number } }
    | { type: 'dispose' }
    | { type: 'getStats' }
    | { type: 'writeFile'; payload: FileSystemPayload['writeFile']; }
    | { type: 'readFile'; payload: FileSystemPayload['readFile']; }
    | { type: 'deleteFile'; payload: FileSystemPayload['deleteFile']; }
    | { type: 'listFiles'; payload: FileSystemPayload['listFiles']; }
    | { type: 'createDirectory'; payload: FileSystemPayload['createDirectory']; }
    | { type: 'listDirectory'; payload: FileSystemPayload['listDirectory']; }
    | { type: 'deleteDirectory'; payload: FileSystemPayload['deleteDirectory']; }
    | { type: 'httpRequest'; payload: { request: HttpRequestPayload; port: number } }
    | { type: 'listServers' }
    | { type: 'textSearch'; payload: { query: string; options?: any } }
    ;


export type WorkerResponseMessage =
    | { type: 'success' }
    | { type: 'initialized' }
    | { type: 'spawned'; payload: SpawnedPayload }
    | { type: 'inputWritten'; }
    | { type: 'terminated'; payload: ProcessExitPayload; }
    | { type: 'disposed'; }
    | {
        type: 'stats'; payload: {
            network: any;
            processes: {
                pid: number;
                type: string;
                state: string;
                uptime: number | null;
            }[];
        }
    }
    | { type: 'fileWritten'; }
    | { type: 'fileRead'; payload: { content: string } }
    | { type: 'fileDeleted'; }
    | { type: 'fileList'; payload: { files: string[] } }
    | { type: 'directoryCreated'; }
    | { type: 'directoryDeleted'; }
    | { type: 'directoryList'; payload: { directories: string[] } }
    | { type: 'error'; payload: { error: string } }
    | { type: 'processOutput'; payload: ProcessOutputPayload }
    | { type: 'processExit'; payload: ProcessExitPayload }
    | { type: 'processError'; payload: ProcessErrorPayload }
    // network responses
    | { type: 'httpResponse'; payload: { response: HttpResponsePayload, port: number } }
    | { type: 'networkError'; payload: { response: NetworkErrorPayload; port: number } }
    | { type: 'serverList'; payload: GetServersResponsePayload }
    | { type: 'onServerListen'; payload: ServerListenPayload }
    | { type: 'onServerClose'; payload: ServerClosePayload }
    | { type: 'textSearchResult'; payload: any }


export type WorkerMessage = WorkerMessageBase & (WorkerRequestMessage | WorkerResponseMessage);
export type WorkerResponse = WorkerMessageBase & WorkerResponseMessage;
