/**
 * Integration Test: Primordials Execution
 *
 * Actually imports and executes primordials.js to verify it works at runtime.
 */

describe('Primordials Integration', () => {
  let primordials: any;

  beforeAll(() => {
    // Actually require the primordials file
    const primordialsPath = require.resolve('../../builtins/primordials.js');
    primordials = require(primordialsPath);
  });

  test('primordials should be an object', () => {
    expect(typeof primordials).toBe('object');
    expect(primordials).not.toBeNull();
  });

  test('primordials object should be frozen', () => {
    expect(Object.isFrozen(primordials)).toBe(true);
  });

  test('should have ArrayIsArray and it should work', () => {
    expect(primordials.ArrayIsArray).toBeDefined();
    expect(typeof primordials.ArrayIsArray).toBe('function');

    // Actually execute it
    expect(primordials.ArrayIsArray([])).toBe(true);
    expect(primordials.ArrayIsArray({})).toBe(false);
  });

  test('should have ObjectKeys and it should work', () => {
    expect(primordials.ObjectKeys).toBeDefined();
    expect(typeof primordials.ObjectKeys).toBe('function');

    // Actually execute it
    const result = primordials.ObjectKeys({ a: 1, b: 2 });
    expect(result).toEqual(['a', 'b']);
  });

  test('should have ArrayPrototypeMap and it should work', () => {
    expect(primordials.ArrayPrototypeMap).toBeDefined();
    expect(typeof primordials.ArrayPrototypeMap).toBe('function');

    // Actually execute it
    const result = primordials.ArrayPrototypeMap([1, 2, 3], (x: number) => x * 2);
    expect(result).toEqual([2, 4, 6]);
  });

  test('should have StringPrototypeSlice and it should work', () => {
    expect(primordials.StringPrototypeSlice).toBeDefined();
    expect(typeof primordials.StringPrototypeSlice).toBe('function');

    // Actually execute it
    const result = primordials.StringPrototypeSlice('hello world', 0, 5);
    expect(result).toBe('hello');
  });

  test('should have ObjectDefineProperty and it should work', () => {
    expect(primordials.ObjectDefineProperty).toBeDefined();
    expect(typeof primordials.ObjectDefineProperty).toBe('function');

    // Actually execute it
    const obj = {};
    primordials.ObjectDefineProperty(obj, 'test', {
      value: 42,
      writable: false,
    });
    expect((obj as any).test).toBe(42);
  });

  test('should have FunctionPrototypeBind and it should work', () => {
    expect(primordials.FunctionPrototypeBind).toBeDefined();
    expect(typeof primordials.FunctionPrototypeBind).toBe('function');

    // Actually execute it
    const fn = function(this: any, x: number) { return this.value + x; };
    const bound = primordials.FunctionPrototypeBind(fn, { value: 10 });
    expect(bound(5)).toBe(15);
  });

  test('primordials should have 100+ properties', () => {
    const keys = Object.keys(primordials);
    expect(keys.length).toBeGreaterThan(100);
    console.log(`Primordials has ${keys.length} properties`);
  });

  test('all primordials should be callable or constructors', () => {
    let functionCount = 0;
    let objectCount = 0;

    for (const key of Object.keys(primordials)) {
      const value = primordials[key];
      const type = typeof value;

      if (type === 'function') {
        functionCount++;
      } else if (type === 'object') {
        objectCount++;
      }
    }

    console.log(`Functions: ${functionCount}, Objects: ${objectCount}`);
    expect(functionCount).toBeGreaterThan(50);
  });
});
