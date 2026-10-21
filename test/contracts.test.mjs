import {it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Message} from '../dist/webnat/message.js';
import {WebnatError} from '../dist/webnat/error.js';
import {toJsonValue, fromJsonValue} from '../dist/webnat/json-value.js';
const fixtures=JSON.parse(fs.readFileSync(new URL('../contracts/v1/golden.json',import.meta.url),'utf8'));
for(const c of fixtures.errors) it(`contract/${c.id}`,()=>{
 const e=WebnatError.from(c.input);
 assert.deepEqual(e && {code:e.code,message:e.message},c.expected);
});
for(const c of fixtures.messages) it(`contract/${c.id}`,()=>{
 const m=Message.from(c.input);assert.ok(m);assert.deepEqual(m.toDictionary(),c.canonical);
});
for(const c of fixtures.rejectedMessages) it(`contract/${c.id}`,()=>assert.equal(Message.from(c.input),undefined));
const make=k=>{
 if(k==='nan')return NaN;if(k==='positive-infinity')return Infinity;if(k==='negative-infinity')return-Infinity;
 if(k==='array-cycle'){const a=[];a.push(a);return a}const o={};o.self=o;return o;
};
for(const c of fixtures.invalidValues) it(`contract/${c.id}`,()=>{
 const v=make(c.kind);assert.throws(()=>toJsonValue(v),e=>e.code===c.encodeCode);
 assert.throws(()=>fromJsonValue(v),e=>e.code===c.decodeCode);
});
