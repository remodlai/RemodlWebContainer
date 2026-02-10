// Test script to run INSIDE QuickJS to verify primordials and internalBinding
// This file should be executed by NodeProcess

console.log('=== QuickJS Globals Test ===');

// Test primordials
if (typeof primordials !== 'undefined') {
    console.log('✓ primordials available');
    console.log('  - ArrayIsArray:', typeof primordials.ArrayIsArray);
    console.log('  - ObjectKeys:', typeof primordials.ObjectKeys);
} else {
    console.error('✗ primordials NOT available');
}

// Test internalBinding
if (typeof internalBinding !== 'undefined') {
    console.log('✓ internalBinding available');

    try {
        const fs = internalBinding('fs');
        console.log('✓ internalBinding("fs") works');
        console.log('  - FSReqCallback:', typeof fs.FSReqCallback);
        console.log('  - statValues:', fs.statValues ? 'present' : 'missing');
    } catch (e) {
        console.error('✗ Error loading fs:', e.message);
    }
} else {
    console.error('✗ internalBinding NOT available');
}

console.log('=== Test Complete ===');
