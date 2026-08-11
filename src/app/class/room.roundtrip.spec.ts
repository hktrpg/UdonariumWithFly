import { ClueLink } from './clue-link';
import { ObjectSerializer } from './core/synchronize-object/object-serializer';
import { ObjectStore } from './core/synchronize-object/object-store';
import { GameCharacter } from './game-character';
import { GameTable } from './game-table';
import { Room } from './room';
import { TableSelecter } from './table-selecter';
import {
  makeCharacter,
  makeTable,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('Room XML round-trip', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('preserves dual-map placements, clue links, and table syncIds', () => {
    const battle = makeTable('gameTable', 'Battle');
    const clue = makeTable('gameTable_clue2d', 'Clue');
    battle.selected = true;
    clue.selected = false;
    viewTables('gameTable');

    const a = makeCharacter('testCharacter_1', 'A');
    a.location = { name: 'table', x: 250, y: 450 };
    a.addToTable('gameTable', { x: 250, y: 450, posZ: 0 }, true);

    const c = makeCharacter('testCharacter_3', 'C', 3);
    c.location = { name: 'table', x: 175, y: 225 };
    c.addToTable('gameTable', { x: 175, y: 225, posZ: 0 }, true);
    c.addToTable('gameTable_clue2d', { x: 175, y: 400, posZ: 0 }, false);

    ClueLink.create(c.identifier, a.identifier, {
      sag: 0.22,
      tableIdentifier: 'gameTable',
      identifier: 'battleClueLink_1',
    });

    TableSelecter.instance.viewTableIdentifier = 'gameTable';
    TableSelecter.instance.viewedTableIdentifier = 'gameTable';

    const room = new Room();
    const xml = `<room syncId="room_test">${room.innerXml()}</room>`;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    expect(doc.querySelector('parsererror')).toBeNull();

    // Simulate load into a clean store.
    resetTabletopStore();
    // Re-create selecter state cleared by reset — Room.parse will restore.
    room.parseInnerXml(doc.documentElement);

    const battle2 = ObjectStore.instance.get<GameTable>('gameTable');
    const clue2 = ObjectStore.instance.get<GameTable>('gameTable_clue2d');
    expect(battle2).toBeTruthy();
    expect(clue2).toBeTruthy();

    const c2 = ObjectStore.instance.get<GameCharacter>('testCharacter_3');
    expect(c2).toBeTruthy();
    expect(c2.hasPlacement('gameTable')).toBeTrue();
    expect(c2.hasPlacement('gameTable_clue2d')).toBeTrue();
    expect(c2.getPoseForTable('gameTable')).toEqual({ x: 175, y: 225, posZ: 0 });
    expect(c2.getPoseForTable('gameTable_clue2d')).toEqual({ x: 175, y: 400, posZ: 0 });

    const link = ObjectStore.instance.get<ClueLink>('battleClueLink_1');
    expect(link).toBeTruthy();
    expect(link.fromIdentifier).toBe('testCharacter_3');
    expect(link.toIdentifier).toBe('testCharacter_1');
    expect(link.tableIdentifier).toBe('gameTable');
  });

  it('ObjectSerializer preserves syncId on GameTable', () => {
    const t = makeTable('syncTable_x', 'X');
    const xml = t.toXml();
    expect(xml).toContain('syncId="syncTable_x"');
    t.destroy();
    ObjectStore.instance.clearDeleteHistory();
    const parsed = ObjectSerializer.instance.parseXml(
      new DOMParser().parseFromString(xml, 'text/xml').documentElement
    ) as GameTable;
    expect(parsed.identifier).toBe('syncTable_x');
  });
});
