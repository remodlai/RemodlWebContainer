/**
 * Test: Primordials Loading and Structure
 *
 * Verifies that primordials.js exists and has the expected structure.
 * This is a unit test that checks the source files directly.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

describe('Primordials Source Files', () => {
  const primordialsPath = resolve(__dirname, '../../builtins/primordials.js');

  describe('File Existence', () => {
    test('primordials.js should exist in source', () => {
      expect(existsSync(primordialsPath)).toBe(true);
    });

    test('primordials.js should be readable', () => {
      expect(() => {
        readFileSync(primordialsPath, 'utf-8');
      }).not.toThrow();
    });
  });

  describe('Structure and Content', () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(primordialsPath, 'utf-8');
    });

    test('should be valid JavaScript', () => {
      expect(() => {
        new Function(content);
      }).not.toThrow();
    });

    test('should contain Object methods', () => {
      expect(content).toContain('ObjectAssign');
    });

    test('should contain ObjectDefineProperty primordial', () => {
      expect(content).toContain('ObjectDefineProperty');
    });

    test('should contain ArrayPrototype primordials', () => {
      expect(content).toContain('ArrayPrototype');
    });

    test('should contain StringPrototype primordials', () => {
      expect(content).toContain('StringPrototype');
    });

    test('should contain primordials module structure', () => {
      // Should have module.exports or export statement
      const hasModuleExports = content.includes('module.exports') ||
                               content.includes('export');
      expect(hasModuleExports).toBe(true);
    });
  });

  describe('Key Primordials Present', () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(primordialsPath, 'utf-8');
    });

    const expectedPrimordials = [
      'ObjectDefineProperty',
      'ObjectGetOwnPropertyDescriptor',
      'ObjectKeys',
      'ObjectValues',
      'ArrayIsArray',
      'ArrayPrototypeMap',
      'ArrayPrototypeFilter',
      'StringPrototypeSlice',
      'FunctionPrototypeBind',
    ];

    expectedPrimordials.forEach(primordial => {
      test(`should contain ${primordial}`, () => {
        expect(content).toContain(primordial);
      });
    });
  });

  describe('File Size and Validity', () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(primordialsPath, 'utf-8');
    });

    test('primordials.js should be substantial (> 1KB)', () => {
      expect(content.length).toBeGreaterThan(1024);
    });

    test('should not contain placeholder or stub content', () => {
      // Should not be a stub
      expect(content).not.toContain('TODO');
      expect(content).not.toContain('STUB');
      expect(content).not.toContain('placeholder');
    });
  });
});
