/**
 * Test script to verify Node.js polyfills work in QuickJS
 * Run with: npx tsx src/polyfills/test-polyfills.ts
 */

import { getQuickJS, QuickJSContext } from 'quickjs-emscripten';
import { getPolyfillBundle, AVAILABLE_MODULES } from './polyfill-loader';

async function testPolyfills() {
  console.log('🚀 Initializing QuickJS...');
  const QuickJS = await getQuickJS();
  const vm = QuickJS.newContext();

  try {
    // Load the polyfill bundle
    console.log('📦 Loading polyfills bundle...');
    const bundle = getPolyfillBundle();
    console.log(`   Bundle size: ${(bundle.length / 1024 / 1024).toFixed(2)} MB`);

    const loadResult = vm.evalCode(bundle);
    if (loadResult.error) {
      console.error('❌ Failed to load polyfills:', vm.dump(loadResult.error));
      loadResult.error.dispose();
      return;
    }
    loadResult.value.dispose();
    console.log('✅ Polyfills loaded successfully');

    // Set up global require
    console.log('🔧 Setting up global require...');
    const setupResult = vm.evalCode(`
      globalThis.require = require;
      globalThis.Buffer = require('buffer').Buffer;
      'setup complete';
    `);
    if (setupResult.error) {
      console.error('Error:', setupResult.error);
      setupResult.error.dispose();
      return;
    }
    console.log('   Result:', vm.dump(setupResult.value));
    setupResult.value.dispose();

    // Test each module
    console.log('\n📝 Testing available modules:');
    for (const moduleName of AVAILABLE_MODULES) {
      const testResult = vm.evalCode(`
        try {
          const mod = require('${moduleName}');
          JSON.stringify({
            success: true,
            module: '${moduleName}',
            keys: Object.keys(mod).slice(0, 5)
          });
        } catch (e) {
          JSON.stringify({
            success: false,
            module: '${moduleName}',
            error: String(e)
          });
        }
      `);

      if (testResult.error) {
        console.log(`   ❌ ${moduleName}: Failed to evaluate`);
        testResult.error.dispose();
      } else {
        const result = JSON.parse(vm.dump(testResult.value));
        if (result.success) {
          console.log(`   ✅ ${moduleName}: ${result.keys.join(', ')}${result.keys.length > 0 ? ', ...' : ''}`);
        } else {
          console.log(`   ❌ ${moduleName}: ${result.error}`);
        }
        testResult.value.dispose();
      }
    }

    // Test Buffer functionality
    console.log('\n🧪 Testing Buffer functionality:');
    const bufferTest = vm.evalCode(`
      const buf = Buffer.from('hello world', 'utf8');
      JSON.stringify({
        length: buf.length,
        hex: buf.toString('hex'),
        base64: buf.toString('base64')
      });
    `);
    if (bufferTest.error) {
      console.log('   ❌ Buffer test failed');
      bufferTest.error.dispose();
    } else {
      const result = JSON.parse(vm.dump(bufferTest.value));
      console.log('   ✅ Buffer test passed:');
      console.log('      Length:', result.length);
      console.log('      Hex:', result.hex);
      console.log('      Base64:', result.base64);
      bufferTest.value.dispose();
    }

    // Test path module
    console.log('\n🧪 Testing path module:');
    const pathTest = vm.evalCode(`
      const path = require('path');
      JSON.stringify({
        join: path.join('/foo', 'bar', 'baz.txt'),
        basename: path.basename('/foo/bar/baz.txt'),
        dirname: path.dirname('/foo/bar/baz.txt'),
        extname: path.extname('/foo/bar/baz.txt')
      });
    `);
    if (pathTest.error) {
      console.log('   ❌ Path test failed');
      pathTest.error.dispose();
    } else {
      const result = JSON.parse(vm.dump(pathTest.value));
      console.log('   ✅ Path test passed:');
      console.log('      join:', result.join);
      console.log('      basename:', result.basename);
      console.log('      dirname:', result.dirname);
      console.log('      extname:', result.extname);
      pathTest.value.dispose();
    }

    // Test crypto module
    console.log('\n🧪 Testing crypto module:');
    const cryptoTest = vm.evalCode(`
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256');
      hash.update('hello world');
      const digest = hash.digest('hex');
      JSON.stringify({
        algorithm: 'sha256',
        input: 'hello world',
        output: digest
      });
    `);
    if (cryptoTest.error) {
      console.log('   ❌ Crypto test failed:', vm.dump(cryptoTest.error));
      cryptoTest.error.dispose();
    } else {
      const result = JSON.parse(vm.dump(cryptoTest.value));
      console.log('   ✅ Crypto test passed:');
      console.log('      Algorithm:', result.algorithm);
      console.log('      Input:', result.input);
      console.log('      Output:', result.output);
      cryptoTest.value.dispose();
    }

    console.log('\n✨ All tests completed!');

  } catch (error) {
    console.error('💥 Test failed:', error);
  } finally {
    vm.dispose();
  }
}

// Run tests
testPolyfills().catch(console.error);
