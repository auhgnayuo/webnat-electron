import type { Param, Webnat, Connection } from '../src/index.js';

function typeWitness(api: Webnat, connection: Connection) {
  const value: Param = { list: [1, null, 'x'] as const, null: null };
  api.raw(value, connection);
  api.onMethod('no-result', async () => {});
  // @ts-expect-error nested undefined is not JSON data
  api.raw({ x: undefined }, connection);
  // @ts-expect-error undefined positions are not JSON data
  api.raw([undefined], connection);
  // @ts-expect-error Date is not a JSON record
  api.raw(new Date(), connection);
  // @ts-expect-error Map is not a JSON object
  api.raw(new Map(), connection);
  // @ts-expect-error use null for absent business values
  const absent: Param = undefined;
  return { value, absent };
}
void typeWitness;
