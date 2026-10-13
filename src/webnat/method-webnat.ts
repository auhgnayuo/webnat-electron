import { randomUUID } from 'node:crypto';
import { WebnatError, WebnatErrorCode } from './error.js';
import { Message } from './message.js';
import { Connection, ConnectionImpl } from './connection.js';

export interface MethodFunc {
  method: string;
  param?: any;
}

export interface MethodOptions {
  timeout?: number;
  onNotification?: (param: any) => void;
  signal?: AbortSignal;
}

export class MethodWebnat {
  private listeners: Map<string, (param: any, signal: AbortSignal, notify: (param: any) => void,
    connection: Connection) => Promise<any>> = new Map();
  private onNotifications: Map<string, (param: any) => void> = new Map();
  private onCompletes: Map<string, (result?: any, error?: WebnatError | null) => void> = new Map();
  private onCloses: Map<string, Map<string, () => void>> = new Map();
  private aborts: Map<string, () => void> = new Map();

  on(method: string, listener: (param: any, signal: AbortSignal, notify: (param: any) => void,
    connection: Connection) => Promise<any>) {
    this.listeners.set(method, listener);
  }

  off(method: string, listener: (param: any, signal: AbortSignal, notify: (param: any) => void,
    connection: Connection) => Promise<any>) {
    if (listener === this.listeners.get(method)) {
      this.listeners.delete(method);
    }
  }

  async method(func: MethodFunc, options?: MethodOptions, connection?: Connection): Promise<any> {
    if (!connection) {
      throw WebnatError.closed();
    }
    if (options?.signal?.aborted) {
      throw WebnatError.cancelled();
    }
    const id = randomUUID();
    const conn = connection as ConnectionImpl;

    let cancelAbort: () => void = () => {
    };
    let cancelTimeout: () => void = () => {
    };
    let cancelOnNotification: () => void = () => {
    };
    let cancelOnClose: () => void = () => {
    };

    try {
      return await new Promise<any>((resolve, reject) => {
        this.onCompletes.set(id, (result?: any, error?: WebnatError | null) => {
          if (error) {
            reject(error);
          } else {
            resolve(result ?? null);
          }
        });

        const signal = options?.signal;
        if (signal) {
          const abort = (): void => {
            const onComplete = this.onCompletes.get(id);
            if (!onComplete) {
              return;
            }
            onComplete(undefined, WebnatError.cancelled());
            void conn.trySend(Message.abort(connection.id, id));
          };
          signal.addEventListener('abort', abort, { once: true });
          cancelAbort = (): void => {
            signal.removeEventListener('abort', abort);
          };
        }

        const timeout = options?.timeout;
        if (timeout !== undefined && timeout > 0) {
          const timer = setTimeout((): void => {
            const onComplete = this.onCompletes.get(id);
            if (!onComplete) {
              return;
            }
            onComplete(undefined, WebnatError.timeout());
            void conn.trySend(Message.abort(connection.id, id));
          }, timeout);
          cancelTimeout = (): void => {
            clearTimeout(timer);
          };
        }

        const onNotification = options?.onNotification;
        if (onNotification) {
          this.onNotifications.set(id, onNotification);
          cancelOnNotification = (): void => {
            this.onNotifications.delete(id);
          };
        }

        let onClosesMap = this.onCloses.get(connection.id);
        if (!onClosesMap) {
          onClosesMap = new Map();
          this.onCloses.set(connection.id, onClosesMap);
        }
        onClosesMap.set(id, (): void => {
          const onComplete = this.onCompletes.get(id);
          if (!onComplete) {
            return;
          }
          onComplete(undefined, WebnatError.closed());
        });
        cancelOnClose = (): void => {
          const m = this.onCloses.get(connection.id);
          if (m) {
            m.delete(id);
            if (m.size === 0) {
              this.onCloses.delete(connection.id);
            }
          }
        };

        const invokeMessage = Message.invoke(connection.id, id, func.method, func.param);
        void conn.send(invokeMessage).catch((err: any): void => {
          const onComplete = this.onCompletes.get(id);
          if (!onComplete) {
            return;
          }
          const w = WebnatError.from(err);
          onComplete(undefined, w ?? new WebnatError(WebnatErrorCode.UNKNOWN, 'Send failed'));
        });
      });
    } finally {
      this.onCompletes.delete(id);
      cancelOnNotification();
      cancelAbort();
      cancelTimeout();
      cancelOnClose();
    }
  }

  receive = async (message: Message, connection: Connection): Promise<void> => {
    if (message.reply) {
      const reply = message.reply;
      const id = reply.id;
      const result: any = reply.result;
      const errorField: any = reply.error;
      const onComplete = this.onCompletes.get(id);
      if (onComplete) {
        if (errorField !== undefined && errorField !== null) {
          const w = WebnatError.from(errorField);
          onComplete(result, w ?? new WebnatError(WebnatErrorCode.UNKNOWN, 'Unknown Error'));
        } else {
          onComplete(result, null);
        }
      }
      return;
    }
    if (message.abort) {
      const abort = message.abort;
      const id = abort.id;
      this.aborts.get(id)?.();
      return;
    }
    if (message.notify) {
      const notify = message.notify;
      const id = notify.id;
      const param: any = notify.param;
      const onNotification = this.onNotifications.get(id);
      if (onNotification) {
        onNotification(param);
      }
      return;
    }
    if (message.invoke) {
      const invoke = message.invoke;
      const id = invoke.id;
      const method = invoke.method;
      const param: any = invoke.param;
      if (!id || typeof id !== 'string') {
        return;
      }
      const listener = this.listeners.get(method);
      if (!listener) {
        const error = WebnatError.unimplemented(method);
        const replyMessage = Message.reply(connection.id, id, undefined, error.toJson());
        (connection as ConnectionImpl).trySend(replyMessage);
        return;
      }
      const abortController = new AbortController();
      let settled = false;

      const clean = (): void => {
        this.aborts.delete(id);
        const onClosesForConn = this.onCloses.get(connection.id);
        if (onClosesForConn) {
          onClosesForConn.delete(id);
          if (onClosesForConn.size === 0) {
            this.onCloses.delete(connection.id);
          }
        }
      };

      const complete = (result: any | undefined, error: WebnatError | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        clean();
        if (error) {
          // must send toJson(): JSON.stringify drops an Error's non-enumerable `message`, leaving only `code`
          const replyMessage = Message.reply(connection.id, id, undefined, error.toJson());
          (connection as ConnectionImpl).trySend(replyMessage);
        } else {
          const conn = connection as ConnectionImpl;
          conn.send(Message.reply(connection.id, id, result, undefined)).catch((err: any): void => {
            // A result that cannot be serialized is answered with the error, or the caller waits for its timeout.
            const w = WebnatError.from(err);
            if (w?.code === WebnatErrorCode.SERIALIZATION_FAILED) {
              void conn.trySend(Message.reply(connection.id, id, undefined, w.toJson()));
            }
          });
        }
      };

      this.aborts.set(id, (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clean();
        abortController.abort();
      });

      let onClosesMap = this.onCloses.get(connection.id);
      if (!onClosesMap) {
        onClosesMap = new Map();
        this.onCloses.set(connection.id, onClosesMap);
      }
      onClosesMap.set(id, (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clean();
        abortController.abort();
      });

      const notify = (nParam: any): void => {
        if (settled) {
          return;
        }
        const notifyMessage = Message.notify(connection.id, id, nParam);
        (connection as ConnectionImpl).trySend(notifyMessage);
      };

      // `await` inside the try, like the Web SDK: a synchronous throw is answered like a rejection.
      try {
        complete(await listener(param, abortController.signal, notify, connection), null);
      } catch (err) {
        const w = WebnatError.from(err);
        complete(undefined, w ?? new WebnatError(WebnatErrorCode.UNKNOWN, 'Unknown Error'));
      }
      return;
    }
  };

  onConnectionOpen = (_connection: Connection): void => {
  };

  onConnectionClose = (connection: Connection): void => {
    const onCloses = this.onCloses.get(connection.id);
    if (onCloses) {
      const callbacks = Array.from(onCloses.values());
      callbacks.forEach(callback => {
        callback();
      });
      this.onCloses.delete(connection.id);
    }
  };
}
