import type { Param } from './json-value.js';
import { WebnatError } from './error.js';
import { Message } from './message.js';

export interface Connection {
  readonly id: string;
  readonly attributes?: Record<string, Param>;
  readonly url?: string | undefined;
  readonly closed: boolean;
}

export class ConnectionImpl implements Connection {
  id: string;
  attributes?: Record<string, Param>;
  url?: string | undefined;
  closed: boolean = false;
  private sendMessage: (message: Message) => Promise<void>;

  constructor(id: string, attributes: Record<string, Param>, url: string | undefined, sendMessage: (message: Message) => Promise<void>) {
    this.id = id;
    this.attributes = attributes;
    this.url = url;
    this.sendMessage = sendMessage;
  }

  async send(message: Message): Promise<void> {
    if (this.closed) {
      throw WebnatError.closed();
    }
    await this.sendMessage(message);
  }

  async trySend(message: Message): Promise<void> {
    try {
      await this.send(message);
    } catch {
      // best-effort send
    }
  }

  dispose(): void {
    this.closed = true;
  }
}
