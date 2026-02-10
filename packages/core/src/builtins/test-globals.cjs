// Test script to verify primordials and internalBinding are available as globals
// This simulates what Node.js bootstrap files expect

'use strict';

console.log('=== Testing Node.js Internal Globals ===\n');

// Test 1: Check if primordials is available
try {
    if (typeof primordials !== 'undefined') {
        console.log('✓ primordials is available as global');

        // Check some key primordials
        const requiredPrimordials = [
            'ArrayIsArray',
            'ObjectKeys',
            'StringPrototypeSlice',
            'Promise',
            'MathMax'
        ];

        let missing = [];
        for (const name of requiredPrimordials) {
            if (!(name in primordials)) {
                missing.push(name);
            }
        }

        if (missing.length === 0) {
            console.log(`✓ All ${requiredPrimordials.length} tested primordials present`);
        } else {
            console.error(`✗ Missing primordials: ${missing.join(', ')}`);
        }

        // Test that primordials is frozen
        try {
            primordials.test = 'should fail';
            console.error('✗ primordials is not frozen');
        } catch (e) {
            console.log('✓ primordials is frozen (immutable)');
        }
    } else {
        console.error('✗ primordials is NOT available');
    }
} catch (e) {
    console.error('✗ Error testing primordials:', e.message);
}

console.log('');

// Test 2: Check if internalBinding is available
try {
    if (typeof internalBinding !== 'undefined') {
        console.log('✓ internalBinding is available as global');

        // Test that it's a function
        if (typeof internalBinding === 'function') {
            console.log('✓ internalBinding is a function');
        } else {
            console.error('✗ internalBinding is not a function');
        }

        // Test loading fs binding
        try {
            const fs = internalBinding('fs');
            console.log('✓ internalBinding("fs") works');

            // Check for FSReqCallback
            if (typeof fs.FSReqCallback === 'function') {
                console.log('✓ FSReqCallback class available');
            } else {
                console.error('✗ FSReqCallback not available');
            }

            // Check for statValues
            if (fs.statValues instanceof Float64Array) {
                console.log('✓ statValues Float64Array available');
            } else {
                console.error('✗ statValues not available');
            }
        } catch (e) {
            console.error('✗ Error loading fs binding:', e.message);
        }

        // Test loading constants binding
        try {
            const constants = internalBinding('constants');
            console.log('✓ internalBinding("constants") works');

            if (constants.fs && typeof constants.fs.O_RDONLY === 'number') {
                console.log('✓ File system constants available');
            } else {
                console.error('✗ File system constants not available');
            }
        } catch (e) {
            console.error('✗ Error loading constants:', e.message);
        }

        // Test error on invalid binding
        try {
            internalBinding('nonexistent');
            console.error('✗ Should throw error for invalid binding');
        } catch (e) {
            if (e.message.includes('No such binding')) {
                console.log('✓ Correctly throws error for invalid binding');
            } else {
                console.error('✗ Wrong error for invalid binding:', e.message);
            }
        }
    } else {
        console.error('✗ internalBinding is NOT available');
    }
} catch (e) {
    console.error('✗ Error testing internalBinding:', e.message);
}

console.log('\n=== Summary ===');
console.log('If all tests passed, Node.js internal modules can now access:');
console.log('- primordials (frozen built-in primordials)');
console.log('- internalBinding() (C++ binding shims)');
console.log('\nNext: Load actual builtins/primordials.cjs and builtins/internalBinding.cjs');
