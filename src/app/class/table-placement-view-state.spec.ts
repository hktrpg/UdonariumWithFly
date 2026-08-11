import {
  applyPlacementViewState,
  capturePlacementViewState,
  viewStatesEqual,
} from './table-placement-view-state';
import {
  makeCharacter,
  makeTable,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('table-placement-view-state', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('captures and reapplies rotate/roll/fx/width-related footprint', () => {
    makeTable('tableA');
    viewTables('tableA');
    const ch = makeCharacter('vs_char');
    ch.rotate = 12;
    ch.roll = 8;
    ch.isInverse = true;
    ch.tokenFrame = 'polaroid';

    const snap = capturePlacementViewState(ch);
    expect(snap.rotate).toBe(12);
    expect(snap.roll).toBe(8);
    expect(snap.isInverse).toBeTrue();
    expect(snap.tokenFrame).toBe('polaroid');
    expect(snap.size).toBe(1);
    expect('statusesJson' in snap).toBeFalse();
    expect(snap.visionRange).toBeDefined();
    expect(snap.brightLight).toBeDefined();
    expect(snap.dimLight).toBeDefined();

    ch.rotate = 0;
    ch.roll = 0;
    ch.isInverse = false;
    ch.tokenFrame = 'none';
    applyPlacementViewState(ch, snap);

    expect(ch.rotate).toBe(12);
    expect(ch.roll).toBe(8);
    expect(ch.isInverse).toBeTrue();
    expect(ch.tokenFrame).toBe('polaroid');
    expect(viewStatesEqual(snap, capturePlacementViewState(ch))).toBeTrue();
  });
});
