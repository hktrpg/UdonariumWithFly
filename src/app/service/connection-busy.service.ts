import { Injectable } from '@angular/core';

/**
 * Fullscreen “connecting / creating room” busy state.
 * Accessible from static helpers via ConnectionBusyService.instance.
 */
@Injectable({ providedIn: 'root' })
export class ConnectionBusyService {
  private static _instance: ConnectionBusyService | null = null;
  static get instance(): ConnectionBusyService | null {
    return ConnectionBusyService._instance;
  }

  busy = false;
  messageKey = 'peer.connectingRoom';

  private listeners = new Set<() => void>();

  constructor() {
    ConnectionBusyService._instance = this;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  show(messageKey: string = 'peer.connectingRoom') {
    this.messageKey = messageKey || 'peer.connectingRoom';
    this.busy = true;
    this.notify();
  }

  hide() {
    if (!this.busy) return;
    this.busy = false;
    this.notify();
  }

  async run<T>(work: Promise<T> | (() => Promise<T>), messageKey?: string): Promise<T> {
    this.show(messageKey);
    try {
      return await (typeof work === 'function' ? work() : work);
    } finally {
      this.hide();
    }
  }
}
