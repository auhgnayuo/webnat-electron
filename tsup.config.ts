import { defineConfig } from 'tsup';

// `clean` is deliberately off: the configs below build in parallel, so `npm run build` wipes dist/ first.
export default defineConfig([
  {
    // The public entry plus the internal modules: the unit tests exercise the modules directly, the way the
    // HarmonyOS source layout is verified module by module. Only `dist/index.*` is reachable through `exports`.
    entry: ['src/index.ts', 'src/webnat/*.ts'],
    format: ['cjs', 'esm'],
    dts: { entry: ['src/index.ts'] },
    sourcemap: true,
    clean: false,
    external: ['electron'],
  },
  {
    // The page-side bridge. A sandboxed preload can only require('electron'), so it must stay one self-contained
    // CommonJS file: the only runtime require in the output is `electron`.
    entry: { 'preload/index': 'src/preload/index.ts' },
    format: ['cjs'],
    dts: false,
    sourcemap: true,
    clean: false,
    external: ['electron'],
  },
]);
