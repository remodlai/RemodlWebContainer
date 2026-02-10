/**
 * Runtime Execution Test: WebContainer with QuickJS
 *
 * Tests that actually EXECUTE code inside WebContainer to verify:
 * - QuickJS loads and runs
 * - Primordials available as globals
 * - internalBinding callable
 * - require() resolves builtins
 */

import { RemodlWebContainer } from '../../container';
import { ProcessEvent } from '../../process';

describe('WebContainer Runtime Execution', () => {
  let container: RemodlWebContainer;

  beforeAll(async () => {
    container = await RemodlWebContainer.create({ debug: true });
  }, 60000);

  afterAll(async () => {
    if (container) {
      await container.dispose();
    }
  });

  // Helper to capture process output
  async function runCode(code: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const testFile = '/test-' + Date.now() + '.js';
    container.writeFile(testFile, code);

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let exitCode = 0;

      container.spawn('node', [testFile]).then(process => {
        process.addEventListener(ProcessEvent.MESSAGE, (data) => {
          if (data.stdout) stdout += data.stdout;
          if (data.stderr) stderr += data.stderr;
        });

        process.addEventListener(ProcessEvent.EXIT, (data) => {
          exitCode = data.exitCode ?? 1;
          resolve({ stdout, stderr, exitCode });
        });
      }).catch(error => {
        resolve({ stdout: '', stderr: error.message, exitCode: 1 });
      });
    });
  }

  describe('Basic JavaScript Execution', () => {
    test('should execute simple console.log', async () => {
      const result = await runCode(`console.log('hello world');`);
      expect(result.stdout).toContain('hello world');
      expect(result.exitCode).toBe(0);
    }, 30000);

    test('should execute arithmetic: 1 + 1', async () => {
      const result = await runCode(`console.log(1 + 1);`);
      expect(result.stdout).toContain('2');
      expect(result.exitCode).toBe(0);
    }, 30000);

    test('should execute string operations', async () => {
      const result = await runCode(`console.log('hello ' + 'world');`);
      expect(result.stdout).toContain('hello world');
      expect(result.exitCode).toBe(0);
    }, 30000);

    test('should execute array operations', async () => {
      const result = await runCode(`
        const arr = [1, 2, 3];
        const doubled = arr.map(x => x * 2);
        console.log(JSON.stringify(doubled));
      `);
      expect(result.stdout).toContain('[2,4,6]');
      expect(result.exitCode).toBe(0);
    }, 30000);
  });

  describe('Primordials Global Availability', () => {
    test('should have primordials as global object', async () => {
      const result = await runCode(`
        console.log('primordials type:', typeof primordials);
        console.log('is object:', typeof primordials === 'object');
      `);
      expect(result.stdout).toContain('primordials type: object');
      expect(result.stdout).toContain('is object: true');
      expect(result.exitCode).toBe(0);
    }, 30000);

    test('should have ArrayIsArray in primordials', async () => {
      const result = await runCode(`
        console.log('ArrayIsArray type:', typeof primordials.ArrayIsArray);
        console.log('ArrayIsArray works:', primordials.ArrayIsArray([]));
      `);
      expect(result.stdout).toContain('ArrayIsArray type: function');
      expect(result.stdout).toContain('ArrayIsArray works: true');
      expect(result.exitCode).toBe(0);
    }, 30000);

    test('should execute ArrayPrototypeMap from primordials', async () => {
      const result = await runCode(`
        const result = primordials.ArrayPrototypeMap([1,2,3], x => x * 2);
        console.log('result:', JSON.stringify(result));
      `);
      expect(result.stdout).toContain('[2,4,6]');
      expect(result.exitCode).toBe(0);
    }, 30000);

    test('primordials should be frozen', async () => {
      const result = await runCode(`
        console.log('frozen:', Object.isFrozen(primordials));
      `);
      expect(result.stdout).toContain('frozen: true');
      expect(result.exitCode).toBe(0);
    }, 30000);
  });

  describe('InternalBinding Global Availability', () => {
    test('should have internalBinding as global function', async () => {
      const result = await runCode(`
        console.log('internalBinding type:', typeof internalBinding);
      `);
      expect(result.stdout).toContain('internalBinding type: function');
      expect(result.exitCode).toBe(0);
    }, 30000);

    test('should be able to call internalBinding("fs")', async () => {
      const result = await runCode(`
        const fs = internalBinding('fs');
        console.log('fs type:', typeof fs);
        console.log('has open:', typeof fs.open);
      `);
      expect(result.stdout).toContain('fs type: object');
      expect(result.stdout).toContain('has open: function');
      expect(result.exitCode).toBe(0);
    }, 30000);

    test('internalBinding("fs") should have statValues', async () => {
      const result = await runCode(`
        const fs = internalBinding('fs');
        console.log('statValues type:', fs.statValues.constructor.name);
        console.log('statValues length:', fs.statValues.length);
      `);
      expect(result.stdout).toContain('statValues type: Float64Array');
      expect(result.stdout).toContain('statValues length: 36');
      expect(result.exitCode).toBe(0);
    }, 30000);
  });

  describe('Module Loading with require()', () => {
    test('should be able to require("fs")', async () => {
      const result = await runCode(`
        const fs = require('fs');
        console.log('fs type:', typeof fs);
        console.log('has readFileSync:', typeof fs.readFileSync);
      `);
      expect(result.stdout).toContain('fs type: object');
      expect(result.exitCode).toBe(0);
    }, 30000);

    test('should be able to require("path")', async () => {
      const result = await runCode(`
        const path = require('path');
        console.log('path type:', typeof path);
        console.log('has join:', typeof path.join);
      `);
      expect(result.stdout).toContain('path type: object');
      expect(result.exitCode).toBe(0);
    }, 30000);

    test('should be able to require internal modules', async () => {
      const result = await runCode(`
        const errors = require('internal/errors');
        console.log('errors type:', typeof errors);
      `);
      expect(result.stdout).toContain('errors type: object');
      expect(result.exitCode).toBe(0);
    }, 30000);
  });

  describe('Error Handling', () => {
    test('should capture errors with stack traces', async () => {
      const result = await runCode(`
        throw new Error('test error');
      `);
      expect(result.stderr).toContain('test error');
      expect(result.exitCode).toBe(1);
    }, 30000);

    test('should handle syntax errors', async () => {
      const result = await runCode(`
        this is invalid javascript
      `);
      expect(result.stderr.length).toBeGreaterThan(0);
      expect(result.exitCode).toBe(1);
    }, 30000);
  });
});
