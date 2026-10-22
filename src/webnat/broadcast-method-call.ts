import type { Param } from './json-value.js';
import { WebnatError, WebnatErrorCode } from './error.js';
import { Connection } from './connection.js';
import { MethodFunc, MethodOptions, MethodWebnat } from './method-webnat.js';

export class BroadcastMethodCall {
  private settled: boolean = false;
  private winnerId: string | undefined = undefined;
  private eliminated: Set<string> = new Set();
  private sawClosed: boolean = false;
  private total: number = 0;
  private controllers: Map<string, AbortController> = new Map();
  private timer: ReturnType<typeof setTimeout> | undefined = undefined;
  private methodName: string = '';
  private userNotification: ((param: Param | undefined) => void) | undefined = undefined;
  private resolveFn: ((value: Param | undefined) => void) | undefined = undefined;
  private rejectFn: ((error: unknown) => void) | undefined = undefined;
  private outerSignal: AbortSignal | undefined = undefined;
  private outerSignalAbort: (() => void) | undefined = undefined;
  private onFinished: () => void;

  constructor(onFinished: () => void) {
    this.onFinished = onFinished;
  }

  start(connections: Connection[], methodWebnat: MethodWebnat, func: MethodFunc, options?: MethodOptions): Promise<Param | undefined> {
    this.methodName = func.method;
    this.userNotification = options?.onNotification;
    this.total = connections.length;

    return new Promise<Param | undefined>((resolve: (value: Param | undefined) => void, reject: (error: unknown) => void): void => {
      this.resolveFn = resolve;
      this.rejectFn = reject;

      if (connections.length === 0) {
        this.finish(undefined, WebnatError.closed());
        return;
      }

      const outer = options?.signal;
      if (outer) {
        if (outer.aborted) {
          this.finish(undefined, WebnatError.cancelled());
          return;
        }
        const onAbort = (): void => {
          this.finish(undefined, WebnatError.cancelled());
        };
        this.outerSignal = outer;
        this.outerSignalAbort = onAbort;
        outer.addEventListener('abort', onAbort, { once: true });
      }

      const timeout = options?.timeout;
      if (timeout !== undefined && timeout > 0) {
        this.timer = setTimeout((): void => {
          this.finish(undefined, WebnatError.timeout());
        }, timeout);
      }

      for (const connection of connections) {
        if (this.settled) {
          break;
        }
        const connId = connection.id;
        const controller = new AbortController();
        this.controllers.set(connId, controller);
        const perNotify = (p: Param | undefined): void => {
          this.handleNotify(connId, p);
        };
        const subOptions: MethodOptions = {
          onNotification: perNotify,
          signal: controller.signal,
        };
        methodWebnat.method(func, subOptions, connection)
          .then((result: Param | undefined): void => {
            this.handleComplete(connId, result, null);
          })
          .catch((err: unknown): void => {
            const w = WebnatError.from(err) ?? new WebnatError(WebnatErrorCode.UNKNOWN, 'Unknown Error');
            this.handleComplete(connId, undefined, w);
          });
      }
    });
  }

  private handleNotify(connId: string, param: Param | undefined): void {
    if (this.settled) {
      return;
    }
    if (this.winnerId !== undefined) {
      if (this.winnerId === connId && this.userNotification) {
        this.userNotification(param);
      }
      return;
    }
    this.winnerId = connId;
    this.cancelLosers(connId);
    if (this.userNotification) {
      this.userNotification(param);
    }
  }

  private handleComplete(connId: string, result: Param | undefined, error: WebnatError | null): void {
    if (this.settled) {
      return;
    }
    this.controllers.delete(connId);

    if (this.winnerId !== undefined) {
      if (this.winnerId === connId) {
        this.finish(result, error);
      }
      return;
    }

    if (error && this.isEliminating(error)) {
      this.eliminated.add(connId);
      if (error.code === WebnatErrorCode.CLOSED) {
        this.sawClosed = true;
      }
      if (this.eliminated.size >= this.total) {
        this.finish(undefined, this.sawClosed ? WebnatError.closed() : WebnatError.unimplemented(this.methodName));
      }
      return;
    }

    this.winnerId = connId;
    this.cancelLosers(connId);
    this.finish(result, error);
  }

  private isEliminating(error: WebnatError): boolean {
    return error.code === WebnatErrorCode.UNIMPLEMENTED || error.code === WebnatErrorCode.CLOSED;
  }

  private cancelLosers(except: string): void {
    const losers: AbortController[] = [];
    const keys: string[] = [];
    this.controllers.forEach((controller: AbortController, id: string): void => {
      if (id !== except) {
        losers.push(controller);
        keys.push(id);
      }
    });
    keys.forEach((id: string): void => {
      this.controllers.delete(id);
    });
    losers.forEach((c: AbortController): void => {
      c.abort();
    });
  }

  private finish(result: Param | undefined, error: WebnatError | null): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.outerSignal && this.outerSignalAbort) {
      this.outerSignal.removeEventListener('abort', this.outerSignalAbort);
    }
    const remaining: AbortController[] = [];
    this.controllers.forEach((c: AbortController): void => {
      remaining.push(c);
    });
    this.controllers.clear();
    remaining.forEach((c: AbortController): void => {
      c.abort();
    });

    if (error) {
      this.rejectFn?.(error);
    } else {
      this.resolveFn?.(result);
    }
    this.onFinished();
  }
}
