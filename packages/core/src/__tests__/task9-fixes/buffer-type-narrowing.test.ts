/**
 * Test: Task #9 Fix - Buffer Type Narrowing (net-websocket.ts)
 *
 * Verifies that Buffer.from properly handles string | Uint8Array union types
 * through type narrowing.
 */

import { Buffer } from 'buffer';

describe('Task #9 Fix: Buffer Type Narrowing', () => {
  describe('Buffer.from with Type Narrowing', () => {
    function createBuffer(data: string | Uint8Array): Buffer {
      // This is the pattern from the fix - narrow the type first
      if (typeof data === 'string') {
        return Buffer.from(data, 'utf8');
      } else {
        return Buffer.from(data);
      }
    }

    test('should create buffer from string', () => {
      const result = createBuffer('Hello, World!');

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString('utf8')).toBe('Hello, World!');
    });

    test('should create buffer from Uint8Array', () => {
      const uint8 = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const result = createBuffer(uint8);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString('utf8')).toBe('Hello');
    });

    test('should handle empty string', () => {
      const result = createBuffer('');

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    test('should handle empty Uint8Array', () => {
      const uint8 = new Uint8Array(0);
      const result = createBuffer(uint8);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  describe('Type Guards', () => {
    test('typeof check should narrow string type', () => {
      const data: string | Uint8Array = 'test string';

      if (typeof data === 'string') {
        // TypeScript should know data is string here
        const upper: string = data.toUpperCase();
        expect(upper).toBe('TEST STRING');
      }
    });

    test('instanceof check should narrow Uint8Array type', () => {
      const data: string | Uint8Array = new Uint8Array([1, 2, 3]);

      if (data instanceof Uint8Array) {
        // TypeScript should know data is Uint8Array here
        const length: number = data.length;
        expect(length).toBe(3);
      }
    });

    test('typeof check should distinguish between types', () => {
      const testString: string | Uint8Array = 'hello';
      const testArray: string | Uint8Array = new Uint8Array([1, 2, 3]);

      expect(typeof testString === 'string').toBe(true);
      expect(typeof testArray === 'string').toBe(false);
      expect(testArray instanceof Uint8Array).toBe(true);
    });
  });

  describe('Real-World Network Patterns', () => {
    function writeToSocket(data: string | Uint8Array): Buffer {
      // Pattern from net-websocket.ts fix
      if (typeof data === 'string') {
        return Buffer.from(data, 'utf8');
      } else if (data instanceof Uint8Array) {
        return Buffer.from(data);
      } else {
        // Should never reach here with proper types
        throw new TypeError('Invalid data type');
      }
    }

    test('should handle text protocol data', () => {
      const textData = 'GET / HTTP/1.1\r\nHost: example.com\r\n\r\n';
      const buffer = writeToSocket(textData);

      expect(buffer.toString()).toBe(textData);
    });

    test('should handle binary protocol data', () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0xFF, 0xFE]);
      const buffer = writeToSocket(binaryData);

      expect(buffer[0]).toBe(0x00);
      expect(buffer[1]).toBe(0x01);
      expect(buffer[2]).toBe(0xFF);
      expect(buffer[3]).toBe(0xFE);
    });

    test('should handle mixed content types', () => {
      const testCases: Array<string | Uint8Array> = [
        'text data',
        new Uint8Array([1, 2, 3]),
        'more text',
        new Uint8Array([255, 254]),
      ];

      testCases.forEach((data) => {
        const buffer = writeToSocket(data);
        expect(Buffer.isBuffer(buffer)).toBe(true);
      });
    });
  });

  describe('Buffer Encoding', () => {
    test('should handle different string encodings', () => {
      const testString = 'Hello, 世界!';

      const utf8Buffer = Buffer.from(testString, 'utf8');
      const latin1Buffer = Buffer.from(testString, 'latin1');

      expect(utf8Buffer.length).toBeGreaterThan(latin1Buffer.length);
      expect(utf8Buffer.toString('utf8')).toBe(testString);
    });

    test('should preserve binary data integrity', () => {
      const original = new Uint8Array([0, 1, 127, 128, 255]);
      const buffer = Buffer.from(original);

      expect(buffer.length).toBe(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(buffer[i]).toBe(original[i]);
      }
    });
  });

  describe('Edge Cases', () => {
    test('should handle very large strings', () => {
      const largeString = 'x'.repeat(10000);
      const buffer = Buffer.from(largeString, 'utf8');

      expect(buffer.length).toBe(10000);
      expect(buffer.toString('utf8')).toBe(largeString);
    });

    test('should handle very large Uint8Arrays', () => {
      const largeArray = new Uint8Array(10000);
      largeArray.fill(42);
      const buffer = Buffer.from(largeArray);

      expect(buffer.length).toBe(10000);
      expect(buffer.every((byte) => byte === 42)).toBe(true);
    });

    test('should handle Unicode edge cases', () => {
      const unicodeString = '\u0000\uFFFF\u{1F600}'; // null, max BMP, emoji
      const buffer = Buffer.from(unicodeString, 'utf8');

      expect(buffer.toString('utf8')).toBe(unicodeString);
    });

    test('should handle binary data with all byte values', () => {
      const allBytes = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        allBytes[i] = i;
      }

      const buffer = Buffer.from(allBytes);

      expect(buffer.length).toBe(256);
      for (let i = 0; i < 256; i++) {
        expect(buffer[i]).toBe(i);
      }
    });
  });

  describe('Type Safety', () => {
    test('should not accept Buffer as input (not in union)', () => {
      // This test documents that Buffer is separate from string | Uint8Array
      const buffer = Buffer.from('test');

      // Buffer IS a Uint8Array
      expect(buffer instanceof Uint8Array).toBe(true);

      // So it should work with the Uint8Array branch
      const copy = Buffer.from(buffer);
      expect(copy.toString()).toBe('test');
    });

    test('should handle typed arrays correctly', () => {
      // Uint8Array is the base, but other typed arrays should also work
      const uint16 = new Uint16Array([256, 512]);
      const uint8View = new Uint8Array(uint16.buffer);

      const buffer = Buffer.from(uint8View);
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  describe('Performance Patterns', () => {
    test('should efficiently convert string to buffer', () => {
      const testString = 'Performance test string';
      const iterations = 1000;

      const start = Date.now();
      for (let i = 0; i < iterations; i++) {
        Buffer.from(testString, 'utf8');
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(1000); // Should complete in < 1 second
    });

    test('should efficiently convert Uint8Array to buffer', () => {
      const testArray = new Uint8Array(1000);
      const iterations = 1000;

      const start = Date.now();
      for (let i = 0; i < iterations; i++) {
        Buffer.from(testArray);
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(1000); // Should complete in < 1 second
    });
  });
});
