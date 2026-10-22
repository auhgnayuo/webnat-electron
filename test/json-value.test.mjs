import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toJsonValue, fromJsonValue } from '../dist/webnat/json-value.js';
import { Message } from '../dist/webnat/message.js';
import { WebnatErrorCode } from '../dist/webnat/error.js';

const encoded = value => toJsonValue(value);
const decoded = value => fromJsonValue(value);
const rejects = (value, decode = false) => assert.throws(() => (decode ? decoded : encoded)(value), e => e.code === (decode ? WebnatErrorCode.DESERIALIZATION_FAILED : WebnatErrorCode.SERIALIZATION_FAILED));

describe('strict JSON business data contract', () => {
  it('preserves nested null, empty keys, containers, Unicode and quoted text', () => {
    const value = {'': '', null: null, list: [1, null, {x: null}], emptyObject: {}, emptyList: [], text: '你好 😀\n\r\t\\"\u0000\u2028\u2029'};
    assert.deepEqual(decoded(JSON.parse(JSON.stringify(encoded(value)))), value);
    assert.notEqual(encoded(value), value);
  });
  it('supports scalars and distinguishes numbers from booleans', () => {
    for (const value of [null, '', 0, 1, -1, 1.5, true, false, [0, 1, true, false, null]]) assert.deepEqual(decoded(encoded(value)), value);
    assert.equal(decoded(undefined), undefined);
    assert.equal(encoded(undefined), undefined);
  });
  it('rejects non-finite numbers at every depth in both directions', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      for (const nested of [value, [value], {x: [value]}]) { rejects(nested); rejects(nested, true); }
    }
  });
  it('rejects Date, Map, Set, classes, functions, symbols and BigInt instead of rewriting them', () => {
    class Custom { value = 1; }
    for (const value of [new Date(), new Map([['x', 1]]), new Set([1]), new Custom(), () => 1, Symbol('x'), 10n]) {
      for (const nested of [value, [value], {x: value}]) { rejects(nested); rejects(nested, true); }
    }
  });
  it('omits undefined object properties and normalizes array undefined / holes to null', () => {
    const input = {drop: undefined, keep: null, nested: {drop: undefined, list: [undefined, null, {drop: undefined, keep: 1}]}};
    const expected = {keep: null, nested: {list: [null, null, {keep: 1}]}};
    assert.deepEqual(encoded(input), expected);
    assert.deepEqual(decoded(input), expected);
    assert.deepEqual(encoded(new Array(2)), [null, null]);
    assert.equal(decoded(undefined), undefined);
    assert.equal(encoded(undefined), undefined);
  });
  it('rejects cycles and permits shared children', () => {
    const object = {}; object.self = object;
    const array = []; array.push(array);
    const mixed = {}; mixed.list = [mixed];
    for (const value of [object, array, mixed]) { rejects(value); rejects(value, true); }
    const child = {x: [1, null]}; const value = {a: child, b: child};
    assert.deepEqual(decoded(encoded(value)), value);
  });
  it('never invokes toJSON, toString or getters', () => {
    let calls = 0;
    for (const value of [
      {toJSON() { calls++; return 'hidden'; }},
      {toString() { calls++; return 'hidden'; }},
      Object.defineProperty({}, 'x', {get() {calls++; return 1}, enumerable: true}),
      Object.defineProperty([1], '0', {get() {calls++; return 1}, enumerable: true}),
    ]) { rejects(value); rejects(value, true); }
    assert.equal(calls, 0);
  });
  it('rejects symbol keys and hidden record fields', () => {
    for (const value of [{[Symbol('key')]: 1}, Object.defineProperty({}, 'hidden', {value: 1})]) { rejects(value); rejects(value, true); }
  });
  it('preserves special keys without prototype mutation, including null-prototype records', () => {
    const value = JSON.parse('{"__proto__":{"x":1},"constructor":null,"":null}');
    for (const convert of [encoded, decoded]) {
      const copy = convert(value); assert.deepEqual(copy, value); assert.equal(Object.getPrototypeOf(copy), Object.prototype);
    }
    const value2 = Object.create(null); value2.x = null;
    assert.deepEqual(encoded(value2), {x: null});
  });
  it('round-trips message payloads and distinguishes missing from explicit null', () => {
    const value = {null: null, list: [1, null, 3]};
    for (const message of [Message.open('p', value), Message.close('p', value), Message.raw('p', value), Message.broadcast('p', 'e', value),
      Message.invoke('p', 'i', 'm', value), Message.reply('p', 'i', value), Message.reply('p', 'i', undefined, value), Message.notify('p', 'i', value), Message.abort('p', 'i')]) {
      const dict = message.toDictionary(); const parsed = Message.from(JSON.parse(JSON.stringify(dict)));
      assert.ok(parsed); assert.deepEqual(parsed.toDictionary(), dict);
    }
    for (const body of ['open', 'close', 'raw', 'broadcast', 'invoke', 'reply', 'notify']) {
      for (const explicit of [false, true]) {
        const fields = {id: 'i', method: 'm', name: 'e'};
        if (explicit) Object.assign(fields, {param: null, result: null, error: null});
        const parsed = Message.from({magic: Message.MAGIC, from: 'p', to: 'n', [body]: fields}); assert.ok(parsed);
        for (const field of body === 'reply' ? ['result', 'error'] : ['param']) {
          assert.equal(parsed[body][field], explicit ? null : undefined);
          assert.equal(Object.hasOwn(parsed.toDictionary()[body], field), explicit);
        }
      }
    }
  });
  it('rejects invalid values in every encoded and decoded payload field', () => {
    for (const value of [new Date(), NaN, {nested: [new Date()]}]) {
      for (const message of [Message.open('p', value), Message.close('p', value), Message.raw('p', value), Message.broadcast('p', 'e', value),
        Message.invoke('p', 'i', 'm', value), Message.reply('p', 'i', value), Message.reply('p', 'i', undefined, value), Message.notify('p', 'i', value)]) {
        assert.throws(() => message.toDictionary(), e => e.code === WebnatErrorCode.SERIALIZATION_FAILED);
      }
      for (const body of ['open', 'close', 'raw', 'broadcast', 'invoke', 'reply', 'notify']) {
        for (const field of body === 'reply' ? ['result', 'error'] : ['param']) {
          assert.equal(Message.from({magic: Message.MAGIC, from: 'p', to: 'n', [body]: {id: 'i', method: 'm', name: 'e', [field]: value}}), undefined);
        }
      }
    }
  });
  it('rejects malformed bodies and protocol accessors without executing them', () => {
    for (const body of ['open', 'close', 'raw', 'broadcast', 'invoke', 'reply', 'notify', 'abort']) {
      for (const value of [null, 'string', [1, 2]]) assert.equal(Message.from({magic: Message.MAGIC, from: 'p', to: 'n', [body]: value}), undefined);
    }
    let called = false;
    assert.equal(Message.from(Object.defineProperty({}, 'magic', {get() {called = true; return Message.MAGIC}})), undefined);
    assert.equal(called, false);
  });
});
