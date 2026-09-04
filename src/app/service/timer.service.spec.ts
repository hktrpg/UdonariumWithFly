import { TestBed } from '@angular/core/testing';

import { Network } from '@udonarium/core/system';
import { resetTabletopStore } from '../../testing/tabletop-test.util';
import { TableTimerList } from '@udonarium/table-fx/table-timer';
import { TimerService } from './timer.service';
import { TimerZeroRunnerService } from './timer-zero-runner.service';

describe('TimerService', () => {
  let service: TimerService;

  beforeEach(() => {
    resetTabletopStore();
    for (const timer of [...TableTimerList.instance.timers]) {
      timer.destroy();
    }
    spyOn(Network, 'GuestMode').and.returnValue(false);
    TestBed.configureTestingModule({
      providers: [
        TimerService,
        { provide: TimerZeroRunnerService, useValue: { run: () => {} } },
      ],
    });
    service = TestBed.inject(TimerService);
  });

  it('pauses countdown by subtracting elapsed time', () => {
    const timer = service.createTimer('', 60_000)!;
    const startedAt = 1_000_000;
    timer.startedAt = startedAt;
    timer.state = 'running';
    timer.remainingMs = 60_000;

    spyOn(Date, 'now').and.returnValue(startedAt + 12_500);
    service.pause(timer.identifier);

    expect(timer.state).toBe('paused');
    expect(timer.startedAt).toBe(0);
    expect(timer.remainingMs).toBe(47_500);
  });

  it('marks countdown finished at zero', () => {
    const timer = service.createTimer('', 1_000)!;
    timer.startedAt = 5_000;
    timer.state = 'running';
    timer.remainingMs = 1_000;

    spyOn(Date, 'now').and.returnValue(6_000);
    service['tick']();

    expect(timer.state).toBe('finished');
    expect(timer.remainingMs).toBe(0);
    expect(timer.finishedAt).toBeGreaterThan(0);
  });

  it('reports remaining fraction for full-mode ring', () => {
    const timer = service.createTimer('', 10_000)!;
    timer.remainingMs = 2_500;
    timer.totalMs = 10_000;
    expect(service.progressRatio(timer)).toBeCloseTo(0.25, 5);
  });

  it('defaults new timers to full canvas view for room and personal display', () => {
    const timer = service.createTimer('', 60_000)!;
    expect(timer.displayMode).toBe('full');
    expect(service.getLocalViewMode(timer.identifier)).toBe('full');
    expect(service.fullCanvasTimers.some(t => t.identifier === timer.identifier)).toBeTrue();
  });

  it('keeps local view modes personal and does not sync hide to displayMode', () => {
    const timer = service.createTimer('', 60_000)!;
    service.setLocalViewMode(timer.identifier, 'compact');
    expect(timer.displayMode).toBe('full');
    expect(service.getLocalViewMode(timer.identifier)).toBe('compact');
    expect(service.fullCanvasTimers.find(t => t.identifier === timer.identifier)).toBeUndefined();
    expect(service.compactCanvasTimers.find(t => t.identifier === timer.identifier)).toBeTruthy();
    service.setLocalViewMode(timer.identifier, 'hidden');
    expect(service.canvasTimers.find(t => t.identifier === timer.identifier)).toBeUndefined();
    expect(timer.displayMode).toBe('full');
  });

  it('shows personal-only canvas when room display is hidden', () => {
    const timer = service.createTimer('', 60_000)!;
    timer.displayMode = 'hidden';
    service.showOnMyCanvas(timer.identifier, 'full');
    expect(service.isOnCanvas(timer)).toBeTrue();
    expect(service.fullCanvasTimers.some(t => t.identifier === timer.identifier)).toBeTrue();
  });

  it('broadcasts room canvas visibility via showOnRoomCanvas', () => {
    const timer = service.createTimer('', 60_000)!;
    timer.createdByUserId = 'test-user';
    spyOnProperty(Network, 'peer', 'get').and.returnValue({ userId: 'test-user' } as any);
    timer.displayMode = 'hidden';
    service.setLocalViewMode(timer.identifier, 'hidden');
    service.showOnRoomCanvas(timer.identifier);
    expect(timer.displayMode).toBe('full');
    expect(service.getLocalViewMode(timer.identifier)).toBe('full');
    expect(service.isOnCanvas(timer)).toBeTrue();
  });

  it('does not change compact local view or position when broadcasting room canvas', () => {
    const timer = service.createTimer('', 60_000)!;
    timer.createdByUserId = 'test-user';
    spyOnProperty(Network, 'peer', 'get').and.returnValue({ userId: 'test-user' } as any);
    timer.posX = 33;
    timer.posY = 44;
    service.setLocalViewMode(timer.identifier, 'compact');
    timer.displayMode = 'hidden';
    service.showOnMyCanvas(timer.identifier, 'compact');
    service.showOnRoomCanvas(timer.identifier);
    expect(timer.displayMode).toBe('full');
    expect(service.getLocalViewMode(timer.identifier)).toBe('compact');
    expect(timer.posX).toBe(33);
    expect(timer.posY).toBe(44);
    expect(service.compactCanvasTimers.some(t => t.identifier === timer.identifier)).toBeTrue();
  });

  it('seeds default on-zero sound + operation log actions', () => {
    const timer = service.createTimer('', 60_000)!;
    expect(timer.onZeroActions.length).toBe(2);
    expect(timer.onZeroActions[0]).toEqual(jasmine.objectContaining({ type: 'sound', preset: 'surprise' }));
    expect(timer.onZeroActions[1]).toEqual(jasmine.objectContaining({ type: 'chat', tabIdentifier: '__operationLog__' }));
  });

  it('assigns increasing sequence numbers via createTimer', () => {
    const first = service.createTimer('', 60_000)!;
    const second = service.createTimer('', 60_000)!;
    expect(second.sequenceNumber).toBeGreaterThan(first.sequenceNumber);
    expect(service.timerDisplayLabel(first)).toContain('1');
    expect(service.timerDisplayLabel(second)).toContain('2');
  });

  it('records lastTouchedAt on mutations', () => {
    const timer = service.createTimer('', 60_000)!;
    expect(timer.lastTouchedAt).toBeGreaterThan(0);
    const before = timer.lastTouchedAt;
    service.start(timer.identifier);
    expect(timer.lastTouchedAt).toBeGreaterThanOrEqual(before);
  });
});
