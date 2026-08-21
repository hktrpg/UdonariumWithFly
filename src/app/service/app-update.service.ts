import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { EventSystem } from '@udonarium/core/system';
import { I18nService } from './i18n.service';

/**
 * Tracks PWA updates: activate quietly when ready; UI shows a hint.
 * New build is used on the next manual reload / restart (no forced reload).
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService implements OnDestroy {
  /** True when a newer build is available (activated, or install failed — still prompt reload). */
  isUpdateReady = false;
  /** True when ngsw could not install (often index.html hash mismatch after deploy). */
  installFailed = false;

  private started = false;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private readonly CHECK_INTERVAL_MS = 30 * 60 * 1000;
  private onVisibility = () => {
    if (document.visibilityState === 'visible') void this.checkNow();
  };

  constructor(
    private swUpdate: SwUpdate,
    private ngZone: NgZone,
    private i18n: I18nService,
  ) { }

  start() {
    if (this.started || !this.swUpdate.isEnabled) return;
    this.started = true;

    let notification: Notification;
    this.swUpdate.versionUpdates.subscribe(event => {
      switch (event.type) {
        case 'VERSION_DETECTED':
          console.log(`Downloading new app version: ${event.version.hash}`);
          Notification.requestPermission().then((permission) => {
            if (permission === 'granted') {
              notification = new Notification('Udonarium with Fly', {
                body: this.i18n.t('update.downloading'),
                icon: 'hktrpg-icon.png'
              });
              notification.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                if (notification) {
                  notification.close();
                  notification = null;
                }
                return false;
              });
            }
          });
          break;
        case 'VERSION_READY':
          console.log(`Current app version: ${(event as VersionReadyEvent).currentVersion.hash}`);
          console.log(`New app version ready for use: ${(event as VersionReadyEvent).latestVersion.hash}`);
          void this.swUpdate.activateUpdate().then(() => {
            if (notification) {
              notification.close();
              notification = null;
            }
            this.markReady(false);
            console.log('New app version activated; will apply on next reload / restart.');
          }).catch(err => {
            console.warn('Service worker activateUpdate failed', err);
            this.markReady(true);
          });
          break;
        case 'VERSION_INSTALLATION_FAILED':
          console.warn(`Failed to install app version '${event.version.hash}': ${event.error}`);
          if (notification) {
            notification.close();
            notification = null;
          }
          // Still show the red icon — user can hard-reload; hash mismatch is common after deploy.
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

  private checkNow(): Promise<boolean> {
    if (!this.swUpdate.isEnabled) return Promise.resolve(false);
    return this.swUpdate.checkForUpdate().catch(err => {
      console.warn('Service worker update check failed', err);
      return false;
    });
  }

  private markReady(failed: boolean) {
    this.ngZone.run(() => {
      this.installFailed = failed;
      this.isUpdateReady = true;
      EventSystem.trigger('APP_UPDATE_READY', null);
    });
  }
}
