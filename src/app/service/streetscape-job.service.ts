import { Injectable } from '@angular/core';

export type StreetscapeJobPhase = 'idle' | 'running' | 'done' | 'error';

/**
 * Streetscape download/bake job state that survives panel destroy.
 * Abort only via explicit cancel (HUD / panel), not panel close.
 */
@Injectable({ providedIn: 'root' })
export class StreetscapeJobService {
  busy = false;
  status = '';
  phase: StreetscapeJobPhase = 'idle';
  /** Show compact HUD when panel is closed/minimized or job finished with a notice. */
  hudVisible = false;

  private abort: AbortController | null = null;
  private listeners = new Set<() => void>();
  private progressPersistAt = 0;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) {
      try { fn(); } catch { /* ignore listener errors */ }
    }
  }

  begin(): AbortSignal {
    this.abort?.abort();
    this.abort = new AbortController();
    this.busy = true;
    this.phase = 'running';
    this.notify();
    return this.abort.signal;
  }

  setStatus(status: string, opts?: { persistThrottleMs?: number }) {
    this.status = status || '';
    const throttle = opts?.persistThrottleMs;
    if (throttle != null && throttle > 0) {
      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (this.progressPersistAt && nowMs - this.progressPersistAt < throttle) {
        this.notify();
        return false;
      }
      this.progressPersistAt = nowMs;
    }
    this.notify();
    return true;
  }

  finish(status?: string) {
    this.busy = false;
    this.phase = 'done';
    this.abort = null;
    if (status != null) this.status = status;
    this.notify();
  }

  fail(status = '') {
    this.busy = false;
    this.phase = 'error';
    this.abort = null;
    this.status = status;
    this.notify();
  }

  /** Explicit cancel — aborts in-flight work. */
  cancel() {
    this.abort?.abort();
    this.abort = null;
    this.busy = false;
    this.phase = 'idle';
    this.status = '';
    this.hudVisible = false;
    this.notify();
  }

  /** Clear HUD after user opens panel or dismisses a finished job. */
  dismissHud() {
    if (this.busy) return;
    this.hudVisible = false;
    if (this.phase === 'done' || this.phase === 'error') {
      this.phase = 'idle';
    }
    this.notify();
  }

  /** Panel is open and showing progress — hide the bubble. */
  hideHudForPanel() {
    this.hudVisible = false;
    this.notify();
  }

  /** Keep HUD up when panel is minimized/closed during a run. */
  pinHud() {
    this.hudVisible = true;
    this.notify();
  }

  get showHud(): boolean {
    return this.hudVisible && (this.busy || this.phase === 'done' || this.phase === 'error' || !!this.status);
  }
}
