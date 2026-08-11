import { ObjectStore } from './core/synchronize-object/object-store';
import { GameCharacter } from './game-character';
import { TabletopObject } from './tabletop-object';
import {
  makeCharacter,
  makeTable,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('GameCharacter temporary copy', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('createTemporaryCopy marks inventory-hidden temp flag and exclusive placement', () => {
    makeTable('mapA');
    viewTables('mapA');
    const src = makeCharacter('srcChar', 'Hero');
    src.location = { name: 'table', x: 10, y: 20 };
    src.addToTable('mapA', { x: 10, y: 20, posZ: 0 }, true);
    src.isInventoryIndicate = true;

    const copy = GameCharacter.createTemporaryCopy(src, { x: 50, y: 60, posZ: 1 }, 'mapA');

    expect(copy.identifier).not.toBe(src.identifier);
    expect(copy.isTemporaryCopy).toBeTrue();
    expect(copy.isInventoryIndicate).toBeFalse();
    expect(copy.hasPlacement('mapA')).toBeTrue();
    expect(copy.getPoseForTable('mapA')).toEqual({ x: 50, y: 60, posZ: 1 });
    expect(src.isTemporaryCopy).toBeFalse();
    expect(src.hasPlacement('mapA')).toBeTrue();
  });

  it('disposeObject destroys temporary copies instead of graveyard callback', () => {
    makeTable('mapA');
    viewTables('mapA');
    const src = makeCharacter('src2');
    src.location = { name: 'table', x: 0, y: 0 };
    src.addToTable('mapA', { x: 0, y: 0, posZ: 0 }, true);
    const copy = GameCharacter.createTemporaryCopy(src, { x: 1, y: 1 }, 'mapA');
    const id = copy.identifier;
    let graveyard = false;

    TabletopObject.disposeObject(copy, () => { graveyard = true; });

    expect(graveyard).toBeFalse();
    expect(ObjectStore.instance.get(id)).toBeFalsy();
  });

  it('disposeObject uses graveyard callback for normal tokens', () => {
    makeTable('mapA');
    viewTables('mapA');
    const ch = makeCharacter('normal');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('mapA', { x: 0, y: 0, posZ: 0 }, true);
    let graveyard = false;

    TabletopObject.disposeObject(ch, () => { graveyard = true; });

    expect(graveyard).toBeTrue();
  });
});
