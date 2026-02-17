/**
 * Runtime Entry Point - runs INSIDE the hidden iframe
 *
 * This is the "server" side of the Comlink RPC bridge.
 * It creates a RemodlWebContainer directly (no nested Worker)
 * and exposes it to the parent window via MessagePort + Comlink.
 *
 * The parent window (thin client) connects by listening for
 * the 'init' message and wrapping the received port with Comlink.wrap().
 */

import * as Comlink from 'comlink';
import { RemodlWebContainer, ProcessEvent } from '@remodl-web-container/core';

interface BuildConfig {
  host: string;
  version: string;
  workdirName?: string;
  forwardPreviewErrors?: boolean | 'exceptions-only';
  filesystem?: any;
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

    // Direct instantiation - no nested Worker/WorkerBridge
    console.log('[runtime-entry] Creating container with filesystem config:', config.filesystem);
    const container = await RemodlWebContainer.create({
      debug: true, // Enable debug logging to see libSQL init
      filesystem: config.filesystem,
      onServerListen: (port: number) => {
        // Will be forwarded via events
      },
      onServerClose: (port: number) => {
        // Will be forwarded via events
      },
    });

    // Create working directory
    try {
      container.createDirectory(workdirName);
    } catch (_e) {
      // Directory might already exist
    }

    // Build the instance API that the thin client will call through Comlink
    const instance = {
      // FS operations
      async readFile(path: string, encoding?: string | null) {
        const content = container.readFile(path);
        if (encoding === null || encoding === undefined) {
          return new TextEncoder().encode(content || '');
        }
        return content || '';
      },

      async writeFile(path: string, data: string | Uint8Array, _options?: any) {
        const content = typeof data === 'string' ? data : new TextDecoder().decode(data);
        container.writeFile(path, content);
      },

      async readdir(path: string, options?: any) {
        const entries = container.listDirectory(path);
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
        container.createDirectory(path);
        if (typeof options === 'object' && options?.recursive === true) {
          return path;
        }
      },

      async rm(path: string, options?: { force?: boolean; recursive?: boolean }) {
        container.deleteFile(path);
      },

      async rename(oldPath: string, newPath: string) {
        const content = container.readFile(oldPath);
        container.writeFile(newPath, content || '');
        container.deleteFile(oldPath);
      },

      async watch(path: string, options: any, listener: any) {
        // TODO: implement watch via filesystem events
        return Comlink.proxy({ close() {} });
      },

      // Process operations
      async run(
        params: { command: string; args: string[]; cwd?: string; env?: Record<string, string>; terminal?: { cols: number; rows: number } },
        stdout: ((data: string | null) => void) | undefined,
        stderr: ((data: string | null) => void) | undefined,
        output: ((data: string | null) => void) | undefined,
      ) {
        const process = await container.spawn(params.command, params.args || [], undefined, {
          cwd: params.cwd || workdirName,
          env: params.env,
        });

        // Wire up output streams via core Process events
        process.addEventListener(ProcessEvent.MESSAGE, (data: any) => {
          if (data.stdout) {
            const encoded = new TextEncoder().encode(data.stdout) as any;
            if (output) output(encoded);
            if (stdout) stdout(encoded);
          }
          if (data.stderr) {
            const encoded = new TextEncoder().encode(data.stderr) as any;
            if (stderr) stderr(encoded);
          }
        });

        const exitPromise = new Promise<number>((resolve) => {
          process.addEventListener(ProcessEvent.EXIT, (data: any) => {
            if (output) output(null);
            if (stdout) stdout(null);
            if (stderr) stderr(null);
            resolve(data.exitCode ?? 0);
          });
        });

        process.addEventListener(ProcessEvent.ERROR, (data: any) => {
          if (stderr) stderr(new TextEncoder().encode(data.error?.message || String(data.error)) as any);
        });

        return Comlink.proxy({
          get onExit() { return exitPromise; },
          write: (data: string) => process.writeInput(data),
          kill: () => process.terminate(),
          resize: (dimensions: { cols: number; rows: number }) => {
            // Resize not supported in core Process
          },
        });
      },

      // Mount: load file tree
      async loadFiles(payload: Uint8Array, options?: { mountPoints?: string }) {
        const json = new TextDecoder().decode(payload);
        const tree = JSON.parse(json);
        writeTree(container, tree, options?.mountPoints || workdirName);
      },

      // Export / serialize
      async serialize(path: string, options: { format: string; includes?: string[]; excludes?: string[]; external?: boolean }) {
        throw new Error('serialize() not yet implemented in runtime');
      },

      // Events
      async on(event: string, listener: (...args: any[]) => void) {
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
function writeTree(container: RemodlWebContainer, tree: any, basePath: string) {
  for (const [name, node] of Object.entries(tree) as [string, any][]) {
    const fullPath = `${basePath}/${name}`;

    if (node.directory !== undefined) {
      try {
        container.createDirectory(fullPath);
      } catch (_e) {
        // exists
      }
      writeTree(container, node.directory, fullPath);
    } else if (node.file !== undefined) {
      if (node.file.symlink !== undefined) {
        container.writeFile(fullPath, `-> ${node.file.symlink}`);
      } else {
        const contents = node.file.contents;
        const data = typeof contents === 'string' ? contents : new TextDecoder().decode(contents);
        container.writeFile(fullPath, data);
      }
    }
  }
}

// --- Bootstrap: create MessageChannel and send port to parent ---

// Report any unhandled errors to parent so they don't silently swallow the init
window.addEventListener('error', (event) => {
  window.parent.postMessage({ type: 'warning', level: 'error', message: `[runtime] ${event.message}` }, '*');
});
window.addEventListener('unhandledrejection', (event) => {
  window.parent.postMessage({ type: 'warning', level: 'error', message: `[runtime] Unhandled rejection: ${event.reason}` }, '*');
});

const { port1, port2 } = new MessageChannel();
Comlink.expose(server, port1);

// Send port2 to parent window
window.parent.postMessage({ type: 'init' }, '*', [port2]);
