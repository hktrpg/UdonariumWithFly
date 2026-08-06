import { animate, keyframes, style, transition, trigger } from '@angular/animations';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';

import { GameObject } from '@udonarium/core/synchronize-object/game-object';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { UUID } from '@udonarium/core/system/util/uuid';
import { DataElement } from '@udonarium/data-element';
import { SortOrder } from '@udonarium/data-summary-setting';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TabletopObject } from '@udonarium/tabletop-object';

import { ChatPaletteComponent } from 'component/chat-palette/chat-palette.component';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { GameCharacterSheetComponent } from 'component/game-character-sheet/game-character-sheet.component';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { StandSettingComponent } from 'component/stand-setting/stand-setting.component';
import { ContextMenuAction, ContextMenuService, ContextMenuSeparator, contextMenuToggleCheck } from 'service/context-menu.service';
import { GameObjectInventoryService } from 'service/game-object-inventory.service';
import { ModalService } from 'service/modal.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';
import { CharacterFxMenuService } from 'service/character-fx-menu.service';
import { I18nService } from 'service/i18n.service';
import { hasStatus } from '@udonarium/table-fx/character-status';
import { buildMatrixRainColumns, imageEffectFilter, imageEffectOpacity, imageEffectTransform, MatrixRainColumn } from '@udonarium/table-fx/image-effect';

@Component({
    selector: 'game-object-inventory',
    templateUrl: './game-object-inventory.component.html',
    styleUrls: ['../shared/settings-ui.css', '../shared/image-effects.css', './game-object-inventory.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    animations: [
        trigger('SlideInOut', [
            transition('void => *', [
                animate('200ms ease', keyframes([
                    style({ transform: 'translateX(60px)', opacity: 0, offset: 0 }),
                    style({ transform: 'translateX(0px)', opacity: 1, offset: 1.0 })
                ]))
            ]),
            transition('* => void', [
                animate('200ms ease', keyframes([
                    style({ transform: 'translateX(0px)', opacity: 1, offset: 0 }),
                    style({ transform: 'translateX(60px)', opacity: 0, offset: 1.0 })
                ]))
            ]),
            /*
            transition(':increment', [
              animate('200ms ease', keyframes([
                style({ transform: 'translateY(-150px)', opacity: 0, offset: 0 }),
                style({ transform: 'translateY(0px)', opacity: 1, offset: 1.0 })
              ]))
            ]),
            transition(':decrement', [
              animate('200ms ease', keyframes([
                style({ transform: 'translateY(150px)', opacity: 0, offset: 0 }),
                style({ transform: 'translateY(0px)', opacity: 1, offset: 1.0 })
              ]))
            ]),
            */
        ])
    ],
    standalone: false
})
export class GameObjectInventoryComponent implements OnInit, OnDestroy {
  inventoryTypes: string[] = ['all', 'table', 'common', 'graveyard'];

  _selectTab: string = 'all';
  get selectTab(): string { return this._selectTab; };
  set selectTab(selectTab: string) {
    this._selectTab = selectTab;
    this.selectionService.clear();
  };
  selectedIdentifier: string = '';
  dropTargetTab: string = '';

  panelId;

  isEdit: boolean = false;

  stringUtil = StringUtil;
  private sortStopTimerId = null;

  get sortTag(): string { return this.inventoryService.sortTag; }
  set sortTag(sortTag: string) { this.inventoryService.sortTag = sortTag; }
  get sortOrder(): SortOrder { return this.inventoryService.sortOrder; }
  set sortOrder(sortOrder: SortOrder) { this.inventoryService.sortOrder = sortOrder; }
  get dataTag(): string { return this.inventoryService.dataTag; }
  set dataTag(dataTag: string) { this.inventoryService.dataTag = dataTag; }
  get dataTags(): string[] { return this.inventoryService.dataTags; }

  get indicateAll(): boolean { return this.inventoryService.indicateAll; }
  set indicateAll(indicateAll: boolean) { this.inventoryService.indicateAll = indicateAll; }

  get sortOrderName(): string { return this.sortOrder === SortOrder.ASC ? this.i18n.t('inv.sortAsc') : this.i18n.t('inv.sortDesc'); }

  //get newLineStrings(): string { return this.inventoryService.newLineStrings; }

  get isGMMode(): boolean{ return PeerCursor.myCursor ? PeerCursor.myCursor.isGMMode : false; }

  selectionState(tabletopObject: TabletopObject): SelectionState { return this.selectionService.state(tabletopObject); }
  checkSelected(tabletopObject: TabletopObject): boolean { return this.selectionState(tabletopObject) !== SelectionState.NONE; }
  checkMagnetic(tabletopObject: TabletopObject): boolean { return this.selectionState(tabletopObject) === SelectionState.MAGNETIC; }
  get newLineDataElement(): DataElement { return this.inventoryService.newLineDataElement; }

  constructor(
    private changeDetector: ChangeDetectorRef,
    private panelService: PanelService,
    private inventoryService: GameObjectInventoryService,
    private contextMenuService: ContextMenuService,
    private pointerDeviceService: PointerDeviceService,
    private modalService: ModalService,
    private selectionService: TabletopSelectionService,
    private characterFxMenu: CharacterFxMenuService,
    private i18n: I18nService,
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }


  ngOnInit() {
    Promise.resolve().then(() => this.refreshPanelTitle());
    EventSystem.register(this)
      .on('SELECT_TABLETOP_OBJECT', event => {
        if (ObjectStore.instance.get(event.data.identifier) instanceof TabletopObject) {
          this.selectedIdentifier = event.data.identifier;
          this.changeDetector.markForCheck();
        }
      })
      .on('SYNCHRONIZE_FILE_LIST', event => {
        if (event.isSendFromSelf) this.changeDetector.markForCheck();
      })
      .on('UPDATE_INVENTORY', event => {
        if (event.isSendFromSelf || event.data) this.changeDetector.markForCheck();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        if (ObjectStore.instance.get(event.data.identifier) instanceof GameCharacter) {
          this.changeDetector.markForCheck();
        }
      })
      .on('OPEN_NETWORK', event => {
        this.inventoryTypes = ['all', 'table', 'common', Network.peerId, 'graveyard'];
        if (!this.inventoryTypes.includes(this.selectTab)) {
          this.selectTab = 'all';
        }
      })
      .on('LOCALE_CHANGED', () => {
        this.refreshPanelTitle();
        this.changeDetector.markForCheck();
      })
      .on('INVENTORY_SELECT_ALL', () => {
        this.selectAllInCurrentTab();
      });
    this.inventoryTypes = ['all', 'table', 'common', Network.peerId, 'graveyard'];
    this.panelId = UUID.generateUuid();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    if (this.sortStopTimerId) clearTimeout(this.sortStopTimerId);
  }

  getTabTitle(inventoryType: string) {
    if (this.GuestMode()) return;
    switch (inventoryType) {
      case 'all':
        return this.i18n.t('inv.tab.all');
      case 'table':
        return this.i18n.t('inv.tab.table');
      case Network.peerId:
        return this.i18n.t('inv.tab.personal');
      case 'graveyard':
        return this.i18n.t('inv.tab.graveyard');
      default:
        return this.i18n.t('inv.tab.common');
    }
  }

  getInventory(inventoryType: string) {
    if (this.GuestMode()) return;
    switch (inventoryType) {
      case 'all':
        return this.inventoryService.allInventory;
      case 'table':
        return this.inventoryService.tableInventory;
      case Network.peerId:
        return this.inventoryService.privateInventory;
      case 'graveyard':
        return this.inventoryService.graveyardInventory;
      default:
        return this.inventoryService.commonInventory;
    }
  }

  getGameObjects(inventoryType: string): TabletopObject[] {
    return this.getInventory(inventoryType).tabletopObjects.filter((tabletopObject) => {
      if (inventoryType === 'all') return true;
      if (inventoryType !== 'table') return true;
      return this.indicateAll || tabletopObject.isInventoryIndicate;
    });
  }

  /** Token is on another map (still location=table, not the current view). */
  isOnOtherTable(gameObject: TabletopObject): boolean {
    return gameObject.location?.name === 'table' && !gameObject.isVisibleOnTable;
  }

  getInventoryTags(gameObject: GameCharacter): DataElement[] {
    // Always resolve from allInventory: tableInventory only has the current map,
    // so other-map tokens in the All tab would otherwise get empty tags.
    return this.inventoryService.allInventory.dataElementMap.get(gameObject.identifier) || [];
  }

  /** Blank area: block browser menu (item menus call stopPropagation). */
  @HostListener('contextmenu', ['$event'])
  onHostContextMenu(e: Event) {
    e.preventDefault();
  }

  onContextMenu(event: Event, gameObject: GameCharacter) {
    event.stopPropagation();
    event.preventDefault();

    if (this.GuestMode()) return;
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.getAttribute('type') !== 'range') return;
    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;

    this.selectGameObject(gameObject);

    const target = <HTMLElement>event.target;
    let position;
    if (target && target.tagName === 'BUTTON') {
      const clientRect = target.getBoundingClientRect();
      position = {
        x: window.pageXOffset + clientRect.left + target.clientWidth,
        y: window.pageYOffset + clientRect.top
      };
    } else {
      position = this.pointerDeviceService.pointers[0];
    }

    let actions: ContextMenuAction[] = [];
    if (this.checkSelected(gameObject)) {
      let selectedCharacter = () => this.selectionService.objects.filter(object => object.aliasName === gameObject.aliasName) as GameCharacter[];
      let subActions: ContextMenuAction[] = [];
      if (this.selectTab != 'table') {
        subActions.push({
          name: this.i18n.t('char.moveAllToTable'), action: () => {
            selectedCharacter().forEach(gameCharacter => {
              EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameCharacter.identifier });
              let isStealthMode = GameCharacter.isStealthMode;
              gameCharacter.setLocation('table');
              this.selectionService.remove(gameCharacter);
              if (gameCharacter.isHideIn && gameCharacter.isVisible && !isStealthMode && !PeerCursor.myCursor.isGMMode) {
                this.modalService.open(ConfirmationComponent, {
                  title: this.i18n.t('char.stealthTitle'),
                  text: this.i18n.t('char.stealthText'),
                  help: this.i18n.t('char.stealthHelp'),
                  type: ConfirmationType.OK,
                  materialIcon: 'disabled_visible'
                });
              }
            });
            SoundEffect.play(PresetSound.piecePut);
            EventSystem.call('UPDATE_INVENTORY', true);
          }
        });
      }
      if (this.selectTab != 'common') {
        subActions.push({
          name: this.i18n.t('char.moveAllToCommon'), action: () => {
            selectedCharacter().forEach(gameCharacter => {
              this.moveCharacterToLocation(gameCharacter, 'common', { silent: true });
            });
            SoundEffect.play(PresetSound.piecePut);
            EventSystem.call('UPDATE_INVENTORY', true);
          }
        });
      }
      if (this.selectTab === 'all' || this.selectTab === 'table' || this.selectTab === 'common' || this.selectTab === 'graveyard') {
        subActions.push({
          name: this.i18n.t('char.moveAllToPersonal'), action: () => {
            selectedCharacter().forEach(gameCharacter => {
              this.moveCharacterToLocation(gameCharacter, Network.peerId, { silent: true });
            });
            SoundEffect.play(PresetSound.piecePut);
            EventSystem.call('UPDATE_INVENTORY', true);
          }
        });
      }
      if (this.selectTab != 'graveyard') {
        subActions.push({
          name: this.i18n.t('char.moveAllToGraveyard'), action: () => {
            selectedCharacter().forEach(gameCharacter => {
              TabletopObject.disposeObject(gameCharacter, () => {
                if (gameCharacter.location.name === 'table') gameCharacter.leaveCurrentTable('graveyard');
                else gameCharacter.setLocation('graveyard');
              });
              this.selectionService.remove(gameCharacter);
            });
            SoundEffect.play(PresetSound.sweep);
            EventSystem.call('UPDATE_INVENTORY', true);
          }
        });
      }
      actions.push({
        name: this.i18n.t('char.selectedCharacters'),
        action: null,
        subActions: subActions
      });
      actions.push(ContextMenuSeparator);
    }

    const afterInv = () => EventSystem.trigger('UPDATE_INVENTORY', null);
    const hasMultiImage = gameObject.imageFiles.length > 1;
    const hasFace = this.hasOverviewFaceIcon(gameObject);
    if (!hasFace && gameObject.isUseIconToOverviewImage) {
      gameObject.isUseIconToOverviewImage = false;
    }
    const inGraveyard = gameObject.location.name === 'graveyard';

    const identity: (ContextMenuAction | null)[] = [
      (gameObject.isVisibleOnTable && (this.isGMMode || gameObject.isVisible)) ? {
        name: this.i18n.t('char.findOnTable'),
        action: () => {
          if (gameObject.isVisibleOnTable) EventSystem.trigger('FOCUS_TABLETOP_OBJECT', { x: gameObject.location.x, y: gameObject.location.y, z: gameObject.posZ + (gameObject.altitude > 0 ? gameObject.altitude * 50 : 0) });
        },
        default: gameObject.isVisibleOnTable,
        disabled: !gameObject.isVisibleOnTable,
        selfOnly: true
      } : null,
      (this.isOnOtherTable(gameObject) && (this.isGMMode || gameObject.isVisible)) ? {
        name: this.i18n.t('inv.placeOnCurrentMap'),
        action: () => {
          gameObject.addToTable();
          SoundEffect.play(PresetSound.piecePut);
          EventSystem.call('UPDATE_INVENTORY', true);
        }
      } : null,
      (this.isOnOtherTable(gameObject) && (this.isGMMode || gameObject.isVisible)) ? {
        name: this.i18n.t('inv.moveToCurrentMapOnly'),
        action: () => {
          gameObject.moveToTableOnly();
          SoundEffect.play(PresetSound.piecePut);
          EventSystem.call('UPDATE_INVENTORY', true);
        }
      } : null,
      (gameObject.isVisibleOnTable && (this.isGMMode || gameObject.isVisible)) ? {
        name: this.i18n.t('inv.removeFromCurrentMap'),
        action: () => {
          EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameObject.identifier });
          gameObject.removeFromTable();
          SoundEffect.play(PresetSound.piecePut);
          EventSystem.call('UPDATE_INVENTORY', true);
        }
      } : null,
      (gameObject.location.name != 'table' && (this.isGMMode || gameObject.isVisible)) ? {
        name: this.i18n.t('char.moveToTable'),
        action: () => {
          let isStealthMode = GameCharacter.isStealthMode;
          EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameObject.identifier });
          gameObject.setLocation('table');
          this.selectionService.remove(gameObject);
          if (gameObject.isHideIn && gameObject.isVisible && !isStealthMode && !PeerCursor.myCursor.isGMMode) {
            this.modalService.open(ConfirmationComponent, {
              title: this.i18n.t('char.stealthTitle'),
              text: this.i18n.t('char.stealthText'),
              help: this.i18n.t('char.stealthHelp'),
              type: ConfirmationType.OK,
              materialIcon: 'disabled_visible'
            });
          }
          SoundEffect.play(PresetSound.piecePut);
          EventSystem.call('UPDATE_INVENTORY', true);
        }
      } : null,
      gameObject.isHideIn ? {
        name: this.i18n.t('char.revealPosition'),
        action: () => {
          gameObject.owner = '';
          SoundEffect.play(PresetSound.piecePut);
          EventSystem.trigger('UPDATE_INVENTORY', null);
        }
      } : null,
      (!gameObject.isHideIn || !gameObject.isVisible) ? {
        name: this.i18n.t('char.selfOnlyStealth'),
        action: () => {
          if (gameObject.isVisibleOnTable && !GameCharacter.isStealthMode && !PeerCursor.myCursor.isGMMode) {
            this.modalService.open(ConfirmationComponent, {
              title: this.i18n.t('char.stealthTitle'),
              text: this.i18n.t('char.stealthText'),
              help: this.i18n.t('char.stealthHelp'),
              type: ConfirmationType.OK,
              materialIcon: 'disabled_visible'
            });
          }
          gameObject.owner = Network.peer.userId;
          SoundEffect.play(PresetSound.sweep);
          EventSystem.call('UPDATE_INVENTORY', true);
        }
      } : null,
      this.characterFxMenu.makeMyTokenMenu(gameObject),
      this.characterFxMenu.makeCombatMenu(gameObject),
    ];

    const appearance: (ContextMenuAction | null)[] = [
      hasMultiImage ? {
        name: this.i18n.t('char.imageSwitch'),
        action: null,
        subActions: gameObject.imageFiles.map((image, i) => ({
          name: `${gameObject.currntImageIndex == i ? '◉' : '○'}`,
          action: () => {
            gameObject.currntImageIndex = i;
            if (!gameObject.isHideIn && gameObject.isVisibleOnTable) SoundEffect.play(PresetSound.surprise);
            EventSystem.trigger('UPDATE_INVENTORY', null);
          },
          default: gameObject.currntImageIndex == i,
          icon: image,
          checkBox: 'radio' as const
        })),
      } : null,
      contextMenuToggleCheck({
        get: () => hasFace && gameObject.isUseIconToOverviewImage,
        set: (v) => {
          if (!this.hasOverviewFaceIcon(gameObject)) return;
          gameObject.isUseIconToOverviewImage = v;
        },
        on: this.i18n.t('char.overviewFaceOn'),
        off: this.i18n.t('char.overviewFaceOff'),
        after: afterInv,
        disabled: !hasFace,
        error: hasFace ? null : this.i18n.t('char.overviewFaceRequired'),
      }),
      contextMenuToggleCheck({
        get: () => gameObject.isDropShadow,
        set: (v) => { gameObject.isDropShadow = v; },
        on: this.i18n.t('char.shadowOn'),
        off: this.i18n.t('char.shadowOff'),
        after: afterInv,
      }),
      this.characterFxMenu.makeImageEffectMenu(gameObject),
    ];

    const fx: ContextMenuAction[] = [
      this.characterFxMenu.makeAuraMenu(gameObject),
      this.characterFxMenu.makeRingMenu(gameObject),
      this.characterFxMenu.makeStatusMenu(gameObject),
    ];

    const pose: ContextMenuAction[] = [
      contextMenuToggleCheck({
        get: () => !gameObject.isNotRide,
        set: (v) => { gameObject.isNotRide = !v; },
        on: this.i18n.t('char.stackOn'),
        off: this.i18n.t('char.stackOff'),
        after: afterInv,
      }),
      contextMenuToggleCheck({
        get: () => gameObject.isAltitudeIndicate,
        set: (v) => { gameObject.isAltitudeIndicate = v; },
        on: this.i18n.t('char.altitudeOn'),
        off: this.i18n.t('char.altitudeOff'),
        after: afterInv,
      }),
      {
        name: this.i18n.t('char.resetAltitude'),
        action: () => {
          if (gameObject.altitude != 0) {
            gameObject.altitude = 0;
            if (gameObject.isVisibleOnTable) SoundEffect.play(PresetSound.sweep);
          }
        },
        altitudeHande: gameObject
      },
    ];

    const chatPanels: ContextMenuAction[] = [
      contextMenuToggleCheck({
        get: () => gameObject.isShowChatBubble,
        set: (v) => { gameObject.isShowChatBubble = v; },
        on: this.i18n.t('char.chatBubbleOn'),
        off: this.i18n.t('char.chatBubbleOff'),
        tip: this.i18n.t('char.chatBubbleTip'),
        after: afterInv,
      }),
      contextMenuToggleCheck({
        get: () => gameObject.isAllowsChat,
        set: (v) => { gameObject.isAllowsChat = v; },
        on: this.i18n.t('char.chatOn'),
        off: this.i18n.t('char.chatOff'),
        after: afterInv,
        disabled: inGraveyard,
      }),
      { name: this.i18n.t('char.showDetail'), action: () => { this.showDetail(gameObject); } },
      { name: this.i18n.t('char.showChatPalette'), action: () => { this.showChatPalette(gameObject); }, disabled: !gameObject.isAllowsChat || inGraveyard },
      { name: this.i18n.t('char.standSetting'), action: () => { this.showStandSetting(gameObject); }, disabled: !gameObject.isAllowsChat || inGraveyard },
      {
        name: this.i18n.t('char.openReferenceUrl'),
        action: null,
        subActions: gameObject.getUrls().map((urlElement) => {
          const url = urlElement.value.toString();
          return {
            name: urlElement.name ? urlElement.name : url,
            action: () => {
              if (StringUtil.sameOrigin(url)) {
                window.open(url.trim(), '_blank', 'noopener');
              } else {
                this.modalService.open(OpenUrlComponent, { url: url, title: gameObject.name, subTitle: urlElement.name });
              }
            },
            disabled: !StringUtil.validUrl(url),
            error: !StringUtil.validUrl(url) ? this.i18n.t('char.invalidUrl') : null,
            isOuterLink: StringUtil.validUrl(url) && !StringUtil.sameOrigin(url)
          };
        }),
        disabled: gameObject.getUrls().length <= 0
      },
    ];

    const locations = [
      { name: 'table', aliasKey: 'char.table' },
      { name: 'common', aliasKey: 'char.commonInventory' },
      { name: Network.peerId, aliasKey: 'char.personalInventory' },
      { name: 'graveyard', aliasKey: 'char.graveyard' }
    ];
    const locationGroup: ContextMenuAction[] = [
      contextMenuToggleCheck({
        get: () => gameObject.isInventoryIndicate,
        set: (v) => { gameObject.isInventoryIndicate = v; },
        on: this.i18n.t('char.inventoryOn'),
        off: this.i18n.t('char.inventoryOff'),
        after: afterInv,
      }),
      {
        name: this.i18n.t('char.moveFrom', { from: this.i18n.t((locations.find((location) => { return location.name == gameObject.location.name }) || locations[1]).aliasKey) }),
        action: null,
        subActions: locations
          .filter((location, i) => { return !(gameObject.location.name == location.name || (i == 1 && !locations.map(loc => loc.name).includes(gameObject.location.name))) })
          .map((location) => ({
            name: this.i18n.t(location.aliasKey),
            action: () => {
              this.moveCharacterToLocation(gameObject, location.name);
            }
          })),
        disabled: !gameObject.isVisible && !this.isGMMode
      },
    ];

    const cloneDelete: ContextMenuAction[] = [
      {
        name: this.i18n.t('char.createTemporaryCopy'),
        action: () => {
          this.createTemporaryCopy(gameObject);
        },
        disabled: !gameObject.isVisible && !this.isGMMode
      },
      {
        name: this.i18n.t('char.clone'),
        action: () => {
          this.cloneGameObject(gameObject);
          SoundEffect.play(PresetSound.piecePut);
        },
        disabled: !gameObject.isVisible && !this.isGMMode
      },
      {
        name: this.i18n.t('char.cloneNumbered'),
        action: () => {
          const cloneObject = gameObject.clone();
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
          cloneObject.update();
          SoundEffect.play(PresetSound.piecePut);
        },
        disabled: !gameObject.isVisible && !this.isGMMode
      },
      inGraveyard ? {
        name: this.i18n.t('char.deleteForever'),
        action: () => {
          this.selectionService.remove(gameObject);
          this.deleteGameObject(gameObject);
          SoundEffect.play(PresetSound.sweep);
        }
      } : {
        name: gameObject.isTemporaryCopy
          ? this.i18n.t('char.deleteTemporaryCopy')
          : this.i18n.t('char.deleteToGraveyard'),
        action: () => {
          EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameObject.identifier });
          this.selectionService.remove(gameObject);
          if (gameObject.isTemporaryCopy) {
            this.deleteGameObject(gameObject);
          } else if (gameObject.location.name === 'table') {
            gameObject.leaveCurrentTable('graveyard');
          } else {
            gameObject.setLocation('graveyard');
          }
          SoundEffect.play(PresetSound.sweep);
          EventSystem.call('UPDATE_INVENTORY', true);
        }
      },
    ];

    actions = actions.concat(this.joinContextMenuGroups([
      identity,
      appearance,
      fx,
      pose,
      chatPanels,
      locationGroup,
      cloneDelete,
    ]));
    this.contextMenuService.open(position, actions, gameObject.name);
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

  toggleEdit() {
    this.isEdit = !this.isEdit;
  }

  cleanInventory() {
    if (this.GuestMode()) return;
    let tabTitle = this.getTabTitle(this.selectTab);
    let gameObjects = this.getGameObjects(this.selectTab);
    this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('char.emptyGraveyardTitle'),
      text: this.i18n.t('char.emptyGraveyardText'),
      helpHtml: this.i18n.t('char.emptyGraveyardHelp', { tab: StringUtil.escapeHtml(tabTitle), count: gameObjects.length }),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'delete_forever',
      action: () => {
        for (const gameObject of gameObjects) {
          this.deleteGameObject(gameObject);
        }
        SoundEffect.play(PresetSound.sweep);
      }
    });
  }

  private cloneGameObject(gameObject: TabletopObject) {
    if (this.GuestMode()) return;
    gameObject.clone();
  }

  private createTemporaryCopy(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    const pose = gameObject.getPoseForView();
    GameCharacter.createTemporaryCopy(gameObject, {
      x: pose.x + 50,
      y: pose.y + 50,
      posZ: pose.posZ,
    });
    SoundEffect.play(PresetSound.piecePut);
    EventSystem.call('UPDATE_INVENTORY', true);
  }

  private showDetail(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });
    let coordinate = this.pointerDeviceService.pointers[0];
    let title = this.i18n.t('char.sheetTitle');
    if (gameObject.name.length) title += ' - ' + gameObject.name;
    let option: PanelOption = {
      title: title, left: coordinate.x - 400, top: coordinate.y - 300, width: 690, height: 560,
      geometryKey: PanelService.sheetGeometryKey(gameObject.aliasName),
    };
    let component = this.panelService.open<GameCharacterSheetComponent>(GameCharacterSheetComponent, option);
    component.tabletopObject = gameObject;
  }

  private showChatPalette(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    const tourId = PanelService.tourIdChatPalette(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId)) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 250, top: coordinate.y - 175, width: 620, height: 350, tourPanelId: tourId };
    let component = this.panelService.open<ChatPaletteComponent>(ChatPaletteComponent, option);
    component.character = gameObject;
  }

  selectGameObject(gameObject: GameObject, e: Event=null) {
    if (this.GuestMode()) return;
    if (!(gameObject instanceof TabletopObject)) return;
    if (e && e instanceof MouseEvent && e.shiftKey) {
      SoundEffect.playLocal(PresetSound.selectionStart);
      // Seed primary highlight into the set so Shift-extend keeps the first pick.
      if (this.selectionService.size === 0 && this.selectedIdentifier) {
        const primary = ObjectStore.instance.get(this.selectedIdentifier);
        if (primary instanceof TabletopObject && primary !== gameObject) {
          this.selectionService.add(primary);
        }
      }
      if (this.checkSelected(gameObject)) {
        this.selectionService.remove(gameObject);
      } else {
        EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName, highlighting: true });
        this.selectionService.add(gameObject);
      }
    } else {
      EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName, highlighting: true });
      if (!this.checkSelected(gameObject)) {
        this.selectionService.clear();
        this.selectionService.add(gameObject);
      }
    }
  }

  private selectAllInCurrentTab() {
    if (this.GuestMode()) return;
    const objects = this.getGameObjects(this.selectTab);
    this.selectionService.clear();
    let first: GameCharacter = null;
    for (const obj of objects) {
      if (!(obj instanceof GameCharacter)) continue;
      if (!obj.isVisible && !this.isGMMode) continue;
      this.selectionService.add(obj);
      if (!first) first = obj;
    }
    if (first) {
      EventSystem.trigger('SELECT_TABLETOP_OBJECT', {
        identifier: first.identifier,
        className: first.aliasName,
        highlighting: true,
      });
      this.selectedIdentifier = first.identifier;
      SoundEffect.playLocal(PresetSound.selectionStart);
    }
    this.changeDetector.markForCheck();
  }

  focusGameObject(gameObject: GameCharacter, e: Event) {
    if (!(e.target instanceof HTMLElement)) return;
    if (new Set(['input', 'button']).has(e.target.tagName.toLowerCase())) return;
    if (e instanceof MouseEvent && e.shiftKey) return;
    if (!gameObject.isVisibleOnTable || (!gameObject.isVisible && !this.isGMMode)) return;
    EventSystem.trigger('FOCUS_TABLETOP_OBJECT', { x: gameObject.location.x + gameObject.size * 50 / 2, y: gameObject.location.y + gameObject.size * 50 / 2, z: gameObject.posZ + (gameObject.altitude > 0 ? gameObject.altitude * 50 : 0) });
  }

  invImageFilter(gameObject: GameCharacter): string | null {
    return imageEffectFilter({
      ...gameObject,
      isDead: hasStatus(gameObject.statusesJson, 'dead'),
    });
  }
  invImageOpacity(gameObject: GameCharacter): number | null {
    return imageEffectOpacity(gameObject);
  }
  invImageTransform(gameObject: GameCharacter): string | null {
    return imageEffectTransform(gameObject);
  }

  private _invMatrixRain = new Map<string, MatrixRainColumn[]>();
  invMatrixRainColumns(gameObject: GameCharacter): MatrixRainColumn[] {
    if (!gameObject?.isMatrix) return [];
    const key = gameObject.identifier;
    let cols = this._invMatrixRain.get(key);
    if (!cols) {
      cols = buildMatrixRainColumns(`inv:${key}`, 5, 10);
      this._invMatrixRain.set(key, cols);
    }
    return cols;
  }
  trackByMatrixCol = (_: number, col: MatrixRainColumn) => `${col.duration}:${col.delay}:${col.text.length}`;

  hasOverviewFaceIcon(gameObject: TabletopObject): boolean {
    return !!(gameObject?.faceIcon && 0 < gameObject.faceIcon.url.length);
  }

  overviewFaceIconTitle(gameObject: TabletopObject): string {
    if (!this.hasOverviewFaceIcon(gameObject)) return this.i18n.t('char.overviewFaceHintNeed');
    return this.i18n.t('char.overviewFaceHint');
  }

  toggleOverviewFaceIcon(gameObject: TabletopObject) {
    if (!this.hasOverviewFaceIcon(gameObject)) {
      gameObject.isUseIconToOverviewImage = false;
      return;
    }
    gameObject.isUseIconToOverviewImage = !gameObject.isUseIconToOverviewImage;
  }

  /** Characters can be dragged to table / common / personal / graveyard. */
  canDragInventory(gameObject: GameCharacter): boolean {
    if (this.GuestMode() || !(gameObject instanceof GameCharacter)) return false;
    return gameObject.isVisible || this.isGMMode;
  }

  /** True after pointerdown on a bar/input — next dragstart must be cancelled. */
  private inventoryDragBlocked = false;

  /** Stop panel appDraggable from treating this as a window move. */
  onInventoryDragGestureStart(e: Event, gameObject: GameCharacter) {
    this.inventoryDragBlocked = this.isInventoryUiControl(e.target);
    if (!this.canDragInventory(gameObject) || this.inventoryDragBlocked) return;
    e.stopPropagation();
  }

  onInventoryDragStart(e: DragEvent, gameObject: GameCharacter) {
    // Range/HP bars and other controls must not start a token DnD.
    if (this.inventoryDragBlocked || this.isInventoryUiControl(e.target)) {
      this.inventoryDragBlocked = false;
      e.preventDefault();
      return;
    }
    if (!this.canDragInventory(gameObject) || !e.dataTransfer) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();

    // Dragging an unselected row: switch selection to that token only (do not drag prior picks).
    if (!this.checkSelected(gameObject)) {
      this.selectionService.clear();
      this.selectionService.add(gameObject);
      this.selectedIdentifier = gameObject.identifier;
      EventSystem.trigger('SELECT_TABLETOP_OBJECT', {
        identifier: gameObject.identifier,
        className: gameObject.aliasName,
        highlighting: true,
      });
      this.changeDetector.markForCheck();
    }

    const tempCopy = !!(e.ctrlKey || e.metaKey);
    const ids = this.inventoryDragIdentifiers(gameObject);
    const payload = ids.join(',');
    e.dataTransfer.setData(GameCharacter.INVENTORY_DRAG_MIME, payload);
    e.dataTransfer.setData('text/plain', `udonarium-character:${payload}`);
    if (tempCopy) {
      e.dataTransfer.setData(GameCharacter.INVENTORY_TEMP_COPY_MIME, '1');
      e.dataTransfer.effectAllowed = 'copy';
    } else {
      e.dataTransfer.effectAllowed = 'move';
    }
  }

  /** Multi-drag only when the dragged row is already in the selection set (≥2). */
  private inventoryDragIdentifiers(gameObject: GameCharacter): string[] {
    if (!this.checkSelected(gameObject)) return [gameObject.identifier];
    const selected = this.selectionService.objects
      .filter((o): o is GameCharacter => o instanceof GameCharacter && o.aliasName === gameObject.aliasName)
      .filter(ch => this.canDragInventory(ch))
      .map(ch => ch.identifier);
    if (selected.length < 2 || !selected.includes(gameObject.identifier)) {
      return [gameObject.identifier];
    }
    // Keep the dragged row first so drop offsets stay predictable.
    return [gameObject.identifier, ...selected.filter(id => id !== gameObject.identifier)];
  }

  onInventoryDragEnd() {
    this.inventoryDragBlocked = false;
    this.dropTargetTab = '';
    this.changeDetector.markForCheck();
  }

  /** Inputs / bars / buttons keep normal interaction; rest of the row can DnD the token. */
  private isInventoryUiControl(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return !!target.closest(
      'input, button, select, textarea, a, label, .resource-tag, .tag-value-box, .tag-value, .resource-value'
    );
  }

  onInventoryTabDragOver(e: DragEvent, inventoryType: string) {
    if (inventoryType === 'all') return;
    if (!this.readInventoryDragIds(e).length) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (this.dropTargetTab !== inventoryType) {
      this.dropTargetTab = inventoryType;
      this.changeDetector.markForCheck();
    }
  }

  onInventoryTabDragLeave(e: DragEvent, inventoryType: string) {
    const related = e.relatedTarget as Node | null;
    const current = e.currentTarget as Node | null;
    if (related && current && current.contains(related)) return;
    if (this.dropTargetTab === inventoryType) {
      this.dropTargetTab = '';
      this.changeDetector.markForCheck();
    }
  }

  onInventoryTabDrop(e: DragEvent, inventoryType: string) {
    const ids = this.readInventoryDragIds(e);
    this.dropTargetTab = '';
    if (!ids.length || ids[0] === '__pending__') return;
    if (inventoryType === 'all') return;
    e.preventDefault();
    e.stopPropagation();
    if (this.GuestMode()) return;
    let moved = 0;
    for (const id of ids) {
      const ch = ObjectStore.instance.get(id);
      if (!(ch instanceof GameCharacter)) continue;
      if (!ch.isVisible && !this.isGMMode) continue;
      if (ch.location?.name === inventoryType) {
        // Same location name, but other-map tokens still need rebinding to the current view table.
        if (inventoryType === 'table' && this.isOnOtherTable(ch)) {
          // fall through → place on current map
        } else if (inventoryType !== 'table' && !ch.isInventoryForCurrentView()) {
          // fall through → rebind inventory to current map
        } else {
          continue;
        }
      }
      this.moveCharacterToLocation(ch, inventoryType, { silent: true });
      moved++;
    }
    if (moved > 0) {
      SoundEffect.play(inventoryType === 'graveyard' ? PresetSound.sweep : PresetSound.piecePut);
      EventSystem.call('UPDATE_INVENTORY', true);
      if (this.selectTab !== inventoryType) this.selectTab = inventoryType;
    }
    this.changeDetector.markForCheck();
  }

  private moveCharacterToLocation(gameObject: GameCharacter, location: string, opts?: { silent?: boolean }) {
    const isStealthMode = GameCharacter.isStealthMode;
    EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameObject.identifier });
    if (location === 'table') {
      gameObject.setLocation('table');
    } else if (gameObject.location.name === 'table') {
      gameObject.leaveCurrentTable(location);
    } else {
      // Off-table → off-table (or rebind to current map's inventory).
      const viewId = TabletopObject.resolveViewTableIdentifier() || '';
      gameObject.setLocation(location, viewId || undefined);
    }
    this.selectionService.remove(gameObject);
    if (location === 'table' && gameObject.isHideIn && gameObject.isVisible && !isStealthMode && !PeerCursor.myCursor.isGMMode) {
      this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('char.stealthTitle'),
        text: this.i18n.t('char.stealthText'),
        help: this.i18n.t('char.stealthHelp'),
        type: ConfirmationType.OK,
        materialIcon: 'disabled_visible'
      });
    }
    if (!opts?.silent) {
      SoundEffect.play(location === 'graveyard' ? PresetSound.sweep : PresetSound.piecePut);
      EventSystem.call('UPDATE_INVENTORY', true);
    }
  }

  private readInventoryDragIds(e: DragEvent): string[] {
    if (!e.dataTransfer) return [];
    const typed = e.dataTransfer.getData(GameCharacter.INVENTORY_DRAG_MIME);
    if (typed) return this.parseInventoryDragPayload(typed);
    if (e.type === 'dragover') {
      const types = Array.from(e.dataTransfer.types || []);
      if (types.includes(GameCharacter.INVENTORY_DRAG_MIME) || types.includes('text/plain')) {
        return ['__pending__'];
      }
      return [];
    }
    const plain = e.dataTransfer.getData('text/plain') || '';
    const m = /^udonarium-character:(.+)$/.exec(plain);
    return m ? this.parseInventoryDragPayload(m[1]) : [];
  }

  private parseInventoryDragPayload(payload: string): string[] {
    return payload.split(',').map(s => s.trim()).filter(Boolean);
  }

  private deleteGameObject(gameObject: GameObject) {
    if (this.GuestMode()) return;
    gameObject.destroy();
    this.changeDetector.markForCheck();
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

  trackByGameObject(index: number, gameObject: GameObject) {
    return gameObject ? gameObject.identifier : index;
  }

  openUrl(url, title=null, subTitle=null) {
    if (StringUtil.sameOrigin(url)) {
      window.open(url.trim(), '_blank', 'noopener');
    } else {
      this.modalService.open(OpenUrlComponent, { url: url, title: title, subTitle: subTitle });
    }
    return false;
  }

  onInput() {
    this.inventoryService.sortStop = true;
    if (this.sortStopTimerId) clearTimeout(this.sortStopTimerId);
    this.sortStopTimerId = setTimeout(() => {
      this.inventoryService.sortStop = false;
    }, 666);
  }

  private refreshPanelTitle() {
    this.panelService.title = this.i18n.t('inv.title');
  }

  suggestWords(): string[] {
    return ['name', 'size'].concat([...new Set(this.inventoryService.dataTags)].filter(dataTag => dataTag != '/' && dataTag != '／').sort());
  }
}
