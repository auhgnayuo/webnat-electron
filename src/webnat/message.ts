import { WebnatError } from './error.js';
import { fromJsonValue, toJsonValue, type Param } from './json-value.js';
export type { Param } from './json-value.js';

export class Open {
  constructor(readonly param?: Param) {}
}

export class Close {
  constructor(readonly param?: Param) {}
}

export class Raw {
  constructor(readonly param?: Param) {}
}

export class Broadcast {
  constructor(readonly name: string, readonly param?: Param) {}
}

export class Invoke {
  constructor(readonly id: string, readonly method: string, readonly param?: Param) {}
}

export class Reply {
  constructor(readonly id: string, readonly result?: Param, readonly error?: Param) {}
}

export class Notify {
  constructor(readonly id: string, readonly param?: Param) {}
}

export class Abort {
  constructor(readonly id: string) {}
}

export class Message {
  static readonly NATIVE_UUID = '00000000-0000-0000-0000-000000000000';
  static readonly MAGIC = 'WEBNAT';

  readonly magic: string = Message.MAGIC;

  constructor(
    readonly from: string,
    readonly to: string,
    readonly open?: Open,
    readonly close?: Close,
    readonly raw?: Raw,
    readonly broadcast?: Broadcast,
    readonly invoke?: Invoke,
    readonly reply?: Reply,
    readonly notify?: Notify,
    readonly abort?: Abort,
  ) {}

  static open(from: string, param?: Param): Message {
    return new Message(from, Message.NATIVE_UUID, new Open(param));
  }

  static close(from: string, param?: Param): Message {
    return new Message(from, Message.NATIVE_UUID, undefined, new Close(param));
  }

  static raw(to: string, param?: Param): Message {
    return new Message(Message.NATIVE_UUID, to, undefined, undefined, new Raw(param));
  }

  static broadcast(to: string, name: string, param?: Param): Message {
    return new Message(Message.NATIVE_UUID, to, undefined, undefined, undefined, new Broadcast(name, param));
  }

  static invoke(to: string, id: string, method: string, param?: Param): Message {
    return new Message(Message.NATIVE_UUID, to, undefined, undefined, undefined, undefined, new Invoke(id, method, param));
  }

  static reply(to: string, id: string, result?: Param, error?: Param): Message {
    return new Message(Message.NATIVE_UUID, to, undefined, undefined, undefined, undefined, undefined, new Reply(id, result, error));
  }

  static notify(to: string, id: string, param?: Param): Message {
    return new Message(Message.NATIVE_UUID, to, undefined, undefined, undefined, undefined, undefined, undefined, new Notify(id, param));
  }

  static abort(to: string, id: string): Message {
    return new Message(Message.NATIVE_UUID, to, undefined, undefined, undefined, undefined, undefined, undefined, undefined, new Abort(id));
  }

  /** 生成规范的协议字典：顶层 undefined 省略、null 保留；业务值严格校验，非法值抛出 SERIALIZATION_FAILED。 */
  toDictionary(): Record<string, Param> {
    try {
      if (this.magic !== Message.MAGIC || typeof this.from !== 'string' || typeof this.to !== 'string') throw new Error('Invalid message header');
      const dictionary: Record<string, Param> = { magic: this.magic, from: this.from, to: this.to };
      if (this.open !== undefined) {
        const body = protocolRecord(this.open, Open);
        const target: Record<string, Param> = {};
        const param = read(body, "param");
        if (param !== undefined) target["param"] = toJsonValue(param)!;
        dictionary["open"] = target;
      }
      if (this.close !== undefined) {
        const body = protocolRecord(this.close, Close);
        const target: Record<string, Param> = {};
        const param = read(body, "param");
        if (param !== undefined) target["param"] = toJsonValue(param)!;
        dictionary["close"] = target;
      }
      if (this.raw !== undefined) {
        const body = protocolRecord(this.raw, Raw);
        const target: Record<string, Param> = {};
        const param = read(body, "param");
        if (param !== undefined) target["param"] = toJsonValue(param)!;
        dictionary["raw"] = target;
      }
      if (this.broadcast !== undefined) {
        const body = protocolRecord(this.broadcast, Broadcast);
        const target: Record<string, Param> = {};
        const name = read(body, "name");
        if (typeof name !== "string") throw new Error("Invalid name");
        target["name"] = name;
        const param = read(body, "param");
        if (param !== undefined) target["param"] = toJsonValue(param)!;
        dictionary["broadcast"] = target;
      }
      if (this.invoke !== undefined) {
        const body = protocolRecord(this.invoke, Invoke);
        const target: Record<string, Param> = {};
        const id = read(body, "id");
        if (typeof id !== "string") throw new Error("Invalid id");
        target["id"] = id;
        const method = read(body, "method");
        if (typeof method !== "string") throw new Error("Invalid method");
        target["method"] = method;
        const param = read(body, "param");
        if (param !== undefined) target["param"] = toJsonValue(param)!;
        dictionary["invoke"] = target;
      }
      if (this.reply !== undefined) {
        const body = protocolRecord(this.reply, Reply);
        const target: Record<string, Param> = {};
        const id = read(body, "id");
        if (typeof id !== "string") throw new Error("Invalid id");
        target["id"] = id;
        const result = read(body, "result");
        if (result !== undefined) target["result"] = toJsonValue(result)!;
        const error = read(body, "error");
        if (error !== undefined) target["error"] = toJsonValue(error)!;
        dictionary["reply"] = target;
      }
      if (this.notify !== undefined) {
        const body = protocolRecord(this.notify, Notify);
        const target: Record<string, Param> = {};
        const id = read(body, "id");
        if (typeof id !== "string") throw new Error("Invalid id");
        target["id"] = id;
        const param = read(body, "param");
        if (param !== undefined) target["param"] = toJsonValue(param)!;
        dictionary["notify"] = target;
      }
      if (this.abort !== undefined) {
        const body = protocolRecord(this.abort, Abort);
        const target: Record<string, Param> = {};
        const id = read(body, "id");
        if (typeof id !== "string") throw new Error("Invalid id");
        target["id"] = id;
        dictionary["abort"] = target;
      }
      return dictionary;
    } catch (error) {
      throw error instanceof WebnatError ? error : WebnatError.serializationFailed(error);
    }
  }

  /** 解码所有业务字段为 JSON 值 / null；非法数据拒绝整条消息，不跳过元素。 */
  static from(input: unknown): Message | undefined {
    try {
      const dictionary = protocolRecord(input, Message);
      const magic = read(dictionary, "magic");
      const from = read(dictionary, "from");
      const to = read(dictionary, "to");
      if (magic !== Message.MAGIC || typeof from !== "string" || typeof to !== "string") return undefined;
      if (!from || !to) return undefined;
      let open: Open | undefined;
      const openValue = read(dictionary, "open");
      if (openValue !== undefined) {
        const body = protocolRecord(openValue, Open);
        const param = fromJsonValue(read(body, "param"));
        open = new Open(param);
      }
      let close: Close | undefined;
      const closeValue = read(dictionary, "close");
      if (closeValue !== undefined) {
        const body = protocolRecord(closeValue, Close);
        const param = fromJsonValue(read(body, "param"));
        close = new Close(param);
      }
      let raw: Raw | undefined;
      const rawValue = read(dictionary, "raw");
      if (rawValue !== undefined) {
        const body = protocolRecord(rawValue, Raw);
        const param = fromJsonValue(read(body, "param"));
        raw = new Raw(param);
      }
      let broadcast: Broadcast | undefined;
      const broadcastValue = read(dictionary, "broadcast");
      if (broadcastValue !== undefined) {
        const body = protocolRecord(broadcastValue, Broadcast);
        const param = fromJsonValue(read(body, "param"));
        const name = read(body, "name");
        if (typeof name === "string" && name) broadcast = new Broadcast(name, param);
      }
      let invoke: Invoke | undefined;
      const invokeValue = read(dictionary, "invoke");
      if (invokeValue !== undefined) {
        const body = protocolRecord(invokeValue, Invoke);
        const param = fromJsonValue(read(body, "param"));
        const id = read(body, "id");
        const method = read(body, "method");
        if (typeof id === "string" && id && typeof method === "string" && method) invoke = new Invoke(id, method, param);
      }
      let reply: Reply | undefined;
      const replyValue = read(dictionary, "reply");
      if (replyValue !== undefined) {
        const body = protocolRecord(replyValue, Reply);
        const result = fromJsonValue(read(body, "result"));
        const error = fromJsonValue(read(body, "error"));
        const id = read(body, "id");
        if (typeof id === "string" && id) reply = new Reply(id, result, error);
      }
      let notify: Notify | undefined;
      const notifyValue = read(dictionary, "notify");
      if (notifyValue !== undefined) {
        const body = protocolRecord(notifyValue, Notify);
        const param = fromJsonValue(read(body, "param"));
        const id = read(body, "id");
        if (typeof id === "string" && id) notify = new Notify(id, param);
      }
      let abort: Abort | undefined;
      const abortValue = read(dictionary, "abort");
      if (abortValue !== undefined) {
        const body = protocolRecord(abortValue, Abort);
        const id = read(body, "id");
        if (typeof id === "string" && id) abort = new Abort(id);
      }
      return new Message(from, to, open, close, raw, broadcast, invoke, reply, notify, abort);
    } catch {
      return undefined;
    }
  }

}

/** 协议对象可以是普通记录或本库 DTO；业务值仍只允许普通 JSON 数据。 */
function protocolRecord(value: unknown, type: { readonly prototype: object }): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid message body');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && prototype !== type.prototype) throw new Error('Invalid protocol object');
  return value as Record<string, unknown>;
}

function read(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) throw new Error('Protocol accessors are not supported');
  return descriptor.value;
}
