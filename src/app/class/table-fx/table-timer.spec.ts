import { resetTabletopStore } from '../../../testing/tabletop-test.util';
import { TableTimerList } from './table-timer';

describe('TableTimerList', () => {
  beforeEach(() => {
    resetTabletopStore();
    for (const timer of [...TableTimerList.instance.timers]) {
      timer.destroy();
    }
  });

  it('assigns monotonic sequence numbers for new timers', () => {
    const list = TableTimerList.instance;
    const first = list.addTimer('', 60_000);
    const second = list.addTimer('', 60_000);
    expect(first.sequenceNumber).toBeGreaterThan(0);
    expect(second.sequenceNumber).toBeGreaterThan(first.sequenceNumber);
  });
});
