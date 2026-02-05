import type { FilesystemConfig } from '../worker/types';

export interface ContainerOptions {
    debug?: boolean;
    maxProcesses?: number;
    memoryLimit?: number;
    onServerListen?: (port: number) => void;
    onServerClose?: (port: number) => void;
    /** libSQL filesystem configuration (optional - falls back to ZenFSCore if not provided) */
    filesystem?: FilesystemConfig;
}

export interface ContainerStats {
    network: NetworkStats;
    processes: {
        pid: number;
        type: string;
        state: string;
        uptime: number | null;
    } [];
}

export interface NetworkStats {
    servers: {
        total: number;
        active: number;
        byType: any;
    };
    connections: {
        total: number;
        active: number;
        byServer: Record<string, number>;
    };
    traffic: {
        bytesReceived: number;
        bytesSent: number;
        requestsTotal: number;
        requestsSuccess: number;
        requestsFailed: number;
        avgResponseTime: number;
    };
    requestsPerMinute: number;
}
