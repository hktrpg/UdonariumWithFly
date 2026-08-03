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
import { ContextMenuAction, ContextMenuService, ContextMenuSeparator } from 'service/context-menu.service';
import { GameObjectInventoryService } from 'service/game-object-inventory.service';
import { ModalService } from 'service/modal.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';
import { CharacterFxMenuService } from 'service/character-fx-menu.service';

@Component({
    selector: 'game-object-inventory',
    templateUrl: './game-object-inventory.component.html',
    styleUrls: ['./game-object-inventory.component.css'],
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
  inventoryTypes: string[] = ['table', 'common', 'graveyard'];

  _selectTab: string = 'table';
  get selectTab(): string { return this._selectTab; };
  set selectTab(selectTab: string) {
    this._selectTab = selectTab;
    this.selectionService.clear();
  };
  selectedIdentifier: string = '';

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

  get sortOrderName(): string { return this.sortOrder === SortOrder.ASC ? '由小到大' : '由大到小'; }

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
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }


  ngOnInit() {
    Promise.resolve().then(() => this.panelService.title = '倉庫');
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
      .on('OPEN_NETWORK', event => {
        this.inventoryTypes = ['table', 'common', Network.peerId, 'graveyard'];
        if (!this.inventoryTypes.includes(this.selectTab)) {
          this.selectTab = Network.peerId;
        }
      });
    this.inventoryTypes = ['table', 'common', Network.peerId, 'graveyard'];
    this.panelId = UUID.generateUuid();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    if (this.sortStopTimerId) clearTimeout(this.sortStopTimerId);
  }

  getTabTitle(inventoryType: string) {
    if (this.GuestMode()) return;
    switch (inventoryType) {
      case 'table':
        return '桌面';
      case Network.peerId:
        return '個人';
      case 'graveyard':
        return '回收區';
      default:
        return '公用';
    }
  }

  getInventory(inventoryType: string) {
    if (this.GuestMode()) return;
    switch (inventoryType) {
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
    return this.getInventory(inventoryType).tabletopObjects.filter((tabletopObject) => { return inventoryType != 'table' || this.indicateAll || tabletopObject.isInventoryIndicate });
  }

  getInventoryTags(gameObject: GameCharacter): DataElement[] {
    return this.getInventory(gameObject.location.name).dataElementMap.get(gameObject.identifier);
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
          name: '全部移至桌面', action: () => {
            selectedCharacter().forEach(gameCharacter => {
              EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameCharacter.identifier });
              let isStealthMode = GameCharacter.isStealthMode;
              gameCharacter.setLocation('table');
              this.selectionService.remove(gameCharacter);
              if (gameCharacter.isHideIn && gameCharacter.isVisible && !isStealthMode && !PeerCursor.myCursor.isGMMode) {
                this.modalService.open(ConfirmationComponent, {
                  title: '隱身模式',
                  text: '已開啟隱身：其他人看不到你的游標位置。',
                  help: '只要桌面上有「僅自己可見」的角色，其他人就看不到你的游標位置。',
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
          name: '全部移至公用倉庫', action: () => {
            selectedCharacter().forEach(gameCharacter => {
              gameCharacter.setLocation('common');
              this.selectionService.remove(gameCharacter);
            });
            SoundEffect.play(PresetSound.piecePut);
            EventSystem.call('UPDATE_INVENTORY', true);
          }
        });
      }
      if (this.selectTab === 'table' || this.selectTab === 'common' || this.selectTab === 'graveyard') {
        subActions.push({
          name: '全部移至個人倉庫', action: () => {
            selectedCharacter().forEach(gameCharacter => {
              gameCharacter.setLocation(Network.peerId);
              this.selectionService.remove(gameCharacter);
            });
            SoundEffect.play(PresetSound.piecePut);
            EventSystem.call('UPDATE_INVENTORY', true);
          }
        });
      }
      if (this.selectTab != 'graveyard') {
        subActions.push({
          name: '全部移至回收區', action: () => {
            selectedCharacter().forEach(gameCharacter => {
              gameCharacter.setLocation('graveyard');
              this.selectionService.remove(gameCharacter);
            });
            SoundEffect.play(PresetSound.sweep);
            EventSystem.call('UPDATE_INVENTORY', true);
          }
        });
      }
      actions.push({
        name: '已選擇的角色',
        action: null,
        subActions: subActions
      });
      actions.push(ContextMenuSeparator);
    }

    if (gameObject.location.name === 'table' && (this.isGMMode || gameObject.isVisible)) {
      actions.push({
        name: '在桌面上尋找',
        action: () => {
          if (gameObject.location.name === 'table') EventSystem.trigger('FOCUS_TABLETOP_OBJECT', { x: gameObject.location.x, y: gameObject.location.y, z: gameObject.posZ + (gameObject.altitude > 0 ? gameObject.altitude * 50 : 0) });
        },
        default: gameObject.location.name === 'table',
        disabled: gameObject.location.name !== 'table',
        selfOnly: true
      });
    }
    if (gameObject.location.name != 'table' && (this.isGMMode || gameObject.isVisible)) {
      actions.push({
        name: '移至桌面',
        action: () => {
          let isStealthMode = GameCharacter.isStealthMode;
          EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameObject.identifier });
          gameObject.setLocation('table');
          this.selectionService.remove(gameObject);
          if (gameObject.isHideIn && gameObject.isVisible && !isStealthMode && !PeerCursor.myCursor.isGMMode) {
            this.modalService.open(ConfirmationComponent, {
              title: '隱身模式',
              text: '已開啟隱身：其他人看不到你的游標位置。',
              help: '只要桌面上有「僅自己可見」的角色，其他人就看不到你的游標位置。',
              type: ConfirmationType.OK,
              materialIcon: 'disabled_visible'
            });
          }
          SoundEffect.play(PresetSound.piecePut);
          EventSystem.call('UPDATE_INVENTORY', true);
        }
      });
    }

    if (gameObject.isHideIn) {
      actions.push({
        name: '公開位置',
        action: () => {
          gameObject.owner = '';
          SoundEffect.play(PresetSound.piecePut);
          EventSystem.trigger('UPDATE_INVENTORY', null);
        }
      });
    }
    if (!gameObject.isHideIn || !gameObject.isVisible) {
      actions.push({
        name: '僅自己可見（隱身）',
        action: () => {
          if (gameObject.location.name === 'table' && !GameCharacter.isStealthMode && !PeerCursor.myCursor.isGMMode) {
            this.modalService.open(ConfirmationComponent, {
              title: '隱身模式',
              text: '已開啟隱身：其他人看不到你的游標位置。',
              help: '只要桌面上有「僅自己可見」的角色，其他人就看不到你的游標位置。',
              type: ConfirmationType.OK,
              materialIcon: 'disabled_visible'
            });
          }
          gameObject.owner = Network.peer.userId;
          SoundEffect.play(PresetSound.sweep);
          EventSystem.call('UPDATE_INVENTORY', true);
        }
      });
    }
    actions.push(ContextMenuSeparator);
    if (gameObject.imageFiles.length > 1) {
      actions.push({
        name: '圖片切換',
        action: null,
        subActions: gameObject.imageFiles.map((image, i) => {
          return {
            name: `${gameObject.currntImageIndex == i ? '◉' : '○'}`,
            action: () => {
              gameObject.currntImageIndex = i;
              if (!gameObject.isHideIn && gameObject.location.name === 'table') SoundEffect.play(PresetSound.surprise);
              EventSystem.trigger('UPDATE_INVENTORY', null);
            },
            default: gameObject.currntImageIndex == i,
            icon: image,
            checkBox: 'radio'
          };
        }),
      });
      actions.push(ContextMenuSeparator);
    }
    actions.push((gameObject.isUseIconToOverviewImage
      ? {
        name: '☑ 總覽顯示大頭貼', action: () => {
          gameObject.isUseIconToOverviewImage = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      } : {
        name: '☐ 總覽顯示大頭貼', action: () => {
          gameObject.isUseIconToOverviewImage = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      }));
    actions.push((gameObject.isShowChatBubble
      ? {
        name: '☑ 顯示💭', action: () => {
          gameObject.isShowChatBubble = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      } : {
        name: '☐ 顯示💭', action: () => {
          gameObject.isShowChatBubble = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      }));
    actions.push(
      (gameObject.isDropShadow
      ? {
        name: '☑ 顯示陰影', action: () => {
          gameObject.isDropShadow = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      } : {
        name: '☐ 顯示陰影', action: () => {
          gameObject.isDropShadow = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      })
    );
    if (gameObject instanceof GameCharacter) {
      actions.push(this.characterFxMenu.makeAuraMenu(gameObject));
      actions.push(this.characterFxMenu.makeRingMenu(gameObject));
      actions.push(this.characterFxMenu.makeStatusMenu(gameObject));
      actions.push(this.characterFxMenu.makeCombatMenu(gameObject));
      actions.push(this.characterFxMenu.makeImageEffectMenu(gameObject, {
        isInverse: gameObject.isInverse,
        isHollow: gameObject.isHollow,
        isBlackPaint: gameObject.isBlackPaint,
        setInverse: v => gameObject.isInverse = v,
        setHollow: v => gameObject.isHollow = v,
        setBlackPaint: v => gameObject.isBlackPaint = v,
      }));
    }
    actions.push(ContextMenuSeparator);
    actions.push((!gameObject.isNotRide
      ? {
        name: '☑ 可疊在其他角色上', action: () => {
          gameObject.isNotRide = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      } : {
        name: '☐ 可疊在其他角色上', action: () => {
          gameObject.isNotRide = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      }));
    actions.push(
      (gameObject.isAltitudeIndicate
      ? {
        name: '☑ 顯示高度', action: () => {
          gameObject.isAltitudeIndicate = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      } : {
        name: '☐ 顯示高度', action: () => {
          gameObject.isAltitudeIndicate = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      })
    );
    actions.push(
    {
      name: '將高度設為0', action: () => {
        if (gameObject.altitude != 0) {
          gameObject.altitude = 0;
          if (gameObject.location.name === 'table') SoundEffect.play(PresetSound.sweep);
        }
      },
      altitudeHande: gameObject
    });
    actions.push(ContextMenuSeparator);
    actions.push({ name: '顯示詳情...', action: () => { this.showDetail(gameObject); } });
    actions.push(gameObject.isAllowsChat
      ? {
        name: '☑ 可進行聊天', action: () => {
          gameObject.isAllowsChat = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        disabled: gameObject.location.name === 'graveyard',
        checkBox: 'check'
      } : {
        name: '☐ 可進行聊天', action: () => {
          gameObject.isAllowsChat = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        disabled: gameObject.location.name === 'graveyard',
        checkBox: 'check'
      });
    //if (gameObject.location.name !== 'graveyard') {
      actions.push({ name: '顯示聊天面板...', action: () => { this.showChatPalette(gameObject) }, disabled: !gameObject.isAllowsChat || gameObject.location.name === 'graveyard' });
    //}
    actions.push({ name: '立繪設定...', action: () => { this.showStandSetting(gameObject) }, disabled: !gameObject.isAllowsChat || gameObject.location.name === 'graveyard' });
    actions.push(ContextMenuSeparator);
    actions.push({
      name: '開啟參考網址', action: null,
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
          error: !StringUtil.validUrl(url) ? '網址無效' : null,
          isOuterLink: StringUtil.validUrl(url) && !StringUtil.sameOrigin(url)
        };
      }),
      disabled: gameObject.getUrls().length <= 0
    });
    actions.push(ContextMenuSeparator);
    actions.push(gameObject.isInventoryIndicate
      ? {
        name: '☑ 在桌面倉庫中顯示', action: () => {
          gameObject.isInventoryIndicate = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      } : {
        name: '☐ 在桌面倉庫中顯示', action: () => {
          gameObject.isInventoryIndicate = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      });
    let locations = [
      { name: 'table', alias: '桌面' },
      { name: 'common', alias: '公用倉庫' },
      { name: Network.peerId, alias: '個人倉庫' },
      { name: 'graveyard', alias: '回收區' }
    ];
    actions.push({
      name: `從${ (locations.find((location) => { return location.name == gameObject.location.name }) || locations[1]).alias }移動`,
      action: null,
      subActions: locations
        .filter((location, i) => { return !(gameObject.location.name == location.name || (i == 1 && !locations.map(loc => loc.name).includes(gameObject.location.name))) })
        .map((location) => {
          return {
            name: `${location.alias}`,
            action: () => {
              let isStealthMode = GameCharacter.isStealthMode;
              EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameObject.identifier });
              gameObject.setLocation(location.name);
              this.selectionService.remove(gameObject);
              if (location.name === 'table' && gameObject.isHideIn && gameObject.isVisible && !isStealthMode && !PeerCursor.myCursor.isGMMode) {
                this.modalService.open(ConfirmationComponent, {
                  title: '隱身模式',
                  text: '已開啟隱身：其他人看不到你的游標位置。',
                  help: '只要桌面上有「僅自己可見」的角色，其他人就看不到你的游標位置。',
                  type: ConfirmationType.OK,
                  materialIcon: 'disabled_visible'
                });
              }
              if (location.name == 'graveyard') {
                SoundEffect.play(PresetSound.sweep);
              } else {
                SoundEffect.play(PresetSound.piecePut);
              }
              EventSystem.call('UPDATE_INVENTORY', true);
            }
          }
        }),
      disabled: !gameObject.isVisible && !this.isGMMode
    });
    /*
    for (let location of locations) {
      if (gameObject.location.name === location.name) continue;
      actions.push({
        name: location.alias, action: () => {
          gameObject.setLocation(location.name);
          SoundEffect.play(PresetSound.piecePut);
        }
      });
    }
    */
    actions.push(ContextMenuSeparator);
    actions.push({
      name: '建立副本', action: () => {
        this.cloneGameObject(gameObject);
        SoundEffect.play(PresetSound.piecePut);
      },
      disabled: !gameObject.isVisible && !this.isGMMode
    });
    actions.push({
      name: '建立副本（自動編號）', action: () => {
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
          if(!character.name.startsWith(baseName)) continue;
          let index = character.name.match(/_(\d+)$/) ? +RegExp.$1 : 0;
          if (index > maxIndex) maxIndex = index;
        }
        cloneObject.name = baseName + '_' + (maxIndex + 1);
        cloneObject.update();
        SoundEffect.play(PresetSound.piecePut);
      },
      disabled: !gameObject.isVisible && !this.isGMMode
    });
    if (gameObject.location.name === 'graveyard') {
      actions.push(ContextMenuSeparator);
      actions.push({
        name: '刪除（完全刪除）', action: () => {
          this.selectionService.remove(gameObject);
          this.deleteGameObject(gameObject);
          SoundEffect.play(PresetSound.sweep);
        }
      });
    } else {
      actions.push(ContextMenuSeparator);
      actions.push({
        name: '刪除（移至回收區）', action: () => {
          EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameObject.identifier });
          this.selectionService.remove(gameObject);
          gameObject.setLocation('graveyard');
          SoundEffect.play(PresetSound.sweep);
        }
      });
    }
    this.contextMenuService.open(position, actions, gameObject.name);
  }

  toggleEdit() {
    this.isEdit = !this.isEdit;
  }

  cleanInventory() {
    if (this.GuestMode()) return;
    let tabTitle = this.getTabTitle(this.selectTab);
    let gameObjects = this.getGameObjects(this.selectTab);
    this.modalService.open(ConfirmationComponent, {
      title: '清空回收區',
      text: '要完全刪除角色嗎？',
      helpHtml: `<b>${ StringUtil.escapeHtml(tabTitle) }</b>中存在的 <b>${ gameObjects.length }</b> 個角色將被完全刪除。`,
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

  private showDetail(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });
    let coordinate = this.pointerDeviceService.pointers[0];
    let title = '角色卡';
    if (gameObject.name.length) title += ' - ' + gameObject.name;
    let option: PanelOption = { title: title, left: coordinate.x - 800, top: coordinate.y - 300, width: 800, height: 600 };
    let component = this.panelService.open<GameCharacterSheetComponent>(GameCharacterSheetComponent, option);
    component.tabletopObject = gameObject;
  }

  private showChatPalette(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 250, top: coordinate.y - 175, width: 620, height: 350 };
    let component = this.panelService.open<ChatPaletteComponent>(ChatPaletteComponent, option);
    component.character = gameObject;
  }

  selectGameObject(gameObject: GameObject, e: Event=null) {
    if (this.GuestMode()) return;
    if (!(gameObject instanceof TabletopObject)) return;
    if (e && e instanceof MouseEvent && e.ctrlKey) {
      SoundEffect.playLocal(PresetSound.selectionStart);
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
      }
    }
  }

  focusGameObject(gameObject: GameCharacter, e: Event) {
    if (!(e.target instanceof HTMLElement)) return;
    if (new Set(['input', 'button']).has(e.target.tagName.toLowerCase())) return;
    if (e instanceof MouseEvent && e.ctrlKey) return;
    if (gameObject.location.name !== 'table' || (!gameObject.isVisible && !this.isGMMode)) return;
    EventSystem.trigger('FOCUS_TABLETOP_OBJECT', { x: gameObject.location.x + gameObject.size * 50 / 2, y: gameObject.location.y + gameObject.size * 50 / 2, z: gameObject.posZ + (gameObject.altitude > 0 ? gameObject.altitude * 50 : 0) });
  }

  private deleteGameObject(gameObject: GameObject) {
    if (this.GuestMode()) return;
    gameObject.destroy();
    this.changeDetector.markForCheck();
  }

  private showStandSetting(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 400, top: coordinate.y - 175, width: 730, height: 572 };
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

  suggestWords(): string[] {
    return ['name', 'size'].concat([...new Set(this.inventoryService.dataTags)].filter(dataTag => dataTag != '/' && dataTag != '／').sort());
  }
}
