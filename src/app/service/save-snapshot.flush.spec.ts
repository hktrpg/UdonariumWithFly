import { TabletopObject } from '@udonarium/tabletop-object';
import {
  makeCharacter,
  makeTable,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

/**
 * Save-path flush behavior (core of prepareRoomSnapshotForSave).
 * Full SaveDataService DI is heavy; assert the public flush API used by snapshot prep.
 */
describe('Save snapshot pose flush', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('flushLivePosesToView persists dragged coords before XML would be built', () => {
    makeTable('gameTable');
    viewTables('gameTable');

    const ch = makeCharacter('dragged');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('gameTable', { x: 100, y: 100, posZ: 0 }, true);
    ch.hydratePoseForView('gameTable');

    // Simulate drag without writing placements yet.
    ch.location.x = 333;
    ch.location.y = 444;

    TabletopObject.flushLivePosesToView('gameTable');

    expect(ch.getPoseForTable('gameTable')).toEqual(jasmine.objectContaining({ x: 333, y: 444, posZ: 0 }));
  });
});
