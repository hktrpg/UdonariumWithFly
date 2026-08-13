import { Card } from './card';
import { CardStack } from './card-stack';
import { CharacterToken } from './character-token';
import { ClueLink } from './clue-link';
import { SyncObject } from './core/synchronize-object/decorator';
import { GameObject } from './core/synchronize-object/game-object';
import { ObjectNode } from './core/synchronize-object/object-node';
import { InnerXml, ObjectSerializer } from './core/synchronize-object/object-serializer';
import { ObjectStore } from './core/synchronize-object/object-store';
import { DiceSymbol } from './dice-symbol';
import { GameCharacter } from './game-character';
import { GameTable } from './game-table';
import { GameTableMask } from './game-table-mask';
import { RangeArea } from './range';
import { AuraNameConfig } from './table-fx/aura-name-config';
import { CombatTracker } from './table-fx/combat-tracker';
import { SceneToolPermission } from './table-fx/scene-tool-permission';
import { TableSelecter } from './table-selecter';
import { TabletopObject } from './tabletop-object';
import { Terrain } from './terrain';
import { TextNote } from './text-note';

@SyncObject('room')
export class Room extends GameObject implements InnerXml {
  // GameObject Lifecycle
  onStoreAdded() {
    super.onStoreAdded();
    ObjectStore.instance.remove(this); // 不登錄到 ObjectStore
  }

  innerXml(): string {
    let xml = '';
    let objects: GameObject[] = [];
    objects = objects.concat(ObjectStore.instance.getObjects(GameTable));
    objects = objects.concat(ObjectStore.instance.getObjects(GameCharacter));
    objects = objects.concat(ObjectStore.instance.getObjects(CharacterToken));
    objects = objects.concat(ObjectStore.instance.getObjects(RangeArea));
    objects = objects.concat(ObjectStore.instance.getObjects(TextNote));
    objects = objects.concat(ObjectStore.instance.getObjects(CardStack));
    objects = objects.concat(ObjectStore.instance.getObjects(Card).filter((obj) => { return obj.parent === null }));
    objects = objects.concat(ObjectStore.instance.getObjects(DiceSymbol));
    objects = objects.concat(ObjectStore.instance.getObjects(ClueLink));
    objects.push(AuraNameConfig.instance);
    objects.push(CombatTracker.instance);
    objects.push(SceneToolPermission.instance);
    objects.push(TableSelecter.instance);
    for (let object of objects) {
      xml += object.toXml();
    }
    return xml;
  }

  parseInnerXml(element: Element) {
    let objects: GameObject[] = [];
    objects = objects.concat(ObjectStore.instance.getObjects(GameTable));
    objects = objects.concat(ObjectStore.instance.getObjects(GameTableMask));
    objects = objects.concat(ObjectStore.instance.getObjects(Terrain));
    objects = objects.concat(ObjectStore.instance.getObjects(GameCharacter));
    objects = objects.concat(ObjectStore.instance.getObjects(CharacterToken));
    objects = objects.concat(ObjectStore.instance.getObjects(RangeArea));
    objects = objects.concat(ObjectStore.instance.getObjects(TextNote));
    objects = objects.concat(ObjectStore.instance.getObjects(CardStack));
    objects = objects.concat(ObjectStore.instance.getObjects(Card));
    objects = objects.concat(ObjectStore.instance.getObjects(DiceSymbol));
    objects = objects.concat(ObjectStore.instance.getObjects(ClueLink));
    for (let object of objects) {
      object.destroy();
    }
    // Allow syncId reuse after destroy marks identifiers as deleted.
    ObjectStore.instance.clearDeleteHistory();
    // Drop stale session view so legacy ZIPs without TableSelecter use selected/first table.
    TableSelecter.instance.prepareForRoomReload();
    for (let i = 0; i < element.children.length; i++) {
      ObjectSerializer.instance.parseXml(element.children[i]);
    }
    // Legacy rooms (no syncId): tableIdentifier still points at pre-save UUIDs.
    TabletopObject.repairOrphanedPieceBindings();
    TableSelecter.instance.restoreAfterRoomLoad();
    // Fresh XML objects start at version ~0; shared default syncIds would otherwise lose
    // LWW to a joiner's aged lobby defaults (house looks replaced by sample tables).
    Room.claimLoadedRoomSyncAuthority();
  }

  /** After room load: make loaded objects win ObjectSynchronizer version merge. */
  static claimLoadedRoomSyncAuthority() {
    for (const object of Room.listSyncedRoomObjects()) {
      Room.claimTree(object);
    }
  }

  /**
   * Before mesh-joining a room: drop local tabletop samples so we pull the host's
   * house instead of pushing lobby defaults onto shared syncIds.
   */
  static clearLocalTabletopForJoin() {
    for (const object of Room.listTabletopObjects()) {
      if (!ObjectStore.instance.get(object.identifier)) continue;
      // Must cascade: ObjectStore.delete(parent) leaves DataElement children orphaned
      // (not in parent._children after recreate) and their high lobby versions win LWW.
      object.destroyLocal();
    }
    ObjectStore.instance.clearDeleteHistory();
    TableSelecter.instance.prepareForRoomReload();
    for (const object of Room.listRoomSingletons()) {
      object.yieldSyncAuthority();
    }
  }

  private static claimTree(object: GameObject) {
    object.claimSyncAuthority(true);
    if (object instanceof ObjectNode) {
      for (const child of object.children) {
        Room.claimTree(child);
      }
    }
  }

  private static listTabletopObjects(): GameObject[] {
    let objects: GameObject[] = [];
    objects = objects.concat(ObjectStore.instance.getObjects(GameTable));
    objects = objects.concat(ObjectStore.instance.getObjects(GameTableMask));
    objects = objects.concat(ObjectStore.instance.getObjects(Terrain));
    objects = objects.concat(ObjectStore.instance.getObjects(GameCharacter));
    objects = objects.concat(ObjectStore.instance.getObjects(CharacterToken));
    objects = objects.concat(ObjectStore.instance.getObjects(RangeArea));
    objects = objects.concat(ObjectStore.instance.getObjects(TextNote));
    objects = objects.concat(ObjectStore.instance.getObjects(CardStack));
    objects = objects.concat(ObjectStore.instance.getObjects(Card));
    objects = objects.concat(ObjectStore.instance.getObjects(DiceSymbol));
    objects = objects.concat(ObjectStore.instance.getObjects(ClueLink));
    return objects;
  }

  private static listRoomSingletons(): GameObject[] {
    return [
      AuraNameConfig.instance,
      CombatTracker.instance,
      SceneToolPermission.instance,
      TableSelecter.instance,
    ];
  }

  private static listSyncedRoomObjects(): GameObject[] {
    return Room.listTabletopObjects().concat(Room.listRoomSingletons());
  }
}
