import test from 'node:test';
import assert from 'node:assert/strict';
import { BroadcastMethodCall } from '../dist/webnat/broadcast-method-call.js';
import { BroadcastWebnat } from '../dist/webnat/broadcast-webnat.js';
import { ConnectionImpl } from '../dist/webnat/connection.js';
import { WebnatError, WebnatErrorCode } from '../dist/webnat/error.js';
import { JavaScriptAliveKeeper } from '../dist/webnat/javaScriptAliveKeeper.js';
import { Broadcast, Invoke, Message } from '../dist/webnat/message.js';
import { MethodWebnat } from '../dist/webnat/method-webnat.js';

// Ports of webnat-ohos library/src/test/*.test.ets, plus the edge cases where the first Electron port diverged.

const NATIVE = Message.NATIVE_UUID;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const silentConnection = (id, out = []) => new ConnectionImpl(id, {}, undefined, async m => { out.push(m); });

test('Message round-trips open and broadcast through toDictionary/from', () => {
  const open = Message.from(Message.open('conn-a').toDictionary());
  assert.equal(open?.from, 'conn-a');
  assert.notEqual(open?.open, undefined);
  assert.equal(Message.from(Message.broadcast('conn-a', 'evt').toDictionary())?.broadcast?.name, 'evt');
});

test('Message.from rejects a wrong magic and an empty from', () => {
  assert.equal(Message.from({ ...Message.open('conn-a').toDictionary(), magic: 'NOPE' }), undefined);
  assert.equal(Message.from({ ...Message.open('conn-a').toDictionary(), from: '' }), undefined);
  assert.equal(Message.from({ ...Message.open('conn-a').toDictionary(), to: '' }), undefined);
});

test('Message.from keeps an open without param', () => {
  const parsed = Message.from({ magic: Message.MAGIC, from: 'conn-b', to: NATIVE, open: {} });
  assert.notEqual(parsed?.open, undefined);
  assert.equal(parsed?.open?.param, undefined);
});

test('Message.from drops bodies that lack their required fields (truthiness rule)', () => {
  const base = { magic: 'WEBNAT', from: 'a', to: NATIVE };
  assert.equal(Message.from({ ...base, broadcast: { name: '' } })?.broadcast, undefined);
  assert.equal(Message.from({ ...base, invoke: { id: '1', method: '' } })?.invoke, undefined);
  assert.equal(Message.from({ ...base, invoke: { id: '', method: 'm' } })?.invoke, undefined);
  assert.equal(Message.from({ ...base, reply: { id: '' } })?.reply, undefined);
  assert.equal(Message.from({ ...base, notify: { id: '' } })?.notify, undefined);
  assert.equal(Message.from({ ...base, abort: { id: '' } })?.abort, undefined);
  const reply = Message.from({ ...base, reply: { id: 'i', result: 0 } })?.reply;
  assert.equal(reply?.id, 'i');
  assert.equal(reply?.result, 0);
  assert.equal(reply?.error, undefined);
});

test('Message.toDictionary omits absent fields', () => {
  assert.deepEqual(Message.raw('c').toDictionary(), { magic: 'WEBNAT', from: NATIVE, to: 'c', raw: {} });
  assert.deepEqual(Message.reply('c', 'i', undefined, { code: 1 }).toDictionary().reply, { id: 'i', error: { code: 1 } });
  assert.deepEqual(Message.reply('c', 'i', 5).toDictionary().reply, { id: 'i', result: 5 });
  assert.deepEqual(Message.abort('c', 'i').toDictionary().abort, { id: 'i' });
});

test('WebnatError.from follows the OHOS parsing rules', () => {
  assert.equal(WebnatError.from(null), null);
  assert.equal(WebnatError.from(undefined), null);
  assert.deepEqual(WebnatError.from({ code: 0, message: 'x' }).toJson(), { code: 0, message: 'x' });
  assert.deepEqual(WebnatError.from({ errCode: '12', errMsg: 'm' }).toJson(), { code: 12, message: 'm' });
  assert.equal(WebnatError.from({ code: '0x10' }).code, WebnatErrorCode.UNKNOWN);
  assert.equal(WebnatError.from({ code: 'abc' }).code, WebnatErrorCode.UNKNOWN);
  assert.equal(WebnatError.from({ code: 1.5 }).code, WebnatErrorCode.UNKNOWN);
  assert.deepEqual(WebnatError.from({ code: 7, message: 42 }).toJson(), { code: 7, message: '42' });
  assert.deepEqual(WebnatError.from({}).toJson(), { code: WebnatErrorCode.UNKNOWN, message: 'Unknown Error' });
  assert.deepEqual(WebnatError.from('boom').toJson(), { code: WebnatErrorCode.UNKNOWN, message: 'boom' });
  assert.deepEqual(WebnatError.from(new Error('plain')).toJson(), { code: WebnatErrorCode.UNKNOWN, message: 'plain' });
});

test('WebnatError factories use the OHOS codes and messages', () => {
  assert.deepEqual(WebnatError.timeout().toJson(), { code: -1001, message: 'Operation Timeout' });
  assert.deepEqual(WebnatError.cancelled().toJson(), { code: -999, message: 'Operation Cancelled' });
  assert.deepEqual(WebnatError.closed().toJson(), { code: -1004, message: 'Connection Closed' });
  assert.deepEqual(WebnatError.unimplemented('m').toJson(), { code: -1010, message: 'Unimplemented Method: m' });
  assert.deepEqual(WebnatError.unimplemented().toJson(), { code: -1010, message: 'Unimplemented Method' });
  assert.deepEqual(WebnatError.deserializationFailed().toJson(), { code: -1011, message: 'Message Deserialization Failed' });
  assert.deepEqual(WebnatError.serializationFailed('x').toJson(), { code: -1012, message: 'Message Serialization Failed: x' });
  assert.equal(new WebnatError(1, 'm').name, 'WebnatError');
});

test('JavaScriptAliveKeeper beats only while referenced', async () => {
  let beats = 0;
  const keeper = new JavaScriptAliveKeeper(10, () => { beats++; });
  keeper.heartbeatInterval = 40;
  assert.equal(keeper.heartbeatInterval, 40);
  const warn = console.warn;
  console.warn = () => {};
  try { keeper.heartbeatInterval = 0; } finally { console.warn = warn; }
  assert.equal(keeper.heartbeatInterval, 40);

  keeper.increaseReference();
  await sleep(200);
  assert.ok(beats >= 2, `expected heartbeats while referenced, got ${beats}`);
  keeper.decreaseReference();
  const stopped = beats;
  await sleep(120);
  assert.equal(beats, stopped);

  keeper.decreaseReference();
  keeper.increaseReference();
  await sleep(120);
  assert.ok(beats > stopped);
  keeper.decreaseReference();
});

test('MethodWebnat.method rejects with CANCELLED for an already aborted signal', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(new MethodWebnat().method({ method: 'x' }, { signal: controller.signal }, silentConnection('conn-1')),
    error => error.code === WebnatErrorCode.CANCELLED);
});

test('MethodWebnat.method rejects with CLOSED without a connection', async () => {
  await assert.rejects(new MethodWebnat().method({ method: 'x' }, {}, undefined), error => error.code === WebnatErrorCode.CLOSED);
});

test('MethodWebnat.method rejects when the send fails', async () => {
  const connection = new ConnectionImpl('conn-1', {}, undefined, async () => { throw WebnatError.closed(); });
  await assert.rejects(new MethodWebnat().method({ method: 'remote' }, {}, connection),
    error => error.code === WebnatErrorCode.CLOSED && error.message === 'Connection Closed');
});

test('MethodWebnat.receive answers an unknown invoke with an UNIMPLEMENTED reply', async () => {
  const out = [];
  await new MethodWebnat().receive(new Message('conn-1', NATIVE, undefined, undefined, undefined, undefined, new Invoke('rid-1', 'missing_method')), silentConnection('conn-1', out));
  assert.equal(out.length, 1);
  assert.equal(WebnatError.from(out[0].reply?.error)?.code, WebnatErrorCode.UNIMPLEMENTED);
});

test('MethodWebnat.receive answers a registered invoke with its result', async () => {
  const mw = new MethodWebnat();
  mw.on('echo', async () => ({ v: 1 }));
  const out = [];
  await mw.receive(new Message('conn-1', NATIVE, undefined, undefined, undefined, undefined, new Invoke('rid-2', 'echo')), silentConnection('conn-1', out));
  assert.equal(out.length, 1);
  assert.equal(out[0].reply?.id, 'rid-2');
  assert.deepEqual(out[0].reply?.result, { v: 1 });
  assert.equal(out[0].reply?.error, undefined);
});

test('MethodWebnat.receive answers a handler that throws synchronously with an error reply, and takes a plain return value as the result', async () => {
  const mw = new MethodWebnat();
  mw.on('throws', () => { throw new WebnatError(123, 'boom'); });
  mw.on('plain-return', () => ({ v: 2 }));
  const out = [];
  const connection = silentConnection('conn-1', out);
  await mw.receive(new Message('conn-1', NATIVE, undefined, undefined, undefined, undefined, new Invoke('rid-3', 'throws')), connection);
  await mw.receive(new Message('conn-1', NATIVE, undefined, undefined, undefined, undefined, new Invoke('rid-4', 'plain-return')), connection);
  assert.deepEqual(out.map(m => [m.reply?.id, m.reply?.result, m.reply?.error]), [
    ['rid-3', undefined, { code: 123, message: 'boom' }],
    ['rid-4', { v: 2 }, undefined],
  ]);
});

test('MethodWebnat.receive answers an unserializable result with a SERIALIZATION_FAILED reply; other send failures stay best-effort', async () => {
  const mw = new MethodWebnat();
  mw.on('big', async () => 'a result the transport cannot serialize');
  const invoke = id => new Message('conn-1', NATIVE, undefined, undefined, undefined, undefined, new Invoke(id, 'big'));

  const out = [];
  const unserializable = new ConnectionImpl('conn-1', {}, undefined, async m => {
    if (m.reply && m.reply.result !== undefined && m.reply.result !== null) throw WebnatError.serializationFailed('BigInt');
    out.push(m);
  });
  await mw.receive(invoke('rid-5'), unserializable);
  await sleep(5);
  assert.equal(out.length, 1);
  assert.equal(out[0].reply?.id, 'rid-5');
  assert.equal(out[0].reply?.result, undefined);
  assert.equal(WebnatError.from(out[0].reply?.error)?.code, WebnatErrorCode.SERIALIZATION_FAILED);

  const sent = [];
  const gone = new ConnectionImpl('conn-1', {}, undefined, async m => { sent.push(m); throw WebnatError.closed(); });
  await mw.receive(invoke('rid-6'), gone);
  await sleep(5);
  assert.equal(sent.length, 1, 'only the original reply was tried; no fallback for a failure that is not about serialization');
});

test('ConnectionImpl.send surfaces a failing transport, trySend swallows it', async () => {
  const failing = new ConnectionImpl('conn-1', {}, undefined, async () => { throw WebnatError.serializationFailed('x'); });
  await assert.rejects(failing.send(Message.raw('conn-1', 1)), error => error.code === WebnatErrorCode.SERIALIZATION_FAILED);
  await failing.trySend(Message.raw('conn-1', 1));
  failing.dispose();
  await assert.rejects(failing.send(Message.raw('conn-1', 1)), error => error.code === WebnatErrorCode.CLOSED);
  await failing.trySend(Message.raw('conn-1', 1));
});

test('BroadcastWebnat ignores an empty name and dispatches a valid broadcast', () => {
  const bw = new BroadcastWebnat();
  const hits = [];
  bw.on('evt', (_param, connection) => hits.push(connection.id));
  bw.receive(new Message('c1', NATIVE, undefined, undefined, undefined, new Broadcast('')), { id: 'c1', closed: false });
  assert.deepEqual(hits, []);
  bw.receive(new Message('c2', NATIVE, undefined, undefined, undefined, new Broadcast('evt')), { id: 'c2', closed: false });
  assert.deepEqual(hits, ['c2']);
});

test('BroadcastWebnat on() de-duplicates a listener and off() removes only that listener', () => {
  const bw = new BroadcastWebnat();
  const hits = [];
  const first = () => hits.push('first');
  const second = () => hits.push('second');
  bw.on('evt', first);
  bw.on('evt', second);
  bw.on('evt', first);
  const message = new Message('c', NATIVE, undefined, undefined, undefined, new Broadcast('evt'));
  bw.receive(message, { id: 'c', closed: false });
  assert.deepEqual(hits, ['second', 'first']);
  bw.off('evt', second);
  bw.receive(message, { id: 'c', closed: false });
  assert.deepEqual(hits, ['second', 'first', 'first']);
});

// A connection that answers every invoke through `answer(message, mw)`.
function answeringConnection(mw, id, answer) {
  const dummy = silentConnection('dummy');
  return new ConnectionImpl(id, {}, undefined, async m => {
    if (m.invoke) answer(m.invoke.id, reply => mw.receive(reply, dummy));
  });
}
const unimplementedReply = (id, invokeId) => Message.reply(id, invokeId, undefined, WebnatError.unimplemented('m').toJson());

test('BroadcastMethodCall without connections ends with CLOSED', async () => {
  await assert.rejects(new BroadcastMethodCall(() => {}).start([], new MethodWebnat(), { method: 'm' }, undefined),
    error => error.code === WebnatErrorCode.CLOSED);
});

test('BroadcastMethodCall takes the result of the one frame that implements the method', async () => {
  const mw = new MethodWebnat();
  const c1 = answeringConnection(mw, 'c1', (id, deliver) => deliver(unimplementedReply('c1', id)));
  const c2 = answeringConnection(mw, 'c2', (id, deliver) => deliver(Message.reply('c2', id, 42)));
  assert.equal(await new BroadcastMethodCall(() => {}).start([c1, c2], mw, { method: 'm' }, undefined), 42);
});

test('BroadcastMethodCall: every frame unimplemented ends with UNIMPLEMENTED, closed wins when seen', async () => {
  const mw = new MethodWebnat();
  const unimplemented = id => answeringConnection(mw, id, (invokeId, deliver) => deliver(unimplementedReply(id, invokeId)));
  await assert.rejects(new BroadcastMethodCall(() => {}).start([unimplemented('c1'), unimplemented('c2'), unimplemented('c3')], mw, { method: 'm' }, undefined),
    error => error.code === WebnatErrorCode.UNIMPLEMENTED);
  const closed = answeringConnection(mw, 'c4', (invokeId, deliver) => deliver(Message.reply('c4', invokeId, undefined, WebnatError.closed().toJson())));
  await assert.rejects(new BroadcastMethodCall(() => {}).start([closed, unimplemented('c5')], mw, { method: 'm' }, undefined),
    error => error.code === WebnatErrorCode.CLOSED);
});

test('BroadcastMethodCall: a real business error wins immediately', async () => {
  const mw = new MethodWebnat();
  const c1 = answeringConnection(mw, 'c1', (id, deliver) => deliver(Message.reply('c1', id, undefined, new WebnatError(123, 'boom').toJson())));
  const c2 = answeringConnection(mw, 'c2', (id, deliver) => deliver(unimplementedReply('c2', id)));
  await assert.rejects(new BroadcastMethodCall(() => {}).start([c1, c2], mw, { method: 'm' }, undefined), error => error.code === 123);
});

test('BroadcastMethodCall forwards only the winner notification and aborts the losers', async () => {
  const mw = new MethodWebnat();
  const loserOut = [];
  const winner = answeringConnection(mw, 'c1', (id, deliver) => {
    deliver(Message.notify('c1', id, 'p'));
    deliver(Message.reply('c1', id, 1));
  });
  const loser = silentConnection('c2', loserOut);
  let notified = null;
  const result = await new BroadcastMethodCall(() => {}).start([winner, loser], mw, { method: 'm' }, { onNotification: p => { notified = p; } });
  assert.equal(notified, 'p');
  assert.equal(result, 1);
  assert.equal(loserOut.some(m => m.abort), true);
});

test('BroadcastMethodCall: a group timeout and an outer abort end the whole group', async () => {
  const mw = new MethodWebnat();
  await assert.rejects(new BroadcastMethodCall(() => {}).start([silentConnection('c1'), silentConnection('c2')], mw, { method: 'm' }, { timeout: 50 }),
    error => error.code === WebnatErrorCode.TIMEOUT);

  const out = [];
  const controller = new AbortController();
  const pending = new BroadcastMethodCall(() => {}).start([silentConnection('c1', out), silentConnection('c2', out)], mw, { method: 'm' }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error.code === WebnatErrorCode.CANCELLED);
  assert.equal(out.filter(m => m.abort).length, 2);

  const preAborted = new AbortController();
  preAborted.abort();
  await assert.rejects(new BroadcastMethodCall(() => {}).start([silentConnection('c1')], mw, { method: 'm' }, { signal: preAborted.signal }),
    error => error.code === WebnatErrorCode.CANCELLED);
});
