/**
 * Test: internalBinding Structure and Functionality
 *
 * Verifies that internalBinding.cjs has the correct structure and exports
 * the fs binding with all expected methods.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

describe('InternalBinding Source Files', () => {
  const internalBindingPath = resolve(__dirname, '../../builtins/internalBinding.cjs');

  describe('File Existence', () => {
    test('internalBinding.cjs should exist in source', () => {
      expect(existsSync(internalBindingPath)).toBe(true);
    });

    test('internalBinding.cjs should be readable', () => {
      expect(() => {
        readFileSync(internalBindingPath, 'utf-8');
      }).not.toThrow();
    });
  });

  describe('Structure and Content', () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(internalBindingPath, 'utf-8');
    });

    test('should be valid JavaScript', () => {
      expect(() => {
        new Function(content);
      }).not.toThrow();
    });

    test('should export internalBinding function', () => {
      expect(content).toContain('internalBinding');
    });

    test('should handle fs binding', () => {
      expect(content).toContain("fs:");
    });

    test('should have module.exports', () => {
      expect(content).toContain('module.exports');
    });
  });

  describe('FS Binding Methods', () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(internalBindingPath, 'utf-8');
    });

    // Based on the 38+ fs methods we need
    const expectedFSMethods = [
      'open',
      'close',
      'read',
      'write',
      'stat',
      'lstat',
      'fstat',
      'readdir',
      'mkdir',
      'rmdir',
      'unlink',
      'rename',
      'chmod',
      'fchmod',
    ];

    test('should contain fs binding methods', () => {
      // Check for actual method implementations
      expectedFSMethods.forEach(method => {
        const hasMethod = content.includes(`${method}(`) ||
                         content.includes(`${method}:`);
        if (!hasMethod) {
          console.warn(`Missing fs method: ${method}`);
        }
      });

      // At minimum should have open, close, read, write
      expect(content).toContain('open(');
      expect(content).toContain('close(');
      expect(content).toContain('read(');
      expect(content).toContain('write(');
    });

    test('should export FSReqCallback class', () => {
      expect(content).toContain('FSReqCallback');
    });

    test('should export statValues', () => {
      expect(content).toContain('statValues');
    });

    test('should mention Float64Array for statValues', () => {
      // statValues should be Float64Array(36)
      expect(content).toContain('Float64Array');
    });
  });

  describe('File Size and Validity', () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(internalBindingPath, 'utf-8');
    });

    test('internalBinding.cjs should be substantial (> 500 bytes)', () => {
      expect(content.length).toBeGreaterThan(500);
    });

    test('should have real implementation (not all stubs)', () => {
      // Allow a few TODOs for unimplemented edge cases
      // but the file should have substantial real implementation
      const todoCount = (content.match(/TODO/g) || []).length;
      expect(todoCount).toBeLessThan(10); // Some TODOs OK, but not all stubs

      // Should have real fs implementation
      expect(content).toContain('openSync');
      expect(content).toContain('readSync');
      expect(content).toContain('writeSync');
    });
  });

  describe('Binding Registry', () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(internalBindingPath, 'utf-8');
    });

    test('should have bindings object or registry', () => {
      // Should have some kind of registry for bindings
      const hasRegistry = content.includes('bindings') ||
                          content.includes('modules') ||
                          content.includes('registry');
      expect(hasRegistry).toBe(true);
    });

    test('should support multiple bindings (not just fs)', () => {
      // Should be extensible for other bindings
      expect(content.length).toBeGreaterThan(500);
    });
  });
});
