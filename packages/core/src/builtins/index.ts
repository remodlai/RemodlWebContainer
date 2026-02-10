// These static imports will be resolved at build time
import primordialsRaw from './primordials.js?raw';
import internalBindingRaw from './internalBinding.cjs?raw';

export const builtinSources = {
  'primordials.js': primordialsRaw,
  'internalBinding.cjs': internalBindingRaw
};

// For Node.js files, use glob
const nodeFiles = import.meta.glob('./node/**/*.js', {
  as: 'raw',
  eager: true
});

export const nodeBuiltinSources: Record<string, string> = {};
for (const [path, content] of Object.entries(nodeFiles)) {
  const relativePath = path.replace('./node/', '');
  nodeBuiltinSources[relativePath] = content as string;
}
