import { createRequire } from 'node:module';
import type { Session, WebContents } from 'electron';
import { BroadcastMethodCall } from './broadcast-method-call.js';
import { BroadcastWebnat } from './broadcast-webnat.js';
import { Connection, ConnectionImpl } from './connection.js';
import { JavaScriptAliveKeeper } from './javaScriptAliveKeeper.js';
import { Message } from './message.js';
import { MethodFunc, MethodOptions, MethodWebnat } from './method-webnat.js';
import { RawWebnat } from './raw-webnat.js';
import { WebnatVersion } from './version.js';

export class Webnat {
  static of(webContents: WebContents): Webnat {
    const ctrl: any = webContents;
    let webnat: Webnat = ctrl.__native_webnat__;
    if (webnat) {
      return webnat;
    }
    // Counterpart of OHOS registerJavaScriptProxy('__native_webnat__', ['postMessage']): the page-side half of the transport.
    // Done first, so a missing bridge script fails loudly before anything is attached to the WebContents.
    Webnat.registerBridge(webContents.session);

    webnat = new Webnat(webContents);
    ctrl.__native_webnat__ = webnat;

    const prefix = 'Webnat';
    const webnatUA = `${prefix}/${WebnatVersion}`;
    try {
      const existingUA = webContents.getUserAgent();
      const components = existingUA.split(' ')
        .filter((c: string) => c.length > 0 && !c.startsWith(prefix));
      webContents.setUserAgent([...components, webnatUA].join(' '));
    } catch (_) {
    }

    // The bridge (preload) sends on this channel.
    webContents.ipc.on('__native_webnat__.postMessage', (_event, param: string): void => {
      webnat.postMessage(param);
    });

    return webnat;
  }

  // Electron registers preloads per session, not per WebContents: register once per session, found by file path so a second
  // copy of this module (or a host that registered the script itself) adds no duplicate. No teardown, as on the other platforms.
  private static registerBridge(session: Session): void {
    const filePath = createRequire(import.meta.url).resolve('webnat-electron/preload');
    if (session.getPreloadScripts().some((script) => script.type === 'frame' && script.filePath === filePath)) {
      return;
    }
    session.registerPreloadScript({ type: 'frame', filePath });
  }

  private constructor(webContents: WebContents) {
    this.webContentsRef = new WeakRef(webContents);

    this.rawWebnat = new RawWebnat();
    this.broadcastWebnat = new BroadcastWebnat();
    this.methodWebnat = new MethodWebnat();
    this.javaScriptAliveKeeper = new JavaScriptAliveKeeper(200, () => {
      const connections = Array.from(this.connections.values());
      const connection = connections[0];
      if (!connection) {
        return;
      }
      this.rawWebnat.raw(null, connection);
    });
  }

  getConnections(): Map<string, Connection> {
    return new Map(this.connections);
  }

  onRaw(listener: (raw: any, connection: Connection) => void): void {
    this.rawWebnat.on(listener);
  }

  offRaw(listener: (raw: any, connection: Connection) => void): void {
    this.rawWebnat.off(listener);
  }

  raw(raw: any, connection: Connection): void {
    this.rawWebnat.raw(raw, connection);
  }

  onBroadcast(name: string, listener: (params: any, connection: Connection) => void): void {
    this.broadcastWebnat.on(name, listener);
  }

  offBroadcast(name: string, listener: (params: any, connection: Connection) => void): void {
    this.broadcastWebnat.off(name, listener);
  }

  broadcast(name: string, params?: any, connection?: Connection): void {
    if (connection) {
      this.broadcastWebnat.broadcast(name, params ?? null, connection);
      return;
    }
    const snapshot = Array.from(this.connections.values());
    snapshot.forEach((c) => {
      this.broadcastWebnat.broadcast(name, params ?? null, c);
    });
  }

  onMethod(name: string, listener: (
    params: any,
    signal: AbortSignal,
    notify: (notification: any) => void,
    connection: Connection,
  ) => Promise<any>): void {
    this.methodWebnat.on(name, listener);
  }

  offMethod(name: string, listener: (
    params: any,
    signal: AbortSignal,
    notify: (notification: any) => void,
    connection: Connection,
  ) => Promise<any>): void {
    this.methodWebnat.off(name, listener);
  }

  async method(func: MethodFunc, options?: MethodOptions, connection?: Connection): Promise<any> {
    this.javaScriptAliveKeeper.increaseReference();
    try {
      if (connection) {
        const result: any = await this.methodWebnat.method(func, options, connection);
        return result;
      }
      const call = new BroadcastMethodCall((): void => {
      });
      const result: any = await call.start(Array.from(this.connections.values()), this.methodWebnat, func, options);
      return result;
    } finally {
      this.javaScriptAliveKeeper.decreaseReference();
    }
  }

  private webContentsRef: WeakRef<WebContents>;

  private getWebContents(): WebContents | undefined {
    return this.webContentsRef.deref();
  }

  private connections: Map<string, Connection> = new Map();
  private rawWebnat: RawWebnat;
  private broadcastWebnat: BroadcastWebnat;
  private methodWebnat: MethodWebnat;
  private javaScriptAliveKeeper: JavaScriptAliveKeeper;

  private onConnectionOpen(connection: Connection): void {
    this.connections.set(connection.id, connection);
    this.rawWebnat.onConnectionOpen(connection);
    this.broadcastWebnat.onConnectionOpen(connection);
    this.methodWebnat.onConnectionOpen(connection);
  }

  private onConnectionClose(connection: Connection): void {
    this.connections.delete(connection.id);
    this.rawWebnat.onConnectionClose(connection);
    this.broadcastWebnat.onConnectionClose(connection);
    this.methodWebnat.onConnectionClose(connection);
  }

  private onConnectionReceive(connection: Connection, message: Message): void {
    this.rawWebnat.receive(message, connection);
    this.broadcastWebnat.receive(message, connection);
    this.methodWebnat.receive(message, connection);
  }

  private postMessage(messageText: string): void {
    this.javaScriptAliveKeeper.delay();
    try {
      const data: Record<string, any> = JSON.parse(messageText);

      const magic = data['magic'] as string;
      if (!magic || magic !== Message.MAGIC) {
        return;
      }

      const message = Message.from(data);
      if (!message) {
        return;
      }
      const from = message.from;
      if (message.open) {
        if (this.connections.has(from)) {
          return;
        }
        const emptyAttrs: Record<string, any> = {};
        const openMsg = message.open;
        const paramForAttrs: any | undefined = openMsg.param;
        let attributes: Record<string, any> = emptyAttrs;
        if (paramForAttrs !== undefined) {
          attributes = paramForAttrs as Record<string, any>;
        }
        const url = this.getWebContents()?.getURL();
        const connection = new ConnectionImpl(from, attributes, url, async (messageToSend: Message): Promise<void> => {
          const webContents = this.getWebContents();
          if (!webContents) {
            return;
          }
          try {
            // Serialize the protocol dictionary, never the Message instance (same as OHOS/Android).
            const string = JSON.stringify([messageToSend.toDictionary()]);
            this.javaScriptAliveKeeper.delay();
            const js = `window.__web_webnat__.receive(...${string})`;
            await webContents.executeJavaScript(js);
          } catch (error) {
          }
        });
        this.onConnectionOpen(connection);
        return;
      }
      if (message.close) {
        const connection = this.connections.get(from);
        if (!connection) {
          return;
        }
        (connection as ConnectionImpl).dispose();
        this.onConnectionClose(connection);
        return;
      }
      const targetConnection = this.connections.get(from);
      if (!targetConnection) {
        return;
      }
      this.onConnectionReceive(targetConnection, message);
    } catch (error) {
    }
  }
}
