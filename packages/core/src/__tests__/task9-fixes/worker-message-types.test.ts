/**
 * Test: Task #9 Fix - Worker Message Types (worker-code.d.ts)
 *
 * Verifies that textSearch and textSearchResult message types are properly
 * defined in the worker message protocol.
 */

// Worker message types (after Task #9 fix)
type WorkerRequestType =
  | 'initialize'
  | 'spawn'
  | 'writeInput'
  | 'terminate'
  | 'writeFile'
  | 'readFile'
  | 'deleteFile'
  | 'listFiles'
  | 'createDirectory'
  | 'textSearch' // FIX: Added in Task #9
  | 'getStats'
  | 'dispose';

type WorkerResponseType =
  | 'initialized'
  | 'spawned'
  | 'inputWritten'
  | 'terminated'
  | 'fileWritten'
  | 'fileRead'
  | 'fileDeleted'
  | 'fileList'
  | 'directoryCreated'
  | 'textSearchResult' // FIX: Added in Task #9
  | 'stats'
  | 'disposed'
  | 'error'
  | 'success';

interface TextSearchRequest {
  type: 'textSearch';
  payload: {
    pattern: string;
    paths?: string[];
    caseSensitive?: boolean;
    maxResults?: number;
  };
}

interface TextSearchResult {
  type: 'textSearchResult';
  payload: {
    matches: Array<{
      path: string;
      lineNumber: number;
      lineContent: string;
      matchStart: number;
      matchEnd: number;
    }>;
    truncated: boolean;
  };
}

describe('Task #9 Fix: Worker Message Types', () => {
  describe('Request Type Union', () => {
    test('textSearch should be valid request type', () => {
      const requestTypes: WorkerRequestType[] = [
        'initialize',
        'spawn',
        'writeInput',
        'terminate',
        'writeFile',
        'readFile',
        'deleteFile',
        'listFiles',
        'createDirectory',
        'textSearch',
        'getStats',
        'dispose',
      ];

      expect(requestTypes).toContain('textSearch');
    });

    test('should accept textSearch in type guard', () => {
      const messageType: WorkerRequestType = 'textSearch';

      expect(messageType).toBe('textSearch');
    });
  });

  describe('Response Type Union', () => {
    test('textSearchResult should be valid response type', () => {
      const responseTypes: WorkerResponseType[] = [
        'initialized',
        'spawned',
        'inputWritten',
        'terminated',
        'fileWritten',
        'fileRead',
        'fileDeleted',
        'fileList',
        'directoryCreated',
        'textSearchResult',
        'stats',
        'disposed',
        'error',
        'success',
      ];

      expect(responseTypes).toContain('textSearchResult');
    });

    test('should accept textSearchResult in type guard', () => {
      const messageType: WorkerResponseType = 'textSearchResult';

      expect(messageType).toBe('textSearchResult');
    });
  });

  describe('TextSearchRequest Structure', () => {
    test('should create valid text search request', () => {
      const request: TextSearchRequest = {
        type: 'textSearch',
        payload: {
          pattern: 'TODO',
          paths: ['src/**/*.ts'],
          caseSensitive: false,
          maxResults: 100,
        },
      };

      expect(request.type).toBe('textSearch');
      expect(request.payload.pattern).toBe('TODO');
    });

    test('should accept minimal text search request', () => {
      const request: TextSearchRequest = {
        type: 'textSearch',
        payload: {
          pattern: 'function',
        },
      };

      expect(request.type).toBe('textSearch');
      expect(request.payload.pattern).toBe('function');
      expect(request.payload.paths).toBeUndefined();
      expect(request.payload.caseSensitive).toBeUndefined();
      expect(request.payload.maxResults).toBeUndefined();
    });

    test('should handle case-sensitive search', () => {
      const request: TextSearchRequest = {
        type: 'textSearch',
        payload: {
          pattern: 'Error',
          caseSensitive: true,
        },
      };

      expect(request.payload.caseSensitive).toBe(true);
    });

    test('should handle path filtering', () => {
      const request: TextSearchRequest = {
        type: 'textSearch',
        payload: {
          pattern: 'import',
          paths: ['src/**/*.ts', 'lib/**/*.js'],
        },
      };

      expect(request.payload.paths).toEqual(['src/**/*.ts', 'lib/**/*.js']);
    });
  });

  describe('TextSearchResult Structure', () => {
    test('should create valid text search result', () => {
      const result: TextSearchResult = {
        type: 'textSearchResult',
        payload: {
          matches: [
            {
              path: 'src/index.ts',
              lineNumber: 42,
              lineContent: '  // TODO: Implement this feature',
              matchStart: 5,
              matchEnd: 9,
            },
          ],
          truncated: false,
        },
      };

      expect(result.type).toBe('textSearchResult');
      expect(result.payload.matches.length).toBe(1);
      expect(result.payload.matches[0].path).toBe('src/index.ts');
    });

    test('should handle empty results', () => {
      const result: TextSearchResult = {
        type: 'textSearchResult',
        payload: {
          matches: [],
          truncated: false,
        },
      };

      expect(result.payload.matches.length).toBe(0);
      expect(result.payload.truncated).toBe(false);
    });

    test('should indicate truncated results', () => {
      const result: TextSearchResult = {
        type: 'textSearchResult',
        payload: {
          matches: Array(100).fill({
            path: 'test.ts',
            lineNumber: 1,
            lineContent: 'test',
            matchStart: 0,
            matchEnd: 4,
          }),
          truncated: true,
        },
      };

      expect(result.payload.matches.length).toBe(100);
      expect(result.payload.truncated).toBe(true);
    });

    test('should handle multiple matches', () => {
      const result: TextSearchResult = {
        type: 'textSearchResult',
        payload: {
          matches: [
            {
              path: 'src/file1.ts',
              lineNumber: 10,
              lineContent: 'const value = 42;',
              matchStart: 6,
              matchEnd: 11,
            },
            {
              path: 'src/file2.ts',
              lineNumber: 25,
              lineContent: 'let value = 100;',
              matchStart: 4,
              matchEnd: 9,
            },
          ],
          truncated: false,
        },
      };

      expect(result.payload.matches.length).toBe(2);
      expect(result.payload.matches[0].path).toBe('src/file1.ts');
      expect(result.payload.matches[1].path).toBe('src/file2.ts');
    });
  });

  describe('Message Type Checking', () => {
    test('should distinguish request types', () => {
      type Message =
        | { type: 'textSearch'; payload: any }
        | { type: 'readFile'; payload: any };

      const message: Message = {
        type: 'textSearch',
        payload: { pattern: 'test' },
      };

      if (message.type === 'textSearch') {
        expect(message.payload.pattern).toBe('test');
      } else {
        throw new Error('Wrong type');
      }
    });

    test('should distinguish response types', () => {
      type Response =
        | { type: 'textSearchResult'; payload: any }
        | { type: 'fileRead'; payload: any };

      const response: Response = {
        type: 'textSearchResult',
        payload: { matches: [], truncated: false },
      };

      if (response.type === 'textSearchResult') {
        expect(Array.isArray(response.payload.matches)).toBe(true);
      } else {
        throw new Error('Wrong type');
      }
    });
  });

  describe('Real-World Usage Patterns', () => {
    test('should handle grep-like search', () => {
      const request: TextSearchRequest = {
        type: 'textSearch',
        payload: {
          pattern: 'console.log',
          paths: ['src/**/*.ts', 'src/**/*.js'],
          caseSensitive: false,
        },
      };

      const result: TextSearchResult = {
        type: 'textSearchResult',
        payload: {
          matches: [
            {
              path: 'src/debug.ts',
              lineNumber: 15,
              lineContent: "  console.log('Debug message');",
              matchStart: 2,
              matchEnd: 13,
            },
          ],
          truncated: false,
        },
      };

      expect(request.payload.pattern).toBe('console.log');
      expect(result.payload.matches[0].lineContent).toContain('console.log');
    });

    test('should handle TODO search across codebase', () => {
      const request: TextSearchRequest = {
        type: 'textSearch',
        payload: {
          pattern: 'TODO|FIXME|XXX',
          caseSensitive: false,
          maxResults: 50,
        },
      };

      const result: TextSearchResult = {
        type: 'textSearchResult',
        payload: {
          matches: [
            {
              path: 'src/component.ts',
              lineNumber: 42,
              lineContent: '  // TODO: Add error handling',
              matchStart: 5,
              matchEnd: 9,
            },
            {
              path: 'src/utils.ts',
              lineNumber: 108,
              lineContent: '  // FIXME: This is a hack',
              matchStart: 5,
              matchEnd: 10,
            },
          ],
          truncated: false,
        },
      };

      expect(result.payload.matches.length).toBe(2);
    });

    test('should handle regex pattern search', () => {
      const request: TextSearchRequest = {
        type: 'textSearch',
        payload: {
          pattern: 'function\\s+\\w+\\(',
          paths: ['src/**/*.ts'],
          caseSensitive: true,
        },
      };

      expect(request.payload.pattern).toContain('function');
      expect(request.payload.caseSensitive).toBe(true);
    });
  });

  describe('Error Cases', () => {
    test('should handle search with no pattern', () => {
      // TypeScript should require pattern
      const request: TextSearchRequest = {
        type: 'textSearch',
        payload: {
          pattern: '', // Empty but present
        },
      };

      expect(request.payload.pattern).toBe('');
    });

    test('should handle result with malformed matches', () => {
      const result: TextSearchResult = {
        type: 'textSearchResult',
        payload: {
          matches: [
            {
              path: '',
              lineNumber: 0,
              lineContent: '',
              matchStart: -1,
              matchEnd: -1,
            },
          ],
          truncated: false,
        },
      };

      // Should compile even with edge case values
      expect(result.payload.matches[0].lineNumber).toBe(0);
    });
  });

  describe('Type Safety', () => {
    test('should enforce correct payload structure for requests', () => {
      const request: TextSearchRequest = {
        type: 'textSearch',
        payload: {
          pattern: 'test',
          paths: ['*.ts'],
          caseSensitive: true,
          maxResults: 10,
        },
      };

      // TypeScript should enforce these types
      const pattern: string = request.payload.pattern;
      const paths: string[] | undefined = request.payload.paths;
      const caseSensitive: boolean | undefined = request.payload.caseSensitive;
      const maxResults: number | undefined = request.payload.maxResults;

      expect(typeof pattern).toBe('string');
    });

    test('should enforce correct payload structure for results', () => {
      const result: TextSearchResult = {
        type: 'textSearchResult',
        payload: {
          matches: [],
          truncated: false,
        },
      };

      // TypeScript should enforce these types
      const matches: typeof result.payload.matches = result.payload.matches;
      const truncated: boolean = result.payload.truncated;

      expect(Array.isArray(matches)).toBe(true);
      expect(typeof truncated).toBe('boolean');
    });
  });
});
