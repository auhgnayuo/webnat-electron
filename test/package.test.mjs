import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The package contract: what `exports` exposes, how it loads as ESM and CommonJS, and that the version stays in sync.
// `webnat-electron` resolves to this very package through its own `exports` map (package self-reference).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const PUBLIC_VALUES = ['Webnat', 'WebnatError', 'WebnatErrorCode', 'WebnatVersion'];

test('the ESM entry exposes exactly the public surface', async () => {
  const esm = await import('webnat-electron');
  assert.deepEqual(Object.keys(esm).sort(), PUBLIC_VALUES);
  assert.equal(typeof esm.Webnat.of, 'function');
});

test('the CommonJS entry exposes the same surface', () => {
  const cjs = require('webnat-electron');
  assert.deepEqual(Object.keys(cjs).sort(), PUBLIC_VALUES);
  assert.equal(typeof cjs.Webnat.of, 'function');
});

test('WebnatVersion is the package version (it is written into the UA as Webnat/{version})', async () => {
  const { WebnatVersion } = await import('webnat-electron');
  assert.equal(WebnatVersion, pkg.version);
});

test('the preload resolves to one self-contained CommonJS file', () => {
  const resolved = require.resolve('webnat-electron/preload');
  assert.equal(resolved, path.join(root, 'dist/preload/index.cjs'));
  const requires = [...fs.readFileSync(resolved, 'utf8').matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  assert.deepEqual(requires, ['electron'], 'a sandboxed preload may only require electron');
});

test('internal modules are not reachable through exports', async () => {
  await assert.rejects(import('webnat-electron/webnat/message.js'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  assert.throws(() => require('webnat-electron/dist/webnat/message.cjs'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
});

test('the main entry has no runtime dependency on electron (it is a type-only peer)', () => {
  const mainFiles = fs.readdirSync(path.join(root, 'dist'), { recursive: true })
    .filter((f) => /\.(c?js)$/.test(f) && !f.startsWith('preload'));
  assert.ok(mainFiles.length > 0);
  for (const file of mainFiles) {
    const source = fs.readFileSync(path.join(root, 'dist', file), 'utf8');
    assert.doesNotMatch(source, /require\(["']electron["']\)|from ["']electron["']/, `${file} must not load electron at runtime`);
  }
});
