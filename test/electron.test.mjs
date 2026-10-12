import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

// Integration: runs test/electron/webnat-runner.cjs inside the pinned Electron's MAIN process (a real Chromium and the real
// preload bridge, no Web SDK) and re-reports each of its checks as a node:test case.
// Needs the Electron binary (`npm install` downloads it). Set WEBNAT_SKIP_ELECTRON=1 to skip on machines without one.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = process.env.WEBNAT_SKIP_ELECTRON === '1'
  ? 'WEBNAT_SKIP_ELECTRON=1'
  : !fs.existsSync(electronPath) ? `Electron binary missing at ${electronPath}; run npm install` : false;

test('Electron integration: Webnat over a real renderer (bridge scope and registration)', { skip, timeout: 150_000 }, async (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'webnat-electron-test-'));
  const args = [
    path.join(root, 'test/electron/webnat-runner.cjs'),
    path.join(root, 'dist'),
    userData,
  ];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  fs.rmSync(userData, { recursive: true, force: true });

  const results = output.split('\n').filter((l) => l.startsWith('RESULT ')).map((l) => JSON.parse(l.slice('RESULT '.length)));
  assert.ok(results.length > 1, `the runner reported nothing (exit ${code}):\n${output.slice(-2000)}`);
  for (const result of results.filter((r) => r.name !== 'summary')) {
    await t.test(result.name, () => {
      assert.equal(result.ok, true, typeof result.detail === 'string' ? result.detail : JSON.stringify(result.detail));
    });
  }
  const summary = results.find((r) => r.name === 'summary');
  assert.ok(summary, `the runner never finished (exit ${code}):\n${output.slice(-2000)}`);
  assert.equal(summary.ok, true, `summary ${summary.detail}`);
  assert.equal(code, 0);
});
