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
import { I18nService } from 'service/i18n.service';

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
        this.inventoryTypes = ['table', 'common', Network.peerId, 'graveyard'];
        if (!this.inventoryTypes.includes(this.selectTab)) {
          this.selectTab = Network.peerId;
        }
      })
      .on('LOCALE_CHANGED', () => {
        this.refreshPanelTitle();
        this.changeDetector.markForCheck();
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
          name: this.i18n.t('char.moveAllToPersonal'), action: () => {
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
          name: this.i18n.t('char.moveAllToGraveyard'), action: () => {
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
        name: this.i18n.t('char.selectedCharacters'),
        action: null,
        subActions: subActions
      });
      actions.push(ContextMenuSeparator);
    }

    if (gameObject.location.name === 'table' && (this.isGMMode || gameObject.isVisible)) {
      actions.push({
        name: this.i18n.t('char.findOnTable'),
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
      });
    }

    if (gameObject.isHideIn) {
      actions.push({
        name: this.i18n.t('char.revealPosition'),
        action: () => {
          gameObject.owner = '';
          SoundEffect.play(PresetSound.piecePut);
          EventSystem.trigger('UPDATE_INVENTORY', null);
        }
      });
    }
    if (!gameObject.isHideIn || !gameObject.isVisible) {
      actions.push({
        name: this.i18n.t('char.selfOnlyStealth'),
        action: () => {
          if (gameObject.location.name === 'table' && !GameCharacter.isStealthMode && !PeerCursor.myCursor.isGMMode) {
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
      });
    }
    actions.push(ContextMenuSeparator);
    if (gameObject.imageFiles.length > 1) {
      actions.push({
        name: this.i18n.t('char.imageSwitch'),
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
    const hasFace = this.hasOverviewFaceIcon(gameObject);
    if (!hasFace && gameObject.isUseIconToOverviewImage) {
      gameObject.isUseIconToOverviewImage = false;
    }
    actions.push((gameObject.isUseIconToOverviewImage && hasFace
      ? {
        name: this.i18n.t('char.overviewFaceOn'), action: () => {
          gameObject.isUseIconToOverviewImage = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      } : {
        name: this.i18n.t('char.overviewFaceOff'), action: () => {
          if (!this.hasOverviewFaceIcon(gameObject)) return;
          gameObject.isUseIconToOverviewImage = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check',
        disabled: !hasFace,
        error: hasFace ? null : this.i18n.t('char.overviewFaceRequired'),
      }));
    actions.push((gameObject.isShowChatBubble
      ? {
        name: this.i18n.t('char.chatBubbleOn'), action: () => {
          gameObject.isShowChatBubble = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      } : {
        name: this.i18n.t('char.chatBubbleOff'), action: () => {
          gameObject.isShowChatBubble = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      }));
    actions.push(
      (gameObject.isDropShadow
      ? {
        name: this.i18n.t('char.shadowOn'), action: () => {
          gameObject.isDropShadow = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      } : {
        name: this.i18n.t('char.shadowOff'), action: () => {
          gameObject.isDropShadow = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      })
    );
    if (gameObject instanceof GameCharacter) {
      actions.push(this.characterFxMenu.makeMyTokenMenu(gameObject));
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
        name: this.i18n.t('char.stackOn'), action: () => {
          gameObject.isNotRide = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      } : {
        name: this.i18n.t('char.stackOff'), action: () => {
          gameObject.isNotRide = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      }));
    actions.push(
      (gameObject.isAltitudeIndicate
      ? {
        name: this.i18n.t('char.altitudeOn'), action: () => {
          gameObject.isAltitudeIndicate = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      } : {
        name: this.i18n.t('char.altitudeOff'), action: () => {
          gameObject.isAltitudeIndicate = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      })
    );
    actions.push(
    {
      name: this.i18n.t('char.resetAltitude'), action: () => {
        if (gameObject.altitude != 0) {
          gameObject.altitude = 0;
          if (gameObject.location.name === 'table') SoundEffect.play(PresetSound.sweep);
        }
      },
      altitudeHande: gameObject
    });
    actions.push(ContextMenuSeparator);
    actions.push({ name: this.i18n.t('char.showDetail'), action: () => { this.showDetail(gameObject); } });
    actions.push(gameObject.isAllowsChat
      ? {
        name: this.i18n.t('char.chatOn'), action: () => {
          gameObject.isAllowsChat = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        disabled: gameObject.location.name === 'graveyard',
        checkBox: 'check'
      } : {
        name: this.i18n.t('char.chatOff'), action: () => {
          gameObject.isAllowsChat = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        disabled: gameObject.location.name === 'graveyard',
        checkBox: 'check'
      });
    //if (gameObject.location.name !== 'graveyard') {
      actions.push({ name: this.i18n.t('char.showChatPalette'), action: () => { this.showChatPalette(gameObject) }, disabled: !gameObject.isAllowsChat || gameObject.location.name === 'graveyard' });
    //}
    actions.push({ name: this.i18n.t('char.standSetting'), action: () => { this.showStandSetting(gameObject) }, disabled: !gameObject.isAllowsChat || gameObject.location.name === 'graveyard' });
    actions.push(ContextMenuSeparator);
    actions.push({
      name: this.i18n.t('char.openReferenceUrl'), action: null,
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
    });
    actions.push(ContextMenuSeparator);
    actions.push(gameObject.isInventoryIndicate
      ? {
        name: this.i18n.t('char.inventoryOn'), action: () => {
          gameObject.isInventoryIndicate = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      } : {
        name: this.i18n.t('char.inventoryOff'), action: () => {
          gameObject.isInventoryIndicate = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        checkBox: 'check'
      });
    let locations = [
      { name: 'table', aliasKey: 'char.table' },
      { name: 'common', aliasKey: 'char.commonInventory' },
      { name: Network.peerId, aliasKey: 'char.personalInventory' },
      { name: 'graveyard', aliasKey: 'char.graveyard' }
    ];
    actions.push({
      name: this.i18n.t('char.moveFrom', { from: this.i18n.t((locations.find((location) => { return location.name == gameObject.location.name }) || locations[1]).aliasKey) }),
      action: null,
      subActions: locations
        .filter((location, i) => { return !(gameObject.location.name == location.name || (i == 1 && !locations.map(loc => loc.name).includes(gameObject.location.name))) })
        .map((location) => {
          return {
            name: this.i18n.t(location.aliasKey),
            action: () => {
              let isStealthMode = GameCharacter.isStealthMode;
              EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameObject.identifier });
              gameObject.setLocation(location.name);
              this.selectionService.remove(gameObject);
              if (location.name === 'table' && gameObject.isHideIn && gameObject.isVisible && !isStealthMode && !PeerCursor.myCursor.isGMMode) {
                this.modalService.open(ConfirmationComponent, {
                  title: this.i18n.t('char.stealthTitle'),
                  text: this.i18n.t('char.stealthText'),
                  help: this.i18n.t('char.stealthHelp'),
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
      name: this.i18n.t('char.clone'), action: () => {
        this.cloneGameObject(gameObject);
        SoundEffect.play(PresetSound.piecePut);
      },
      disabled: !gameObject.isVisible && !this.isGMMode
    });
    actions.push({
      name: this.i18n.t('char.cloneNumbered'), action: () => {
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
        name: this.i18n.t('char.deleteForever'), action: () => {
          this.selectionService.remove(gameObject);
          this.deleteGameObject(gameObject);
          SoundEffect.play(PresetSound.sweep);
        }
      });
    } else {
      actions.push(ContextMenuSeparator);
      actions.push({
        name: this.i18n.t('char.deleteToGraveyard'), action: () => {
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

  private showDetail(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });
    let coordinate = this.pointerDeviceService.pointers[0];
    let title = this.i18n.t('char.sheetTitle');
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

  /** Stop panel appDraggable from treating this as a window move. */
  onInventoryDragGestureStart(e: Event, gameObject: GameCharacter) {
    if (!this.canDragInventory(gameObject)) return;
    e.stopPropagation();
  }

  onInventoryDragStart(e: DragEvent, gameObject: GameCharacter) {
    if (!this.canDragInventory(gameObject) || !e.dataTransfer) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    e.dataTransfer.setData(GameCharacter.INVENTORY_DRAG_MIME, gameObject.identifier);
    e.dataTransfer.setData('text/plain', `udonarium-character:${gameObject.identifier}`);
    e.dataTransfer.effectAllowed = 'move';
  }

  onInventoryDragEnd() {
    this.dropTargetTab = '';
    this.changeDetector.markForCheck();
  }

  onInventoryTabDragOver(e: DragEvent, inventoryType: string) {
    if (!this.readInventoryDragId(e)) return;
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
    const id = this.readInventoryDragId(e);
    this.dropTargetTab = '';
    if (!id || id === '__pending__') return;
    e.preventDefault();
    e.stopPropagation();
    if (this.GuestMode()) return;
    const ch = ObjectStore.instance.get(id);
    if (!(ch instanceof GameCharacter)) return;
    if (!ch.isVisible && !this.isGMMode) return;
    if (ch.location?.name === inventoryType) {
      this.changeDetector.markForCheck();
      return;
    }
    this.moveCharacterToLocation(ch, inventoryType);
    if (this.selectTab !== inventoryType) this.selectTab = inventoryType;
    this.changeDetector.markForCheck();
  }

  private moveCharacterToLocation(gameObject: GameCharacter, location: string) {
    const isStealthMode = GameCharacter.isStealthMode;
    EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameObject.identifier });
    gameObject.setLocation(location);
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
    SoundEffect.play(location === 'graveyard' ? PresetSound.sweep : PresetSound.piecePut);
    EventSystem.call('UPDATE_INVENTORY', true);
  }

  private readInventoryDragId(e: DragEvent): string {
    if (!e.dataTransfer) return '';
    const typed = e.dataTransfer.getData(GameCharacter.INVENTORY_DRAG_MIME);
    if (typed) return typed;
    if (e.type === 'dragover') {
      const types = Array.from(e.dataTransfer.types || []);
      if (types.includes(GameCharacter.INVENTORY_DRAG_MIME)) return '__pending__';
      return types.includes('text/plain') ? '__pending__' : '';
    }
    const plain = e.dataTransfer.getData('text/plain') || '';
    const m = /^udonarium-character:(.+)$/.exec(plain);
    return m ? m[1] : '';
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

  private refreshPanelTitle() {
    this.panelService.title = this.i18n.t('inv.title');
  }

  suggestWords(): string[] {
    return ['name', 'size'].concat([...new Set(this.inventoryService.dataTags)].filter(dataTag => dataTag != '/' && dataTag != '／').sort());
  }
}
