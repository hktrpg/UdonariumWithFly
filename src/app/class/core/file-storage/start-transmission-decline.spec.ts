import { StartTransmissionDeclineGate, START_DECLINE_COOLDOWN_MS } from './start-transmission-decline';

describe('StartTransmissionDeclineGate', () => {
  let cancels: Array<{ identifier: string; sendTo: string }>;
  let gate: StartTransmissionDeclineGate;
  let nowSpy: jasmine.Spy;

  beforeEach(() => {
    cancels = [];
    gate = new StartTransmissionDeclineGate((identifier, sendTo) => {
      cancels.push({ identifier, sendTo });
    });
    nowSpy = spyOn(performance, 'now').and.returnValue(1_000);
  });

  it('sends CANCEL_TASK on first redundant start', () => {
    gate.cancelRedundantStart('peer-a', 'file-1');
    expect(cancels).toEqual([{ identifier: 'file-1', sendTo: 'peer-a' }]);
  });

  it('suppresses CANCEL within cooldown for same peer+file', () => {
    gate.cancelRedundantStart('peer-a', 'file-1');
    nowSpy.and.returnValue(1_000 + START_DECLINE_COOLDOWN_MS - 1);
    gate.cancelRedundantStart('peer-a', 'file-1');
    expect(cancels.length).toBe(1);
  });

  it('allows CANCEL again after cooldown', () => {
    gate.cancelRedundantStart('peer-a', 'file-1');
    nowSpy.and.returnValue(1_000 + START_DECLINE_COOLDOWN_MS + 1);
    gate.cancelRedundantStart('peer-a', 'file-1');
    expect(cancels.length).toBe(2);
  });

  it('treats different peers or files independently', () => {
    gate.cancelRedundantStart('peer-a', 'file-1');
    gate.cancelRedundantStart('peer-b', 'file-1');
    gate.cancelRedundantStart('peer-a', 'file-2');
    expect(cancels.length).toBe(3);
  });
});
