import { defineConfig } from 'tsup';
import fs from'fs';
// Identify which build we're running using an environment variable
const isWorkerBuild = process.env.BUILD_TARGET === 'worker';

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
            sourcemap: true
        }
    )
}
export default config;
