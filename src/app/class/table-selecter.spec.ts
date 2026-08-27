import { EventSystem, Network } from './core/system';
import { Event } from './core/system/event/event';
import { ObjectStore } from './core/synchronize-object/object-store';
import { PeerCursor } from './peer-cursor';
import { TabletopObject } from './tabletop-object';
import { TableSelecter } from './table-selecter';
import { TabletopLoadSettle } from './tabletop-load-settle';
import {
  makeCharacter,
  makeTable,
  makeTextNote,
  makeToken,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('TableSelecter view / reload', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => {
    resetTabletopStore();
    TabletopLoadSettle.forceRelease();
  });

  it('prepareForRoomReload clears active and viewed ids', () => {
    makeTable('t1');
    viewTables('t1');
    expect(TableSelecter.instance.viewTableIdentifier).toBe('t1');
    TableSelecter.instance.prepareForRoomReload();
    expect(TableSelecter.instance.viewTableIdentifier).toBe('');
    expect(TableSelecter.instance.viewedTableIdentifier).toBe('');
  });

  it('restoreAfterRoomLoad prefers selecter SyncVar over GameTable.selected', () => {
    const a = makeTable('mapA');
    const b = makeTable('mapB');
    a.selected = true;
    b.selected = false;
    TableSelecter.instance.viewTableIdentifier = 'mapB';
    TableSelecter.instance.viewedTableIdentifier = '';

    TableSelecter.instance.restoreAfterRoomLoad();

    expect(TableSelecter.instance.viewTableIdentifier).toBe('mapB');
    expect(TableSelecter.instance.viewedTableIdentifier).toBe('mapB');
    expect(b.selected).toBeTrue();
    expect(a.selected).toBeFalse();
  });

  it('A→B→A keeps pose on A after flush + hydrate (applyViewLocal path)', () => {
    // Multi-map placements remain for non-character ITEMS (notes etc.).
    makeTable('mapA');
    makeTable('mapB');
    viewTables('mapA');

    const note = makeTextNote('traveler');
    note.location = { name: 'table', x: 10, y: 20 };
    note.addToTable('mapA', { x: 10, y: 20, posZ: 0 }, false);
    note.addToTable('mapB', { x: 30, y: 40, posZ: 0 }, false);
    note.hydratePoseForView('mapA');

    note.location.x = 15;
    note.location.y = 25;
    TabletopObject.flushLivePosesToView('mapA');

    (TableSelecter.instance as any).applyViewLocal('mapB');
    expect(note.location.x).toBe(30);
    expect(note.location.y).toBe(40);

    (TableSelecter.instance as any).applyViewLocal('mapA');
    expect(note.location.x).toBe(15);
    expect(note.location.y).toBe(25);
  });

  it('token only on B is not visible when viewing A', () => {
    makeTable('mapA');
    makeTable('mapB');
    viewTables('mapA');

    const body = makeCharacter('onlyB');
    body.location = { name: 'common', x: 0, y: 0 };
    const tok = makeToken(body, { x: 1, y: 1, posZ: 0 }, 'mapB');

    expect(tok.isVisibleOnTable).toBeFalse();
    expect(body.location.name).not.toBe('table');
    viewTables('mapB');
    expect(tok.isVisibleOnTable).toBeTrue();
  });

  it('viewTableLocal changes viewed without changing room active', () => {
    makeTable('mapA');
    makeTable('mapB');
    viewTables('mapA', 'mapA');
    const prev = PeerCursor.myCursor;
    PeerCursor.myCursor = { isGMMode: true } as any;

    TableSelecter.instance.viewTableLocal('mapB');

    expect(TableSelecter.instance.viewTableIdentifier).toBe('mapA');
    expect(TableSelecter.instance.viewedTableIdentifier).toBe('mapB');
    PeerCursor.myCursor = prev;
  });

  it('viewTable / activeTable do not fall back to tables[0] while id is still syncing', () => {
    makeTable('mapPresent');
    TableSelecter.instance.viewTableIdentifier = 'mapPending';
    TableSelecter.instance.viewedTableIdentifier = 'mapPending';
    // Pending id is not in store and not deleted — join race guard.
    expect(ObjectStore.instance.get('mapPending')).toBeFalsy();
    expect(ObjectStore.instance.isDeleted('mapPending')).toBeFalse();

    expect(TableSelecter.instance.viewTable).toBeNull();
    expect(TableSelecter.instance.activeTable).toBeNull();
  });

  it('ensureActiveOrFirst does not rewrite SyncVar while active id is still syncing', () => {
    makeTable('mapPresent');
    TableSelecter.instance.viewTableIdentifier = 'mapPending';
    TableSelecter.instance.viewedTableIdentifier = '';

    TableSelecter.instance.ensureActiveOrFirst();

    expect(TableSelecter.instance.viewTableIdentifier).toBe('mapPending');
    expect(TableSelecter.instance.viewedTableIdentifier).toBe('mapPending');
  });

  it('ensureActiveOrFirst does not invent active SyncVar when other peers are present', () => {
    makeTable('mapA');
    makeTable('mapB');
    TableSelecter.instance.viewTableIdentifier = '';
    TableSelecter.instance.viewedTableIdentifier = '';
    spyOnProperty(Network, 'peerIds', 'get').and.returnValue(['me', 'other']);

    TableSelecter.instance.ensureActiveOrFirst();

    expect(TableSelecter.instance.viewTableIdentifier).toBe('');
    expect(TableSelecter.instance.viewedTableIdentifier).toBe('mapA');
  });

  it('remote TableSelecter UPDATE with same active does not yank local viewer', () => {
    makeTable('mapA');
    makeTable('mapB');
    viewTables('mapA', 'mapA');
    (TableSelecter.instance as any).lastRemoteActiveId = 'mapA';
    TableSelecter.instance.viewedTableIdentifier = 'mapB';

    const applySpy = spyOn(TableSelecter.instance as any, 'applyViewLocal').and.callThrough();
    EventSystem.trigger(new Event('UPDATE_GAME_OBJECT', {
      identifier: TableSelecter.instance.identifier,
    }, 'other-peer'));

    expect(TableSelecter.instance.viewedTableIdentifier).toBe('mapB');
    expect(applySpy).not.toHaveBeenCalled();
  });

  it('remote TableSelecter UPDATE with new active pulls local viewer', () => {
    makeTable('mapA');
    makeTable('mapB');
    viewTables('mapA', 'mapA');
    (TableSelecter.instance as any).lastRemoteActiveId = 'mapA';
    TableSelecter.instance.viewTableIdentifier = 'mapB';
    TableSelecter.instance.viewedTableIdentifier = 'mapA';

    EventSystem.trigger(new Event('UPDATE_GAME_OBJECT', {
      identifier: TableSelecter.instance.identifier,
    }, 'other-peer'));

    expect(TableSelecter.instance.viewedTableIdentifier).toBe('mapB');
    expect((TableSelecter.instance as any).lastRemoteActiveId).toBe('mapB');
  });
});
