import * as esbuild from 'esbuild';
import { nodeModulesPolyfillPlugin } from 'esbuild-plugins-node-modules-polyfill';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const isWatch = process.argv.includes('--watch');
const isAnalyze = process.argv.includes('--analyze');

const shimDir = path.resolve(__dirname, 'src/shims');

const buildOptions = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  minify: isProd,
  sourcemap: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020', 'chrome90', 'firefox88', 'safari14'],
  outdir: 'dist',

  // Code splitting for lazy loading
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',

  // Metafile for analysis
  metafile: isAnalyze,

  plugins: [
    nodeModulesPolyfillPlugin({
      globals: { Buffer: true, process: true },

      // Fallback for any unlisted modules
      fallback: 'empty',

      // Explicit module configuration
      modules: {
        // Enable these polyfills
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
        crypto: true,  // Enable crypto polyfill
        http: true,
        https: true,

        // Disable (use overrides instead)
        fs: false,
        'fs/promises': false,
        net: false,
        tls: false,
        dgram: false,
        dns: false,
        child_process: false,
      },

      // Custom implementations
      overrides: {
        fs: `${shimDir}/fs-webcontainer.ts`,
        'fs/promises': `${shimDir}/fs-webcontainer.ts`,
        net: `${shimDir}/net-websocket.ts`,
        tls: `${shimDir}/tls-websocket.ts`,
        dgram: `${shimDir}/dgram-sse.ts`,
        dns: `${shimDir}/dns-http.ts`,
        child_process: `${shimDir}/child-process-websocket.ts`,
        crypto: `${shimDir}/crypto-hybrid.ts`,  // Hybrid Web Crypto + fallback
      },
    }),

    // Custom plugin for ?raw imports
    {
      name: 'raw-loader',
      setup(build) {
        build.onResolve({ filter: /\?raw$/ }, args => ({
          path: path.resolve(args.resolveDir, args.path.replace('?raw', '')),
          namespace: 'raw-text',
        }));

        build.onLoad({ filter: /.*/, namespace: 'raw-text' }, async (args) => {
          const fs = await import('fs/promises');
          const text = await fs.readFile(args.path, 'utf8');
          return {
            contents: `export default ${JSON.stringify(text)}`,
            loader: 'js',
          };
        });
      },
    },

    // Custom plugin for import.meta.glob
    {
      name: 'glob-loader',
      setup(build) {
        build.onLoad({ filter: /builtins\/index\.ts$/ }, async (args) => {
          const fs = await import('fs/promises');

          const nodeFilesPath = path.join(path.dirname(args.path), 'node');

          // Recursively read all .js files
          async function readDirRecursive(dir, basePath = '') {
            const files = {};
            const entries = await fs.readdir(dir, { withFileTypes: true });

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

          // Read the builtin files directly and inline them
          const primordialsPath = path.join(path.dirname(args.path), 'primordials.js');
          const internalBindingPath = path.join(path.dirname(args.path), 'internalBinding.cjs');

          const primordialsContent = await fs.readFile(primordialsPath, 'utf8');
          const internalBindingContent = await fs.readFile(internalBindingPath, 'utf8');

          // Generate fully static module with all content inlined
          const contents = `
export const builtinSources = {
  'primordials.js': ${JSON.stringify(primordialsContent)},
  'internalBinding.cjs': ${JSON.stringify(internalBindingContent)}
};

export const nodeBuiltinSources = ${JSON.stringify(fileContents)};
          `;

          return {
            contents,
            loader: 'ts',
          };
        });
      },
    },

    // Custom plugin for WASM loading
    {
      name: 'wasm-loader',
      setup(build) {
        build.onResolve({ filter: /\.wasm$/ }, args => ({
          path: path.resolve(args.resolveDir, args.path),
          namespace: 'wasm-binary',
        }));

        build.onLoad({ filter: /.*/, namespace: 'wasm-binary' }, async (args) => {
          const fs = await import('fs/promises');
          const contents = await fs.readFile(args.path);
          return {
            contents,
            loader: 'binary',
          };
        });
      },
    },
  ],

  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    'process.env.GATEWAY_API_URL': JSON.stringify(process.env.GATEWAY_API_URL || 'https://webcontainer-gateway.remodl.ai'),
    'global': 'globalThis',
    '__dirname': '""',
    '__filename': '""',
  },

  loader: {
    '.wasm': 'binary',
    '.node': 'empty',
  },

  banner: {
    js: `/* RemodlWebContainer - Built ${new Date().toISOString()} */`,
  },
};

async function build() {
  try {
    if (isWatch) {
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
      console.log('Watching for changes...');
    } else {
      const result = await esbuild.build(buildOptions);
      console.log('Build complete!');

      if (isAnalyze && result.metafile) {
        const analysis = await esbuild.analyzeMetafile(result.metafile);
        console.log(analysis);
      }
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
