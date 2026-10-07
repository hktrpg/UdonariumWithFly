import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { AppUpdateService } from './app-update.service';

describe('AppUpdateService', () => {
  let service: AppUpdateService;
  let versionUpdates$: Subject<VersionEvent>;
  let activateUpdate: jasmine.Spy;
  let ngZone: NgZone;

  /** markReady() applies state inside NgZone.run — flush before expects. */
  function flushNgZone(): Promise<void> {
    return new Promise(resolve => ngZone.run(() => resolve()));
  }

  beforeEach(() => {
    versionUpdates$ = new Subject<VersionEvent>();
    activateUpdate = jasmine.createSpy('activateUpdate').and.returnValue(Promise.resolve(true));
    TestBed.configureTestingModule({
      providers: [
        AppUpdateService,
        {
          provide: SwUpdate,
          useValue: {
            isEnabled: true,
            versionUpdates: versionUpdates$.asObservable(),
            checkForUpdate: () => Promise.resolve(false),
            activateUpdate,
          },
        },
        { provide: NgZone, useValue: new NgZone({ enableLongStackTrace: false }) },
      ],
    });
    ngZone = TestBed.inject(NgZone);
    service = TestBed.inject(AppUpdateService);
  });

  it('clears installFailed when a later VERSION_READY activates successfully', async () => {
    service.start();
    versionUpdates$.next({
      type: 'VERSION_INSTALLATION_FAILED',
      version: { hash: 'bad' },
      error: 'Hash mismatch',
    } as VersionEvent);
    await flushNgZone();
    expect(service.installFailed).toBe(true);
    expect(service.isUpdateReady).toBe(true);

    versionUpdates$.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'old' },
      latestVersion: { hash: 'new' },
    } as VersionEvent);
    await activateUpdate.calls.mostRecent().returnValue;
    await flushNgZone();

    expect(service.installFailed).toBe(false);
    expect(service.isUpdateReady).toBe(true);
  });

  it('keeps installFailed when activateUpdate rejects', async () => {
    activateUpdate.and.returnValue(Promise.reject(new Error('activate failed')));
    service.start();
    versionUpdates$.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'old' },
      latestVersion: { hash: 'new' },
    } as VersionEvent);
    try {
      await activateUpdate.calls.mostRecent().returnValue;
    } catch { /* expected */ }
    await flushNgZone();
    expect(service.installFailed).toBe(true);
  });
});
