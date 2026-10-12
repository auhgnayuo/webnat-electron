'use strict';
// Runs INSIDE Electron's main process (spawned by electron.test.mjs). Checks that need a real renderer but NO Web SDK,
// like the unit tests of the other platforms: the page-side bridge scope (top frame only) and its registration by Webnat.of.
// Nothing registers the preload by hand: Webnat.of does, as it does for a real host.
// The end-to-end run against the real Web SDK is done by hand with the demo host, as on the other platforms.
const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const [distDir, userData] = process.argv.slice(2);
app.setPath('userData', userData);
app.on('window-all-closed', () => {});
setTimeout(() => { console.log('RESULT ' + JSON.stringify({ name: 'watchdog', ok: false, detail: 'runner exceeded 60s' })); app.exit(2); }, 60000).unref();
const out = (name, ok, detail) => console.log('RESULT ' + JSON.stringify({ name, ok, detail }));
const plain = (_req, res) => { res.setHeader('content-type', 'text/html'); res.setHeader('cache-control', 'no-store'); res.end('<!doctype html><meta charset=utf-8><p>plain</p>'); };
const server = http.createServer(plain);
const otherOrigin = http.createServer(plain);
(async () => {
  const { Webnat } = await import(pathToFileURL(path.join(distDir, 'webnat/webnat.js')).href);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  await new Promise((r) => otherOrigin.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const otherBase = `http://127.0.0.1:${otherOrigin.address().port}`;
  await app.whenReady();
  if (app.dock) app.dock.hide();
  let failed = 0; const check = async (n, f) => { try { out(n, true, await f()); } catch (e) { failed++; out(n, false, String(e.message).slice(0, 300)); } };

  await check('the bridge is exposed to the top frame only, even when the host enables nodeIntegrationInSubFrames', async () => {
    const scope = async (webPreferences) => {
      const w = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, ...webPreferences } });
      try {
        Webnat.of(w.webContents);
        await w.loadURL(base + '/plain.html');
        await w.webContents.executeJavaScript(`(async () => {
          const add = (props) => new Promise((resolve) => { const f = document.createElement('iframe'); Object.assign(f, props); f.addEventListener('load', resolve, { once: true }); document.body.appendChild(f); });
          await add({ src: '/plain.html' });
          await add({ src: ${JSON.stringify(otherBase + '/plain.html')} });
          await add({ srcdoc: '<p>x</p>' });
        })()`);
        const seen = {};
        for (const frame of w.webContents.mainFrame.framesInSubtree) {
          const name = frame === w.webContents.mainFrame ? 'main' : frame.url.startsWith(otherBase) ? 'cross-origin' : frame.url.startsWith(base) ? 'same-origin' : 'srcdoc';
          seen[name] = await frame.executeJavaScript('typeof window.__native_webnat__');
        }
        return seen;
      } finally { w.destroy(); }
    };
    const expected = { main: 'object', 'same-origin': 'undefined', 'cross-origin': 'undefined', srcdoc: 'undefined' };
    assert.deepEqual(await scope({}), expected);
    assert.deepEqual(await scope({ nodeIntegrationInSubFrames: true }), expected);
    return expected;
  });

  await check('Webnat.of registers the bridge itself: two WebContents on a fresh session share one registration and both pages get the bridge', async () => {
    const fresh = session.fromPartition('webnat-fresh');
    assert.equal(fresh.getPreloadScripts().length, 0, 'precondition: nothing registered on the new session');
    const w1 = new BrowserWindow({ show: false, webPreferences: { session: fresh } });
    const w2 = new BrowserWindow({ show: false, webPreferences: { session: fresh } });
    try {
      Webnat.of(w1.webContents);
      Webnat.of(w2.webContents);
      const scripts = fresh.getPreloadScripts();
      assert.equal(scripts.length, 1, 'one registration per session, not one per WebContents');
      assert.equal(scripts[0].type, 'frame');
      assert.equal(scripts[0].filePath, path.join(distDir, 'preload/index.cjs'));
      await Promise.all([w1.webContents.loadURL(base + '/plain.html'), w2.webContents.loadURL(base + '/plain.html')]);
      const seen = await Promise.all([w1, w2].map((w) => w.webContents.executeJavaScript('typeof window.__native_webnat__')));
      assert.deepEqual(seen, ['object', 'object']);
      return { registrations: scripts.length, seen };
    } finally { w1.destroy(); w2.destroy(); }
  });

  console.log('RESULT ' + JSON.stringify({ name: 'summary', ok: failed === 0, detail: 'electron ' + process.versions.electron }));
  app.exit(failed ? 1 : 0);
})().catch((e) => { console.log('RESULT ' + JSON.stringify({ name: 'fatal', ok: false, detail: String((e && e.stack) || e).slice(0, 1200) })); app.exit(3); });
