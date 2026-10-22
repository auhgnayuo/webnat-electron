import type { Param } from './json-value.js';
import { Message } from './message.js';
import { Connection, ConnectionImpl } from './connection.js';

export class BroadcastWebnat {
  private listeners: Map<string, ((param: Param | undefined, connection: Connection) => void)[]> = new Map();

  on = (name: string, listener: (param: Param | undefined, connection: Connection) => void) => {
    const listeners = this.listeners.get(name);
    if (!listeners) {
      this.listeners.set(name, [listener]);
    } else {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
      listeners.push(listener);
    }
  };

  off = (name: string, listener: (param: Param | undefined, connection: Connection) => void) => {
    const listeners = this.listeners.get(name);
    if (listeners) {
      const filteredListeners = listeners.filter(item => item !== listener);
      if (filteredListeners.length === 0) {
        this.listeners.delete(name);
      } else {
        this.listeners.set(name, filteredListeners);
      }
    }
  };

  broadcast = (name: string, params?: Param, connection?: Connection): void => {
    if (connection) {
      const message = Message.broadcast(connection.id, name, params);
      (connection as ConnectionImpl).trySend(message);
    }
  };

  receive = (message: Message, connection: Connection): void => {
    if (!message.broadcast) {
      return;
    }
    const name = message.broadcast.name;
    const params = message.broadcast.param;
    if (!name || typeof name !== 'string') {
      return;
    }
    const listeners = this.listeners.get(name);
    if (listeners) {
      const snapshot = listeners.slice();
      snapshot.forEach(listener => {
        try {
          listener(params, connection);
        } catch {
          // listener errors are isolated
        }
      });
    }
  };

  onConnectionOpen = (_connection: Connection): void => {
  };

  onConnectionClose = (_connection: Connection): void => {
  };
}
