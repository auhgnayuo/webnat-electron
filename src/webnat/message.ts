export class Open {
  constructor(readonly param?: any) {}
}

export class Close {
  constructor(readonly param?: any) {}
}

export class Raw {
  constructor(readonly param?: any) {}
}

export class Broadcast {
  constructor(readonly name: string, readonly param?: any) {}
}

export class Invoke {
  constructor(readonly id: string, readonly method: string, readonly param?: any) {}
}

export class Reply {
  constructor(readonly id: string, readonly result?: any, readonly error?: any) {}
}

export class Notify {
  constructor(readonly id: string, readonly param?: any) {}
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

  static open(from: string, param?: any): Message {
    return new Message(from, Message.NATIVE_UUID, new Open(param));
  }

  static close(from: string, param?: any): Message {
    return new Message(from, Message.NATIVE_UUID, undefined, new Close(param));
  }

  static raw(to: string, param?: any): Message {
    return new Message(Message.NATIVE_UUID, to, undefined, undefined, new Raw(param));
  }

  static broadcast(to: string, name: string, param?: any): Message {
    return new Message(Message.NATIVE_UUID, to, undefined, undefined, undefined, new Broadcast(name, param));
  }

  static invoke(to: string, id: string, method: string, param?: any): Message {
    return new Message(Message.NATIVE_UUID, to, undefined, undefined, undefined, undefined, new Invoke(id, method, param));
  }

  static reply(to: string, id: string, result?: any, error?: any): Message {
    return new Message(Message.NATIVE_UUID, to, undefined, undefined, undefined, undefined, undefined, new Reply(id, result, error));
  }

  static notify(to: string, id: string, param?: any): Message {
    return new Message(Message.NATIVE_UUID, to, undefined, undefined, undefined, undefined, undefined, undefined, new Notify(id, param));
  }

  static abort(to: string, id: string): Message {
    return new Message(Message.NATIVE_UUID, to, undefined, undefined, undefined, undefined, undefined, undefined, undefined, new Abort(id));
  }

  toDictionary(): Record<string, any> {
    const dict: Record<string, any> = {
      'magic': this.magic,
      'from': this.from,
      'to': this.to,
    };

    if (this.open) {
      const openDict: Record<string, any> = {};
      if (this.open.param !== undefined) {
        openDict['param'] = this.open.param;
      }
      dict['open'] = openDict;
    }

    if (this.close) {
      const closeDict: Record<string, any> = {};
      if (this.close.param !== undefined) {
        closeDict['param'] = this.close.param;
      }
      dict['close'] = closeDict;
    }

    if (this.raw) {
      const rawDict: Record<string, any> = {};
      if (this.raw.param !== undefined) {
        rawDict['param'] = this.raw.param;
      }
      dict['raw'] = rawDict;
    }

    if (this.broadcast) {
      const broadcastDict: Record<string, any> = {
        'name': this.broadcast.name,
      };
      if (this.broadcast.param !== undefined) {
        broadcastDict['param'] = this.broadcast.param;
      }
      dict['broadcast'] = broadcastDict;
    }

    if (this.invoke) {
      const invokeDict: Record<string, any> = {
        'id': this.invoke.id,
        'method': this.invoke.method,
      };
      if (this.invoke.param !== undefined) {
        invokeDict['param'] = this.invoke.param;
      }
      dict['invoke'] = invokeDict;
    }

    if (this.reply) {
      const replyDict: Record<string, any> = {
        'id': this.reply.id,
      };
      if (this.reply.result !== undefined) {
        replyDict['result'] = this.reply.result;
      }
      if (this.reply.error !== undefined) {
        replyDict['error'] = this.reply.error;
      }
      dict['reply'] = replyDict;
    }

    if (this.notify) {
      const notifyDict: Record<string, any> = {
        'id': this.notify.id,
      };
      if (this.notify.param !== undefined) {
        notifyDict['param'] = this.notify.param;
      }
      dict['notify'] = notifyDict;
    }

    if (this.abort) {
      dict['abort'] = {
        'id': this.abort.id,
      };
    }

    return dict;
  }

  static from(dict: Record<string, any>): Message | undefined {
    const magic = dict['magic'] as string;
    if (!magic || magic !== Message.MAGIC) {
      return undefined;
    }

    const from = dict['from'] as string;
    const to = dict['to'] as string;
    if (!from || !to) {
      return undefined;
    }

    let open: Open | undefined;
    if (dict['open']) {
      const openDict = dict['open'] as Record<string, any>;
      open = new Open(openDict['param']);
    }

    let close: Close | undefined;
    if (dict['close']) {
      const closeDict = dict['close'] as Record<string, any>;
      close = new Close(closeDict['param']);
    }

    let raw: Raw | undefined;
    if (dict['raw']) {
      const rawDict = dict['raw'] as Record<string, any>;
      raw = new Raw(rawDict['param']);
    }

    let broadcast: Broadcast | undefined;
    if (dict['broadcast']) {
      const broadcastDict = dict['broadcast'] as Record<string, any>;
      const name = broadcastDict['name'] as string;
      if (name) {
        broadcast = new Broadcast(name, broadcastDict['param']);
      }
    }

    let invoke: Invoke | undefined;
    if (dict['invoke']) {
      const invokeDict = dict['invoke'] as Record<string, any>;
      const id = invokeDict['id'] as string;
      const method = invokeDict['method'] as string;
      if (id && method) {
        invoke = new Invoke(id, method, invokeDict['param']);
      }
    }

    let reply: Reply | undefined;
    if (dict['reply']) {
      const replyDict = dict['reply'] as Record<string, any>;
      const id = replyDict['id'] as string;
      if (id) {
        reply = new Reply(id, replyDict['result'], replyDict['error']);
      }
    }

    let notify: Notify | undefined;
    if (dict['notify']) {
      const notifyDict = dict['notify'] as Record<string, any>;
      const id = notifyDict['id'] as string;
      if (id) {
        notify = new Notify(id, notifyDict['param']);
      }
    }

    let abort: Abort | undefined;
    if (dict['abort']) {
      const abortDict = dict['abort'] as Record<string, any>;
      const id = abortDict['id'] as string;
      if (id) {
        abort = new Abort(id);
      }
    }

    return new Message(from, to, open, close, raw, broadcast, invoke, reply, notify, abort);
  }
}
