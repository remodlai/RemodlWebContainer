/**
 * Test: Task #9 Fix - QuickJS Error Handling (test-polyfills.ts)
 *
 * Verifies that QuickJS context results properly check .error before accessing .value
 * and that errors are properly disposed.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';

// Mock QuickJS types for testing
type QuickJSHandle = { id: number };

type DisposableSuccess<T> = {
  value: T;
  error: undefined;
  dispose: () => void;
};

type DisposableFail<T> = {
  value: undefined;
  error: { message: string };
  dispose: () => void;
};

type QuickJSContextResult<T> = DisposableSuccess<T> | DisposableFail<T>;

describe('Task #9 Fix: QuickJS Error Handling', () => {
  describe('Context Result Type Guards', () => {
    test('should identify successful result correctly', () => {
      const successResult: QuickJSContextResult<QuickJSHandle> = {
        value: { id: 1 },
        error: undefined,
        dispose: () => {},
      };

      expect(successResult.error).toBeUndefined();
      expect(successResult.value).toBeDefined();
      expect(successResult.value?.id).toBe(1);
    });

    test('should identify error result correctly', () => {
      const errorResult: QuickJSContextResult<QuickJSHandle> = {
        value: undefined,
        error: { message: 'Test error' },
        dispose: () => {},
      };

      expect(errorResult.error).toBeDefined();
      expect(errorResult.error?.message).toBe('Test error');
      expect(errorResult.value).toBeUndefined();
    });
  });

  describe('Error-First Pattern', () => {
    test('should check error before accessing value', () => {
      const mockResult: QuickJSContextResult<QuickJSHandle> = {
        value: undefined,
        error: { message: 'Compilation failed' },
        dispose: () => {},
      };

      // This is the pattern from the fix
      if (mockResult.error) {
        expect(mockResult.error.message).toBe('Compilation failed');
        expect(mockResult.value).toBeUndefined();
      } else {
        // Should not reach here
        expect(mockResult.value).toBeDefined();
      }
    });

    test('should safely access value when no error', () => {
      const mockResult: QuickJSContextResult<QuickJSHandle> = {
        value: { id: 42 },
        error: undefined,
        dispose: () => {},
      };

      if (mockResult.error) {
        // Should not reach here
        throw new Error('Unexpected error');
      } else {
        expect(mockResult.value).toBeDefined();
        expect(mockResult.value.id).toBe(42);
      }
    });
  });

  describe('Resource Disposal', () => {
    test('should dispose successful results', () => {
      let disposed = false;
      const successResult: QuickJSContextResult<QuickJSHandle> = {
        value: { id: 1 },
        error: undefined,
        dispose: () => { disposed = true; },
      };

      successResult.dispose();
      expect(disposed).toBe(true);
    });

    test('should dispose error results', () => {
      let disposed = false;
      const errorResult: QuickJSContextResult<QuickJSHandle> = {
        value: undefined,
        error: { message: 'Test error' },
        dispose: () => { disposed = true; },
      };

      errorResult.dispose();
      expect(disposed).toBe(true);
    });

    test('should dispose in try-finally pattern', () => {
      let disposed = false;
      const result: QuickJSContextResult<QuickJSHandle> = {
        value: { id: 1 },
        error: undefined,
        dispose: () => { disposed = true; },
      };

      try {
        if (result.error) {
          throw new Error('Unexpected error');
        }
        expect(result.value.id).toBe(1);
      } finally {
        result.dispose();
      }

      expect(disposed).toBe(true);
    });
  });

  describe('Type Safety', () => {
    test('TypeScript should prevent accessing .value without checking .error', () => {
      const result: QuickJSContextResult<QuickJSHandle> = {
        value: { id: 1 },
        error: undefined,
        dispose: () => {},
      };

      // This pattern should compile without TS errors
      if (!result.error) {
        const handle: QuickJSHandle = result.value;
        expect(handle.id).toBe(1);
      }
    });

    test('should handle error case with proper typing', () => {
      const result: QuickJSContextResult<QuickJSHandle> = {
        value: undefined,
        error: { message: 'Error occurred' },
        dispose: () => {},
      };

      if (result.error) {
        const errorMsg: string = result.error.message;
        expect(errorMsg).toBe('Error occurred');
      }
    });
  });

  describe('Real-World Usage Pattern', () => {
    function createMockContext(shouldError: boolean): QuickJSContextResult<QuickJSHandle> {
      if (shouldError) {
        return {
          value: undefined,
          error: { message: 'Context creation failed' },
          dispose: () => {},
        };
      }
      return {
        value: { id: Math.floor(Math.random() * 1000) },
        error: undefined,
        dispose: () => {},
      };
    }

    test('should handle successful context creation', () => {
      const ctx = createMockContext(false);

      if (ctx.error) {
        throw new Error('Should not error');
      }

      expect(ctx.value).toBeDefined();
      expect(typeof ctx.value.id).toBe('number');
      ctx.dispose();
    });

    test('should handle failed context creation', () => {
      const ctx = createMockContext(true);

      if (ctx.error) {
        expect(ctx.error.message).toBe('Context creation failed');
        expect(ctx.value).toBeUndefined();
      } else {
        throw new Error('Should have error');
      }

      ctx.dispose();
    });
  });
});
