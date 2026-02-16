/**
 * Runtime Entry Point - runs INSIDE the hidden iframe
 *
 * This is the "server" side of the Comlink RPC bridge.
 * It creates a ContainerManager (heavy runtime) and exposes it
 * to the parent window via MessagePort + Comlink.
 *
 * The parent window (thin client) connects by listening for
 * the 'init' message and wrapping the received port with Comlink.wrap().
 */

import * as Comlink from 'comlink';
import { ContainerManager } from './container/container';
import type { FilesystemConfig } from './worker/types';

interface BuildConfig {
  host: string;
  version: string;
  workdirName?: string;
  forwardPreviewErrors?: boolean | 'exceptions-only';
  filesystem?: FilesystemConfig;
  baseUrl?: string;
}

interface RuntimeInfo {
  path: string;
  cwd: string;
}

/**
 * Server object exposed to parent via Comlink.
 * Matches the StackBlitz pattern: parent calls server.build(config)
 * which returns a proxy to the container instance.
 */
const server = {
  async build(config: BuildConfig) {
    const workdirName = config.workdirName || '/home/project';

    const container = new ContainerManager({
      debug: false,
      maxProcesses: 20,
      memoryLimit: 1024 * 1024 * 1024,
      filesystem: config.filesystem,
      baseUrl: config.baseUrl,
      onServerListen: (port: number) => {
        // Will be forwarded via events
      },
      onServerClose: (port: number) => {
        // Will be forwarded via events
      },
    });

    await container.waitForReady();

    // Create working directory
    try {
      await container.createDirectory(workdirName);
    } catch (_e) {
      // Directory might already exist
    }

    // Build the instance API that the thin client will call through Comlink
    const instance = {
      // FS operations
      async readFile(path: string, encoding?: string | null) {
        const content = await container.readFile(path);
        if (encoding === null || encoding === undefined) {
          return new TextEncoder().encode(content);
        }
        return content;
      },

      async writeFile(path: string, data: string | Uint8Array, _options?: any) {
        const content = typeof data === 'string' ? data : new TextDecoder().decode(data);
        await container.writeFile(path, content);
      },

      async readdir(path: string, options?: any) {
        const entries = await container.listDirectory(path);
        if (!Array.isArray(entries)) return [];

        const withFileTypes = typeof options === 'object' && options?.withFileTypes === true;
        if (withFileTypes) {
          return entries.map((name: string) => ({
            name,
            'Symbol(type)': 2, // DIR_ENTRY_TYPE_DIR - TODO: check actual type
          }));
        }
        return entries;
      },

      async mkdir(path: string, options?: any) {
        await container.createDirectory(path);
        if (typeof options === 'object' && options?.recursive === true) {
          return path;
        }
      },

      async rm(path: string, options?: { force?: boolean; recursive?: boolean }) {
        await container.deleteFile(path, options?.recursive);
      },

      async rename(oldPath: string, newPath: string) {
        if (container.rename) {
          await container.rename(oldPath, newPath);
        } else {
          const content = await container.readFile(oldPath);
          await container.writeFile(newPath, content);
          await container.deleteFile(oldPath);
        }
      },

      async watch(path: string, options: any, listener: any) {
        const watcher = container.watch(path, (eventType: string, filename: string | null) => {
          if (listener) listener(eventType, filename);
        });
        return Comlink.proxy(watcher);
      },

      // Process operations
      async run(
        params: { command: string; args: string[]; cwd?: string; env?: Record<string, string>; terminal?: { cols: number; rows: number } },
        stdout: ((data: string | null) => void) | undefined,
        stderr: ((data: string | null) => void) | undefined,
        output: ((data: string | null) => void) | undefined,
      ) {
        const process = await container.spawn(params.command, params.args || [], {
          cwd: params.cwd || workdirName,
          env: params.env,
        });

        // Wire up output streams
        process.on('output', (data: any) => {
          if (output) output(new TextEncoder().encode(data.output) as any);
          if (stdout) stdout(new TextEncoder().encode(data.output) as any);
        });

        const exitPromise = new Promise<number>((resolve) => {
          process.on('exit', (data: any) => {
            if (output) output(null);
            if (stdout) stdout(null);
            if (stderr) stderr(null);
            resolve(data.exitCode ?? 0);
          });
        });

        process.on('error', (data: any) => {
          if (stderr) stderr(new TextEncoder().encode(data.error) as any);
        });

        return Comlink.proxy({
          get onExit() { return exitPromise; },
          write: (data: string) => process.write(data),
          kill: () => process.kill(),
          resize: (dimensions: { cols: number; rows: number }) => {
            if (typeof (process as any).resize === 'function') {
              (process as any).resize(dimensions);
            }
          },
        });
      },

      // Mount: load file tree
      async loadFiles(payload: Uint8Array, options?: { mountPoints?: string }) {
        // Parse the JSON file tree from payload
        const json = new TextDecoder().decode(payload);
        const tree = JSON.parse(json);
        await writeTree(container, tree, options?.mountPoints || workdirName);
      },

      // Export / serialize
      async serialize(path: string, options: { format: string; includes?: string[]; excludes?: string[]; external?: boolean }) {
        // TODO: implement full serialize
        throw new Error('serialize() not yet implemented in runtime');
      },

      // Events
      async on(event: string, listener: (...args: any[]) => void) {
        // TODO: wire up port/server-ready/error/etc events from container
        return () => {};
      },

      // Preview script
      async setPreviewScript(scriptSrc: string, options?: any) {
        // TODO: inject into preview iframes
      },

      // Credentials
      async setCredentials(creds: { accessToken: string; editorOrigin: string }) {
        // TODO: forward to container for private package access
      },

      // FS proxy (StackBlitz pattern: instance.fs() returns FS proxy)
      async fs() {
        return Comlink.proxy({
          readFile: instance.readFile,
          writeFile: instance.writeFile,
          readdir: instance.readdir,
          mkdir: instance.mkdir,
          rm: instance.rm,
          rename: instance.rename,
          watch: instance.watch,
        });
      },

      async previewScript() {
        return null;
      },

      async runtimeInfo(): Promise<RuntimeInfo> {
        return {
          path: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
          cwd: workdirName,
        };
      },

      async teardown() {
        await container.dispose();
      },
    };

    return Comlink.proxy(instance);
  },
};

/**
 * Recursively write a FileSystemTree to the container
 */
async function writeTree(container: ContainerManager, tree: any, basePath: string) {
  for (const [name, node] of Object.entries(tree) as [string, any][]) {
    const fullPath = `${basePath}/${name}`;

    if (node.directory !== undefined) {
      try {
        await container.createDirectory(fullPath);
      } catch (_e) {
        // exists
      }
      await writeTree(container, node.directory, fullPath);
    } else if (node.file !== undefined) {
      if (node.file.symlink !== undefined) {
        // Symlinks: write as regular file for now
        await container.writeFile(fullPath, `-> ${node.file.symlink}`);
      } else {
        const contents = node.file.contents;
        const data = typeof contents === 'string' ? contents : new TextDecoder().decode(contents);
        await container.writeFile(fullPath, data);
      }
    }
  }
}

// --- Bootstrap: create MessageChannel and send port to parent ---

const { port1, port2 } = new MessageChannel();
Comlink.expose(server, port1);

// Send port2 to parent window
window.parent.postMessage({ type: 'init' }, '*', [port2]);
