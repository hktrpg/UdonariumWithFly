import { ClueLink } from '@udonarium/clue-link';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { GameCharacter } from '@udonarium/game-character';
import { GameTable } from '@udonarium/game-table';
import { TableSelecter } from '@udonarium/table-selecter';
import { TextNote } from '@udonarium/text-note';
import { Terrain } from '@udonarium/terrain';

/** Destroy tabletop-related objects between specs (ObjectStore is a process singleton). */
export function resetTabletopStore(): void {
  const destroyAll = (list: { destroy(): void }[]) => {
    for (const o of [...list]) {
      try { o.destroy(); } catch { /* ignore */ }
    }
  };
  destroyAll(ObjectStore.instance.getObjects(ClueLink));
  destroyAll(ObjectStore.instance.getObjects(GameCharacter));
  destroyAll(ObjectStore.instance.getObjects(TextNote));
  destroyAll(ObjectStore.instance.getObjects(Terrain));
  destroyAll(ObjectStore.instance.getObjects(GameTable));
  ObjectStore.instance.clearDeleteHistory();
  TableSelecter.instance.prepareForRoomReload();
}

export function makeTable(id: string, name = id): GameTable {
  const table = new GameTable(id);
  table.name = name;
  table.initialize();
  return table;
}

export function makeCharacter(id: string, name = id, size = 1): GameCharacter {
  const ch = new GameCharacter(id);
  (ch as any).createDataElements();
  ch.initialize();
  ch.createTestGameDataElement(name, size, '');
  return ch;
}

export function viewTables(activeId: string, viewedId = activeId): void {
  const sel = TableSelecter.instance;
  sel.viewTableIdentifier = activeId;
  sel.viewedTableIdentifier = viewedId;
}
