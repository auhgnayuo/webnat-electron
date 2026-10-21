'use strict';
// A real Chromium + preload + built Web SDK run, isolated from the user's Electron profile.
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const [dist, sdkFile, userData] = process.argv.slice(2);
app.setPath('userData', userData);
app.on('window-all-closed', () => {});
const out = (name, ok, detail) => console.log('RESULT ' + JSON.stringify({name, ok, detail}));
setTimeout(() => {out('watchdog', false, 'interop runner exceeded 60s'); app.exit(2)}, 60000).unref();
(async () => {
  const sdk = fs.readFileSync(sdkFile, 'utf8');
  const html = `<!doctype html><script type="module">
    import sdk from '/sdk.js'; window.sdk = sdk;
    sdk.onMethod('web.echo', async (param, _signal, notify) => {notify(param); return param});
    sdk.onMethod('web.empty', async () => {});
    sdk.onMethod('web.bad', async () => new Date());
    window.ready = true;
  </script>`;
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', request.url === '/sdk.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/sdk.js' ? sdk : html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await app.whenReady(); if (app.dock) app.dock.hide();
  const {Webnat} = await import(pathToFileURL(path.join(dist, 'webnat/webnat.js')).href);
  const window = new BrowserWindow({show: false, webPreferences: {backgroundThrottling: false}});
  const native = Webnat.of(window.webContents);
  let calls = 0;
  native.onMethod('node.echo', async (param, _signal, notify) => {calls++; notify(param); return param});
  const until = async condition => {
    for (let i = 0; i < 200; i++) {if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 20))}
    throw new Error('timeout waiting for the Web SDK');
  };
  let failures = 0;
  const check = async (name, fn) => {try {await fn(); out(name, true)} catch(error) {failures++; out(name, false, error.stack || JSON.stringify(error))}};
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    await window.loadURL(url);
    await until(() => window.webContents.executeJavaScript('window.ready === true'));
    await window.webContents.executeJavaScript(`new Promise(resolve => {const f = document.createElement('iframe'); f.src = '/child'; f.onload = resolve; document.body.appendChild(f)})`);
    await until(() => native.getConnections().size === 2);
    const frames = window.webContents.mainFrame.framesInSubtree;
    for (const frame of frames) await until(() => frame.executeJavaScript('window.ready === true'));
    const payload = JSON.parse('{"null":null,"list":[1,null,{"x":null}],"__proto__":{"safe":true},"text":"你好 😀"}');
    await check('main frame and iframe preserve JSON values and notifications over real IPC', async () => {
      for (const frame of frames) {
        const result = await frame.executeJavaScript(`(async () => {const notes = []; const value = await sdk.method({method:'node.echo',param:JSON.parse(${JSON.stringify(JSON.stringify(payload))})},{timeout:1000,onNotification:v=>notes.push(v)}); return {value,notes}})()`);
        assert.deepEqual(result, {value: payload, notes: [payload]});
      }
      assert.equal(calls, 2);
    });
    await check('invalid Web values fail at the source, including iframe BigInt, without reaching native', async () => {
      const before = calls;
      for (const frame of frames) {
        const codes = await frame.executeJavaScript(`(async () => {
          const values = [NaN,Infinity,new Date(),new Map(),new Set(),10n,{x:undefined},[undefined]];
          const codes = []; for (const param of values) {
            try {await sdk.method({method:'node.echo',param},{timeout:500}); codes.push('unexpected success')}
            catch(error) {codes.push(error.code)}
          } return codes;
        })()`);
        assert.deepEqual(codes, Array(8).fill(-1012));
      }
      assert.equal(calls, before);
    });
    await check('native requests receive JSON results, notifications and null empty results from both frames', async () => {
      for (const connection of native.getConnections().values()) {
        const notes = [];
        assert.deepEqual(await native.method({method: 'web.echo', param: payload}, {timeout: 1000, onNotification: value => notes.push(value)}, connection), payload);
        assert.deepEqual(notes, [payload]);
        assert.equal(await native.method({method: 'web.empty'}, {timeout: 1000}, connection), null);
        await assert.rejects(native.method({method: 'web.bad'}, {timeout: 1000}, connection), error => error.code === -1012);
      }
    });
    await check('native invalid parameters fail before renderer execution rather than being rewritten', async () => {
      for (const connection of native.getConnections().values()) {
        for (const param of [NaN, new Date(), new Map(), [undefined]]) {
          await assert.rejects(native.method({method: 'web.echo', param}, {timeout: 1000}, connection), error => error.code === -1012);
        }
      }
    });
  } finally {
    window.destroy(); server.close();
  }
  out('summary', failures === 0, `Electron ${process.versions.electron}`);
  app.exit(failures ? 1 : 0);
})().catch(error => {out('fatal', false, error.stack); app.exit(3)});
