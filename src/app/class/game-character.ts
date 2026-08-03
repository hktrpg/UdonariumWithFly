import { ChatPalette } from './chat-palette';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { DataElement } from './data-element';
import { TabletopObject } from './tabletop-object';
import { UUID } from '@udonarium/core/system/util/uuid';

import { StandList } from './stand-list';
import { Network } from './core/system';
import { PeerCursor } from './peer-cursor';
import { ObjectStore } from './core/synchronize-object/object-store';
import { translate } from 'i18n';

@SyncObject('character')
export class GameCharacter extends TabletopObject {
  constructor(identifier: string = UUID.generateUuid()) {
    super(identifier);
    this.isAltitudeIndicate = true;
  }

  @SyncVar() rotate: number = 0;
  @SyncVar() roll: number = 0;
  @SyncVar() isDropShadow: boolean = true;
  @SyncVar() isShowChatBubble: boolean = true;
  @SyncVar() owner: string = '';
  /**
   * Peer userId that claims this as their PC token (not stealth).
   * Used for chat default, FoW vision, combat "my turn", etc.
   */
  @SyncVar() playerOwner: string = '';
  @SyncVar() isAllowsChat: boolean = true;
  /** How far this character can see, in grid squares (FoW). */
  @SyncVar() visionRange: number = 6;
  /** Emitted bright-light radius in grid squares (0 = none). */
  @SyncVar() brightLight: number = 0;
  /** Emitted dim-light radius in grid squares (outer ring; 0 = none). */
  @SyncVar() dimLight: number = 0;
  /**
   * Peer userId that manually claims FoW vision from this character.
   * Chat-window auto links use {@link claimAutoVision} instead and do not write here.
   */
  @SyncVar() visionOwner: string = '';
  /** When true (default), footprint blocks light and vision. */
  @SyncVar() affectsLight: boolean = true;

  /** Local preferred chat character (last「作為我的角色」claim). */
  private static preferredChatCharacterId = '';

  /** HTML5 DnD type for dragging inventory characters onto the table. */
  static readonly INVENTORY_DRAG_MIME = 'application/x-udonarium-character';

  /** characterId → userId for chat-window auto vision (local session only). */
  private static autoVisionUser = new Map<string, string>();
  /** Refcount so multiple chat windows can share the same character. */
  private static autoVisionRefCount = new Map<string, number>();

  /** Link this character as FoW vision for a chat-window selection (refcounted). */
  static claimAutoVision(characterId: string, userId: string): void {
    if (!characterId || !userId) return;
    GameCharacter.autoVisionUser.set(characterId, userId);
    GameCharacter.autoVisionRefCount.set(
      characterId,
      (GameCharacter.autoVisionRefCount.get(characterId) || 0) + 1
    );
  }

  /** Release one chat-window auto vision claim. */
  static releaseAutoVision(characterId: string, userId: string): void {
    if (!characterId || !userId) return;
    if (GameCharacter.autoVisionUser.get(characterId) !== userId) return;
    const next = (GameCharacter.autoVisionRefCount.get(characterId) || 0) - 1;
    if (next <= 0) {
      GameCharacter.autoVisionRefCount.delete(characterId);
      GameCharacter.autoVisionUser.delete(characterId);
    } else {
      GameCharacter.autoVisionRefCount.set(characterId, next);
    }
  }
  @SyncVar() statusesJson: string = '[]';
  @SyncVar() floorRing: string = 'none';
  @SyncVar() floorRingColor: string = '';
  @SyncVar() floorRingSpeed: number = 1;
  
  text = '';
  dialog = null;
  isEmote = false;
  isLoaded = false;

  // 很醜，有沒有別的方法
  chatBubbleAltitude = 0;

  /** Synced character speech balloon (public). Secret balloons still use EventSystem unicast. */
  @SyncVar() chatDialogText: string = '';
  @SyncVar() chatDialogColor: string = '';
  @SyncVar() chatDialogFaceIconIdentifier: string = '';
  @SyncVar() chatDialogIsEmote: boolean = false;
  /** Non-zero while a public balloon is active; bump to retrigger. */
  @SyncVar() chatDialogStamp: number = 0;

  openChatDialog(opts: {
    text: string;
    color?: string;
    faceIconIdentifier?: string;
    isEmote?: boolean;
    stamp?: number;
  }) {
    this.chatDialogText = opts.text || '';
    this.chatDialogColor = opts.color || '';
    this.chatDialogFaceIconIdentifier = opts.faceIconIdentifier || '';
    this.chatDialogIsEmote = !!opts.isEmote;
    this.chatDialogStamp = opts.stamp || Date.now();
  }

  clearChatDialog() {
    if (!this.chatDialogStamp && !this.chatDialogText) return;
    this.chatDialogText = '';
    this.chatDialogColor = '';
    this.chatDialogFaceIconIdentifier = '';
    this.chatDialogIsEmote = false;
    this.chatDialogStamp = 0;
  }

  get name(): string { return this.getCommonValue('name', ''); }
  set name(name) { this.setCommonValue('name', name); }
  get size(): number { return this.getCommonValue('size', 1); }
  get height(): number {
    let element = this.getElement('height', this.commonDataElement);
    //if (!element && this.commonDataElement) {
    //  this.commonDataElement.insertBefore(DataElement.create('height', 0, { 'currentValue': '' }, 'height_' + this.identifier), this.getElement('altitude', this.commonDataElement));
    //}
    let num = element ? +element.value : 0;
    if (element && element.currentValue) num = (Number.isNaN(num) ? 0 : num) * this.size;
    return Number.isNaN(num) ? 0 : num;
  }

  get chatPalette(): ChatPalette {
    for (let child of this.children) {
      if (child instanceof ChatPalette) return child;
    }
    return null;
  }

  get ownerName(): string {
    let object = PeerCursor.findByUserId(this.owner);
    return object ? object.name : null;
  }

  get ownerColor(): string {
    let object = PeerCursor.findByUserId(this.owner);
    return object ? object.color : '#444444';
  }

  get playerOwnerName(): string {
    const object = PeerCursor.findByUserId(this.playerOwner);
    return object ? object.name : (this.playerOwner ? translate('char.unknownPlayer') : '');
  }

  get playerOwnerColor(): string {
    const object = PeerCursor.findByUserId(this.playerOwner);
    return object ? object.color : '#64748b';
  }
  
  get standList(): StandList {
    for (let child of this.children) {
      if (child instanceof StandList) return child;
    }
    let standList = new StandList('StandList_' + this.identifier);
    standList.initialize();
    this.appendChild(standList);
    return standList;
  }

  static create(name: string, size: number, imageIdentifier: string): GameCharacter {
    let gameCharacter: GameCharacter = new GameCharacter();
    gameCharacter.createDataElements();
    gameCharacter.initialize();
    gameCharacter.createTestGameDataElement(name, size, imageIdentifier);

    return gameCharacter;
  }

  get isHideIn(): boolean { return !!this.owner; }
  get isVisible(): boolean { return !this.owner || Network.peer.userId === this.owner; }

  /** Stealth owner or claimed PC token. */
  isControlledBy(userId: string): boolean {
    return !!userId && (this.playerOwner === userId || this.owner === userId);
  }

  get hasPlayerController(): boolean {
    return !!this.playerOwner || !!this.owner;
  }

  /**
   * Claimed PC tokens cannot be moved/rotated by other non-GM players.
   * Owner and GM may still manipulate them.
   */
  get isLockedByPlayerOwner(): boolean {
    if (!this.playerOwner) return false;
    if (PeerCursor.myCursor?.isGMMode) return false;
    return this.playerOwner !== Network.peer?.userId;
  }

  /**
   * Claim / release as the local player's exclusive PC token (chat + vision + control).
   * Unique: one owner per character; claiming releases this player's previous claim.
   * Returns false if another player already owns it (GM may take over).
   */
  static setAsMyToken(character: GameCharacter, enabled: boolean): boolean {
    const userId = Network.peer?.userId;
    if (!character || !userId) return false;
    if (enabled) {
      const takenByOther = !!character.playerOwner && character.playerOwner !== userId;
      if (takenByOther && !PeerCursor.myCursor?.isGMMode) return false;

      // One claimed character per player.
      for (const ch of ObjectStore.instance.getObjects(GameCharacter)) {
        if (ch === character) continue;
        if (ch.playerOwner === userId) {
          ch.playerOwner = '';
          if (ch.visionOwner === userId) ch.visionOwner = '';
        }
      }
      character.playerOwner = userId;
      character.visionOwner = userId;
      GameCharacter.preferredChatCharacterId = character.identifier;
      return true;
    }

    if (!character.playerOwner) return true;
    if (character.playerOwner !== userId && !PeerCursor.myCursor?.isGMMode) return false;
    const prev = character.playerOwner;
    character.playerOwner = '';
    if (character.visionOwner === prev) character.visionOwner = '';
    if (GameCharacter.preferredChatCharacterId === character.identifier) {
      GameCharacter.preferredChatCharacterId = '';
    }
    return true;
  }

  /** Preferred character for new chat windows (falls back to any of my tokens). */
  static preferredChatCharacter(userId: string = Network.peer?.userId): GameCharacter | null {
    if (!userId) return null;
    const preferredId = GameCharacter.preferredChatCharacterId;
    if (preferredId) {
      const preferred = ObjectStore.instance.get(preferredId);
      if (preferred instanceof GameCharacter && preferred.playerOwner === userId) {
        return preferred;
      }
    }
    for (const ch of ObjectStore.instance.getObjects(GameCharacter)) {
      if (ch.playerOwner === userId) return ch;
    }
    return null;
  }

  /** Whether this character contributes FoW vision for the given peer userId. */
  providesVisionTo(userId: string): boolean {
    if (!userId) return false;
    if (this.playerOwner === userId) return true;
    if (this.visionOwner === userId) return true;
    return GameCharacter.autoVisionUser.get(this.identifier) === userId;
  }

  /** Emitted bright radius in grid squares (clamped ≥ 0). */
  get brightLightGrid(): number {
    return Math.max(0, Number(this.brightLight) || 0);
  }

  /** Emitted dim radius in grid squares (at least bright). */
  get dimLightGrid(): number {
    return Math.max(this.brightLightGrid, Number(this.dimLight) || 0);
  }

  get visionRangeGrid(): number {
    return Math.max(0, Number(this.visionRange) || 0);
  }

  static get isStealthMode(): boolean {
    for (const character of ObjectStore.instance.getObjects(GameCharacter)) {
      if (character.isHideIn && character.isVisible && character.location.name === 'table') return true;
    }
    return false;
  }

  complement(): void {
    let element = this.getElement('altitude', this.commonDataElement);
    if (!element && this.commonDataElement) {
      this.commonDataElement.appendChild(DataElement.create('altitude', 0, {}, 'altitude_' + this.identifier));
    }
    element = this.getElement('height', this.commonDataElement);
    if (!element && this.commonDataElement) {
      this.commonDataElement.insertBefore(DataElement.create('height', 0, { 'currentValue': '' }, 'height_' + this.identifier), this.getElement('altitude', this.commonDataElement));
    }
  }

  createTestGameDataElement(name: string, size: number, imageIdentifier: string) {
    this.createDataElements();

    let nameElement: DataElement = DataElement.create('name', name, {}, 'name_' + this.identifier);
    let sizeElement: DataElement = DataElement.create('size', size, {}, 'size_' + this.identifier);
    let heightElement: DataElement = DataElement.create('height', 0, { 'currentValue': '' }, 'height_' + this.identifier);
    let altitudeElement: DataElement = DataElement.create('altitude', 0, {}, 'altitude_' + this.identifier);

    if (this.imageDataElement.getFirstElementByName('imageIdentifier')) {
      this.imageDataElement.getFirstElementByName('imageIdentifier').value = imageIdentifier;
    }

    let resourceElement: DataElement = DataElement.create(translate('sample.char.resources'), '', {}, '資源' + this.identifier);
    let hpElement: DataElement = DataElement.create('HP', 200, { 'type': 'numberResource', 'currentValue': '200' }, 'HP_' + this.identifier);
    let mpElement: DataElement = DataElement.create('MP', 100, { 'type': 'numberResource', 'currentValue': '100' }, 'MP_' + this.identifier);

    this.commonDataElement.appendChild(nameElement);
    this.commonDataElement.appendChild(sizeElement);
    this.commonDataElement.appendChild(heightElement);
    this.commonDataElement.appendChild(altitudeElement);

    this.detailDataElement.appendChild(resourceElement);
    resourceElement.appendChild(hpElement);
    resourceElement.appendChild(mpElement);

    //TEST
    let testElement: DataElement = DataElement.create(translate('sample.char.info'), '', {}, '情報' + this.identifier);
    this.detailDataElement.appendChild(testElement);
    testElement.appendChild(DataElement.create(translate('sample.char.desc'), translate('sample.char.descValue'), { 'type': 'note' }, '說明' + this.identifier));
    testElement.appendChild(DataElement.create(translate('sample.char.note'), translate('sample.char.noteValue'), { 'type': 'note' }, '筆記' + this.identifier));
    testElement.appendChild(DataElement.create(translate('sample.char.url'), 'https://www.example.com', { 'type': 'url' }, '參考URL' + this.identifier));

    //TEST
    testElement = DataElement.create(translate('sample.char.abilities'), '', {}, '能力' + this.identifier);
    this.detailDataElement.appendChild(testElement);
    testElement.appendChild(DataElement.create(translate('sample.char.dex'), 24, { 'type': 'abilityScore', 'currentValue': 'div6' }, '靈巧' + this.identifier));
    testElement.appendChild(DataElement.create(translate('sample.char.agi'), 24, { 'type': 'abilityScore', 'currentValue': 'div6' }, '敏捷' + this.identifier));
    testElement.appendChild(DataElement.create(translate('sample.char.str'), 24, { 'type': 'abilityScore', 'currentValue': 'div6' }, '筋力' + this.identifier));
    testElement.appendChild(DataElement.create(translate('sample.char.vit'), 24, { 'type': 'abilityScore', 'currentValue': 'div6' }, '生命力' + this.identifier));
    testElement.appendChild(DataElement.create(translate('sample.char.int'), 24, { 'type': 'abilityScore', 'currentValue': 'div6' }, '智力' + this.identifier));
    testElement.appendChild(DataElement.create(translate('sample.char.mnd'), 24, { 'type': 'abilityScore', 'currentValue': 'div6' }, '精神力' + this.identifier));

    //TEST
    testElement = DataElement.create(translate('sample.char.skills'), '', {}, '戰鬥特技' + this.identifier);
    this.detailDataElement.appendChild(testElement);
    testElement.appendChild(DataElement.create('Lv1', translate('sample.char.skill1'), {}, 'Lv1' + this.identifier));
    testElement.appendChild(DataElement.create('Lv3', translate('sample.char.skill3'), {}, 'Lv3' + this.identifier));
    testElement.appendChild(DataElement.create('Lv5', translate('sample.char.skill5'), {}, 'Lv5' + this.identifier));
    testElement.appendChild(DataElement.create('Lv7', translate('sample.char.skill7'), {}, 'Lv7' + this.identifier));
    testElement.appendChild(DataElement.create('Lv9', translate('sample.char.skill9'), {}, 'Lv9' + this.identifier));
    testElement.appendChild(DataElement.create(translate('sample.char.auto'), translate('sample.char.skillAuto'), {}, '自動' + this.identifier));

    let domParser: DOMParser = new DOMParser();
    let gameCharacterXMLDocument: Document = domParser.parseFromString(this.rootDataElement.toXml(), 'application/xml');

    let palette: ChatPalette = new ChatPalette('ChatPalette_' + this.identifier);
    palette.setPalette(translate('sample.char.palette'));
    palette.initialize();
    this.appendChild(palette);

    let standList = new StandList('StandList_' + this.identifier);
    standList.initialize();
    this.appendChild(standList);
  }
}
