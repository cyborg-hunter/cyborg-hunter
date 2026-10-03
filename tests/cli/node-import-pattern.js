// tests/cli/node-import-pattern.js
// Shared by the tests that check browser code reaches no Node built-in (the
// CLI cores' browser bundles, the analyze page bundle, its worker source): a
// static import, a dynamic import() or a require() of node:*, fs, path, zlib
// or crypto, in any of the forms esbuild prints for an external module.
export const NODE_IMPORT = /(from\s*|import\s*\(\s*|require\s*\(\s*)["'](node:[^"']*|fs|path|zlib|crypto)["']/;
