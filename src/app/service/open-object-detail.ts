import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { CharacterToken } from '@udonarium/character-token';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { DiceSymbol } from '@udonarium/dice-symbol';
import { GameCharacter } from '@udonarium/game-character';
import { GameTableMask } from '@udonarium/game-table-mask';
import { RangeArea } from '@udonarium/range';
import { Terrain } from '@udonarium/terrain';
import { TextNote } from '@udonarium/text-note';

import { CardSettingsComponent } from 'component/card-settings/card-settings.component';
import { CardStackSettingsComponent } from 'component/card-stack-settings/card-stack-settings.component';
import { CharacterSettingsComponent } from 'component/character-settings/character-settings.component';
import { DiceSettingsComponent } from 'component/dice-settings/dice-settings.component';
import { MaskSettingsComponent } from 'component/mask-settings/mask-settings.component';
import { NoteSettingsComponent } from 'component/note-settings/note-settings.component';
import { RangeSettingsComponent } from 'component/range-settings/range-settings.component';
import { TerrainSettingsComponent } from 'component/terrain-settings/terrain-settings.component';

import { I18nService } from 'service/i18n.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';

/** Open the settings / detail sheet for a tabletop object by identifier. */
export function openObjectDetailById(
  objectId: string,
  deps: {
    panelService: PanelService;
    pointerDeviceService: PointerDeviceService;
    i18n: I18nService;
  },
): boolean {
  if (!objectId || Network.GuestMode()) return false;
  const obj = ObjectStore.instance.get(objectId);
  if (!obj) return false;

  const { panelService, pointerDeviceService, i18n } = deps;
  const ptr = pointerDeviceService.pointers[0] || { x: 200, y: 160 };

  if (obj instanceof Card) {
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: obj.identifier, className: obj.aliasName });
    let title = i18n.t('card.panelTitle');
    if (obj.name.length) title += ' - ' + (obj.isVisible ? obj.name : i18n.t('card.back'));
    return openPanel(panelService, obj.identifier, obj.aliasName, title, ptr.x - 210, ptr.y - 160, 420, 360, (c: CardSettingsComponent) => {
      c.card = obj;
    }, CardSettingsComponent);
  }

  if (obj instanceof CardStack) {
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: obj.identifier, className: obj.aliasName });
    let title = i18n.t('stack.panelTitle');
    if (obj.name.length) title += ' - ' + obj.name;
    return openPanel(panelService, obj.identifier, obj.aliasName, title, ptr.x - 210, ptr.y - 140, 420, 320, (c: CardStackSettingsComponent) => {
      c.cardStack = obj;
    }, CardStackSettingsComponent);
  }

  if (obj instanceof TextNote) {
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: obj.identifier, className: obj.aliasName });
    let title = i18n.t('note.detailTitle');
    if (obj.title.length) title += ' - ' + obj.title;
    return openPanel(panelService, obj.identifier, obj.aliasName, title, ptr.x - 280, ptr.y - 180, 420, 440, (c: NoteSettingsComponent) => {
      c.note = obj;
      c.embedded = false;
    }, NoteSettingsComponent);
  }

  if (obj instanceof CharacterToken) {
    const body = ObjectStore.instance.get(obj.characterId);
    if (!(body instanceof GameCharacter)) return false;
    let title = i18n.t('char.sheetTitle');
    if (body.name.length) title += ' - ' + body.name;
    return openPanel(panelService, body.identifier, body.aliasName, title, ptr.x - 270, ptr.y - 240, 540, 480, (c: CharacterSettingsComponent) => {
      c.character = body;
      c.token = obj;
    }, CharacterSettingsComponent);
  }

  if (obj instanceof GameCharacter) {
    let title = i18n.t('char.sheetTitle');
    if (obj.name.length) title += ' - ' + obj.name;
    return openPanel(panelService, obj.identifier, obj.aliasName, title, ptr.x - 270, ptr.y - 240, 540, 480, (c: CharacterSettingsComponent) => {
      c.character = obj;
    }, CharacterSettingsComponent);
  }

  if (obj instanceof Terrain) {
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: obj.identifier, className: obj.aliasName });
    let title = i18n.t('terrain.panelTitle');
    if (obj.name.length) title += ' - ' + obj.name;
    return openPanel(panelService, obj.identifier, obj.aliasName, title, ptr.x - 210, ptr.y - 180, 420, 400, (c: TerrainSettingsComponent) => {
      c.terrain = obj;
    }, TerrainSettingsComponent);
  }

  if (obj instanceof DiceSymbol) {
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: obj.identifier, className: obj.aliasName });
    let title = i18n.t('dice.panelTitle');
    if (obj.name.length) title += ' - ' + obj.name;
    return openPanel(panelService, obj.identifier, obj.aliasName, title, ptr.x - 210, ptr.y - 180, 420, 400, (c: DiceSettingsComponent) => {
      c.dice = obj;
    }, DiceSettingsComponent);
  }

  if (obj instanceof GameTableMask) {
    let title = i18n.t('mask.panelTitle');
    if (obj.name.length) title += ' - ' + obj.name;
    return openPanel(panelService, obj.identifier, obj.aliasName, title, ptr.x - 200, ptr.y - 140, 400, 400, (c: MaskSettingsComponent) => {
      c.mask = obj;
      c.embedded = false;
    }, MaskSettingsComponent);
  }

  if (obj instanceof RangeArea) {
    let title = i18n.t('range.panelTitle');
    if (obj.name.length) title += ' - ' + obj.name;
    return openPanel(panelService, obj.identifier, obj.aliasName, title, ptr.x - 210, ptr.y - 180, 420, 400, (c: RangeSettingsComponent) => {
      c.range = obj;
    }, RangeSettingsComponent);
  }

  return false;
}

function openPanel<T>(
  panelService: PanelService,
  objectId: string,
  aliasName: string,
  title: string,
  left: number,
  top: number,
  width: number,
  height: number,
  assign: (component: T) => void,
  type: new (...args: any[]) => T,
): boolean {
  const tourId = PanelService.tourIdObjectDetail(objectId);
  if (PanelService.bringTourPanelToFront(tourId, { title })) return true;
  const option: PanelOption = {
    title,
    left,
    top,
    width,
    height,
    tourPanelId: tourId,
    geometryKey: PanelService.sheetGeometryKey(aliasName),
  };
  const component = panelService.open<T>(type, option);
  assign(component);
  return true;
}
