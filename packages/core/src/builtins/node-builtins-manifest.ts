/**
 * Manifest of Node.js builtin files to copy to ZenFS
 *
 * This is a curated list of essential Node.js modules needed for runtime.
 * Full 292 files will be added via template seeding (Task #8).
 */

export const NODE_BUILTINS_MANIFEST = [
    // === Core Modules ===
    'fs.js',
    'path.js',
    'util.js',
    'events.js',
    'stream.js',
    'buffer.js',
    'crypto.js',
    'os.js',
    'net.js',
    'http.js',
    'https.js',
    'child_process.js',
    'url.js',
    'querystring.js',
    'assert.js',
    'timers.js',
    'console.js',
    'process.js',
    'tty.js',
    'zlib.js',

    // === Internal Modules ===
    'internal/errors.js',
    'internal/util.js',
    'internal/validators.js',
    'internal/constants.js',
    'internal/streams/utils.js',
    'internal/fs/utils.js',
    'internal/fs/dir.js',
    'internal/fs/promises.js',
    'internal/fs/streams.js',
    'internal/buffer.js',
    'internal/url.js',
    'internal/querystring.js',
    'internal/process/warning.js',
    'internal/assert.js',
    'internal/util/types.js',
    'internal/util/inspect.js',

    // === Bootstrap ===
    'internal/bootstrap/node.js',
    'internal/bootstrap/loaders.js',

    // === Modules System ===
    'internal/modules/cjs/loader.js',
    'internal/modules/cjs/helpers.js',
    'internal/modules/esm/resolve.js',
] as const;
