import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { Network } from './core/system';
import { DataElement } from './data-element';
import { PeerCursor } from './peer-cursor';
import {
  emptyMaskAppearanceSnap,
  emptyMaskTokenFxConfig,
  MaskAppearanceSnap,
  MaskTokenFxConfig,
  parseMaskAppearanceSnap,
  parseMaskTokenFxConfig,
  stringifyMaskAppearanceSnap,
  stringifyMaskTokenFxConfig,
} from './table-fx/mask-appearance';
import {
  hostHasClickAction,
  hostHasClickActionKind,
  parseClickActionsJson,
  resolveEnabledClickActions,
  stringifyClickActions,
  TabletopClickAction,
  TabletopClickTabMode,
} from './tabletop-click-action';
import { TabletopObject } from './tabletop-object';

@SyncObject('table-mask')
export class GameTableMask extends TabletopObject {
  @SyncVar() isLock: boolean = false;
  @SyncVar() blendType: number = 0;
  @SyncVar() isTransparentOnGMMode: boolean = false;

  @SyncVar() owner: string = '';
  @SyncVar() scratchingGrids: string = '';
  @SyncVar() scratchedGrids: string = '';
  @SyncVar() isScratchPreviewOnGMMode = false;
  @SyncVar() isPreview = false;

  @SyncVar() borderType = 1; // 0:不顯示 1:僅未鎖定時顯示 2:一律顯示
  /** When true (default), footprint blocks light and vision. */
  @SyncVar() affectsLight: boolean = true;

  /** Legacy single action; kept in sync with clickActionsJson[0] or 'none'. */
  @SyncVar() clickAction: TabletopClickAction = 'none';
  /** Multi-select enabled actions JSON array (preferred). */
  @SyncVar() clickActionsJson: string = '';
  /** Chat / dice text. */
  @SyncVar() clickPayload: string = '';
  @SyncVar() clickGameType: string = 'DiceBot';
  @SyncVar() clickTabMode: TabletopClickTabMode = 'current';
  @SyncVar() clickTabId: string = '';
  @SyncVar() clickMusicTrack: number = 0;
  @SyncVar() clickMusicLoop: boolean = true;
  @SyncVar() clickMusicId: string = '';
  @SyncVar() clickCutinId: string = '';
  @SyncVar() clickNoteId: string = '';
  @SyncVar() clickTableId: string = '';
  @SyncVar() clickPresetId: string = '';

  /** Locked “default” appearance for A/B toggle (JSON). */
  @SyncVar() appearanceDefaultJson: string = '';
  /** Alternate appearance set (JSON). */
  @SyncVar() appearanceAltJson: string = '';
  /** True when currently showing the alt appearance. */
  @SyncVar() appearanceIsAlt: boolean = false;

  /** Image FX + altitude applied to tokens on this mask (JSON). */
  @SyncVar() tokenFxJson: string = '';
  /** When true, standing on the mask auto-applies tokenFxJson. */
  @SyncVar() tokenFxPassive: boolean = false;

  get name(): string { return this.getCommonValue('name', ''); }
  set name(name: string) { this.setCommonValue('name', name); }
  get width(): number { return this.getCommonValue('width', 1); }
  set width(width: number) { this.setCommonValue('width', width); }
  get height(): number { return this.getCommonValue('height', 1); }
  set height(height: number) { this.setCommonValue('height', height); }
  get opacity(): number {
    let element = this.getElement('opacity', this.commonDataElement);
    let num = element ? <number>element.currentValue / <number>element.value : 1;
    return Number.isNaN(num) ? 1 : num;
  }
  /** UI percent 0–100 (numberResource currentValue). */
  get opacityPercent(): number {
    const element = this.getElement('opacity', this.commonDataElement);
    if (!element) return 100;
    const n = Number(element.currentValue);
    return Number.isNaN(n) ? 100 : n;
  }
  set opacityPercent(percent: number) {
    const element = this.getElement('opacity', this.commonDataElement);
    if (!element) return;
    const max = Number(element.value) || 100;
    const n = Math.max(0, Math.min(max, Number(percent)));
    element.currentValue = Number.isNaN(n) ? max : n;
  }

  setImage(identifier: string) {
    const element = this.getElement('imageIdentifier', this.imageDataElement);
    if (element) element.value = identifier || '';
  }
  
  get fontsize(): number { 
    let element = this.getElement('fontsize', this.commonDataElement);
    return element ? +element.value : 18;
  }
  set fontsize(fontsize: number) { this.setCommonValue('fontsize', fontsize); }
  
  get text(): string { 
    let element = this.getElement('text', this.commonDataElement);
    return element ? element.value + '' : '';
  }
  set text(text: string) { this.setCommonValue('text', text); }

  get color(): string { 
    let element = this.getElement('color', this.commonDataElement);
    return element ? element.value + '' : '#555555';
  }
  set color(color: string) { this.setCommonValue('color', color); }

  get bgcolor(): string { 
    let element = this.getElement('color', this.commonDataElement);
    return element ? element.currentValue + '' : '#0a0a0a';
  }
  set bgcolor(bgcolor: string) { 
    let element = this.getElement('color', this.commonDataElement);
    if (element) element.currentValue = bgcolor;
  }

  get ownerName(): string {
    let object = PeerCursor.findByUserId(this.owner);
    return object ? object.name : '';
  }

  get ownerColor(): string {
    let object = PeerCursor.findByUserId(this.owner);
    return object ? object.color : '#444444';
  }

  get hasOwner(): boolean { return 0 < this.owner.length; }
  get ownerIsOnline(): boolean { return this.hasOwner && (this.isMine || Network.peers.some(peer => peer.userId === this.owner && peer.isOpen)); }
  get isMine(): boolean { return Network.peer.userId === this.owner; }

  get imageIdentifier(): string {
    const el = this.imageElement;
    return el ? (el.value + '') : '';
  }

  get enabledClickActions(): TabletopClickAction[] {
    return resolveEnabledClickActions(this);
  }

  get hasAnyClickAction(): boolean {
    return hostHasClickAction(this);
  }

  hasClickActionKind(action: TabletopClickAction): boolean {
    return hostHasClickActionKind(this, action);
  }

  setEnabledClickActions(actions: TabletopClickAction[]) {
    const next = stringifyClickActions(actions || []);
    this.clickActionsJson = next;
    const list = parseClickActionsJson(next);
    this.clickAction = list.length ? list[0] : 'none';
  }

  toggleClickAction(action: TabletopClickAction) {
    if (!action || action === 'none') {
      this.setEnabledClickActions([]);
      return;
    }
    const cur = this.enabledClickActions.slice();
    const i = cur.indexOf(action);
    if (i >= 0) cur.splice(i, 1);
    else {
      cur.push(action);
      this.migrateLegacyPayloadInto(action);
    }
    this.setEnabledClickActions(cur);
  }

  /** Move shared legacy clickPayload into typed id fields when enabling multi actions. */
  private migrateLegacyPayloadInto(action: TabletopClickAction) {
    const payload = (this.clickPayload || '').trim();
    if (!payload || this.clickAction !== action) return;
    if (action === 'music' && !this.clickMusicId) this.clickMusicId = payload;
    else if (action === 'cutin' && !this.clickCutinId) this.clickCutinId = payload;
    else if (action === 'note' && !this.clickNoteId) this.clickNoteId = payload;
    else if (action === 'table' && !this.clickTableId) this.clickTableId = payload;
    else if (action === 'preset' && !this.clickPresetId) this.clickPresetId = payload;
  }

  get appearanceAlt(): MaskAppearanceSnap {
    return parseMaskAppearanceSnap(this.appearanceAltJson);
  }
  set appearanceAlt(snap: MaskAppearanceSnap) {
    this.appearanceAltJson = stringifyMaskAppearanceSnap(snap || emptyMaskAppearanceSnap());
  }

  get tokenFxConfig(): MaskTokenFxConfig {
    return parseMaskTokenFxConfig(this.tokenFxJson);
  }
  set tokenFxConfig(cfg: MaskTokenFxConfig) {
    this.tokenFxJson = stringifyMaskTokenFxConfig(cfg || emptyMaskTokenFxConfig());
  }

  captureAppearanceSnap(): MaskAppearanceSnap {
    return {
      opacityPercent: this.opacityPercent,
      width: this.width,
      height: this.height,
      altitude: this.altitude,
      fontsize: this.fontsize,
      color: this.color,
      imageIdentifier: this.imageIdentifier,
    };
  }

  applyAppearanceSnap(snap: MaskAppearanceSnap): void {
    if (!snap) return;
    this.opacityPercent = snap.opacityPercent;
    this.width = snap.width;
    this.height = snap.height;
    this.altitude = snap.altitude;
    this.fontsize = snap.fontsize;
    this.color = snap.color;
    this.setImage(snap.imageIdentifier || '');
  }

  /** Toggle between locked default appearance and appearanceAltJson. */
  toggleAppearanceSets(): boolean {
    // Switching to B requires a configured alt set (avoid applying empty 1×1 defaults).
    if (!this.appearanceIsAlt && !this.appearanceAltJson) return false;
    if (!this.appearanceDefaultJson) {
      this.appearanceDefaultJson = stringifyMaskAppearanceSnap(this.captureAppearanceSnap());
    }
    if (this.appearanceIsAlt) {
      this.applyAppearanceSnap(parseMaskAppearanceSnap(this.appearanceDefaultJson));
      this.appearanceIsAlt = false;
    } else {
      this.applyAppearanceSnap(this.appearanceAlt);
      this.appearanceIsAlt = true;
    }
    return true;
  }

  complement(): void {
    let element = this.getElement('fontsize', this.commonDataElement);
    if (!element && this.commonDataElement) {
      this.commonDataElement.appendChild(DataElement.create('fontsize', 18, { }, 'fontsize_' + this.identifier));
    }
    element = this.getElement('text', this.commonDataElement);
    if (!element && this.commonDataElement) {
      this.commonDataElement.appendChild(DataElement.create('text', '', { type: 'note', currentValue: '' }, 'text_' + this.identifier));
    }
    element = this.getElement('color', this.commonDataElement);
    if (!element && this.commonDataElement) {
      this.commonDataElement.appendChild(DataElement.create('color', "#555555", { type: 'colors', currentValue: '#0a0a0a' }, 'color_' + this.identifier));
    }
    element = this.getElement('altitude', this.commonDataElement);
    if (!element && this.commonDataElement) {
      this.commonDataElement.appendChild(DataElement.create('altitude', 0, {}, 'altitude_' + this.identifier));
    }
    this.migrateLegacyClickConfig();
  }

  /** One-time: single clickAction + shared payload → multi actions + typed ids. */
  private migrateLegacyClickConfig() {
    if (this.clickActionsJson) return;
    if (!this.clickAction || this.clickAction === 'none') return;
    const payload = (this.clickPayload || '').trim();
    if (payload && this.clickAction !== 'chat') {
      if (this.clickAction === 'music' && !this.clickMusicId) this.clickMusicId = payload;
      else if (this.clickAction === 'cutin' && !this.clickCutinId) this.clickCutinId = payload;
      else if (this.clickAction === 'note' && !this.clickNoteId) this.clickNoteId = payload;
      else if (this.clickAction === 'table' && !this.clickTableId) this.clickTableId = payload;
      else if (this.clickAction === 'preset' && !this.clickPresetId) this.clickPresetId = payload;
    }
    this.clickActionsJson = stringifyClickActions([this.clickAction]);
  }

  static create(name: string, width: number, height: number, opacity: number, identifier?: string): GameTableMask {
    let object: GameTableMask = null;

    if (identifier) {
      object = new GameTableMask(identifier);
    } else {
      object = new GameTableMask();
    }
    object.createDataElements();

    object.commonDataElement.appendChild(DataElement.create('name', name, {}, 'name_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('width', width, {}, 'width_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('height', height, {}, 'height_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('opacity', opacity, { type: 'numberResource', currentValue: opacity }, 'opacity_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('fontsize', 18, { }, 'fontsize_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('text', '', { type: 'note', currentValue: '' }, 'text_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('color', "#555555", { type: 'colors' , currentValue: '#0a0a0a' }, 'ccolor_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('altitude', 0, { }, 'altitude_' + object.identifier));
    object.initialize();

    return object;
  }
}
