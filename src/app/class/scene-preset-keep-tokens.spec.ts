import { ScenePresetList } from './scene-preset-list';
import {
  makeCharacter,
  makeTable,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('ScenePreset keep-tokens helpers', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('captureVisibleTokenPoses records visible characters only', () => {
    makeTable('mapA');
    makeTable('mapB');
    viewTables('mapA');

    const visible = makeCharacter('vis');
    visible.location = { name: 'table', x: 11, y: 22 };
    visible.addToTable('mapA', { x: 11, y: 22, posZ: 0 }, true);

    const hidden = makeCharacter('hid');
    hidden.location = { name: 'table', x: 1, y: 1 };
    hidden.addToTable('mapB', { x: 1, y: 1, posZ: 0 }, true);

    const list = ScenePresetList.instance;
    const kept = (list as any).captureVisibleTokenPoses();

    expect(kept.length).toBe(1);
    expect(kept[0].obj.identifier).toBe('vis');
    expect(kept[0].x).toBe(11);
    expect(kept[0].y).toBe(22);
  });

  it('applyKeptTokenPoses stamps poses onto the target map without exclusive wipe', () => {
    makeTable('mapA');
    makeTable('mapB');
    viewTables('mapA');

    const ch = makeCharacter('stamp');
    ch.location = { name: 'table', x: 5, y: 6 };
    ch.addToTable('mapA', { x: 5, y: 6, posZ: 0 }, false);

    const list = ScenePresetList.instance;
    (list as any).applyKeptTokenPoses('mapB', [
      { obj: ch, x: 90, y: 91, posZ: 2 },
    ]);

    expect(ch.hasPlacement('mapA')).toBeTrue();
    expect(ch.hasPlacement('mapB')).toBeTrue();
    expect(ch.getPoseForTable('mapB')).toEqual(jasmine.objectContaining({ x: 90, y: 91, posZ: 2 }));
  });

  it('removeExtraPiecesFromTable keeps captured tokens when skipTokens', () => {
    makeTable('mapA');
    viewTables('mapA');

    const keep = makeCharacter('keepMe');
    keep.location = { name: 'table', x: 1, y: 1 };
    keep.addToTable('mapA', { x: 1, y: 1, posZ: 0 }, true);

    const drop = makeCharacter('dropMe');
    drop.location = { name: 'table', x: 2, y: 2 };
    drop.addToTable('mapA', { x: 2, y: 2, posZ: 0 }, true);

    const list = ScenePresetList.instance;
    (list as any).removeExtraPiecesFromTable(
      'mapA',
      { version: 1, pieces: [], tableChildren: [] },
      { skipTokens: true },
      new Set(['keepMe'])
    );

    expect(keep.hasPlacement('mapA')).toBeTrue();
    expect(keep.location.name).toBe('table');
    // removeFromTable clears placements and moves leftovers to inventory (tableIdentifier kept for per-map invent).
    expect(drop.location.name).toBe('common');
    expect(drop.placementTableIds).toEqual([]);
  });
});
