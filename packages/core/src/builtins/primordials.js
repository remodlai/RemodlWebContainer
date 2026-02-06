// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

/**
 * Primordials are frozen references to JavaScript built-in objects and methods.
 *
 * This prevents user code from monkey-patching built-ins that Node.js internals rely on.
 * For example, if user code does `Array.prototype.push = evil`, Node.js internals using
 * ArrayPrototypePush still have the original implementation.
 *
 * Pattern:
 * - XxxPrototypeMethod: Bound method from prototype (e.g., Array.prototype.push)
 * - SafeXxx: Frozen constructor (e.g., Map, Set)
 * - XxxMethod: Static methods (e.g., Object.keys)
 *
 * Extracted from 58 Node.js source files in RemodlWebContainer.
 * Total primordials: 140+
 */

// Helper to create bound methods
function uncurryThis(func) {
  return Function.prototype.call.bind(func);
}

// Create primordials object
const primordials = {
  // === Global uncurryThis helper ===
  uncurryThis,

  // === Array ===
  Array,
  ArrayIsArray: Array.isArray,
  ArrayPrototypeAt: uncurryThis(Array.prototype.at),
  ArrayPrototypeEvery: uncurryThis(Array.prototype.every),
  ArrayPrototypeFilter: uncurryThis(Array.prototype.filter),
  ArrayPrototypeFindLastIndex: uncurryThis(Array.prototype.findLastIndex),
  ArrayPrototypeForEach: uncurryThis(Array.prototype.forEach),
  ArrayPrototypeIncludes: uncurryThis(Array.prototype.includes),
  ArrayPrototypeIndexOf: uncurryThis(Array.prototype.indexOf),
  ArrayPrototypeJoin: uncurryThis(Array.prototype.join),
  ArrayPrototypeLastIndexOf: uncurryThis(Array.prototype.lastIndexOf),
  ArrayPrototypeMap: uncurryThis(Array.prototype.map),
  ArrayPrototypePop: uncurryThis(Array.prototype.pop),
  ArrayPrototypePush: uncurryThis(Array.prototype.push),
  ArrayPrototypePushApply(array, values) {
    Array.prototype.push.apply(array, values);
  },
  ArrayPrototypeShift: uncurryThis(Array.prototype.shift),
  ArrayPrototypeSlice: uncurryThis(Array.prototype.slice),
  ArrayPrototypeSome: uncurryThis(Array.prototype.some),
  ArrayPrototypeSort: uncurryThis(Array.prototype.sort),
  ArrayPrototypeSplice: uncurryThis(Array.prototype.splice),
  ArrayPrototypeUnshift: uncurryThis(Array.prototype.unshift),

  // === ArrayBuffer ===
  ArrayBuffer,
  ArrayBufferIsView: ArrayBuffer.isView,
  ArrayBufferPrototypeSlice: uncurryThis(ArrayBuffer.prototype.slice),

  // === BigInt ===
  BigIntPrototypeToString: uncurryThis(BigInt.prototype.toString),

  // === Boolean ===
  Boolean,

  // === DataView ===
  DataView,

  // === Date ===
  Date,
  DateNow: Date.now,
  DatePrototypeGetDate: uncurryThis(Date.prototype.getDate),
  DatePrototypeGetHours: uncurryThis(Date.prototype.getHours),
  DatePrototypeGetMinutes: uncurryThis(Date.prototype.getMinutes),
  DatePrototypeGetMonth: uncurryThis(Date.prototype.getMonth),
  DatePrototypeGetSeconds: uncurryThis(Date.prototype.getSeconds),

  // === Error ===
  Error,
  ErrorCaptureStackTrace: Error.captureStackTrace,
  SyntaxError,
  SyntaxErrorPrototype: SyntaxError.prototype,

  // === Function ===
  FunctionPrototypeBind: uncurryThis(Function.prototype.bind),
  FunctionPrototypeCall: uncurryThis(Function.prototype.call),

  // === JSON ===
  JSONParse: JSON.parse,
  JSONStringify: JSON.stringify,

  // === Math ===
  MathAbs: Math.abs,
  MathFloor: Math.floor,
  MathMax: Math.max,
  MathMaxApply(values) {
    return Math.max.apply(null, values);
  },
  MathMin: Math.min,
  MathTrunc: Math.trunc,

  // === Number ===
  Number,
  NumberIsFinite: Number.isFinite,
  NumberIsInteger: Number.isInteger,
  NumberIsNaN: Number.isNaN,
  NumberIsSafeInteger: Number.isSafeInteger,
  NumberMAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
  NumberMIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
  NumberParseFloat: Number.parseFloat,
  NumberParseInt: Number.parseInt,

  // === Object ===
  ObjectAssign: Object.assign,
  ObjectDefineProperties: Object.defineProperties,
  ObjectDefineProperty: Object.defineProperty,
  ObjectEntries: Object.entries,
  ObjectFreeze: Object.freeze,
  ObjectGetOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
  ObjectGetOwnPropertyDescriptors: Object.getOwnPropertyDescriptors,
  ObjectGetOwnPropertyNames: Object.getOwnPropertyNames,
  ObjectGetPrototypeOf: Object.getPrototypeOf,
  ObjectHasOwn: Object.hasOwn || ((obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop)),
  ObjectIs: Object.is,
  ObjectKeys: Object.keys,
  ObjectPrototypeHasOwnProperty: uncurryThis(Object.prototype.hasOwnProperty),
  ObjectPrototypeIsPrototypeOf: uncurryThis(Object.prototype.isPrototypeOf),
  ObjectPrototypeToString: uncurryThis(Object.prototype.toString),
  ObjectSetPrototypeOf: Object.setPrototypeOf,
  ObjectValues: Object.values,

  // === Promise ===
  Promise,
  PromisePrototypeThen: uncurryThis(Promise.prototype.then),
  PromiseReject: Promise.reject.bind(Promise),
  PromiseResolve: Promise.resolve.bind(Promise),

  // === Reflect ===
  ReflectApply: Reflect.apply,
  ReflectConstruct: Reflect.construct,
  ReflectOwnKeys: Reflect.ownKeys,

  // === RegExp ===
  RegExp,
  RegExpPrototypeExec: uncurryThis(RegExp.prototype.exec),
  RegExpPrototypeSymbolReplace: uncurryThis(RegExp.prototype[Symbol.replace]),

  // === Safe Collections (frozen constructors) ===
  SafeFinalizationRegistry: FinalizationRegistry,
  SafeMap: Map,
  SafePromiseRace: Promise.race.bind(Promise),
  SafeSet: Set,
  SafeWeakMap: WeakMap,
  SafeWeakSet: WeakSet,

  // === String ===
  String,
  StringFromCharCode: String.fromCharCode,
  StringPrototypeCharAt: uncurryThis(String.prototype.charAt),
  StringPrototypeCharCodeAt: uncurryThis(String.prototype.charCodeAt),
  StringPrototypeCodePointAt: uncurryThis(String.prototype.codePointAt),
  StringPrototypeEndsWith: uncurryThis(String.prototype.endsWith),
  StringPrototypeIncludes: uncurryThis(String.prototype.includes),
  StringPrototypeIndexOf: uncurryThis(String.prototype.indexOf),
  StringPrototypeLastIndexOf: uncurryThis(String.prototype.lastIndexOf),
  StringPrototypePadStart: uncurryThis(String.prototype.padStart),
  StringPrototypeRepeat: uncurryThis(String.prototype.repeat),
  StringPrototypeReplace: uncurryThis(String.prototype.replace),
  StringPrototypeSlice: uncurryThis(String.prototype.slice),
  StringPrototypeSplit: uncurryThis(String.prototype.split),
  StringPrototypeStartsWith: uncurryThis(String.prototype.startsWith),
  StringPrototypeToLocaleLowerCase: uncurryThis(String.prototype.toLocaleLowerCase),
  StringPrototypeToLowerCase: uncurryThis(String.prototype.toLowerCase),
  StringPrototypeToUpperCase: uncurryThis(String.prototype.toUpperCase),
  StringPrototypeToWellFormed: String.prototype.toWellFormed
    ? uncurryThis(String.prototype.toWellFormed)
    : (str) => str, // Fallback for older environments
  StringPrototypeTrim: uncurryThis(String.prototype.trim),
  StringPrototypeTrimStart: uncurryThis(String.prototype.trimStart),

  // === Symbol ===
  Symbol,
  SymbolAsyncIterator: Symbol.asyncIterator,
  SymbolFor: Symbol.for,
  SymbolHasInstance: Symbol.hasInstance,
  SymbolSpecies: Symbol.species,
  SymbolToPrimitive: Symbol.toPrimitive,

  // === TypedArray (shared prototype methods) ===
  TypedArrayPrototypeFill: uncurryThis(Uint8Array.prototype.fill),
  TypedArrayPrototypeGetBuffer: Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    'buffer'
  ).get,
  TypedArrayPrototypeGetByteLength: Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    'byteLength'
  ).get,
  TypedArrayPrototypeGetByteOffset: Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    'byteOffset'
  ).get,
  TypedArrayPrototypeGetLength: Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    'length'
  ).get,
  TypedArrayPrototypeSet: uncurryThis(Uint8Array.prototype.set),
  TypedArrayPrototypeSlice: uncurryThis(Uint8Array.prototype.slice),
  TypedArrayPrototypeSubarray: uncurryThis(Uint8Array.prototype.subarray),

  // === TypedArray Constructors ===
  BigInt64Array,
  BigUint64Array,
  Float32Array,
  Float64Array,
  Int16Array,
  Int32Array,
  Int8Array,
  Uint16Array,
  Uint32Array,
  Uint8Array,
  Uint8ArrayPrototype: Uint8Array.prototype,
  Uint8ClampedArray,

  // === Global Functions ===
  decodeURIComponent,
  globalThis,
};

// Freeze the primordials object to prevent modification
Object.freeze(primordials);

module.exports = primordials;
