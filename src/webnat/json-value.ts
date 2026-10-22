import { WebnatError, WebnatErrorCode } from './error.js';

/**
 * JSON 兼容的业务数据。number 必须有限；对象必须是普通字符串键记录。
 * 对象属性中的 undefined 会递归省略；数组中的 undefined / 空位转为 null；顶层 undefined 表示缺失。
 * Map / Set / Date、类实例、函数、BigInt、循环引用、Symbol 键、对象访问器及隐藏字段都不接受。
 */
export type Param = string | number | boolean | null | readonly (Param | undefined)[] | { readonly [key: string]: Param | undefined };

/** 验证并复制数据：对象省略 undefined，数组将 undefined / 空位规范化为 null。 */
export function toJsonValue(value: unknown): Param | undefined {
  return convert(value, false, new Set());
}

/** 验证并复制接收数据；缺失的顶层值保持为 undefined，显式 JSON null 保持为 null。 */
export function fromJsonValue(value: unknown): Param | undefined {
  return convert(value, true, new Set());
}

function convert(value: unknown, decoding: boolean, ancestors: Set<object>): Param | undefined {
  const fail = (message: string): never => {
    throw new WebnatError(decoding ? WebnatErrorCode.DESERIALIZATION_FAILED : WebnatErrorCode.SERIALIZATION_FAILED, message);
  };
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('JSON numbers must be finite');
    return value;
  }
  if (typeof value !== 'object') return fail(`Unsupported JSON value type: ${typeof value}`);
  if (ancestors.has(value)) fail('Circular JSON value');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const result: Param[] = [];
      for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor) { result.push(null); continue; }
        if (!('value' in descriptor)) fail('JSON arrays cannot contain accessors');
        const item = convert(descriptor!.value, decoding, ancestors);
        result.push(item === undefined ? null : item);
      }
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail('JSON objects must be plain records');
    if (Object.getOwnPropertySymbols(value).length) fail('JSON object keys must be strings');
    const keys = Object.keys(value);
    if (Object.getOwnPropertyNames(value).length !== keys.length) fail('JSON records cannot contain hidden fields');
    const result: Record<string, Param> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) fail('JSON records cannot contain accessors');
      if (descriptor!.value === undefined) continue;
      Object.defineProperty(result, key, {
        value: convert(descriptor!.value, decoding, ancestors)!, enumerable: true, writable: true, configurable: true,
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}
