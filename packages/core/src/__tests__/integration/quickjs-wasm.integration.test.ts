/**
 * Integration Test: QuickJS WASM Loading
 *
 * Tests if QuickJS WASM can load with proper locateFile configuration.
 * Matches coder's fix in process.ts:40-51
 */

import { newQuickJSAsyncWASMModuleFromVariant } from 'quickjs-emscripten';
import baseVariant from '@jitl/quickjs-ng-wasmfile-release-asyncify';

describe('QuickJS WASM Loading Integration', () => {
  describe('With locateFile (matching coder fix)', () => {
    let QuickJS: any;

    beforeAll(async () => {
      // Match coder's approach from process.ts:40-51
      const variantWithLocateFile = {
        ...baseVariant,
        locateFile: (path: string) => {
          if (path.endsWith('.wasm')) {
            // In Node.js tests: resolve from node_modules
            try {
              const resolved = require.resolve(
                '@jitl/quickjs-ng-wasmfile-release-asyncify/dist/emscripten-module.wasm'
              );
              return resolved;
            } catch (e) {
              // Fallback (for browser/worker)
              return '/emscripten-module.wasm';
            }
          }
          return path;
        }
      };

      QuickJS = await newQuickJSAsyncWASMModuleFromVariant(variantWithLocateFile);
    }, 30000);

    test('QuickJS module loads successfully', () => {
      expect(QuickJS).toBeDefined();
      expect(QuickJS).not.toBeNull();
    });

    test('can create runtime', () => {
      const runtime = QuickJS.newRuntime();
      expect(runtime).toBeDefined();
      runtime.dispose();
    });

    test('can create context', () => {
      const runtime = QuickJS.newRuntime();
      const context = runtime.newContext();
      expect(context).toBeDefined();
      context.dispose();
      runtime.dispose();
    });

    test('can evaluate: 1 + 1 = 2', () => {
      const runtime = QuickJS.newRuntime();
      const context = runtime.newContext();
      const result = context.evalCode('1 + 1');
      expect(result.error).toBeUndefined();
      const value = context.dump(result.value);
      expect(value).toBe(2);
      result.value.dispose();
      context.dispose();
      runtime.dispose();
    });

    test('can evaluate: string concatenation', () => {
      const runtime = QuickJS.newRuntime();
      const context = runtime.newContext();
      const result = context.evalCode('"hello " + "world"');
      expect(result.error).toBeUndefined();
      const value = context.dump(result.value);
      expect(value).toBe('hello world');
      result.value.dispose();
      context.dispose();
      runtime.dispose();
    });

    test('can evaluate: array.map()', () => {
      const runtime = QuickJS.newRuntime();
      const context = runtime.newContext();
      const result = context.evalCode('[1, 2, 3].map(x => x * 2)');
      expect(result.error).toBeUndefined();
      const value = context.dump(result.value);
      expect(value).toEqual([2, 4, 6]);
      result.value.dispose();
      context.dispose();
      runtime.dispose();
    });

    test('can define and call functions', () => {
      const runtime = QuickJS.newRuntime();
      const context = runtime.newContext();
      const result = context.evalCode('function add(a,b){return a+b;} add(5,3)');
      expect(result.error).toBeUndefined();
      const value = context.dump(result.value);
      expect(value).toBe(8);
      result.value.dispose();
      context.dispose();
      runtime.dispose();
    });

    test('handles errors correctly', () => {
      const runtime = QuickJS.newRuntime();
      const context = runtime.newContext();
      const result = context.evalCode('throw new Error("test")');
      expect(result.error).toBeDefined();
      const errorMessage = context.dump(result.error);
      expect(errorMessage).toContain('test');
      result.error.dispose();
      context.dispose();
      runtime.dispose();
    });
  });
});
