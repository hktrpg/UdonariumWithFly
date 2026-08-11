import { Room } from './room';
import { ObjectStore } from './core/synchronize-object/object-store';
import { GameObject } from './core/synchronize-object/game-object';
import { TableSelecter } from './table-selecter';
import {
  makeCharacter,
  makeTable,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

function syncCtx(obj: GameObject): { majorVersion: number; minorVersion: number } {
  return (obj as any).context;
}

describe('Room join / load sync authority', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('clearLocalTabletopForJoin destroys lobby tabletop pieces and clears selecter', () => {
    makeTable('lobbyTable');
    viewTables('lobbyTable');
    const ch = makeCharacter('lobbyChar');
    ch.location = { name: 'table', x: 1, y: 2 };
    ch.addToTable('lobbyTable', { x: 1, y: 2, posZ: 0 }, true);

    expect(ObjectStore.instance.get('lobbyChar')).toBeTruthy();
    expect(ObjectStore.instance.get('lobbyTable')).toBeTruthy();

    Room.clearLocalTabletopForJoin();

    expect(ObjectStore.instance.get('lobbyChar')).toBeFalsy();
    expect(ObjectStore.instance.get('lobbyTable')).toBeFalsy();
    expect(TableSelecter.instance.viewTableIdentifier).toBe('');
    expect(TableSelecter.instance.viewedTableIdentifier).toBe('');
  });

  it('clearLocalTabletopForJoin yields singleton sync authority to 0', () => {
    syncCtx(TableSelecter.instance).majorVersion = 42;
    syncCtx(TableSelecter.instance).minorVersion = 0.5;

    Room.clearLocalTabletopForJoin();

    expect(syncCtx(TableSelecter.instance).majorVersion).toBe(0);
    expect(syncCtx(TableSelecter.instance).minorVersion).toBe(0);
  });

  it('claimLoadedRoomSyncAuthority bumps tabletop versions above lobby age', () => {
    const table = makeTable('houseTable');
    const ch = makeCharacter('houseChar');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('houseTable', { x: 0, y: 0, posZ: 0 }, true);

    // Simulate aged lobby / prior session versions that would otherwise win LWW.
    syncCtx(table).majorVersion = 1;
    syncCtx(ch).majorVersion = 1;
    syncCtx(TableSelecter.instance).majorVersion = 1;

    const before = Date.now() / 1000;
    Room.claimLoadedRoomSyncAuthority();
    const after = Date.now() / 1000 + 1;

    expect(syncCtx(table).majorVersion).toBeGreaterThanOrEqual(Math.floor(before));
    expect(syncCtx(table).majorVersion).toBeLessThanOrEqual(Math.floor(after));
    expect(syncCtx(ch).majorVersion).toBeGreaterThanOrEqual(Math.floor(before));
    expect(syncCtx(TableSelecter.instance).majorVersion).toBeGreaterThanOrEqual(Math.floor(before));
  });

  it('claimSyncAuthority floors version so loaded ZIP beats aged lobby samples', () => {
    const table = makeTable('vTable');
    syncCtx(table).majorVersion = 99;
    table.claimSyncAuthority(false);
    const floor = Math.floor(Date.now() / 1000);
    expect(syncCtx(table).majorVersion).toBeGreaterThanOrEqual(floor);
  });
});
