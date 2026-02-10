/**
 * Test: Module Loader and require() Resolution
 *
 * Verifies that the module loader can correctly resolve Node.js builtins
 * from the /builtins/node/ directory.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

describe('Module Loader Resolution', () => {
  const nodeBuiltinsDir = resolve(__dirname, '../../builtins/node');

  describe('Builtin Module Files', () => {
    const builtinModules = [
      'fs.js',
      'path.js',
      'buffer.js',
      'events.js',
      'stream.js',
      'util.js',
      'assert.js',
      'querystring.js',
      'url.js',
    ];

    builtinModules.forEach(module => {
      test(`${module} should exist and be loadable`, () => {
        const modulePath = resolve(nodeBuiltinsDir, module);
        expect(existsSync(modulePath)).toBe(true);

        const content = readFileSync(modulePath, 'utf-8');
        expect(content.length).toBeGreaterThan(100);

        // Should be valid JavaScript
        expect(() => {
          new Function(content);
        }).not.toThrow();
      });
    });
  });

  describe('Internal Module Files', () => {
    const internalModules = [
      'internal/errors.js',
      'internal/util.js',
      'internal/validators.js',
      'internal/assert.js',
      'internal/constants.js',
    ];

    internalModules.forEach(module => {
      test(`${module} should exist and be loadable`, () => {
        const modulePath = resolve(nodeBuiltinsDir, module);

        if (!existsSync(modulePath)) {
          console.warn(`MISSING: ${module}`);
          expect(existsSync(modulePath)).toBe(true);
          return;
        }

        const content = readFileSync(modulePath, 'utf-8');
        expect(content.length).toBeGreaterThan(50);
      });
    });

    test('report missing internal modules', () => {
      const allInternalModules = [
        'internal/errors.js',
        'internal/util.js',
        'internal/validators.js',
        'internal/assert.js',
        'internal/constants.js',
        'internal/util/types.js', // Known missing
      ];

      const missing = allInternalModules.filter(module => {
        const modulePath = resolve(nodeBuiltinsDir, module);
        return !existsSync(modulePath);
      });

      if (missing.length > 0) {
        console.warn(`Missing internal modules (${missing.length}):`, missing.join(', '));
      }

      // We expect most to exist
      expect(allInternalModules.length - missing.length).toBeGreaterThan(3);
    });
  });

  describe('Module Dependencies', () => {
    test('fs.js should reference internal modules', () => {
      const fsPath = resolve(nodeBuiltinsDir, 'fs.js');
      if (!existsSync(fsPath)) {
        console.warn('fs.js not found - skipping');
        return;
      }

      const content = readFileSync(fsPath, 'utf-8');

      // fs.js should require internal modules
      const hasInternalRequires =
        content.includes('internal/errors') ||
        content.includes('internal/validators') ||
        content.includes('internal/fs');

      expect(hasInternalRequires).toBe(true);
    });

    test('internal/errors.js should define ERR_ codes', () => {
      const errorsPath = resolve(nodeBuiltinsDir, 'internal/errors.js');
      if (!existsSync(errorsPath)) {
        console.warn('internal/errors.js not found - skipping');
        return;
      }

      const content = readFileSync(errorsPath, 'utf-8');
      expect(content).toContain('ERR_');
    });
  });

  describe('Module Exports', () => {
    test('fs.js should export functions', () => {
      const fsPath = resolve(nodeBuiltinsDir, 'fs.js');
      if (!existsSync(fsPath)) {
        console.warn('fs.js not found - skipping');
        return;
      }

      const content = readFileSync(fsPath, 'utf-8');

      // Should have exports
      const hasExports =
        content.includes('module.exports') ||
        content.includes('exports.') ||
        content.includes('export ');

      expect(hasExports).toBe(true);
    });

    test('path.js should export path methods', () => {
      const pathPath = resolve(nodeBuiltinsDir, 'path.js');
      if (!existsSync(pathPath)) {
        console.warn('path.js not found - skipping');
        return;
      }

      const content = readFileSync(pathPath, 'utf-8');

      // Should have path methods like join, resolve, dirname
      const hasPathMethods =
        content.includes('join') &&
        content.includes('resolve') &&
        content.includes('dirname');

      expect(hasPathMethods).toBe(true);
    });
  });

  describe('Critical Paths for require()', () => {
    test('require("fs") path should exist: /builtins/node/fs.js', () => {
      const fsPath = resolve(nodeBuiltinsDir, 'fs.js');
      expect(existsSync(fsPath)).toBe(true);
    });

    test('require("path") path should exist: /builtins/node/path.js', () => {
      const pathPath = resolve(nodeBuiltinsDir, 'path.js');
      expect(existsSync(pathPath)).toBe(true);
    });

    test('require("internal/errors") path should exist', () => {
      const errorsPath = resolve(nodeBuiltinsDir, 'internal/errors.js');
      expect(existsSync(errorsPath)).toBe(true);
    });

    test('require("internal/util") path should exist', () => {
      const utilPath = resolve(nodeBuiltinsDir, 'internal/util.js');
      expect(existsSync(utilPath)).toBe(true);
    });
  });
});
