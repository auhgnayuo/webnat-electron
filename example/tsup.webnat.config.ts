import { defineConfig } from 'tsup';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exampleDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(exampleDir, '..');
const webnatDir = path.join(root, 'src/webnat');
const webnatEntries = Object.fromEntries(
  fs.readdirSync(webnatDir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => [`webnat/${file.slice(0, -3)}`, path.join(webnatDir, file)]),
);

export default defineConfig([
  {
    entry: {
      index: path.join(root, 'src/index.ts'),
      ...webnatEntries,
    },
    outDir: path.join(root, 'dist'),
    format: ['cjs', 'esm'],
    dts: { entry: [path.join(root, 'src/index.ts')] },
    sourcemap: true,
    clean: false,
    external: ['electron'],
    shims: true,
    tsconfig: path.join(exampleDir, 'tsconfig.webnat.json'),
  },
  {
    entry: { 'preload/index': path.join(root, 'src/preload/index.ts') },
    outDir: path.join(root, 'dist'),
    format: ['cjs'],
    dts: false,
    sourcemap: true,
    clean: false,
    external: ['electron'],
    tsconfig: path.join(exampleDir, 'tsconfig.webnat.json'),
  },
]);
