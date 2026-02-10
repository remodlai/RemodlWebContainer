/**
 * Integration Test: internalBinding Execution
 *
 * Actually imports and executes internalBinding to verify it works at runtime.
 */

describe('InternalBinding Integration', () => {
  let internalBinding: any;

  beforeAll(() => {
    // Actually require the internalBinding file
    const bindingPath = require.resolve('../../builtins/internalBinding.cjs');
    internalBinding = require(bindingPath);
  });

  test('internalBinding should be a function', () => {
    expect(typeof internalBinding).toBe('function');
  });

  test('internalBinding should list available bindings', () => {
    expect(Array.isArray(internalBinding.bindings)).toBe(true);
    expect(internalBinding.bindings.length).toBeGreaterThan(5);
    console.log('Available bindings:', internalBinding.bindings.join(', '));
  });

  describe('FS Binding', () => {
    let fsBinding: any;

    beforeAll(() => {
      // Actually call internalBinding('fs')
      fsBinding = internalBinding('fs');
    });

    test('internalBinding("fs") should return an object', () => {
      expect(typeof fsBinding).toBe('object');
      expect(fsBinding).not.toBeNull();
    });

    test('should have open method', () => {
      expect(fsBinding.open).toBeDefined();
      expect(typeof fsBinding.open).toBe('function');
    });

    test('should have close method', () => {
      expect(fsBinding.close).toBeDefined();
      expect(typeof fsBinding.close).toBe('function');
    });

    test('should have read method', () => {
      expect(fsBinding.read).toBeDefined();
      expect(typeof fsBinding.read).toBe('function');
    });

    test('should have write method', () => {
      expect(fsBinding.write).toBeDefined();
      expect(typeof fsBinding.write).toBe('function');
    });

    test('should have stat method', () => {
      expect(fsBinding.stat).toBeDefined();
      expect(typeof fsBinding.stat).toBe('function');
    });

    test('should have statValues as Float64Array', () => {
      expect(fsBinding.statValues).toBeDefined();
      expect(fsBinding.statValues).toBeInstanceOf(Float64Array);
    });

    test('statValues should have length of 36', () => {
      expect(fsBinding.statValues.length).toBe(36);
    });

    test('should have bigintStatValues as BigInt64Array(36)', () => {
      expect(fsBinding.bigintStatValues).toBeDefined();
      expect(fsBinding.bigintStatValues).toBeInstanceOf(BigInt64Array);
      expect(fsBinding.bigintStatValues.length).toBe(36);
    });

    test('should have statFsValues as Float64Array(14)', () => {
      expect(fsBinding.statFsValues).toBeDefined();
      expect(fsBinding.statFsValues).toBeInstanceOf(Float64Array);
      expect(fsBinding.statFsValues.length).toBe(14);
    });

    test('should have bigintStatFsValues as BigInt64Array(14)', () => {
      expect(fsBinding.bigintStatFsValues).toBeDefined();
      expect(fsBinding.bigintStatFsValues).toBeInstanceOf(BigInt64Array);
      expect(fsBinding.bigintStatFsValues.length).toBe(14);
    });

    test('should have FSReqCallback class', () => {
      expect(fsBinding.FSReqCallback).toBeDefined();
      expect(typeof fsBinding.FSReqCallback).toBe('function');

      // Should be constructable
      const req = new fsBinding.FSReqCallback();
      expect(req).toBeDefined();
    });

    test('should have 38+ properties/methods', () => {
      const keys = Object.keys(fsBinding);
      expect(keys.length).toBeGreaterThan(38);
      console.log(`FS binding has ${keys.length} properties`);
    });

    test('should have 40+ methods and properties', () => {
      const keys = Object.keys(fsBinding);
      expect(keys.length).toBeGreaterThan(40);
    });
  });

  describe('Other Bindings', () => {
    test('should support multiple bindings', () => {
      // Check that other bindings are available
      expect(internalBinding.bindings).toContain('fs');
      expect(internalBinding.bindings.length).toBeGreaterThan(1);
    });

    test('should throw error for unknown binding', () => {
      expect(() => {
        internalBinding('nonexistent_binding_xyz');
      }).toThrow('No such binding');
    });
  });
});
