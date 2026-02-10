/**
 * Test: Copy Builtin Files
 *
 * Verifies that Node.js builtin files are properly copied to the filesystem
 * during container initialization.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, join } from 'path';

describe('Copy Builtin Files', () => {
  const builtinsDir = resolve(__dirname, '../../builtins');
  const nodeBuiltinsDir = resolve(builtinsDir, 'node');

  describe('Directory Structure', () => {
    test('builtins directory should exist', () => {
      expect(existsSync(builtinsDir)).toBe(true);
    });

    test('builtins/node directory should exist', () => {
      expect(existsSync(nodeBuiltinsDir)).toBe(true);
    });

    test('primordials.js should exist', () => {
      const primordialsPath = join(builtinsDir, 'primordials.js');
      expect(existsSync(primordialsPath)).toBe(true);
    });

    test('internalBinding.cjs should exist', () => {
      const internalBindingPath = join(builtinsDir, 'internalBinding.cjs');
      expect(existsSync(internalBindingPath)).toBe(true);
    });
  });

  describe('Node.js Builtin Files Count', () => {
    test('should have significant number of builtin files (> 100)', () => {
      if (!existsSync(nodeBuiltinsDir)) {
        console.warn('node builtin dir does not exist - skipping');
        return;
      }

      let fileCount = 0;

      function countFiles(dir: string): number {
        let count = 0;
        const entries = readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            count += countFiles(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.js')) {
            count++;
          }
        }
        return count;
      }

      fileCount = countFiles(nodeBuiltinsDir);

      // We expect 292 files based on commit ff27aa6
      expect(fileCount).toBeGreaterThan(100);
      console.log(`Found ${fileCount} Node.js builtin files`);
    });
  });

  describe('Critical Builtin Files', () => {
    const criticalFiles = [
      'internal/errors.js',
      'internal/util.js',
      'internal/validators.js',
      'internal/assert.js',
      'fs.js',
      'path.js',
      'buffer.js',
      'events.js',
      'stream.js',
      'util.js',
    ];

    criticalFiles.forEach(file => {
      test(`should have ${file}`, () => {
        const filePath = join(nodeBuiltinsDir, file);
        expect(existsSync(filePath)).toBe(true);
      });
    });
  });

  describe('File Content Validity', () => {
    test('fs.js should be valid JavaScript', () => {
      const fsPath = join(nodeBuiltinsDir, 'fs.js');
      if (!existsSync(fsPath)) {
        console.warn('fs.js not found - skipping');
        return;
      }

      const content = readFileSync(fsPath, 'utf-8');
      expect(() => {
        new Function(content);
      }).not.toThrow();
    });

    test('internal/errors.js should exist and be non-empty', () => {
      const errorsPath = join(nodeBuiltinsDir, 'internal/errors.js');
      if (!existsSync(errorsPath)) {
        console.warn('internal/errors.js not found - skipping');
        return;
      }

      const content = readFileSync(errorsPath, 'utf-8');
      expect(content.length).toBeGreaterThan(100);
    });
  });

  describe('Internal Modules Structure', () => {
    test('internal/ subdirectory should exist', () => {
      const internalDir = join(nodeBuiltinsDir, 'internal');
      expect(existsSync(internalDir)).toBe(true);
    });

    test('internal/ should have multiple files', () => {
      const internalDir = join(nodeBuiltinsDir, 'internal');
      if (!existsSync(internalDir)) {
        console.warn('internal/ dir not found - skipping');
        return;
      }

      const files = readdirSync(internalDir).filter(f => f.endsWith('.js'));
      expect(files.length).toBeGreaterThan(10);
      console.log(`Found ${files.length} files in internal/`);
    });
  });
});
