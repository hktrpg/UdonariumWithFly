import { animate, keyframes, style, transition, trigger } from '@angular/animations';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  Input,
  NgZone,
  ViewChild, ElementRef, AfterViewInit,
  OnChanges,
  OnDestroy
} from '@angular/core';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { EventSystem, Network } from '@udonarium/core/system';
import { MathUtil } from '@udonarium/core/system/util/math-util';
import { GameCharacter } from '@udonarium/game-character';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { ChatPaletteComponent } from 'component/chat-palette/chat-palette.component';
import { CharacterSettingsComponent } from 'component/character-settings/character-settings.component';
import { MovableOption } from 'directive/movable.directive';
import { RotableOption } from 'directive/rotable.directive';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService, contextMenuToggleCheck } from 'service/context-menu.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { PeerCursor } from '@udonarium/peer-cursor';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { ModalService } from 'service/modal.service';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { StandSettingComponent } from 'component/stand-setting/stand-setting.component';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { TableSelecter } from '@udonarium/table-selecter';
import { CharacterFxMenuService } from 'service/character-fx-menu.service';
import { CharacterStatusId, getStatusDef } from '@udonarium/table-fx/character-status';
import { buildMatrixRainColumns, imageEffectFilter, imageEffectOpacity, imageEffectTransform, MatrixRainColumn } from '@udonarium/table-fx/image-effect';
import { I18nService } from 'service/i18n.service';

@Component({
    selector: 'game-character',
    templateUrl: './game-character.component.html',
    styleUrls: ['./game-character.component.css', '../shared/image-effects.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    animations: [
        trigger('switchImage', [
            transition(':increment, :decrement', [
                animate('400ms ease', keyframes([
                    style({ transform: 'scale3d(0.8, 0.8, 0.8) rotateY(0deg)' }),
                    style({ transform: 'scale3d(1.2, 1.2, 1.2) rotateY(180deg)' }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0) rotateY(360deg)' })
                ]))
            ])
        ]),
        trigger('switchImageShadow', [
            transition(':increment, :decrement', [
                animate('400ms ease', keyframes([
                    style({ transform: 'scale3d(0.8, 0.8, 0.8)' }),
                    style({ transform: 'scale3d(0, 1.2, 1.2)' }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0)' })
                ]))
            ])
        ]),
        trigger('switchImagePedestal', [
            transition(':increment, :decrement', [
                animate('400ms ease', keyframes([
                    style({ transform: 'scale3d(0, 0, 0)' }),
                    style({ transform: 'scale3d(1.2, 1.2, 1.2)' }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0)' })
                ]))
            ])
        ]),
        trigger('bounceInOut', [
            transition('void => *', [
                animate('600ms ease', keyframes([
                    style({ transform: 'scale3d(0, 0, 0)', offset: 0 }),
                    style({ transform: 'scale3d(1.5, 1.5, 1.5)', offset: 0.5 }),
                    style({ transform: 'scale3d(0.75, 0.75, 0.75)', offset: 0.75 }),
                    style({ transform: 'scale3d(1.125, 1.125, 1.125)', offset: 0.875 }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0)', offset: 1.0 })
                ]))
            ]),
            transition('* => void', [
                animate(100, style({ transform: 'scale3d(0, 0, 0)' }))
            ])
        ]),
        trigger('fadeAndScaleInOut', [
            transition('void => *, true => false', [
                animate('200ms ease-in-out', keyframes([
                    style({ transform: 'scale3d(0, 0, 0)', opacity: 0 }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0)', opacity: 0.8 }),
                ]))
            ]),
            transition('* => void, true => false', [
                animate('100ms ease-in-out', style({ transform: 'scale3d(0, 0, 0)', opacity: 0 }))
            ])
        ])
    ],
    standalone: false
})
export class GameCharacterComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() gameCharacter: GameCharacter = null;
  @Input() is3D: boolean = false;

  get name(): string { return this.gameCharacter.name; }
  get size(): number { return MathUtil.clampMin(this.gameCharacter.size); }
  get altitude(): number { return this.gameCharacter.altitude; }
  set altitude(altitude: number) { this.gameCharacter.altitude = altitude; }
  get height(): number { return MathUtil.clampMin(this.gameCharacter.height); }
  /** Room 2D mode: face-up token centered on the pedestal (top-down). */
  get is2DMode(): boolean { return !!TableSelecter.instance?.viewTable?.is2DMode; }
  get uprightTransform(): string {
    if (this.is2DMode) {
      // Face parallel to the table, slight Z lift above pedestal/grid.
      // Do not use note tip-over (hinge at bottom) — that parks tall art above the base.
      return `translateZ(${this.altitude * this.gridSize + 1}px)`;
    }
    const alt = (-this.altitude) * this.gridSize;
    return `rotateY(90deg) rotateZ(-90deg) rotateY(-90deg) translateY(-50%) translateY(${alt}px)`;
  }

  
  get imageFile(): ImageFile { return this.gameCharacter.imageFile; }
  get rotate(): number { return this.gameCharacter.rotate; }
  set rotate(rotate: number) { this.gameCharacter.rotate = rotate; }
  /** 2D mode: roll SyncVar is forced to 0 (no tip/tilt). */
  get roll(): number { return this.is2DMode ? 0 : this.gameCharacter.roll; }
  set roll(roll: number) {
    if (this.is2DMode) {
      if (this.gameCharacter.roll !== 0) this.gameCharacter.roll = 0;
      return;
    }
    this.gameCharacter.roll = roll;
  }
  get isRollLocked(): boolean { return this.is2DMode || this.isMoveLocked; }

  /** Write stored roll → 0 while room is in 2D (covers tokens that already had a non-zero tip). */
  private enforce2DRollZero() {
    if (!this.is2DMode || !this.gameCharacter) return;
    if (this.gameCharacter.roll !== 0) this.gameCharacter.roll = 0;
  }
  get isDropShadow(): boolean { return this.gameCharacter.isDropShadow; }
  set isDropShadow(isDropShadow: boolean) { this.gameCharacter.isDropShadow = isDropShadow; }
  get isAltitudeIndicate(): boolean { return this.gameCharacter.isAltitudeIndicate; }
  set isAltitudeIndicate(isAltitudeIndicate: boolean) { this.gameCharacter.isAltitudeIndicate = isAltitudeIndicate; }
  get isInverse(): boolean { return this.gameCharacter.isInverse; }
  set isInverse(isInverse: boolean) { this.gameCharacter.isInverse = isInverse; }
  get isHollow(): boolean { return this.gameCharacter.isHollow; }
  set isHollow(isHollow: boolean) { this.gameCharacter.isHollow = isHollow; }
  get isBlackPaint(): boolean { return this.gameCharacter.isBlackPaint; }
  set isBlackPaint(isBlackPaint: boolean) { this.gameCharacter.isBlackPaint = isBlackPaint; }

  private imageEffectSource() {
    return {
      isInverse: this.gameCharacter.isInverse,
      isHollow: this.gameCharacter.isHollow,
      isBlackPaint: this.gameCharacter.isBlackPaint,
      isGrayscale: this.gameCharacter.isGrayscale,
      isSepia: this.gameCharacter.isSepia,
      isWhitePaint: this.gameCharacter.isWhitePaint,
      isMatrix: this.gameCharacter.isMatrix,
      isFlipVertical: this.gameCharacter.isFlipVertical,
      isContrast: this.gameCharacter.isContrast,
      isDead: this.hasDeadStatus,
    };
  }
  get imageEffectFilter(): string | null { return imageEffectFilter(this.imageEffectSource()); }
  get imageEffectTransform(): string | null { return imageEffectTransform(this.imageEffectSource()); }
  get imageEffectOpacity(): number | null { return imageEffectOpacity(this.imageEffectSource()); }

  private _matrixRainCacheKey = '';
  private _matrixRainColumns: MatrixRainColumn[] = [];
  get matrixRainColumns(): MatrixRainColumn[] {
    if (!this.gameCharacter?.isMatrix) return [];
    const w = this.characterImageWidth || this.size * this.gridSize;
    const count = Math.max(4, Math.min(16, Math.round(w / 9)));
    const key = `${this.gameCharacter.identifier}:${count}`;
    if (key !== this._matrixRainCacheKey) {
      this._matrixRainCacheKey = key;
      this._matrixRainColumns = buildMatrixRainColumns(key, count);
    }
    return this._matrixRainColumns;
  }
  trackByMatrixCol = (_: number, col: MatrixRainColumn) => `${col.duration}:${col.delay}:${col.text.length}`;

  get aura(): number { return this.gameCharacter.aura; }
  set aura(aura: number) { this.gameCharacter.aura = aura; }
  get floorRing(): string { return this.gameCharacter.floorRing || 'none'; }
  get floorRingUrl(): string { return this.characterFxMenu.ringAsset(this.floorRing); }
  get floorRingSpeed(): number { return this.gameCharacter.floorRingSpeed || 1; }
  get floorRingColor(): string { return this.gameCharacter.floorRingColor || ''; }
  get statusEntries() { return this.characterFxMenu.statusesOf(this.gameCharacter); }
  /** Cap name-tag / status icon strip to roughly the token footprint. */
  get nameTagMaxWidth(): number { return Math.max(72, this.size * this.gridSize); }
  get hasInvisibleStatus(): boolean { return this.statusEntries.some(s => s.id === 'invisible'); }
  get hasDeadStatus(): boolean { return this.statusEntries.some(s => s.id === 'dead'); }
  statusIcon(id: string): string { return getStatusDef(id as any)?.icon || 'info'; }
  statusName(id: string): string {
    const name = this.i18n.t(`fx.status.${id}`);
    const entry = this.statusEntries.find(s => s.id === id);
    return entry?.level ? `${name} ${entry.level}` : name;
  }

  /** Right-click a head status badge to clear it without opening the token menu. */
  onStatusBadgeContextMenu(e: Event, id: CharacterStatusId) {
    e.stopPropagation();
    e.preventDefault();
    if (this.GuestMode()) return;
    this.characterFxMenu.clearStatus(this.gameCharacter, id);
    this.changeDetector.markForCheck();
  }

  get isNotRide(): boolean { return this.gameCharacter.isNotRide; }
  set isNotRide(isNotRide: boolean) { this.gameCharacter.isNotRide = isNotRide; }
  get isUseIconToOverviewImage(): boolean { return this.gameCharacter.isUseIconToOverviewImage; }
  set isUseIconToOverviewImage(isUseIconToOverviewImage: boolean) { this.gameCharacter.isUseIconToOverviewImage = isUseIconToOverviewImage; }

  hasOverviewFaceIcon(): boolean {
    return !!(this.faceIcon && 0 < this.faceIcon.url.length);
  }

  get ownerName(): string { return this.gameCharacter.ownerName; }
  get ownerColor(): string { return this.gameCharacter.ownerColor; }
  get isHideIn(): boolean { return !!this.gameCharacter.owner; }
  get isVisible(): boolean { return this.gameCharacter.isVisible; }
  get isGMMode(): boolean{ return PeerCursor.myCursor ? PeerCursor.myCursor.isGMMode : false; }
  /** Other players cannot drag a token claimed as someone's PC. */
  get isMoveLocked(): boolean { return this.gameCharacter.isLockedByPlayerOwner; }

  get faceIcon(): ImageFile { return this.gameCharacter.faceIcon; }
  
  get dialogFaceIcon(): ImageFile {
    if (!this.dialog || !this.dialog.faceIconIdentifier) return null;
    return ImageStorage.instance.get(<string>this.dialog.faceIconIdentifier);
  }

  get shadowImageFile(): ImageFile { return this.gameCharacter.shadowImageFile; }

  get elevation(): number {
    return +((this.gameCharacter.posZ + (this.altitude * this.gridSize)) / this.gridSize).toFixed(1);
  }

  get selectionState(): SelectionState { return this.selectionService.state(this.gameCharacter); }
  get isSelected(): boolean { return this.selectionState !== SelectionState.NONE; }
  get isMagnetic(): boolean { return this.selectionState === SelectionState.MAGNETIC; }

  gridSize: number = 50;
  math = Math;
  stringUtil = StringUtil;
  viewRotateX = 50;
  viewRotateZ = 10;
  heightWidthRatio = 1.5;

  set dialog(dialog) {
    if (!dialog || !dialog.text) return;
    // Guests may view speech balloons; only block when this peer cannot see the token.
    if (!this.gameCharacter) return;
    if (!this.gameCharacter.isVisible && !this.isGMMode) return;
    clearTimeout(this.dialogTimeOutId);
    clearInterval(this.chatIntervalId);
    let text = StringUtil.cr(dialog.text);
    const isEmote = StringUtil.isEmote(text);
    const rubys = [];
    const re = /[\|｜]([^\|｜\s]+?)《(.+?)》/g;
    let ary;
    let count = 0;
    let rubyLength = 0;

    if (!isEmote) {
      text = text.replace(/[。、]{3}/g, '…').replace(/[。、]{2}/g, '‥').replace(/(。|[\r\n]{2,})/g, "$1                            ").trimEnd(); // 在換行或句號後留時間的 dirty hack
      while ((ary = re.exec(text)) !== null) {
        let offset = ary.index - (count * 3);
        rubys.push({base: ary[1], ruby: ary[2], start: offset - rubyLength, end: offset + ary[1].length - rubyLength - 1});
        count++;
        rubyLength += ary[2].length;
      }
    }

    let speechDelay = 1000 / Array.from(text).length > 36 ? 1000 / Array.from(text).length : 36;
    if (speechDelay > 200) speechDelay = 200;
    this.dialogTimeOutId = setTimeout(() => {
      const stamp = dialog.stamp || this.lastChatDialogStamp;
      this.clearChatDialogLocal();
      if (stamp && this.gameCharacter.chatDialogStamp === stamp) {
        this.gameCharacter.clearChatDialog();
      }
      this.changeDetector.markForCheck();
    }, Array.from(text).length * speechDelay + 6000);

    this.gameCharacter.dialog = dialog;
    this.gameCharacter.isEmote = isEmote;
    count = 0;
    let countLength = 0;
    let rubyCount = 0;
    let tmpText = '';
    let carrentRuby = rubys.shift();
    let rubyText = '';
    let isOpenRuby = false;
    if (isEmote) {
      this.gameCharacter.text = text;
      this.changeDetector.markForCheck();
    }  else {
      const charAry = Array.from(text.replace(/[\|｜]([^\|｜\s]+?)《.+?》/g, '$1'));
      this.chatIntervalId = setInterval(() => {
        let c = charAry[count];
        let isMulti = c.length > 1;
        if (c) {
            if (!isOpenRuby && carrentRuby && countLength >= carrentRuby.start) {
                tmpText += '<ruby>';
                isOpenRuby = true;
                rubyCount = 0;
            }
            tmpText += StringUtil.escapeHtml(c);
            if (isOpenRuby) {
                rubyCount += 1;
                let rt = carrentRuby.ruby;
                rubyText = '<rt>' + StringUtil.escapeHtml(Array.from(rt).slice(0, Math.ceil(Array.from(rt).length * (rubyCount / Array.from(carrentRuby.base).length))).join('')) + '</rt>'
            }
            if (isOpenRuby && carrentRuby && countLength >= carrentRuby.end - (isMulti ? 1 : 0)) {
                tmpText += (rubyText + '</ruby>');
                isOpenRuby = false;
                carrentRuby = rubys.shift(); 
            }
            countLength += c.length;
        }
        count += 1;
        this.gameCharacter.text = tmpText + (isOpenRuby ? (rubyText + '</ruby>') : '');
        this.changeDetector.markForCheck();
        if (count >= charAry.length) {
          clearInterval(this.chatIntervalId);
        }
      }, speechDelay);
    }
  }

  get dialogText(): string {
    if (!this.gameCharacter || !this.gameCharacter.text) return '';
    const ary = this.gameCharacter.text.replace(/。/g, "。\n\n").split(/[\r\n]{2,}/g).filter(str => str.trim());
    return ary.length > 0 ? ary.reverse()[0].trim() : '';
  }
  
  get isRubied(): boolean {
    if (!this.gameCharacter || !this.gameCharacter.text) return false;
    return -1 < this.dialogText.indexOf('<ruby>');
  }

  get dialogChatBubbleMinWidth(): number {
    const max = this.characterImageWidth + 2.1 * this.gridSize;
    const existIcon = this.isUseFaceIcon && this.dialogFaceIcon && this.dialogFaceIcon.url;
    const dynamic = Array.from(this.dialogText).length * 11 + 52 + (existIcon ? 32 : 0);
    return max < dynamic ? max : dynamic; 
  }

  get dialog() {
    return this.gameCharacter.dialog;
  }

  selected = false;
  private dialogTimeOutId = null;
  private chatIntervalId = null;
  private lastChatDialogStamp = 0;

  get chatBubbleXDeg(): number {
    //console.log(this.viewRotateX)
    let ret = 90 - this.viewRotateX;
    if (ret < 0) ret = 360 + ret;
    ret = ret % 360;
    if (ret > 180) ret = -(180 - (ret - 180));
    //console.log(ret)
    // 補正
    if (ret > 90) ret = 90;
    if (ret < -90) ret = -90;
    return ret / 1.5;
  }

  @ViewChild('characterImage') characterImage: ElementRef;
  //@ViewChild('characterShadowImage') characterShadowImage: ElementRef;
  @ViewChild('chatBubble') chatBubble: ElementRef;

  //height = 0;
  naturalImageWidth = 0;
  naturalImageHeight = 0
  naturaHeightWidthRatio = 1;

  get characterImageHeight(): number {
    if (!this.characterImage || !this.naturalImageHeight) return 0;
    if (this.height > 0) return this.gridSize * this.height;
    let ratio = this.naturaHeightWidthRatio;
    if (ratio > this.heightWidthRatio) ratio = this.heightWidthRatio;
    return ratio * this.gridSize * this.size;
  }

  get characterImageWidth(): number {
    if (!this.characterImage || !this.naturalImageWidth) return 0;
    if (this.height <= 0) return this.gridSize * this.size;
    let ratio = this.naturaHeightWidthRatio;
    if (ratio > this.heightWidthRatio) ratio = this.heightWidthRatio;
    return this.gridSize * this.height / ratio;
  }

  /** Ground-shadow shrink/fade factor from altitude (1 on ground, smaller when flying). */
  get shadowAltitudeFactor(): number {
    return Math.max(0.35, 1 / (1 + Math.max(0, this.altitude) * 0.45));
  }

  get characterShadowImageHeight(): number {
    // Follow token image height (size / height), then shrink with altitude.
    return this.characterImageHeight * this.shadowAltitudeFactor;
  }

  get characterShadowImageWidth(): number {
    // Follow token image width (size / height), then shrink with altitude.
    return this.characterImageWidth * this.shadowAltitudeFactor;
  }

  get characterShadowOffset(): number {
    // With Fly: pin near pedestal with *0.99 so the flattened silhouette falls
    // behind the upright art — not centered on the token base.
    let offset = 0;
    if (0.2 < this.height && this.height <= 0.3) {
      offset = 0.09;
    } else if (0.1 < this.height && this.height <= 0.2) {
      offset = 0.19;
    } else if (0 < this.height && this.height <= 0.1) {
      offset = 0.29;
    }
    return (this.gridSize * this.size / 2) - (this.characterShadowImageHeight * 0.99) - (this.gridSize * offset);
  }

  get shadowOpacity(): number {
    const base = (this.isHollow ? 0.5 : 0.7) * (this.isHideIn ? 0.85 : 1);
    return base * Math.max(0.3, 1 / (1 + Math.max(0, this.altitude) * 0.35));
  }

  get shadowBlurPx(): number {
    return 1 + Math.max(0, this.altitude) * 0.6;
  }

  get shadowTranslateX(): number {
    return (this.gridSize * this.size - this.characterShadowImageWidth) / 2;
  }

  get chatBubbleAltitude(): number {
    let cos =  Math.cos(this.roll * Math.PI / 180);
    let sin = Math.abs(Math.sin(this.roll * Math.PI / 180));
    if (cos < 0.5) cos = 0.5;
    if (sin < 0.5) sin = 0.5;
    const altitude1 = (this.characterImageHeight + (this.name != '' ? 24 : 0)) * cos + 4;
    const altitude2 = (this.characterImageWidth / 2) * sin + 4 + this.characterImageWidth / 2;
    let ret = altitude1 > altitude2 ? altitude1 : altitude2;
    this.gameCharacter.chatBubbleAltitude = ret;
    return ret;
  }

  get elevationUnrerZeroIndicatorY(): number {
    let ret = Math.max(this.characterImageWidth, this.chatBubbleAltitude) + 4;
    if (Math.abs(this.altitude * this.gridSize) < ret) {
      return -this.altitude * this.gridSize - 4;
    }
    return ret;
  }

  /*
  // 自原始高度扣除的值
  get nameplateOffset(): number {
    return 0;
    if (!this.characterImage) return this.gridSize * this.size * this.heightWidthRatio;
    return this.gridSize * this.size * this.heightWidthRatio - this.characterImageHeight;
  }
  */
  get nameTagRotate(): number {
    let x = (this.viewRotateX % 360) - 90;
    let z = (this.viewRotateZ + this.rotate) % 360;
    let roll = this.roll % 360;
    z = (z > 0 ? z : 360 + z);
    roll = (roll > 0 ? roll : 360 + roll);
    return (x > 0 ? x : 360 + x) * (90 < z && z < 270 ? 1 : -1) * (90 <= roll && roll <= 270 ? -1 : 1);
  }

  get isListen(): boolean {
    return (this.dialog && this.dialog.text && !this.dialog.dialogTest && this.dialog.text.trim().length > 0);
  }

  get isWhisper(): boolean {
    return this.dialog && this.dialog.secret;
  }

  get isEmote(): boolean {
    return this.gameCharacter.isEmote;
    //return this.dialog && StringUtil.isEmote(this.dialog.text);
  }

  get isUseFaceIcon(): ImageFile {
    return this.dialog && this.dialog.faceIconIdentifier;
  }

  get dialogColor(): string {
    return (this.dialog && this.dialog.color) ? this.dialog.color : PeerCursor.CHAT_DEFAULT_COLOR;
  }

  movableOption: MovableOption = {};
  rotableOption: RotableOption = {};
  rollOption: RotableOption = {};

  constructor(
    private contextMenuService: ContextMenuService,
    private panelService: PanelService,
    private changeDetector: ChangeDetectorRef,
    private pointerDeviceService: PointerDeviceService,
    private ngZone: NgZone,
    private modalService: ModalService,
    private selectionService: TabletopSelectionService,
    private characterFxMenu: CharacterFxMenuService,
    private i18n: I18nService,
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }

  private applySyncedChatDialog() {
    if (!this.gameCharacter) return;
    const stamp = this.gameCharacter.chatDialogStamp || 0;
    if (!stamp) {
      if (this.lastChatDialogStamp) this.clearChatDialogLocal();
      return;
    }
    if (stamp === this.lastChatDialogStamp) return;
    this.applyChatDialogPayload({
      characterIdentifier: this.gameCharacter.identifier,
      text: this.gameCharacter.chatDialogText,
      color: this.gameCharacter.chatDialogColor,
      faceIconIdentifier: this.gameCharacter.chatDialogFaceIconIdentifier || null,
      secret: false,
      stamp,
      isEmote: this.gameCharacter.chatDialogIsEmote,
    });
  }

  private applyChatDialogPayload(data: any) {
    if (!data || !data.text) return;
    const stamp = data.stamp || 0;
    if (stamp && stamp === this.lastChatDialogStamp) return;
    if (stamp) this.lastChatDialogStamp = stamp;
    this.dialog = data;
  }

  private clearChatDialogLocal() {
    this.lastChatDialogStamp = 0;
    this.gameCharacter.dialog = null;
    this.gameCharacter.text = '';
    this.gameCharacter.isEmote = false;
    clearTimeout(this.dialogTimeOutId);
    clearInterval(this.chatIntervalId);
  }

  
  /*
  ngOnInit() {
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', event => {
        let object = ObjectStore.instance.get(event.data.identifier);
        if (!this.gameCharacter || !object) return;
        if (this.gameCharacter === object || (object instanceof ObjectNode && this.gameCharacter.contains(object))) {
          if (this.gameCharacter.imageFiles.length <= 0) {
            this.naturalImageHeight = 0;
            this.naturalImageWidth = 0;
            this.naturaHeightWidthRatio = 1;
          }
          this.changeDetector.markForCheck();
        }
    private selectionService: TabletopSelectionService,
    private pointerDeviceService: PointerDeviceService
  ) { }
*/
  ngOnChanges(): void {
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on(`UPDATE_GAME_OBJECT/identifier/${this.gameCharacter?.identifier}`, event => {
        if (this.gameCharacter.imageFiles.length <= 0) {
          this.naturalImageHeight = 0;
          this.naturalImageWidth = 0;
          this.naturaHeightWidthRatio = 1;
        }
        this.applySyncedChatDialog();
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        const tableId = TableSelecter.instance?.viewTable?.identifier;
        if (tableId && event.data?.identifier === tableId) {
          this.enforce2DRollZero();
          this.changeDetector.markForCheck();
        }
      })
      .on(`UPDATE_OBJECT_CHILDREN/identifier/${this.gameCharacter?.identifier}`, event => {
        if (this.gameCharacter.imageFiles.length <= 0) {
          this.naturalImageHeight = 0;
          this.naturalImageWidth = 0;
          this.naturaHeightWidthRatio = 1;
        }
        this.changeDetector.markForCheck();
      })
      .on('SYNCHRONIZE_FILE_LIST', event => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_FILE_RESOURE', event => {
        this.changeDetector.markForCheck();
      })
      .on<object>('TABLE_VIEW_ROTATE', -1000, event => {
        this.ngZone.run(() => {
          this.viewRotateX = event.data['x'];
          this.viewRotateZ = event.data['z'];
          this.changeDetector.markForCheck();
        });
      })
      .on<object>('SELECT_TABLETOP_OBJECT', -1000, event => {
        // 暫且如此
        this.ngZone.run(() => {
          if (event.data['highlighting'] && event.data['identifier'] === this.gameCharacter.identifier) {
            this.selected = true;
          } else {
            this.selected = false;
          }
          this.changeDetector.markForCheck();
        });
      })
      .on('CHANGE_GM_MODE', event => {
        this.changeDetector.markForCheck();
      })
      .on('POPUP_CHAT_BALLOON', -1000, event => {
        if (this.gameCharacter && this.gameCharacter.identifier == event.data.characterIdentifier) {
          this.ngZone.run(() => {
            this.applyChatDialogPayload(event.data);
            this.changeDetector.markForCheck();
          });
        }
      })
      .on('FAREWELL_CHAT_BALLOON', -1000, event => {
        if (this.gameCharacter && this.gameCharacter.identifier == event.data.characterIdentifier) {
          this.ngZone.run(() => {
            this.clearChatDialogLocal();
            this.changeDetector.markForCheck();
          });
        }
      })
      .on(`UPDATE_SELECTION/identifier/${this.gameCharacter?.identifier}`, event => {
        this.changeDetector.markForCheck();
      });
    this.applySyncedChatDialog();
    this.enforce2DRollZero();
    this.movableOption = {
      tabletopObject: this.gameCharacter,
      transformCssOffset: 'translateZ(1.0px)',
      colideLayers: ['terrain', 'text-note', 'character']
    };
    this.rotableOption = {
      tabletopObject: this.gameCharacter
    };
    this.rollOption = {
      tabletopObject: this.gameCharacter,
      targetPropertyName: 'roll',
    };
  }

  ngAfterViewInit() {
    queueMicrotask(() => {
      this.gameCharacter.isLoaded = true;
    });
  }

  ngOnDestroy() {
    this.clearChatDialogLocal();
    EventSystem.unregister(this);
  }

  @HostListener('dragstart', ['$event'])
  onDragstart(e: any) {
    console.log('Dragstart Cancel !!!!');
    e.stopPropagation();
    e.preventDefault();
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(e: Event) {
    e.stopPropagation();
    e.preventDefault();

    if (this.GuestMode()) return;
    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;

    let position = this.pointerDeviceService.pointers[0];
    let menuActions: ContextMenuAction[] = [];
    let title = this.name;

    if (this.isMultiSelectedCharacters()) {
      menuActions = this.makeMultiSelectionContextMenu();
      title = this.i18n.t('char.selectedCount', { count: this.selectedCharacters().length });
    } else {
      menuActions = menuActions.concat(this.makeSelectionContextMenu());
      menuActions = menuActions.concat(this.makeContextMenu());
    }
    this.contextMenuService.open(position, menuActions, title);
  }

  onMove() {
    this.contextMenuService.close();
    if (!this.isHideIn) SoundEffect.play(PresetSound.piecePick);
  }

  onMoved() {
    // 暫且：移動後清除 💭
    if (this.gameCharacter && this.gameCharacter.text) {
      EventSystem.call('FAREWELL_CHAT_BALLOON', { characterIdentifier: this.gameCharacter.identifier });
    }
    if (!this.isHideIn) SoundEffect.play(PresetSound.piecePut);
    this.selected = false;
  }

  onImageLoad() {
    this.naturalImageWidth = this.characterImage.nativeElement.naturalWidth;
    this.naturalImageHeight = this.characterImage.nativeElement.naturalHeight;
    this.naturaHeightWidthRatio =  (this.naturalImageWidth && this.naturalImageHeight) ? (this.naturalImageHeight / this.naturalImageWidth) : 1;
    //EventSystem.trigger('UPDATE_GAME_OBJECT', this.gameCharacter);
  }

  private selectedCharacters(): GameCharacter[] {
    return this.selectionService.objects.filter(
      object => object.aliasName === this.gameCharacter.aliasName
    ) as GameCharacter[];
  }

  private isMultiSelectedCharacters(): boolean {
    return this.isSelected && this.selectedCharacters().length > 1;
  }

  private moveCharacterOffTable(gameCharacter: GameCharacter, location: string) {
    EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameCharacter.identifier });
    this.selectionService.remove(gameCharacter);
    if (location === 'graveyard' && gameCharacter.isTemporaryCopy) {
      gameCharacter.destroy();
      return;
    }
    if (location === 'table') {
      gameCharacter.setLocation('table');
    } else {
      // Per-map: keep placements on other maps.
      gameCharacter.leaveCurrentTable(location);
    }
  }

  /** Congregate only — used when not in multi-character mode (e.g. gather selection to an unselected token). */
  private makeSelectionContextMenu(): ContextMenuAction[] {
    if (this.selectionService.size <= 1) return [];

    let objectPosition = {
      x: this.gameCharacter.location.x + (this.gameCharacter.size * this.gridSize) / 2,
      y: this.gameCharacter.location.y + (this.gameCharacter.size * this.gridSize) / 2,
      z: this.gameCharacter.posZ
    };
    return [
      { name: this.i18n.t('char.congregate'), hotkey: 'T', action: () => this.selectionService.congregate(objectPosition) },
      ContextMenuSeparator,
    ];
  }

  /** Right-click menu when 2+ selected characters include this token. */
  private makeMultiSelectionContextMenu(): ContextMenuAction[] {
    const selectedCharacter = () => this.selectedCharacters();
    let objectPosition = {
      x: this.gameCharacter.location.x + (this.gameCharacter.size * this.gridSize) / 2,
      y: this.gameCharacter.location.y + (this.gameCharacter.size * this.gridSize) / 2,
      z: this.gameCharacter.posZ
    };

    return [
      { name: this.i18n.t('char.congregate'), hotkey: 'T', action: () => this.selectionService.congregate(objectPosition) },
      ContextMenuSeparator,
      this.characterFxMenu.makeCombatMenu(this.gameCharacter),
      ContextMenuSeparator,
      {
        name: this.i18n.t('char.moveTo'),
        action: null,
        subActions: [
          {
            name: this.i18n.t('char.moveAllToCommon'),
            action: () => {
              selectedCharacter().forEach(ch => this.moveCharacterOffTable(ch, 'common'));
              SoundEffect.play(PresetSound.piecePut);
            }
          },
          {
            name: this.i18n.t('char.moveAllToPersonal'),
            action: () => {
              selectedCharacter().forEach(ch => this.moveCharacterOffTable(ch, Network.peerId));
              SoundEffect.play(PresetSound.piecePut);
            }
          },
          {
            name: this.i18n.t('char.moveAllToGraveyard'),
            action: () => {
              selectedCharacter().forEach(ch => this.moveCharacterOffTable(ch, 'graveyard'));
              SoundEffect.play(PresetSound.sweep);
            }
          },
        ]
      },
      {
        name: this.i18n.t('char.inventoryAllOn'),
        action: () => {
          selectedCharacter().forEach(ch => { ch.isInventoryIndicate = true; });
          EventSystem.trigger('UPDATE_INVENTORY', null);
        }
      },
      {
        name: this.i18n.t('char.inventoryAllOff'),
        action: () => {
          selectedCharacter().forEach(ch => { ch.isInventoryIndicate = false; });
          EventSystem.trigger('UPDATE_INVENTORY', null);
        }
      },
      {
        name: this.i18n.t('char.resetAltitudeAll'),
        action: () => {
          selectedCharacter().forEach(ch => { ch.altitude = 0; });
          SoundEffect.play(PresetSound.sweep);
        }
      },
      ContextMenuSeparator,
      {
        name: this.i18n.t('char.cloneAll'),
        action: () => {
          selectedCharacter().forEach(ch => {
            const cloneObject = ch.clone();
            cloneObject.location.x += this.gridSize;
            cloneObject.location.y += this.gridSize;
            cloneObject.update();
          });
          SoundEffect.play(PresetSound.piecePut);
        }
      },
      {
        name: this.i18n.t('char.deleteAllToGraveyard'),
        hotkey: 'Del',
        action: () => {
          selectedCharacter().forEach(ch => this.moveCharacterOffTable(ch, 'graveyard'));
          SoundEffect.play(PresetSound.sweep);
        }
      },
      ContextMenuSeparator,
      {
        name: this.i18n.t('char.clearSelection'),
        action: () => this.selectionService.clear()
      },
    ];
  }

  private makeContextMenu(): ContextMenuAction[] {
    const after = () => EventSystem.trigger('UPDATE_INVENTORY', null);
    const hasMultiImage = this.gameCharacter.imageFiles.length > 1;
    const hasFace = this.hasOverviewFaceIcon();
    if (!hasFace && this.isUseIconToOverviewImage) this.isUseIconToOverviewImage = false;

    return this.joinContextMenuGroups([
      // Identity / claim
      [
        {
          name: this.isHideIn ? this.i18n.t('char.revealPosition') : this.i18n.t('char.selfOnlyStealth'),
          hotkey: 'H',
          action: () => {
            if (this.isHideIn) {
              this.gameCharacter.owner = '';
              SoundEffect.play(PresetSound.piecePut);
            } else {
              if (!GameCharacter.isStealthMode && !PeerCursor.myCursor.isGMMode) {
                this.modalService.open(ConfirmationComponent, {
                  title: this.i18n.t('char.stealthTitle'),
                  text: this.i18n.t('char.stealthText'),
                  help: this.i18n.t('char.stealthHelp'),
                  type: ConfirmationType.OK,
                  materialIcon: 'disabled_visible'
                });
              }
              this.gameCharacter.owner = Network.peer.userId;
              if (!this.gameCharacter.visionOwner) {
                this.gameCharacter.visionOwner = Network.peer.userId;
              }
              SoundEffect.play(PresetSound.sweep);
              EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: this.gameCharacter.identifier });
            }
            EventSystem.call('UPDATE_INVENTORY', true);
          },
        },
        this.characterFxMenu.makeMyTokenMenu(this.gameCharacter),
        this.characterFxMenu.makeCombatMenu(this.gameCharacter),
      ],
      // Image / appearance
      [
        hasMultiImage ? {
          name: this.i18n.t('char.imageSwitch'),
          action: null,
          subActions: this.gameCharacter.imageFiles.map((image, i) => ({
            name: `${this.gameCharacter.currntImageIndex == i ? '◉' : '○'}`,
            action: () => { this.changeImage(i); },
            default: this.gameCharacter.currntImageIndex == i,
            icon: image,
            checkBox: 'radio' as const
          }))
        } : null,
        {
          name: this.i18n.t('char.nextImage'),
          action: () => { this.nextImage(); },
          disabled: !hasMultiImage
        },
        contextMenuToggleCheck({
          get: () => hasFace && this.isUseIconToOverviewImage,
          set: (v) => {
            if (!this.hasOverviewFaceIcon()) return;
            this.isUseIconToOverviewImage = v;
          },
          on: this.i18n.t('char.overviewFaceOn'),
          off: this.i18n.t('char.overviewFaceOff'),
          after,
          disabled: !hasFace,
          error: hasFace ? null : this.i18n.t('char.overviewFaceRequired'),
        }),
        contextMenuToggleCheck({
          get: () => this.isDropShadow,
          set: (v) => { this.isDropShadow = v; },
          on: this.i18n.t('char.shadowOn'),
          off: this.i18n.t('char.shadowOff'),
          after,
        }),
        this.characterFxMenu.makeImageEffectMenu(this.gameCharacter),
      ],
      // FX / lighting / status
      [
        this.characterFxMenu.makeAuraMenu(this.gameCharacter),
        this.characterFxMenu.makeRingMenu(this.gameCharacter),
        this.characterFxMenu.makeVisionMenu(this.gameCharacter),
        this.characterFxMenu.makeStatusMenu(this.gameCharacter),
      ],
      // Pose
      [
        contextMenuToggleCheck({
          get: () => !this.isNotRide,
          set: (v) => { this.isNotRide = !v; },
          on: this.i18n.t('char.stackOn'),
          off: this.i18n.t('char.stackOff'),
          after,
        }),
        contextMenuToggleCheck({
          get: () => this.isAltitudeIndicate,
          set: (v) => { this.isAltitudeIndicate = v; },
          on: this.i18n.t('char.altitudeOn'),
          off: this.i18n.t('char.altitudeOff'),
          after,
        }),
        {
          name: this.i18n.t('char.resetAltitude'),
          action: () => {
            if (this.altitude != 0) {
              this.altitude = 0;
              if (!this.isHideIn) SoundEffect.play(PresetSound.sweep);
            }
          },
          altitudeHande: this.gameCharacter
        },
      ],
      // Chat / panels
      [
        contextMenuToggleCheck({
          get: () => this.gameCharacter.isShowChatBubble,
          set: (v) => { this.gameCharacter.isShowChatBubble = v; },
          on: this.i18n.t('char.chatBubbleOn'),
          off: this.i18n.t('char.chatBubbleOff'),
          tip: this.i18n.t('char.chatBubbleTip'),
          after,
        }),
        contextMenuToggleCheck({
          get: () => this.gameCharacter.isAllowsChat,
          set: (v) => { this.gameCharacter.isAllowsChat = v; },
          on: this.i18n.t('char.chatOn'),
          off: this.i18n.t('char.chatOff'),
          after,
        }),
        { name: this.i18n.t('char.showDetail'), action: () => { this.showDetail(this.gameCharacter); } },
        { name: this.i18n.t('char.showChatPalette'), action: () => { this.showChatPalette(this.gameCharacter); }, disabled: !this.gameCharacter.isAllowsChat },
        { name: this.i18n.t('char.standSetting'), action: () => { this.showStandSetting(this.gameCharacter); }, disabled: !this.gameCharacter.isAllowsChat },
        {
          name: this.i18n.t('char.openReferenceUrl'),
          action: null,
          subActions: this.gameCharacter.getUrls().map((urlElement) => {
            const url = urlElement.value.toString();
            return {
              name: urlElement.name ? urlElement.name : url,
              action: () => {
                if (StringUtil.sameOrigin(url)) {
                  window.open(url.trim(), '_blank', 'noopener');
                } else {
                  this.modalService.open(OpenUrlComponent, { url: url, title: this.gameCharacter.name, subTitle: urlElement.name });
                }
              },
              disabled: !StringUtil.validUrl(url),
              error: !StringUtil.validUrl(url) ? this.i18n.t('char.invalidUrl') : null,
              isOuterLink: StringUtil.validUrl(url) && !StringUtil.sameOrigin(url)
            };
          }),
          disabled: this.gameCharacter.getUrls().length <= 0
        },
      ],
      // Inventory / location
      [
        contextMenuToggleCheck({
          get: () => this.gameCharacter.isInventoryIndicate,
          set: (v) => { this.gameCharacter.isInventoryIndicate = v; },
          on: this.i18n.t('char.inventoryOn'),
          off: this.i18n.t('char.inventoryOff'),
          after,
        }),
        {
          name: this.i18n.t('char.moveTo'),
          action: null,
          subActions: [
            {
              name: this.i18n.t('char.commonInventory'),
              action: () => {
                EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: this.gameCharacter.identifier });
                this.gameCharacter.leaveCurrentTable('common');
                this.selectionService.remove(this.gameCharacter);
                SoundEffect.play(PresetSound.piecePut);
              }
            },
            {
              name: this.i18n.t('char.personalInventory'),
              action: () => {
                EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: this.gameCharacter.identifier });
                this.gameCharacter.leaveCurrentTable(Network.peerId);
                this.selectionService.remove(this.gameCharacter);
                SoundEffect.play(PresetSound.piecePut);
              }
            },
            {
              name: this.gameCharacter.isTemporaryCopy
                ? this.i18n.t('char.deleteTemporaryCopy')
                : this.i18n.t('char.graveyard'),
              action: () => {
                EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: this.gameCharacter.identifier });
                this.selectionService.remove(this.gameCharacter);
                if (this.gameCharacter.isTemporaryCopy) {
                  this.gameCharacter.destroy();
                } else {
                  this.gameCharacter.leaveCurrentTable('graveyard');
                }
                SoundEffect.play(PresetSound.sweep);
              }
            },
          ]
        },
      ],
      // Clone / delete
      [
        {
          name: this.i18n.t('char.createTemporaryCopy'),
          action: () => {
            const pose = this.gameCharacter.getPoseForView();
            GameCharacter.createTemporaryCopy(this.gameCharacter, {
              x: pose.x + this.gridSize,
              y: pose.y + this.gridSize,
              posZ: pose.posZ,
            });
            SoundEffect.play(PresetSound.piecePut);
          }
        },
        {
          name: this.i18n.t('char.clone'),
          action: () => {
            let cloneObject = this.gameCharacter.clone();
            cloneObject.location.x += this.gridSize;
            cloneObject.location.y += this.gridSize;
            cloneObject.update();
            SoundEffect.play(PresetSound.piecePut);
          }
        },
        {
          name: this.i18n.t('char.cloneNumbered'),
          action: () => {
            const cloneObject = this.gameCharacter.clone();
            const tmp = cloneObject.name.split('_');
            let baseName;
            if (tmp.length > 1 && /\d+/.test(tmp[tmp.length - 1])) {
              baseName = tmp.slice(0, tmp.length - 1).join('_');
            } else {
              baseName = tmp.join('_');
            }
            let maxIndex = 0;
            for (const character of ObjectStore.instance.getObjects(GameCharacter)) {
              if (!character.name.startsWith(baseName)) continue;
              let index = character.name.match(/_(\d+)$/) ? +RegExp.$1 : 0;
              if (index > maxIndex) maxIndex = index;
            }
            cloneObject.name = baseName + '_' + (maxIndex + 1);
            cloneObject.location.x += this.gridSize;
            cloneObject.location.y += this.gridSize;
            cloneObject.update();
            SoundEffect.play(PresetSound.piecePut);
          }
        },
        {
          name: this.gameCharacter.isTemporaryCopy
            ? this.i18n.t('char.deleteTemporaryCopy')
            : this.i18n.t('char.deleteToGraveyard'),
          hotkey: 'Del',
          action: () => {
            EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: this.gameCharacter.identifier });
            this.selectionService.remove(this.gameCharacter);
            if (this.gameCharacter.isTemporaryCopy) {
              this.gameCharacter.destroy();
            } else {
              this.gameCharacter.leaveCurrentTable('graveyard');
            }
            SoundEffect.play(PresetSound.sweep);
          }
        },
      ],
    ]);
  }

  /** Flatten menu groups with a single separator between non-empty groups. */
  private joinContextMenuGroups(groups: (ContextMenuAction | null)[][]): ContextMenuAction[] {
    const out: ContextMenuAction[] = [];
    for (const group of groups) {
      const items = group.filter((a): a is ContextMenuAction => !!a);
      if (!items.length) continue;
      if (out.length) out.push(ContextMenuSeparator);
      out.push(...items);
    }
    return out;
  }

  onDoubleClick(e: Event) {
    e.stopPropagation();
    this.showDetail(this.gameCharacter);
  }

  private showDetail(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let title = this.i18n.t('char.sheetTitle');
    if (gameObject.name.length) title += ' - ' + gameObject.name;
    let option: PanelOption = {
      title: title, left: coordinate.x - 270, top: coordinate.y - 240, width: 540, height: 480,
      geometryKey: PanelService.sheetGeometryKey(gameObject.aliasName),
    };
    let component = this.panelService.open<CharacterSettingsComponent>(CharacterSettingsComponent, option);
    component.character = gameObject;
  }

  private showChatPalette(gameObject: GameCharacter) {
    if (!gameObject || !gameObject.isAllowsChat) return;
    const tourId = PanelService.tourIdChatPalette(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId)) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 250, top: coordinate.y - 175, width: 620, height: 350, tourPanelId: tourId };
    let component = this.panelService.open<ChatPaletteComponent>(ChatPaletteComponent, option);
    component.character = gameObject;
  }

  private showStandSetting(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    const tourId = PanelService.tourIdStandSetting(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId)) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 400, top: coordinate.y - 175, width: 690, height: 540, tourPanelId: tourId };
    let component = this.panelService.open<StandSettingComponent>(StandSettingComponent, option);
    component.character = gameObject;
  }

  changeImage(index: number) {
    if (this.GuestMode()) return;
    if (this.gameCharacter.currntImageIndex != index) {
      this.gameCharacter.currntImageIndex = index;
      if (!this.isHideIn && this.gameCharacter.isVisibleOnTable) SoundEffect.play(PresetSound.surprise);
      EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: this.gameCharacter.identifier });
      EventSystem.trigger('UPDATE_INVENTORY', null);
    }
  }

  nextImage() {
    if (this.gameCharacter.imageFiles.length <= 1) return;
    if (this.gameCharacter.currntImageIndex + 1 >= this.gameCharacter.imageFiles.length) {
      this.changeImage(0);
    } else {
      this.changeImage(this.gameCharacter.currntImageIndex + 1);
    }
  }
}
