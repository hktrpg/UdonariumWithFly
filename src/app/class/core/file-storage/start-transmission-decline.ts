import { EventSystem } from '../system';

/** Suppress repeated CANCEL_TASK when we already have the file COMPLETE. */
export const START_DECLINE_COOLDOWN_MS = 60_000;

type CancelRedundantFn = (identifier: string, sendTo: string) => void;

/**
 * When a peer starts sending media we already hold complete, cancel their send —
 * but at most once per peer+identifier within the cooldown (avoids cancel storms on remesh).
 */
export class StartTransmissionDeclineGate {
  private readonly declinedKeys = new Map<string, number>();
  private readonly sendCancel: CancelRedundantFn;

  constructor(sendCancel?: CancelRedundantFn) {
    this.sendCancel = sendCancel ?? ((identifier, sendTo) => {
      EventSystem.call('CANCEL_TASK_' + identifier, null, sendTo);
    });
  }

  /**
   * Send CANCEL_TASK to the peer, or no-op if we already declined recently.
   * Caller should return after this (do not startReceiveTask).
   */
  cancelRedundantStart(sendFrom: string, identifier: string): void {
    const key = `${sendFrom}:${identifier}`;
    const last = this.declinedKeys.get(key);
    if (last != null && performance.now() - last < START_DECLINE_COOLDOWN_MS) return;
    this.declinedKeys.set(key, performance.now());
    this.sendCancel(identifier, sendFrom);
  }
}
