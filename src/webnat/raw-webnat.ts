import { Message } from './message.js';
import { Connection, ConnectionImpl } from './connection.js';

export class RawWebnat {
  private listeners: ((param: any, connection: Connection) => void)[] = [];

  on = (listener: (param: any, connection: Connection) => void) => {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
    this.listeners.push(listener);
  };

  off = (listener: (param: any, connection: Connection) => void) => {
    this.listeners = this.listeners.filter(item => item !== listener);
  };

  raw = (param: any, connection: Connection): void => {
    const message = Message.raw(connection.id, param);
    (connection as ConnectionImpl).trySend(message);
  };

  receive = (message: Message, connection: Connection): void => {
    if (!message.raw) {
      return;
    }
    const param: any = message.raw.param;
    const snapshot = this.listeners.slice();
    snapshot.forEach(listener => {
      try {
        listener(param, connection);
      } catch {
        // listener errors are isolated
      }
    });
  };

  onConnectionOpen = (_connection: Connection): void => {
  };

  onConnectionClose = (_connection: Connection): void => {
  };
}
