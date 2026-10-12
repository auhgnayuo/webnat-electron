'use strict';
// Runs INSIDE Electron's main process (spawned by electron.test.mjs). Webnat-over-Chromium checks that need a real renderer:
// same-origin iframe relayed through the main frame, multi-frame method race, two WebContents isolation, navigation cleanup,
// and the bridge scope (top frame only). Nothing registers the preload by hand: Webnat.of does, as it does for a real host.
const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const [distDir, webnatDist, userData] = process.argv.slice(2);
app.setPath('userData', userData);
app.on('window-all-closed', () => {});
setTimeout(() => { console.log('RESULT ' + JSON.stringify({ name: 'watchdog', ok: false, detail: 'runner exceeded 80s' })); app.exit(2); }, 80000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, label, ms = 10000) => { const t = Date.now(); for (;;) { if (await fn()) return; if (Date.now() - t > ms) throw new Error('timeout ' + label); await sleep(30); } };
const out = (name, ok, detail) => console.log('RESULT ' + JSON.stringify({ name, ok, detail }));
const SDK = fs.readFileSync(path.join(webnatDist, 'index.js'), 'utf8');
const html = (extra) => `<!doctype html><meta charset=utf-8><script>window.process={env:{NODE_ENV:'production'}};window.__log=[]</script><script type="module">import webnat from '/sdk.js';window.__sdk=webnat;${extra};window.__ready=true</script>`;
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  const send = (t, c) => { res.setHeader('content-type', t); res.setHeader('cache-control', 'no-store'); res.end(c); };
  if (p === '/sdk.js') return send('text/javascript', SDK);
  if (p === '/main.html') return send('text/html', html("webnat.onMethod('web.echo', async (x)=>({echo:x}));webnat.onMethod('web.never',(x,s)=>new Promise(()=>{s.addEventListener('abort',()=>window.__log.push('aborted'))}));const f=document.createElement('iframe');f.src='/frame.html';document.body.appendChild(f)"));
  if (p === '/frame.html') return send('text/html', html("webnat.onMethod('frame.only', async (x)=>({from:'frame',x}))"));
  if (p === '/other.html') return send('text/html', html(''));
  if (p === '/plain.html') return send('text/html', '<!doctype html><meta charset=utf-8><p>plain</p>');
  res.statusCode = 404; res.end();
});
const otherOrigin = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta charset=utf-8><p>cross-origin</p>'); });
(async () => {
  const { Webnat } = await import(pathToFileURL(path.join(distDir, 'webnat/webnat.js')).href);
  const { WebnatErrorCode } = await import(pathToFileURL(path.join(distDir, 'webnat/error.js')).href);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  await new Promise((r) => otherOrigin.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const otherBase = `http://127.0.0.1:${otherOrigin.address().port}`;
  await app.whenReady();
  if (app.dock) app.dock.hide();
  const mk = () => new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  let failed = 0; const check = async (n, f) => { try { out(n, true, await f()); } catch (e) { failed++; out(n, false, String(e.message).slice(0, 300)); } };

  const winA = mk(), winB = mk();
  const A = Webnat.of(winA.webContents), B = Webnat.of(winB.webContents);
  await winA.loadURL(base + '/main.html');
  await waitFor(() => A.getConnections().size === 2, 'A two connections');
  const roles = (w) => { const all = [...w.getConnections().values()]; return { main: all.find((c) => c.attributes.isMainframe === true), frame: all.find((c) => c.attributes.isMainframe === false) }; };

  await check('main frame + same-origin iframe both connect (iframe relayed through the main frame)', async () => {
    const { main, frame } = roles(A); assert.ok(main && frame);
    assert.equal(main.url, base + '/main.html'); return { main: main.attributes, frame: frame.attributes };
  });
  await check('method() without a connection races every frame and picks the one that implements it', async () => {
    const notes = []; const r = await A.method({ method: 'frame.only', param: { x: 1 } }, { timeout: 4000, onNotification: (n) => notes.push(n) });
    assert.deepEqual(r, { from: 'frame', x: { x: 1 } });
    await assert.rejects(A.method({ method: 'nobody' }, { timeout: 4000 }), (e) => e.code === WebnatErrorCode.UNIMPLEMENTED);
  });
  await winB.loadURL(base + '/main.html');
  await waitFor(() => B.getConnections().size === 2, 'B two connections');
  await check('two WebContents are isolated: separate connection sets, destroying one leaves the other working', async () => {
    const idsA = [...A.getConnections().keys()], idsB = [...B.getConnections().keys()];
    assert.ok(idsA.every((i) => !idsB.includes(i)));
    winB.destroy(); await sleep(200);
    assert.equal(A.getConnections().size, 2);
    assert.deepEqual(await A.method({ method: 'web.echo', param: 7 }, { timeout: 4000 }, roles(A).main), { echo: 7 });
  });
  await check('cross-page navigation: a pending call fails with CLOSED and no stale connections remain', async () => {
    const oldIds = [...A.getConnections().keys()]; const { main: oldMain } = roles(A);
    const pending = A.method({ method: 'web.never' }, { timeout: 15000 }, oldMain).then(() => 'resolved', (e) => e.code);
    await winA.webContents.loadURL(base + '/other.html');
    assert.equal(await pending, WebnatErrorCode.CLOSED);
    await waitFor(() => A.getConnections().size === 1, 'one connection after navigating to a page without iframe');
    assert.ok([...A.getConnections().keys()].every((i) => !oldIds.includes(i)));
    assert.equal(oldMain.closed, true);
  });
  await check('destroying the WebContents is harmless: no throw, no unhandled errors', async () => {
    const stale = roles(A).main; let unhandled = 0; process.on('unhandledRejection', () => unhandled++); process.on('uncaughtException', () => unhandled++);
    winA.destroy(); await sleep(300);
    A.raw({ x: 1 }, stale); A.broadcast('x', 1);
    await assert.rejects(A.method({ method: 'x' }, { timeout: 100 }, stale), (e) => e.code === WebnatErrorCode.TIMEOUT);
    await sleep(200); assert.equal(unhandled, 0);
  });
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
