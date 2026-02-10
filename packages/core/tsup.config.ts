import { defineConfig } from 'tsup';
import fs from 'fs';
import path from 'path';
// Identify which build we're running using an environment variable
const isWorkerBuild = process.env.BUILD_TARGET === 'worker';

// Esbuild plugin for ?raw imports
const rawLoaderPlugin = {
    name: 'raw-loader',
    setup(build) {
        build.onResolve({ filter: /\?raw$/ }, args => ({
            path: path.resolve(args.resolveDir, args.path.replace('?raw', '')),
            namespace: 'raw-text',
        }));

        build.onLoad({ filter: /.*/, namespace: 'raw-text' }, async (args) => {
            const text = await fs.promises.readFile(args.path, 'utf8');
            return {
                contents: `export default ${JSON.stringify(text)}`,
                loader: 'js',
            };
        });
    },
};

let config: any = undefined
if (isWorkerBuild) {

    config = defineConfig(
        // First config for worker
        {
            entry: {
                worker: 'src/worker-entry.ts'
            },
            format: ['iife'],
            globalName: 'RemodlWebContainer',
            // minify: true,
            platform: 'browser',
            bundle: true,
            sourcemap: true,
            outDir: 'dist',
            esbuildPlugins: [rawLoaderPlugin],
            onSuccess: async () => {
                const workerCode = fs.readFileSync('dist/worker.global.js', 'utf-8');
                fs.writeFileSync(
                    'src/generated/worker-code.ts',
                    `// Generated file - do not edit\nexport default ${JSON.stringify(workerCode)};\n`
                );
            }
        })
} else {
    // Second config for main package
    config = defineConfig(
        {
            entry: {
                index: 'src/index.ts',
                'worker-code': 'src/generated/worker-code.ts'
            },
            format: ['esm', 'cjs'],
            dts: true,
            clean: false,
            sourcemap: true,
            esbuildPlugins: [rawLoaderPlugin]
        }
    )
}
export default config;
