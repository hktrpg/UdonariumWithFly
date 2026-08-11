import { ClueLink } from '@udonarium/clue-link';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { GameCharacter } from '@udonarium/game-character';
import { GameTable } from '@udonarium/game-table';
import {
  DEFAULT_TABLE_2D_ID,
  DEFAULT_TABLE_3D_ID,
} from 'service/default-room/default-room.ids';
import {
  makeDefaultTables,
  seedDefaultRoomObjects,
} from 'service/default-room/default-room.seed';
import { resetTabletopStore } from '../../../testing/tabletop-test.util';

describe('default-room.seed contracts', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  const t = (key: string) => key;

  it('seeds dual-map monster C and battle + clue red strings', () => {
    makeDefaultTables(t);
    seedDefaultRoomObjects(t);

    expect(ObjectStore.instance.get<GameTable>(DEFAULT_TABLE_3D_ID)).toBeTruthy();
    expect(ObjectStore.instance.get<GameTable>(DEFAULT_TABLE_2D_ID)).toBeTruthy();

    const c = ObjectStore.instance.get<GameCharacter>('testCharacter_3');
    expect(c).toBeTruthy();
    expect(c.hasPlacement(DEFAULT_TABLE_3D_ID)).toBeTrue();
    expect(c.hasPlacement(DEFAULT_TABLE_2D_ID)).toBeTrue();

    const links = ClueLink.all();
    const battleLinks = links.filter(l => l.tableIdentifier === DEFAULT_TABLE_3D_ID);
    const clueLinks = links.filter(l => l.tableIdentifier === DEFAULT_TABLE_2D_ID);
    expect(battleLinks.length).toBe(2);
    expect(clueLinks.length).toBe(5);

    // Fixed syncIds only (no random "新角色").
    const chars = ObjectStore.instance.getObjects(GameCharacter);
    for (const ch of chars) {
      expect(ch.identifier.startsWith('testCharacter_') || ch.identifier.startsWith('clueCharacter_')).toBeTrue();
    }
  });
});
