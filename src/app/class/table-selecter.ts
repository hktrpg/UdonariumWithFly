import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { GameObject } from './core/synchronize-object/game-object';
import { ObjectStore } from './core/synchronize-object/object-store';
import { EventSystem, Network } from './core/system';
import { GameTable } from './game-table';
import { PeerCursor } from './peer-cursor';
import { TabletopObject } from './tabletop-object';

/**
 * Foundry-style scene selection:
 * - active (`viewTableIdentifier` SyncVar, kept for save/compat) — one room-wide active table
 * - viewed (`viewedTableIdentifier`, local) — canvas currently rendered for this client
 */
@SyncObject('TableSelecter')
export class TableSelecter extends GameObject {
  private static _instance: TableSelecter;
  static get instance(): TableSelecter {
    if (!TableSelecter._instance) {
      TableSelecter._instance = new TableSelecter('TableSelecter');
      TableSelecter._instance.initialize();
    }
    return TableSelecter._instance;
  }

  /** Room-wide active table id (Foundry “active scene”). Legacy SyncVar name kept for compat. */
  @SyncVar() viewTableIdentifier: string = '';

  /** Soft pause watermark for all clients; does not block input. */
  @SyncVar() isPaused: boolean = false;

  /** Per-client viewed table id (Foundry “viewed scene”). Not synced. */
  viewedTableIdentifier: string = '';

  gridShow: boolean = false; // true=一律顯示格線
  gridSnap: boolean = true;

  /** Alias for active table id. */
  get activeTableIdentifier(): string { return this.viewTableIdentifier; }
  set activeTableIdentifier(id: string) { this.viewTableIdentifier = id; }

  // GameObject Lifecycle
  onStoreAdded() {
    super.onStoreAdded();
    EventSystem.register(this)
      .on('ACTIVATE_GAME_TABLE', event => {
        const id: string = event.data?.identifier;
        if (!id) return;
        if (event.isSendFromSelf) {
          // Originator already applied via activateTable / legacy SELECT; ensure viewed.
          if (this.viewTableIdentifier !== id) this.applyActivateAsOriginator(id);
          else this.applyViewLocal(id);
        } else {
          this.applyViewLocal(id);
        }
        EventSystem.trigger('SELECT_GAME_TABLE', { identifier: id, _fromSelecter: true });
      })
      .on('VIEW_GAME_TABLE', event => {
        const id: string = event.data?.identifier;
        if (!id) return;
        this.applyViewLocal(id);
        EventSystem.trigger('SELECT_GAME_TABLE', { identifier: id, _fromSelecter: true });
      })
      // Legacy: treat as Activate for old callers that still fire SELECT_GAME_TABLE directly.
      .on('SELECT_GAME_TABLE', event => {
        // Ignore our own re-triggers from activate/view handlers above.
        if (event.data?._fromSelecter) return;
        const id: string = event.data?.identifier;
        if (!id) return;

        // Join catalog / rehydrate of selected GameTable — never rebroadcast Activate
        // (that would yank peers, including a GM previewing another map).
        if (event.data?._fromCatalog) {
          if (this.viewTableIdentifier === id) {
            if (this.viewedTableIdentifier !== id) this.applyViewLocal(id);
            else TabletopObject.hydrateAllForView(id, true);
          }
          return;
        }

        // Already aligned — hydrate only.
        if (this.viewedTableIdentifier === id && this.viewTableIdentifier === id) {
          TabletopObject.hydrateAllForView(id, true);
          return;
        }
        this.applyActivateAsOriginator(id);
        EventSystem.call('ACTIVATE_GAME_TABLE', { identifier: id });
      })
      .on('UPDATE_GAME_OBJECT', event => {
        if (event.isSendFromSelf) return;
        if (event.data?.identifier !== this.identifier) return;
        const activeId = this.viewTableIdentifier;
        if (!activeId) return;
        // Remote active change → pull local view (Foundry Activate).
        if (this.viewedTableIdentifier !== activeId) {
          this.applyViewLocal(activeId);
          EventSystem.trigger('SELECT_GAME_TABLE', { identifier: activeId, _fromSelecter: true });
        } else {
          TabletopObject.hydrateAllForView(activeId, true);
        }
      })
      .on('CONNECT_PEER', event => {
        if (!event.isSendFromSelf) return;
        // After join catalog sync, align viewed to active and hydrate poses.
        setTimeout(() => this.ensureActiveOrFirst(), 500);
      })
      .on('MY_PEER_CURSOR_READY', () => {
        // createMyCursor finishes after ensureActiveOrFirst often ran — sync presence now.
        if (!this.viewedTableIdentifier) this.ensureActiveOrFirst();
        else this.syncMyViewedPresence();
      });
  }

  // GameObject Lifecycle
  onStoreRemoved() {
    super.onStoreRemoved();
    EventSystem.unregister(this);
  }

  /**
   * Activate a table for the whole room (GM). Sets SyncVar active and pulls every peer’s viewed canvas.
   */
  activateTable(identifier: string) {
    if (!identifier) return;
    if (Network.GuestMode()) return;
    if (!PeerCursor.myCursor?.isGMMode) return;
    this.applyActivateAsOriginator(identifier);
    EventSystem.call('ACTIVATE_GAME_TABLE', { identifier });
    EventSystem.trigger('SELECT_GAME_TABLE', { identifier, _fromSelecter: true });
  }

  /**
   * View a table locally only (does not change room active).
   * Players need `playerCanView` on that GameTable; GM always allowed.
   */
  viewTableLocal(identifier: string) {
    if (!identifier) return;
    const table = ObjectStore.instance.get<GameTable>(identifier);
    if (!table) return;
    const isGM = !!PeerCursor.myCursor?.isGMMode;
    if (!isGM && !table.playerCanView) return;
    this.applyViewLocal(identifier);
    EventSystem.trigger('SELECT_GAME_TABLE', { identifier, _fromSelecter: true });
  }

  togglePaused() {
    if (Network.GuestMode()) return;
    if (!PeerCursor.myCursor?.isGMMode) return;
    this.isPaused = !this.isPaused;
    EventSystem.trigger('UPDATE_GAME_OBJECT', this.toContext());
  }

  private applyActivateAsOriginator(identifier: string) {
    const prev = ObjectStore.instance.get<GameTable>(this.viewTableIdentifier);
    if (prev && prev.identifier !== identifier) prev.selected = false;
    this.viewTableIdentifier = identifier;
    const next = ObjectStore.instance.get<GameTable>(identifier);
    if (next) next.selected = true;
    TabletopObject.migrateUnboundTablePieces(identifier);
    this.applyViewLocal(identifier);
  }

  private applyViewLocal(identifier: string) {
    const prev = this.viewedTableIdentifier;
    if (prev && prev !== identifier) {
      // Flush movable batches + live poses into placements[prev] before hydrate.
      EventSystem.trigger('BEFORE_VIEW_TABLE_CHANGE', { tableId: prev });
      TabletopObject.flushLivePosesToView(prev);
    }
    this.viewedTableIdentifier = identifier;
    // Clear selection before hydrate — selected tokens ignore self UPDATE and keep the old map's screen pose.
    EventSystem.trigger('PREPARE_VIEW_TABLE_CHANGE', { tableId: identifier });
    TabletopObject.hydrateAllForView(identifier, true);
    EventSystem.trigger('AFTER_VIEW_TABLE_CHANGE', { tableId: identifier });
    if (PeerCursor.myCursor) {
      PeerCursor.myCursor.viewedSceneIdentifier = identifier;
    }
  }

  /**
   * Canvas table = viewed (fallback active).
   * Read-only: never mutates viewed/active ids. If a known id is still syncing into the store,
   * return null instead of falling back to tables[0] (avoids canvas/presence desync on join).
   */
  get viewTable(): GameTable {
    const id = this.viewedTableIdentifier || this.viewTableIdentifier;
    if (id) {
      const table = ObjectStore.instance.get<GameTable>(id);
      if (table) return table;
      if (!ObjectStore.instance.isDeleted(id)) return null;
    }
    if (id) return null;
    return ObjectStore.instance.getObjects<GameTable>(GameTable)[0] || null;
  }

  get activeTable(): GameTable {
    return this.viewTableIdentifier
      ? ObjectStore.instance.get<GameTable>(this.viewTableIdentifier)
      : null;
  }

  /** Boot / empty-room: ensure active+viewed point at first table without getter side effects. */
  ensureActiveOrFirst() {
    const tables = ObjectStore.instance.getObjects<GameTable>(GameTable);
    if (tables.length < 1) return;

    const activeId = this.viewTableIdentifier;
    const activeObj = activeId ? ObjectStore.instance.get<GameTable>(activeId) : null;
    const activeDeleted = !!(activeId && ObjectStore.instance.isDeleted(activeId));

    // If we already have an active id but the GameTable is not in the store yet
    // (catalog still syncing), do NOT rewrite SyncVar to tables[0] — that races joins.
    if (activeId && !activeObj && !activeDeleted) {
      if (!this.viewedTableIdentifier) this.viewedTableIdentifier = activeId;
      this.syncMyViewedPresence();
      return;
    }

    if (!activeObj || activeDeleted) {
      this.viewTableIdentifier = tables[0].identifier;
      tables[0].selected = true;
    }
    if (!this.viewedTableIdentifier || !ObjectStore.instance.get<GameTable>(this.viewedTableIdentifier)) {
      this.viewedTableIdentifier = this.viewTableIdentifier;
    }
    TabletopObject.hydrateAllForView(this.viewedTableIdentifier, true);
    this.syncMyViewedPresence();
  }

  private syncMyViewedPresence() {
    if (PeerCursor.myCursor && this.viewedTableIdentifier) {
      PeerCursor.myCursor.viewedSceneIdentifier = this.viewedTableIdentifier;
    }
  }
}