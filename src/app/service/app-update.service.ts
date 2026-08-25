import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { EventSystem } from '@udonarium/core/system';

/**
 * Tracks PWA updates: activate quietly when ready; UI shows an Angular modal
 * (no browser Notification / alert). New build applies on reload after user confirms.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService implements OnDestroy {
  /** True when a newer build is available (activated, or install failed — still prompt reload). */
  isUpdateReady = false;
  /** True when ngsw could not install (often index.html hash mismatch after deploy). */
  installFailed = false;

  private started = false;
  private updatePromptPending = false;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private readonly CHECK_INTERVAL_MS = 30 * 60 * 1000;
  private onVisibility = () => {
    if (document.visibilityState === 'visible') void this.checkNow();
  };

  constructor(
    private swUpdate: SwUpdate,
    private ngZone: NgZone,
  ) { }

  start() {
    if (this.started || !this.swUpdate.isEnabled) return;
    this.started = true;

    this.swUpdate.versionUpdates.subscribe(event => {
      switch (event.type) {
        case 'VERSION_DETECTED':
          console.log(`Downloading new app version: ${event.version.hash}`);
          break;
        case 'VERSION_READY':
          console.log(`Current app version: ${(event as VersionReadyEvent).currentVersion.hash}`);
          console.log(`New app version ready for use: ${(event as VersionReadyEvent).latestVersion.hash}`);
          void this.swUpdate.activateUpdate().then(() => {
            this.markReady(false);
            console.log('New app version activated; will apply on next reload / restart.');
          }).catch(err => {
            console.warn('Service worker activateUpdate failed', err);
            this.markReady(true);
          });
          break;
        case 'VERSION_INSTALLATION_FAILED':
          console.warn(`Failed to install app version '${event.version.hash}': ${event.error}`);
          // Still show the update modal — user can hard-reload; hash mismatch is common after deploy.
          this.markReady(true);
          break;
      }
    });

    void this.checkNow();
    this.ngZone.runOutsideAngular(() => {
      this.checkTimer = setInterval(() => void this.checkNow(), this.CHECK_INTERVAL_MS);
    });
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  ngOnDestroy() {
    if (this.checkTimer != null) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /**
   * One-shot for auto popup: true only once per ready cycle.
   * Manual peer-menu click does not need this.
   */
  takeUpdatePrompt(): boolean {
    if (!this.isUpdateReady || !this.updatePromptPending) return false;
    this.updatePromptPending = false;
    return true;
  }

  private checkNow(): Promise<boolean> {
    if (!this.swUpdate.isEnabled) return Promise.resolve(false);
    return this.swUpdate.checkForUpdate().catch(err => {
      console.warn('Service worker update check failed', err);
      return false;
    });
  }

  private markReady(failed: boolean) {
    this.ngZone.run(() => {
      const firstReady = !this.isUpdateReady;
      this.installFailed = this.installFailed || failed;
      this.isUpdateReady = true;
      // Only arm auto-popup once per ready cycle.
      if (firstReady) {
        this.updatePromptPending = true;
        EventSystem.trigger('APP_UPDATE_READY', null);
      }
    });
  }
}