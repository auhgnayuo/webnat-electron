import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Webnat } from '../dist/webnat/webnat.js';
import { Message } from '../dist/webnat/message.js';
import { WebnatVersion } from '../dist/webnat/version.js';
import { WebnatError, WebnatErrorCode } from '../dist/webnat/error.js';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const TO_MAIN = '__native_webnat__.postMessage';
const NATIVE = Message.NATIVE_UUID;
const tick = () => new Promise(resolve => setImmediate(resolve));

// Mirrors the two Session methods `Webnat.of` uses; the script shape and the unique ids follow Electron's PreloadScript.
function createSession() {
  const scripts = [];
  return {
    scripts,
    registerPreloadScript(script) {
      const id = `preload-${scripts.length + 1}`;
      scripts.push({ ...script, id });
      return id;
    },
    getPreloadScripts() { return [...scripts]; },
  };
}

function createLegacySession(initialPreloads = []) {
  let preloads = [...initialPreloads];
  return {
    getPreloads() { return [...preloads]; },
    setPreloads(next) { preloads = [...next]; },
  };
}

// `ipc` is a real EventEmitter, like `webContents.ipc`: only listeners registered on the exact channel fire.
// The WebContents itself is one too, like Electron's: `Webnat.of` listens to `render-process-gone` and `destroyed`.
function createWebContents(session = createSession()) {
  const ipc = new EventEmitter();
  const executedMessages = [];
  const webContents = Object.assign(new EventEmitter(), {
    ipc,
    session,
    userAgent: 'Chromium/1.0 MiniProgram/3.0.2 Webnat/1.2.0',
    destroyed: false,
    executeJavaScriptError: undefined,
    getUserAgent() { return this.userAgent; },
    setUserAgent(value) { this.userAgent = value; },
    getURL() { return 'https://demo.example/app/'; },
    isDestroyed() { return this.destroyed; },
    async executeJavaScript(script) {
      if (this.executeJavaScriptError) throw this.executeJavaScriptError;
      const prefix = 'window.__web_webnat__.receive(...';
      assert.ok(script.startsWith(prefix));
      executedMessages.push(...JSON.parse(script.slice(prefix.length, -1)));
    },
  });
  return { webContents, ipc, session, executedMessages };
}

function createElectronHarness({ session } = {}) {
  const base = createWebContents(session);
  const webnat = Webnat.of(base.webContents);
  const sendFromRenderer = (message, event = {}) => base.ipc.emit(TO_MAIN, event, JSON.stringify(message));
  return { ...base, webnat, sendFromRenderer };
}

function asWebMessage(message, from) {
  const result = message.toDictionary();
  result.from = from;
  result.to = NATIVE;
  return result;
}

function connect(harness, id, attributes = { origin: 'https://demo.example', isMainframe: true }) {
  harness.sendFromRenderer(Message.open(id, attributes).toDictionary());
  return harness.webnat.getConnections().get(id);
}

test('Webnat.of is a per-WebContents singleton, tags the UA once and listens on the native channel only', () => {
  const h = createElectronHarness();
  assert.equal(Webnat.of(h.webContents), h.webnat);
  assert.equal(h.webContents.__native_webnat__, h.webnat);
  assert.equal(h.webContents.userAgent.match(/Webnat\//g)?.length, 1);
  assert.ok(h.webContents.userAgent.endsWith(` Webnat/${WebnatVersion}`), h.webContents.userAgent);
  assert.ok(!h.webContents.userAgent.includes('Webnat/1.2.0'), 'the previous Webnat token must be replaced, not kept');
  assert.match(h.webContents.userAgent, /MiniProgram\/3\.0\.2/);
  assert.deepEqual(h.ipc.eventNames(), [TO_MAIN]);
  assert.equal(h.ipc.listenerCount(TO_MAIN), 1);
});

test('Webnat.of registers the page-side bridge on the session by itself, once per session', () => {
  const bridge = require.resolve('webnat/preload');
  const shared = createSession();
  const first = createElectronHarness({ session: shared });
  const second = createElectronHarness({ session: shared }); // another WebContents on the same session
  assert.notEqual(first.webnat, second.webnat);
  assert.deepEqual(shared.scripts.map(({ type, filePath }) => ({ type, filePath })), [{ type: 'frame', filePath: bridge }]);

  const alone = createElectronHarness(); // a different session needs its own registration
  assert.equal(alone.session.scripts.length, 1);
  assert.equal(Webnat.of(alone.webContents), alone.webnat);
  assert.equal(alone.session.scripts.length, 1, 'asking again for the same WebContents registers nothing');
});

test('Webnat.of uses Electron 22 session preload APIs and does not duplicate an existing path', () => {
  const bridge = require.resolve('webnat/preload');
  const session = createLegacySession();
  createElectronHarness({ session });
  assert.deepEqual(session.getPreloads(), [bridge]);
  createElectronHarness({ session });
  assert.deepEqual(session.getPreloads(), [bridge]);

  const alreadyRegistered = createLegacySession([bridge, '/host/preload.cjs']);
  createElectronHarness({ session: alreadyRegistered });
  assert.deepEqual(alreadyRegistered.getPreloads(), [bridge, '/host/preload.cjs']);
});

test('Webnat.of does not duplicate a bridge the host already registered', () => {
  const session = createSession();
  session.registerPreloadScript({ type: 'frame', filePath: require.resolve('webnat/preload') });
  createElectronHarness({ session });
  assert.equal(session.scripts.length, 1);
});

test('Webnat.of fails before attaching anything when the bridge cannot be registered', () => {
  const session = createSession();
  session.registerPreloadScript = () => { throw new Error('session refused the preload'); };
  const { webContents, ipc } = createWebContents(session);
  const userAgent = webContents.userAgent;
  assert.throws(() => Webnat.of(webContents), /session refused the preload/);
  assert.equal(webContents.__native_webnat__, undefined);
  assert.equal(webContents.userAgent, userAgent);
  assert.deepEqual(ipc.eventNames(), []);
});

test('connection lifecycle: open, duplicate open, dispatch, invalid input, close', () => {
  const h = createElectronHarness();
  const connection = connect(h, 'main');
  assert.equal(connection.url, 'https://demo.example/app/');
  assert.deepEqual(connection.attributes, { origin: 'https://demo.example', isMainframe: true });

  h.sendFromRenderer(Message.open('main', { other: true }).toDictionary());
  assert.equal(h.webnat.getConnections().get('main'), connection);

  h.sendFromRenderer(Message.open('bare').toDictionary());
  assert.deepEqual(h.webnat.getConnections().get('bare').attributes, {});

  const seen = [];
  h.webnat.onRaw(() => { throw new Error('listener errors are isolated'); });
  h.webnat.onRaw((param, source) => seen.push(['raw', param, source.id]));
  h.webnat.onBroadcast('ready', (param, source) => seen.push(['event', param, source.id]));
  h.sendFromRenderer(asWebMessage(Message.raw(NATIVE, { value: 2 }), 'main'));
  h.sendFromRenderer(asWebMessage(Message.broadcast(NATIVE, 'ready', true), 'main'));
  assert.deepEqual(seen, [['raw', { value: 2 }, 'main'], ['event', true, 'main']]);

  h.sendFromRenderer(asWebMessage(Message.raw(NATIVE, 1), 'ghost'));
  h.sendFromRenderer({ ...asWebMessage(Message.raw(NATIVE, 1), 'main'), magic: 'NOPE' });
  h.ipc.emit(TO_MAIN, {}, '{not json');
  assert.equal(seen.length, 2);

  const snapshot = h.webnat.getConnections();
  snapshot.clear();
  assert.equal(h.webnat.getConnections().size, 2);

  // After a navigation Electron reports senderFrame as null; the close must still be honoured.
  h.sendFromRenderer(Message.close('main').toDictionary(), { senderFrame: null });
  assert.deepEqual([...h.webnat.getConnections().keys()], ['bare']);
  assert.equal(connection.closed, true);
});

test('native to web: raw, broadcast and invoke leave as protocol dictionaries via window.__web_webnat__.receive', () => {
  const h = createElectronHarness();
  const connection = connect(h, 'main');
  connect(h, 'frame-1', { origin: 'https://demo.example', isMainframe: false });
  h.executedMessages.length = 0;

  h.webnat.raw({ hello: 'world' }, connection);
  h.webnat.broadcast('tick', 7, connection);
  assert.deepEqual(h.executedMessages.at(-2).raw, { param: { hello: 'world' } });
  assert.deepEqual(h.executedMessages.at(-1).broadcast, { name: 'tick', param: 7 });
  assert.deepEqual(Object.keys(h.executedMessages.at(-1)).sort(), ['broadcast', 'from', 'magic', 'to']);

  h.executedMessages.length = 0;
  h.webnat.broadcast('all');
  assert.deepEqual(h.executedMessages.map(m => [m.to, m.broadcast]), [
    ['main', { name: 'all', param: null }],
    ['frame-1', { name: 'all', param: null }],
  ]);
});

test('method(): resolves with the reply, forwards notifications, rejects with the reply error', async () => {
  const h = createElectronHarness();
  const connection = connect(h, 'main');
  const notes = [];
  const resolved = h.webnat.method({ method: 'answer', param: 42 }, { timeout: 1000, onNotification: n => notes.push(n) }, connection);
  const invoke = h.executedMessages.at(-1);
  assert.deepEqual([invoke.from, invoke.to, invoke.invoke.method, invoke.invoke.param], [NATIVE, 'main', 'answer', 42]);
  h.sendFromRenderer(asWebMessage(Message.notify(NATIVE, invoke.invoke.id, { p: 1 }), 'main'));
  h.sendFromRenderer(asWebMessage(Message.reply(NATIVE, invoke.invoke.id, 'ok'), 'main'));
  assert.equal(await resolved, 'ok');
  assert.deepEqual(notes, [{ p: 1 }]);

  const rejected = h.webnat.method({ method: 'answer' }, { timeout: 1000 }, connection);
  const second = h.executedMessages.at(-1);
  h.sendFromRenderer(asWebMessage(Message.reply(NATIVE, second.invoke.id, undefined, { code: 7, message: 'bad' }), 'main'));
  await assert.rejects(rejected, error => error instanceof WebnatError && error.code === 7 && error.message === 'bad');
});

test('method(): a pre-aborted signal, abort() and timeout cancel the call and tell the peer', async () => {
  const h = createElectronHarness();
  const connection = connect(h, 'main');

  const preAborted = new AbortController();
  preAborted.abort();
  const before = h.executedMessages.length;
  await assert.rejects(h.webnat.method({ method: 'x' }, { signal: preAborted.signal }, connection),
    error => error.code === WebnatErrorCode.CANCELLED);
  assert.equal(h.executedMessages.length, before);

  const controller = new AbortController();
  const aborted = h.webnat.method({ method: 'x' }, { signal: controller.signal }, connection);
  const abortedInvoke = h.executedMessages.at(-1);
  controller.abort();
  await assert.rejects(aborted, error => error.code === WebnatErrorCode.CANCELLED);
  assert.deepEqual(h.executedMessages.at(-1).abort, { id: abortedInvoke.invoke.id });

  const timed = h.webnat.method({ method: 'x' }, { timeout: 20 }, connection);
  const timedInvoke = h.executedMessages.at(-1);
  await assert.rejects(timed, error => error.code === WebnatErrorCode.TIMEOUT);
  assert.deepEqual(h.executedMessages.at(-1).abort, { id: timedInvoke.invoke.id });
});

test('incoming invoke: unimplemented, success with notify, failure keeps code and message, offMethod', async () => {
  const h = createElectronHarness();
  connect(h, 'main');
  const invoke = (id, method, param) => h.sendFromRenderer(asWebMessage(Message.invoke(NATIVE, id, method, param), 'main'));
  const replyOf = id => h.executedMessages.find(m => m.reply?.id === id)?.reply;

  invoke('missing-call', 'not.registered');
  await tick();
  assert.deepEqual(replyOf('missing-call'), {
    id: 'missing-call',
    error: { code: WebnatErrorCode.UNIMPLEMENTED, message: 'Unimplemented Method: not.registered' },
  });

  const echo = async (param, _signal, notify, source) => { notify({ step: 1 }); return { echoed: param, from: source.id }; };
  h.webnat.onMethod('echo', echo);
  invoke('call-1', 'echo', { a: 1 });
  await tick();
  const forCall = h.executedMessages.filter(m => m.notify?.id === 'call-1' || m.reply?.id === 'call-1');
  assert.deepEqual(forCall.map(m => (m.notify ? 'notify' : 'reply')), ['notify', 'reply']);
  assert.deepEqual(forCall[0].notify, { id: 'call-1', param: { step: 1 } });
  assert.deepEqual(forCall[1].reply, { id: 'call-1', result: { echoed: { a: 1 }, from: 'main' } });

  h.webnat.onMethod('fail', async () => { throw new WebnatError(123, 'boom'); });
  h.webnat.onMethod('plain', async () => { throw new Error('plain'); });
  invoke('call-2', 'fail');
  invoke('call-3', 'plain');
  await tick();
  assert.deepEqual(replyOf('call-2').error, { code: 123, message: 'boom' });
  assert.deepEqual(replyOf('call-3').error, { code: WebnatErrorCode.UNKNOWN, message: 'plain' });

  h.webnat.offMethod('echo', async () => ({}));
  invoke('call-4', 'echo');
  await tick();
  assert.equal(replyOf('call-4').result.from, 'main');
  h.webnat.offMethod('echo', echo);
  invoke('call-5', 'echo');
  await tick();
  assert.equal(replyOf('call-5').error.code, WebnatErrorCode.UNIMPLEMENTED);
});

test('incoming invoke: a peer abort or a connection close aborts the handler signal without replying', async () => {
  const h = createElectronHarness();
  connect(h, 'main');
  const signals = [];
  h.webnat.onMethod('long-task', (_param, signal) => { signals.push(signal); return new Promise(() => {}); });
  const invoke = id => h.sendFromRenderer(asWebMessage(Message.invoke(NATIVE, id, 'long-task'), 'main'));

  invoke('long-1');
  assert.ok(signals[0] instanceof AbortSignal);
  assert.equal(signals[0].aborted, false);
  h.sendFromRenderer(asWebMessage(Message.abort(NATIVE, 'long-1'), 'main'));
  assert.equal(signals[0].aborted, true);

  invoke('long-2');
  h.sendFromRenderer(Message.close('main').toDictionary());
  assert.equal(signals[1].aborted, true);
  await tick();
  assert.equal(h.executedMessages.some(m => m.reply), false);
});

test('the handler signal is a native AbortSignal: Node APIs accept it and a peer abort cancels them', async () => {
  const h = createElectronHarness();
  connect(h, 'main');
  let outcome;
  h.webnat.onMethod('sleepy', async (_param, signal) => {
    try {
      await delay(10_000, undefined, { signal });
      outcome = 'completed';
    } catch (error) {
      outcome = error.name;
      throw error;
    }
  });
  h.sendFromRenderer(asWebMessage(Message.invoke(NATIVE, 'sleepy-1', 'sleepy'), 'main'));
  h.sendFromRenderer(asWebMessage(Message.abort(NATIVE, 'sleepy-1'), 'main'));
  await tick();
  assert.equal(outcome, 'AbortError');
  assert.equal(h.executedMessages.some(m => m.reply), false);
});

async function raceOutcome(replies) {
  const h = createElectronHarness();
  connect(h, 'main');
  connect(h, 'frame-1', { origin: 'https://demo.example', isMainframe: false });
  const result = h.webnat.method({ method: 'forwarded-call', param: { id: 7 } }, { timeout: 1000 });
  const invokes = h.executedMessages.filter(m => m.invoke?.method === 'forwarded-call');
  assert.deepEqual(invokes.map(m => m.to).sort(), ['frame-1', 'main']);
  for (const [to, [result_, error]] of Object.entries(replies)) {
    const call = invokes.find(m => m.to === to);
    h.sendFromRenderer(asWebMessage(Message.reply(NATIVE, call.invoke.id, result_, error), to));
  }
  return result;
}

test('method() without a connection races every connection; unimplemented/closed only eliminate', async () => {
  const unimplemented = WebnatError.unimplemented('forwarded-call').toJson();
  assert.deepEqual(await raceOutcome({ main: [undefined, unimplemented], 'frame-1': [{ forwarded: true }, undefined] }), { forwarded: true });
  await assert.rejects(raceOutcome({ main: [undefined, unimplemented], 'frame-1': [undefined, unimplemented] }),
    error => error.code === WebnatErrorCode.UNIMPLEMENTED);
  await assert.rejects(raceOutcome({ main: [undefined, WebnatError.closed().toJson()], 'frame-1': [undefined, unimplemented] }),
    error => error.code === WebnatErrorCode.CLOSED);
  await assert.rejects(raceOutcome({ main: [undefined, unimplemented], 'frame-1': [undefined, { code: 123, message: 'boom' }] }),
    error => error.code === 123 && error.message === 'boom');
});

test('method() without a connection and without any connection fails with CLOSED', async () => {
  const h = createElectronHarness();
  await assert.rejects(h.webnat.method({ method: 'x' }), error => error.code === WebnatErrorCode.CLOSED);
});

test('a connection close rejects its pending RPC with CLOSED', async () => {
  const h = createElectronHarness();
  const connection = connect(h, 'main');
  const pending = h.webnat.method({ method: 'never-returns' }, { timeout: 1000 }, connection);
  h.sendFromRenderer(Message.close('main').toDictionary());
  await assert.rejects(pending, error => error.code === WebnatErrorCode.CLOSED);
  assert.equal(h.webnat.getConnections().size, 0);
});

test('the JavaScript alive keeper runs only while a method call is in flight', async () => {
  const h = createElectronHarness();
  const connection = connect(h, 'main');
  const keeper = h.webnat.javaScriptAliveKeeper;
  assert.equal(keeper.timer, undefined);
  const pending = h.webnat.method({ method: 'slow' }, undefined, connection);
  assert.notEqual(keeper.timer, undefined);
  const invoke = h.executedMessages.at(-1);
  h.sendFromRenderer(asWebMessage(Message.reply(NATIVE, invoke.invoke.id, 'done'), 'main'));
  assert.equal(await pending, 'done');
  assert.equal(keeper.timer, undefined);
});

test('incoming invoke: a handler that throws synchronously is answered with an error reply, a plain return value with its result', async () => {
  const h = createElectronHarness();
  connect(h, 'main');
  const invoke = (id, method) => h.sendFromRenderer(asWebMessage(Message.invoke(NATIVE, id, method), 'main'));
  const replyOf = id => h.executedMessages.find(m => m.reply?.id === id)?.reply;

  h.webnat.onMethod('throws-sync', () => { throw new Error('boom'); });
  h.webnat.onMethod('throws-webnat-error', () => { throw new WebnatError(123, 'denied'); });
  h.webnat.onMethod('plain-value', () => ({ plain: true }));
  invoke('call-1', 'throws-sync');
  invoke('call-2', 'throws-webnat-error');
  invoke('call-3', 'plain-value');
  await tick();
  assert.deepEqual(replyOf('call-1').error, { code: WebnatErrorCode.UNKNOWN, message: 'boom' });
  assert.deepEqual(replyOf('call-2').error, { code: 123, message: 'denied' });
  assert.deepEqual(replyOf('call-3'), { id: 'call-3', result: { plain: true } });
});

test('a failed send is visible: method() rejects at once instead of waiting for its timeout', async () => {
  const h = createElectronHarness();
  const connection = connect(h, 'main');
  const circular = {};
  circular.self = circular;
  for (const param of [10n, circular]) {
    await assert.rejects(h.webnat.method({ method: 'x', param }, { timeout: 2000 }, connection),
      error => error.code === WebnatErrorCode.SERIALIZATION_FAILED);
  }

  h.webContents.executeJavaScriptError = new Error('Script failed to execute');
  await assert.rejects(h.webnat.method({ method: 'x' }, { timeout: 2000 }, connection),
    error => error instanceof WebnatError && error.message === 'Script failed to execute');
  h.webContents.executeJavaScriptError = undefined;

  h.webContents.destroyed = true;
  await assert.rejects(h.webnat.method({ method: 'x' }, { timeout: 2000 }, connection),
    error => error.code === WebnatErrorCode.CLOSED);
  assert.equal(h.webnat.javaScriptAliveKeeper.timer, undefined);
});

test('raw and broadcast stay best-effort: an unserializable payload is dropped without throwing', async () => {
  const h = createElectronHarness();
  const connection = connect(h, 'main');
  const before = h.executedMessages.length;
  h.webnat.raw(10n, connection);
  h.webnat.broadcast('evt', 10n, connection);
  await tick();
  assert.equal(h.executedMessages.length, before);
});

test('an unserializable handler result is answered with SERIALIZATION_FAILED instead of being dropped', async () => {
  const h = createElectronHarness();
  connect(h, 'main');
  h.webnat.onMethod('big', async () => 10n);
  h.sendFromRenderer(asWebMessage(Message.invoke(NATIVE, 'big-1', 'big'), 'main'));
  await tick();
  const reply = h.executedMessages.find(m => m.reply?.id === 'big-1')?.reply;
  assert.equal(reply?.error?.code, WebnatErrorCode.SERIALIZATION_FAILED);
  assert.equal(reply?.result, undefined);
});

test('onRenderProcessGone ends pending calls with CLOSED, aborts running handlers without a reply, and a reload can open again', async () => {
  const h = createElectronHarness();
  const main = connect(h, 'main');
  connect(h, 'frame-1', { origin: 'https://demo.example', isMainframe: false });
  const signals = [];
  h.webnat.onMethod('long-task', (_param, signal) => { signals.push(signal); return new Promise(() => {}); });
  h.sendFromRenderer(asWebMessage(Message.invoke(NATIVE, 'long-1', 'long-task'), 'main'));
  const pending = h.webnat.method({ method: 'never-returns' }, undefined, main); // no timeout: only CLOSE can end it
  assert.notEqual(h.webnat.javaScriptAliveKeeper.timer, undefined);
  const sent = h.executedMessages.length;

  h.webnat.onRenderProcessGone();
  await assert.rejects(pending, error => error.code === WebnatErrorCode.CLOSED);
  assert.equal(signals[0].aborted, true);
  assert.equal(h.webnat.getConnections().size, 0);
  assert.equal(main.closed, true);
  assert.equal(h.webnat.javaScriptAliveKeeper.timer, undefined);
  await tick();
  assert.equal(h.executedMessages.length, sent, 'nothing is sent to the page');
  assert.equal(h.executedMessages.some(m => m.reply), false);

  h.webnat.onRenderProcessGone(); // idempotent
  const reopened = connect(h, 'main-2'); // the reloaded page
  assert.equal(h.webnat.getConnections().size, 1);
  assert.equal(reopened.closed, false);
  h.webnat.raw('hello', reopened);
  assert.deepEqual(h.executedMessages.at(-1).raw, { param: 'hello' });
});

test('Webnat.of ends the connections by itself when the renderer is gone or the WebContents is destroyed', async () => {
  for (const [event, args] of [['render-process-gone', [{}, { reason: 'crashed', exitCode: 11 }]], ['destroyed', []]]) {
    const h = createElectronHarness();
    const connection = connect(h, 'main');
    const pending = h.webnat.method({ method: 'never-returns' }, undefined, connection);
    h.webContents.emit(event, ...args);
    await assert.rejects(pending, error => error.code === WebnatErrorCode.CLOSED, event);
    assert.equal(h.webnat.getConnections().size, 0, event);
    assert.equal(connection.closed, true, event);
    assert.equal(h.webnat.javaScriptAliveKeeper.timer, undefined, event);
  }
});

function loadPreload({ isMainFrame }) {
  const electronPath = require.resolve('electron');
  const preloadPath = require.resolve('../dist/preload/index.cjs');
  const exposed = {};
  const sent = [];
  const fakeElectron = {
    contextBridge: { exposeInMainWorld(name, api) { exposed[name] = api; } },
    ipcRenderer: { send(channel, payload) { sent.push({ channel, payload }); } },
  };
  const previous = require.cache[electronPath];
  const hadIsMainFrame = Object.hasOwn(process, 'isMainFrame');
  const previousIsMainFrame = process.isMainFrame;
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fakeElectron };
  process.isMainFrame = isMainFrame;
  try {
    delete require.cache[preloadPath];
    require(preloadPath);
  } finally {
    if (previous) require.cache[electronPath] = previous;
    else delete require.cache[electronPath];
    delete require.cache[preloadPath];
    if (hadIsMainFrame) process.isMainFrame = previousIsMainFrame;
    else delete process.isMainFrame;
  }
  return { exposed, sent };
}

test('preload exposes only the postMessage proxy and forwards strings on the native channel', () => {
  const { exposed, sent } = loadPreload({ isMainFrame: true });

  assert.deepEqual(Object.keys(exposed), ['__native_webnat__']);
  const api = exposed.__native_webnat__;
  assert.equal(Object.keys(api).join(','), 'postMessage');
  const payload = JSON.stringify(Message.raw('main', { x: 1 }).toDictionary());
  api.postMessage(payload);
  api.postMessage({ not: 'a string' });
  assert.deepEqual(sent, [{ channel: TO_MAIN, payload }]);
});

test('preload exposes nothing in a subframe: the bridge belongs to the top frame only', () => {
  const { exposed, sent } = loadPreload({ isMainFrame: false });
  assert.deepEqual(Object.keys(exposed), []);
  assert.deepEqual(sent, []);
});
