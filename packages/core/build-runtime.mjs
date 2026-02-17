/**
 * Build the runtime-entry bundle for the iframe.
 *
 * Reuses the same polyfill/shim config as build.mjs so that all Node.js
 * built-ins are properly shimmed for the browser.
 *
 * Usage:
 *   pnpm --filter @remodl-web-container/core build:runtime
 */
import * as esbuild from 'esbuild';
import { nodeModulesPolyfillPlugin } from 'esbuild-plugins-node-modules-polyfill';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outDir = path.join(repoRoot, 'dist');

await fs.mkdir(outDir, { recursive: true });

const tempFile = path.join(outDir, 'remodl-webcontainer.temp.js');

await esbuild.build({
  entryPoints: [
    path.join(repoRoot, 'packages/api/src/runtime-entry.ts'),
  ],
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020', 'chrome90', 'firefox88', 'safari14'],
  outfile: tempFile,

  alias: {
    '@remodl-web-container/core': path.join(__dirname, 'src/index.ts'),
  },

  // Externalize QuickJS -- only needed for spawn(), not filesystem ops.
  // The dynamic import() in process.ts won't resolve at runtime, which is
  // fine: spawn() will fail gracefully until QuickJS is loaded separately.
  external: [
    'quickjs-emscripten',
    'quickjs-emscripten-core',
    '@jitl/quickjs-ng-wasmfile-release-asyncify',
    '@jitl/quickjs-ng-wasmfile-release-sync',
    '@jitl/quickjs-ng-wasmfile-debug-asyncify',
    '@jitl/quickjs-ng-wasmfile-debug-sync',
  ],

  plugins: [
    nodeModulesPolyfillPlugin({
      globals: { Buffer: true, process: true },
      fallback: 'empty',
      modules: {
        buffer: true,
        events: true,
        stream: true,
        util: true,
        path: true,
        url: true,
        querystring: true,
        string_decoder: true,
        zlib: true,
        assert: true,
        os: true,
        timers: true,
        'timers/promises': true,
        crypto: true,
        http: true,
        https: true,
        // Disabled -- use custom shims via overrides
        fs: false,
        'fs/promises': false,
        net: false,
        tls: false,
        dgram: false,
        dns: false,
        child_process: false,
      },
      overrides: {
        fs: path.join(__dirname, 'src/shims/fs-webcontainer.ts'),
        'fs/promises': path.join(__dirname, 'src/shims/fs-webcontainer.ts'),
        net: path.join(__dirname, 'src/shims/net-websocket.ts'),
        tls: path.join(__dirname, 'src/shims/tls-websocket.ts'),
        dgram: path.join(__dirname, 'src/shims/dgram-sse.ts'),
        dns: path.join(__dirname, 'src/shims/dns-http.ts'),
        child_process: path.join(__dirname, 'src/shims/child-process-websocket.ts'),
        crypto: path.join(__dirname, 'src/shims/crypto-hybrid.ts'),
      },
    }),

    // Inline ?raw imports as string constants
    {
      name: 'raw-loader',
      setup(build) {
        build.onResolve({ filter: /\?raw$/ }, args => ({
          path: path.resolve(args.resolveDir, args.path.replace('?raw', '')),
          namespace: 'raw-text',
        }));
        build.onLoad({ filter: /.*/, namespace: 'raw-text' }, async (args) => {
          const text = await fs.readFile(args.path, 'utf8');
          return { contents: `export default ${JSON.stringify(text)}`, loader: 'js' };
        });
      },
    },

    // Inline builtin JS files at build time
    {
      name: 'glob-loader',
      setup(build) {
        build.onLoad({ filter: /builtins\/index\.ts$/ }, async (args) => {
          const nodeFilesPath = path.join(path.dirname(args.path), 'node');

          async function readDirRecursive(dir, basePath = '') {
            const files = {};
            let entries;
            try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return files; }
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
              if (entry.isDirectory()) {
                Object.assign(files, await readDirRecursive(fullPath, relativePath));
              } else if (entry.name.endsWith('.js')) {
                files[relativePath] = await fs.readFile(fullPath, 'utf8');
              }
            }
            return files;
          }

          const fileContents = await readDirRecursive(nodeFilesPath);
          const primordialsPath = path.join(path.dirname(args.path), 'primordials.js');
          const internalBindingPath = path.join(path.dirname(args.path), 'internalBinding.cjs');

          let primordialsContent = '', internalBindingContent = '';
          try { primordialsContent = await fs.readFile(primordialsPath, 'utf8'); } catch {}
          try { internalBindingContent = await fs.readFile(internalBindingPath, 'utf8'); } catch {}

          return {
            contents: `
export const builtinSources = {
  'primordials.js': ${JSON.stringify(primordialsContent)},
  'internalBinding.cjs': ${JSON.stringify(internalBindingContent)}
};
export const nodeBuiltinSources = ${JSON.stringify(fileContents)};
            `,
            loader: 'ts',
          };
        });
      },
    },

    // Load .wasm as binary data (inline base64)
    {
      name: 'wasm-loader',
      setup(build) {
        build.onResolve({ filter: /\.wasm$/ }, args => ({
          path: path.resolve(args.resolveDir, args.path),
          namespace: 'wasm-binary',
        }));
        build.onLoad({ filter: /.*/, namespace: 'wasm-binary' }, async (args) => {
          const contents = await fs.readFile(args.path);
          return { contents, loader: 'binary' };
        });
      },
    },
  ],

  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.GATEWAY_API_URL': '"https://webcontainer-gateway.remodl.ai"',
    'global': 'globalThis',
    '__dirname': '""',
    '__filename': '""',
  },

  loader: {
    '.wasm': 'binary',
    '.node': 'empty',
  },

  banner: {
    js: `/* RemodlWebContainer Runtime - Built ${new Date().toISOString()} */`,
  },
});

// Content-hash the output and rename
const content = await fs.readFile(tempFile);
const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
const finalFile = path.join(outDir, `remodl-webcontainer.${hash}.js`);
await fs.rename(tempFile, finalFile);
await fs.writeFile(path.join(outDir, 'bundle-hash.txt'), hash);

const sizeKB = (content.length / 1024).toFixed(0);
console.log(`Runtime bundle: remodl-webcontainer.${hash}.js (${sizeKB} KB)`);
console.log(`Hash: ${hash}`);
