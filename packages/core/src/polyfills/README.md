# Node.js Polyfills for QuickJS

This directory contains browserified Node.js built-in modules that can be loaded into QuickJS to provide Node.js compatibility.

## What's Included

The `node-polyfills-bundle.js` file contains polyfills for the following Node.js built-ins:

- `http` - HTTP client/server
- `https` - HTTPS client/server
- `crypto` - Cryptographic functions
- `stream` - Stream API (Readable, Writable, Transform, etc.)
- `buffer` - Buffer implementation
- `events` - EventEmitter
- `util` - Utility functions
- `path` - Path manipulation
- `url` - URL parsing
- `querystring` - Query string parsing
- `zlib` - Compression/decompression

## Bundle Size

~1.2MB minified (includes all dependencies)

## Generation

The bundle is generated using Browserify with Babelify transform:

```bash
npx browserify \
  -r http \
  -r https \
  -r crypto \
  -r stream \
  -r buffer \
  -r events \
  -r util \
  -r path \
  -r url \
  -r querystring \
  -r zlib \
  -t [ babelify --presets [ @babel/preset-env ] ] \
  -o src/polyfills/node-polyfills-bundle.js
```

## Usage

### In TypeScript/JavaScript (build-time)

```typescript
import { getPolyfillInitCode, AVAILABLE_MODULES } from './polyfill-loader';

// Get the initialization code
const initCode = getPolyfillInitCode();

// Evaluate in QuickJS
quickjs.evalCode(initCode);

// Now Node.js modules are available
quickjs.evalCode(`
  const http = require('http');
  const crypto = require('crypto');
  // ... use modules
`);
```

### Direct Loading into QuickJS

```typescript
import { QuickJSContext } from 'quickjs-emscripten';
import { getPolyfillBundle } from './polyfill-loader';

async function initQuickJSWithPolyfills(vm: QuickJSContext) {
  // Load the polyfill bundle
  const bundle = getPolyfillBundle();

  // Evaluate it in the QuickJS context
  const result = vm.evalCode(bundle);
  if (result.error) {
    console.error('Failed to load polyfills:', vm.dump(result.error));
    result.error.dispose();
    return false;
  }
  result.value.dispose();

  // Set up global require
  const requireResult = vm.evalCode('globalThis.require = require; globalThis.Buffer = require("buffer").Buffer;');
  requireResult.value.dispose();

  return true;
}
```

## Architecture

```
┌─────────────────────────┐
│   RemodlWebContainer    │
│                         │
│  ┌───────────────────┐  │
│  │ polyfill-loader.ts│  │
│  └────────┬──────────┘  │
│           │             │
│           ▼             │
│  ┌───────────────────┐  │
│  │ node-polyfills-   │  │
│  │    bundle.js      │  │
│  └────────┬──────────┘  │
│           │             │
└───────────┼─────────────┘
            │
            ▼
    ┌───────────────┐
    │   QuickJS     │
    │   (WASM)      │
    │               │
    │ require('http')│
    │ require('crypto')│
    └───────────────┘
```

## Integration Points

1. **WebContainer Boot** - Load polyfills when QuickJS initializes
2. **Process Spawn** - Ensure polyfills are available in each process context
3. **Module Resolution** - Wire `require()` to load from bundle
4. **HTTP Proxy** - Configure http/https modules to use Temporal proxy endpoints (see task #26)

## Next Steps

- [ ] Task #23: Load this bundle into QuickJS module system
- [ ] Task #26: Configure polyfills to use Temporal proxy endpoints
- [ ] Task #10: Wire these polyfills into WebContainer initialization

## Notes

- This bundle is standalone and has no external dependencies
- All polyfills are ES5-compatible (via Babelify transform)
- The bundle creates a global `require()` function that can load any included module
- Some modules (like `http`, `https`) will need to be configured to use proxy endpoints rather than making direct network calls
