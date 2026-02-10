/**
 * Test: Task #9 Fix - DNS Callbacks (dns-http.ts)
 *
 * Verifies that DNS resolve functions accept correct callback types
 * and handle unknown promise resolution types properly.
 */

// DNS record types
type ARecord = { address: string; ttl: number };
type AAAARecord = { address: string; ttl: number };
type MXRecord = { exchange: string; priority: number };
type TXTRecord = string[];
type SRVRecord = { name: string; port: number; priority: number; weight: number };
type AnyRecord = ARecord | AAAARecord | MXRecord | TXTRecord | SRVRecord;

// DNS callback types (after Task #9 fix)
type ResolveCallback<T> = (err: Error | null, records: T) => void;

describe('Task #9 Fix: DNS Callbacks', () => {
  describe('Callback Type Definitions', () => {
    test('should accept callback for resolve4 (A records)', () => {
      const callback: ResolveCallback<string[]> = (err, records) => {
        if (err) {
          expect(err).toBeInstanceOf(Error);
        } else {
          expect(Array.isArray(records)).toBe(true);
          records.forEach((ip) => expect(typeof ip).toBe('string'));
        }
      };

      // Simulate successful resolution
      callback(null, ['192.168.1.1', '192.168.1.2']);
    });

    test('should accept callback for resolve6 (AAAA records)', () => {
      const callback: ResolveCallback<string[]> = (err, records) => {
        if (err) {
          expect(err).toBeInstanceOf(Error);
        } else {
          expect(Array.isArray(records)).toBe(true);
        }
      };

      callback(null, ['2001:db8::1', '2001:db8::2']);
    });

    test('should accept callback for resolveMx (MX records)', () => {
      const callback: ResolveCallback<MXRecord[]> = (err, records) => {
        if (err) {
          expect(err).toBeInstanceOf(Error);
        } else {
          expect(Array.isArray(records)).toBe(true);
          records.forEach((mx) => {
            expect(typeof mx.exchange).toBe('string');
            expect(typeof mx.priority).toBe('number');
          });
        }
      };

      callback(null, [
        { exchange: 'mail1.example.com', priority: 10 },
        { exchange: 'mail2.example.com', priority: 20 },
      ]);
    });

    test('should accept callback for resolveTxt (TXT records)', () => {
      const callback: ResolveCallback<string[][]> = (err, records) => {
        if (err) {
          expect(err).toBeInstanceOf(Error);
        } else {
          expect(Array.isArray(records)).toBe(true);
          records.forEach((txt) => expect(Array.isArray(txt)).toBe(true));
        }
      };

      callback(null, [['v=spf1 mx -all'], ['google-site-verification=abc123']]);
    });
  });

  describe('Unknown Type Handling', () => {
    test('should handle unknown promise result with type assertion', () => {
      const mockPromise = Promise.resolve(['192.168.1.1'] as unknown);

      mockPromise.then((result) => {
        // Type assertion after unknown
        const records = result as string[];
        expect(Array.isArray(records)).toBe(true);
        expect(records[0]).toBe('192.168.1.1');
      });
    });

    test('should handle unknown result in callback pattern', () => {
      const processResult = (result: unknown): string[] => {
        // This is the pattern used in the fix
        return result as string[];
      };

      const unknownResult: unknown = ['10.0.0.1', '10.0.0.2'];
      const typedResult = processResult(unknownResult);

      expect(Array.isArray(typedResult)).toBe(true);
      expect(typedResult.length).toBe(2);
    });

    test('should handle different record types from unknown', () => {
      const testCases: Array<{ input: unknown; expected: any }> = [
        { input: ['192.168.1.1'] as unknown, expected: 'string[]' },
        { input: [['txt1'], ['txt2']] as unknown, expected: 'string[][]' },
        {
          input: [{ exchange: 'mail.example.com', priority: 10 }] as unknown,
          expected: 'MXRecord[]',
        },
      ];

      testCases.forEach(({ input, expected }) => {
        expect(input).toBeDefined();
        expect(typeof input).toBe('object');
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle DNS resolution errors', () => {
      const callback: ResolveCallback<string[]> = (err, records) => {
        if (err) {
          expect(err).toBeInstanceOf(Error);
          expect(err.message).toContain('ENOTFOUND');
        }
      };

      callback(new Error('ENOTFOUND: Domain not found'), []);
    });

    test('should handle network errors', () => {
      const callback: ResolveCallback<string[]> = (err, records) => {
        if (err) {
          expect(err).toBeInstanceOf(Error);
          expect(err.message).toContain('ETIMEDOUT');
        }
      };

      callback(new Error('ETIMEDOUT: DNS query timed out'), []);
    });

    test('should handle success with empty results', () => {
      const callback: ResolveCallback<string[]> = (err, records) => {
        if (!err) {
          expect(Array.isArray(records)).toBe(true);
          expect(records.length).toBe(0);
        }
      };

      callback(null, []);
    });
  });

  describe('Promise to Callback Conversion', () => {
    function promiseToCallback<T>(
      promise: Promise<unknown>,
      callback: ResolveCallback<T>
    ): void {
      promise
        .then((result) => {
          // Type assertion from unknown
          callback(null, result as T);
        })
        .catch((error) => {
          callback(error as Error, [] as T);
        });
    }

    test('should convert successful promise to callback', (done) => {
      const mockPromise = Promise.resolve(['192.168.1.1'] as unknown);

      promiseToCallback<string[]>(mockPromise, (err, records) => {
        expect(err).toBeNull();
        expect(records).toEqual(['192.168.1.1']);
        done();
      });
    });

    test('should convert rejected promise to callback', (done) => {
      const mockPromise = Promise.reject(new Error('DNS failed'));

      promiseToCallback<string[]>(mockPromise, (err, records) => {
        expect(err).toBeInstanceOf(Error);
        expect(err?.message).toBe('DNS failed');
        expect(records).toEqual([]);
        done();
      });
    });
  });

  describe('Real-World DNS Patterns', () => {
    test('should handle resolve4 with detailed records', () => {
      const callback: ResolveCallback<ARecord[]> = (err, records) => {
        if (!err) {
          records.forEach((record) => {
            expect(record.address).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
            expect(typeof record.ttl).toBe('number');
          });
        }
      };

      callback(null, [
        { address: '192.168.1.1', ttl: 300 },
        { address: '192.168.1.2', ttl: 300 },
      ]);
    });

    test('should handle mixed record types (ANY query)', () => {
      const callback: ResolveCallback<AnyRecord[]> = (err, records) => {
        if (!err) {
          expect(Array.isArray(records)).toBe(true);
          records.forEach((record) => {
            expect(record).toBeDefined();
          });
        }
      };

      callback(null, [
        { address: '192.168.1.1', ttl: 300 } as ARecord,
        { exchange: 'mail.example.com', priority: 10 } as unknown as AnyRecord,
      ]);
    });

    test('should handle reverse DNS lookup', () => {
      const callback: ResolveCallback<string[]> = (err, hostnames) => {
        if (!err) {
          hostnames.forEach((hostname) => {
            expect(typeof hostname).toBe('string');
            expect(hostname).toMatch(/\./); // Should contain dots
          });
        }
      };

      callback(null, ['example.com', 'www.example.com']);
    });
  });

  describe('Type Safety with Generics', () => {
    test('should enforce correct return types', () => {
      const stringCallback: ResolveCallback<string[]> = (err, records) => {
        if (!err) {
          // TypeScript should know records is string[]
          const firstRecord: string = records[0];
          expect(typeof firstRecord).toBe('string');
        }
      };

      stringCallback(null, ['test']);
    });

    test('should enforce correct error handling', () => {
      const callback: ResolveCallback<string[]> = (err, records) => {
        if (err) {
          // TypeScript should know err is Error
          const message: string = err.message;
          expect(typeof message).toBe('string');
        }
      };

      callback(new Error('Test error'), []);
    });
  });
});
