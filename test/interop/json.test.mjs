import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import electron from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sdk = process.env.WEBNAT_WEB_SDK_BUNDLE || path.resolve(root, '../webnat-web/dist/index.js');
test('real Electron and Web SDK JSON contract interoperability', {timeout: 90000}, async t => {
  assert.ok(fs.existsSync(sdk), `Build the Web SDK first or set WEBNAT_WEB_SDK_BUNDLE: ${sdk}`);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'webnat-json-interop-'));
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [path.join(root, 'test/interop/json-runner.cjs'), path.join(root, 'dist'), sdk, userData], {cwd: root, env});
  let output = ''; child.stdout.on('data', bytes => {output += bytes}); child.stderr.on('data', bytes => {output += bytes});
  const timer = setTimeout(() => child.kill(), 65000);
  let code;
  try {code = await new Promise((resolve, reject) => {child.on('close', resolve); child.on('error', reject)})}
  finally {clearTimeout(timer); fs.rmSync(userData, {recursive: true, force: true})}
  const results = output.split('\n').filter(line => line.startsWith('RESULT ')).map(line => JSON.parse(line.slice(7)));
  for (const result of results.filter(result => result.name !== 'summary')) {
    await t.test(result.name, () => assert.equal(result.ok, true, result.detail));
  }
  assert.ok(results.find(result => result.name === 'summary' && result.ok), output.slice(-5000));
  assert.equal(code, 0);
});
