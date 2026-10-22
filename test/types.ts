import type { Param, Webnat, Connection } from '../src/index.js';

function typeWitness(api: Webnat, connection: Connection) {
  const value: Param = { list: [1, null, 'x'] as const, null: null };
  api.raw(value, connection);
  api.onMethod('no-result', async () => {});
  api.raw({ x: undefined, nested: { y: undefined } }, connection);
  api.raw([undefined, null], connection);
  // @ts-expect-error Date is not a JSON record
  api.raw(new Date(), connection);
  // @ts-expect-error Map is not a JSON object
  api.raw(new Map(), connection);
  // @ts-expect-error use null for absent business values
  const absent: Param = undefined;
  return { value, absent };
}
void typeWitness;
