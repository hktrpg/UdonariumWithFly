import { Injectable } from '@angular/core';
import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { ClueLink } from '@udonarium/clue-link';
import { ImageContext, ImageFile } from '@udonarium/core/file-storage/image-file';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { EventSystem, Network } from '@udonarium/core/system';
import { DiceSymbol, DiceType } from '@udonarium/dice-symbol';
import { GameCharacter } from '@udonarium/game-character';
import { GameTable } from '@udonarium/game-table';
import { GameTableMask } from '@udonarium/game-table-mask';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TableSelecter } from '@udonarium/table-selecter';
import { TabletopObject } from '@udonarium/tabletop-object';
import { Terrain } from '@udonarium/terrain';
import { TextNote } from '@udonarium/text-note';
import { a4HeightForWidth, pinAngleFromId, PushPinColor, TokenFrameStyle } from '@udonarium/table-fx/push-pin.util';

import { ContextMenuAction } from './context-menu.service';
import { I18nService } from './i18n.service';
import { PointerCoordinate } from './pointer-device.service';

import { ImageTag } from '@udonarium/image-tag';
import { RangeArea } from '@udonarium/range';

/** Fixed sync ids for the two first-load default maps. */
export const DEFAULT_TABLE_3D_ID = 'gameTable';
export const DEFAULT_TABLE_2D_ID = 'gameTable_clue2d';
export const DEFAULT_BG_3D_IMAGE_ID = 'testTableBackgroundImage_image';
export const DEFAULT_BG_2D_IMAGE_ID = 'clueBoardBackgroundImage_image';

@Injectable({
  providedIn: 'root'
})
export class TabletopActionService {

  constructor(private i18n: I18nService) { }

  GuestMode() {
    return Network.GuestMode();
  }

  createGameCharacter(position: PointerCoordinate): GameCharacter {
    if (this.GuestMode()) return;
    let character = GameCharacter.create(this.i18n.t('action.newCharacter'), 1, '');
    character.location.x = position.x - 25;
    character.location.y = position.y - 25;
    character.posZ = position.z;
    character.setLocation('table');
    return character;
  }

  createGameTableMask(position: PointerCoordinate): GameTableMask {
    if (this.GuestMode()) return;
    let viewTable = this.getViewTable();
    if (!viewTable) return;

    let tableMask = GameTableMask.create(this.i18n.t('action.mapMaskName'), 5, 5, 100);
    tableMask.location.x = position.x - 25;
    tableMask.location.y = position.y - 25;
    tableMask.posZ = position.z;

    viewTable.appendChild(tableMask);
    return tableMask;
  }

  createTerrain(position: PointerCoordinate): Terrain {
    if (this.GuestMode()) return;
    let url: string = './assets/images/tex.jpg';
    let image: ImageFile = ImageStorage.instance.get(url);
    //if (!image) image = ImageStorage.instance.add(url);
    if (!image) {
      image = ImageStorage.instance.add(url);
      ImageTag.create(image.identifier).tag = '*default ' + this.i18n.t('action.terrainName');
    }

    let viewTable = this.getViewTable();
    if (!viewTable) return;

    let terrain = Terrain.create(this.i18n.t('action.terrainName'), 2, 2, 2, image.identifier, image.identifier);
    terrain.location.x = position.x - 50;
    terrain.location.y = position.y - 50;
    terrain.posZ = position.z;

    viewTable.appendChild(terrain);
    return terrain;
  }

  createTextNote(position: PointerCoordinate): TextNote {
    if (this.GuestMode()) return;
    let textNote = TextNote.create(this.i18n.t('action.noteName'), this.i18n.t('action.noteBody'), 5, 4, 3);
    textNote.location.x = position.x;
    textNote.location.y = position.y;
    textNote.posZ = position.z;
    // 2D boards: notes are always face-up on the table (never billboard upright).
    if (TableSelecter.instance.viewTable?.is2DMode) textNote.isUpright = false;
    textNote.setLocation('table');
    return textNote;
  }


  createDiceSymbol(position: PointerCoordinate, name: string, diceType: DiceType, imagePathPrefix: string): DiceSymbol {
    if (this.GuestMode()) return;
    let diceSymbol = DiceSymbol.create(name, diceType, 1);
    let image: ImageFile = null;

    diceSymbol.nothingFaces.forEach(face => {
      let url: string = `./assets/images/dice/${imagePathPrefix}/${imagePathPrefix}[0].png`;
      image = ImageStorage.instance.get(url)
      //if (!image) { image = ImageStorage.instance.add(url); }
      if (!image) {
        image = ImageStorage.instance.add(url);
        ImageTag.create(image.identifier).tag = `*default ${ diceType === DiceType.D2 ? this.i18n.t('action.coinName') : this.i18n.t('action.diceName')}`;
      }
      diceSymbol.imageDataElement.getFirstElementByName(face).value = image.identifier;
    });
    
    diceSymbol.faces.forEach(face => {
      let url: string = `./assets/images/dice/${imagePathPrefix}/${imagePathPrefix}[${face}].png`;
      image = ImageStorage.instance.get(url);
      //if (!image) { image = ImageStorage.instance.add(url); }
      if (!image) {
        image = ImageStorage.instance.add(url);
        ImageTag.create(image.identifier).tag = `*default ${ diceType === DiceType.D2 ? this.i18n.t('action.coinName') : this.i18n.t('action.diceName')}`;
      }
      diceSymbol.imageDataElement.getFirstElementByName(face).value = image.identifier;
    });

    diceSymbol.location.x = position.x - 25;
    diceSymbol.location.y = position.y - 25;
    diceSymbol.posZ = position.z;
    diceSymbol.setLocation('table');
    return diceSymbol;
  }

  createBlankCard(position: PointerCoordinate): Card {
    if (this.GuestMode()) return;
    const frontUrl = './assets/images/trump/blank_card.png';
    const backUrl = './assets/images/trump/z01.gif';
    let frontImage: ImageFile;
    let backImage: ImageFile;

    frontImage = ImageStorage.instance.get(frontUrl);
    if (!frontImage) {
      frontImage = ImageStorage.instance.add(frontUrl);
      ImageTag.create(frontImage.identifier).tag = '*default ' + this.i18n.t('action.cardName');
    }
    backImage = ImageStorage.instance.get(backUrl);
    if (!backImage) {
      backImage = ImageStorage.instance.add(backUrl);
      ImageTag.create(backImage.identifier).tag = '*default ' + this.i18n.t('action.cardName');
    }
    let card = Card.create(this.i18n.t('action.cardName'), frontImage.identifier, backImage.identifier);
    card.location.x = position.x - 25;
    card.location.y = position.y - 25;
    card.posZ = position.z;
    card.setLocation('table');
    return card;
  }

  private cardName(code: string) {
    let ret = '';
    const suit = code.slice(0, 1);
    const number = parseInt(code.substring(1, 3));
    const jqk = ['J', 'Q', 'K']
    switch(suit) {
      case 'c':
        ret = this.i18n.t('action.suit.club')
        break;
      case 'd':
        ret = this.i18n.t('action.suit.diamond')
        break;
      case 'h':
        ret = this.i18n.t('action.suit.heart')
        break;
      case 's':
        ret = this.i18n.t('action.suit.spade')
        break;
      case 'x':
        ret = this.i18n.t('action.suit.joker')
        break;
    }
    if (suit == 'x') {
      ret += `（${(number == 1) ? this.i18n.t('action.suit.red') : this.i18n.t('action.suit.black') }）`;
    } else {
      ret += `${this.i18n.t('action.suit.of')}${number == 1 ? 'A' : number >= 11 ? jqk[number - 11] : number }`
    }
    return ret;
  }

  createTrump(position: PointerCoordinate): CardStack {
    if (this.GuestMode()) return;
    let cardStack = CardStack.create(this.i18n.t('action.pokerDeck'));
    cardStack.location.x = position.x - 25;
    cardStack.location.y = position.y - 25;
    cardStack.posZ = position.z;
    cardStack.setLocation('table');

    let back: string = './assets/images/trump/z02.gif';
    if (!ImageStorage.instance.get(back)) {
      //ImageStorage.instance.add(back);
      const image = ImageStorage.instance.add(back);
      ImageTag.create(image.identifier).tag = '*default ' + this.i18n.t('action.cardName');
    }

    let suits: string[] = ['c', 'd', 'h', 's'];
    let trumps: string[] = [];

    for (let suit of suits) {
      for (let i = 1; i <= 13; i++) {
        trumps.push(suit + (('00' + i).slice(-2)));
      }
    }

    trumps.push('x01');
    trumps.push('x02');

    for (let trump of trumps) {
      let url: string = './assets/images/trump/' + trump + '.gif';
      if (!ImageStorage.instance.get(url)) {
        //ImageStorage.instance.add(url);
        const image = ImageStorage.instance.add(url);
        ImageTag.create(image.identifier).tag = '*default ' + this.i18n.t('action.cardName');
      }
      let card = Card.create(this.cardName(trump), url, back);
      //let card = Card.create('卡牌', url, back);
      cardStack.putOnBottom(card);
    }
    return cardStack;
  }

  createRangeArea(position: PointerCoordinate, typeName: string): RangeArea {
    let range;
    switch (typeName) {
      case 'LINE':
        range = RangeArea.create(this.i18n.t('action.rangeLineName'), 1, 6, 100);
        break;
      case 'CIRCLE':
        range = RangeArea.create(this.i18n.t('action.rangeCircleName'), 3, 3, 100);
        break;
      case 'SQUARE':
        range = RangeArea.create(this.i18n.t('action.rangeSquareName'), 3, 3, 100);
        break;
      case 'DIAMOND':
        range = RangeArea.create(this.i18n.t('action.rangeDiamondName'), 3, 3, 100);
        break;
      case 'CORN':
      default:
        range = RangeArea.create(this.i18n.t('action.rangeConeName'), 6, 6, 100);
        break;
    }

    range.location.x = position.x;
    range.location.y = position.y;
    range.posZ = position.z;
    range.type = typeName;
    range.setLocation('table');
    let data = range.commonDataElement.getFirstElementByName('opacity');
    //console.log( '射程範圍TEST' + data);
    data.currentValue = 60;
    return range;
  }

  makeDefaultTable() {
    // 3D battle map (legacy image id — also used by "create blank table")
    const bg3dCtx = ImageFile.createEmpty(DEFAULT_BG_3D_IMAGE_ID).toContext();
    bg3dCtx.url = './assets/images/BG10a_80.jpg';
    const bg3d = ImageStorage.instance.add(bg3dCtx);
    ImageTag.create(bg3d.identifier).tag = '*default ' + this.i18n.t('char.table');

    const table3d = new GameTable(DEFAULT_TABLE_3D_ID);
    table3d.name = this.i18n.t('sample.battle.tableName');
    table3d.imageIdentifier = bg3d.identifier;
    table3d.width = 20;
    table3d.height = 15;
    table3d.is2DMode = false;
    table3d.initialize();

    // 2D clue board
    const bg2dCtx = ImageFile.createEmpty(DEFAULT_BG_2D_IMAGE_ID).toContext();
    bg2dCtx.url = './assets/images/clue-board/corkboard.jpg';
    const bg2d = ImageStorage.instance.add(bg2dCtx);
    ImageTag.create(bg2d.identifier).tag = '*default ' + this.i18n.t('sample.clue.tableName');

    const table2d = new GameTable(DEFAULT_TABLE_2D_ID);
    table2d.name = this.i18n.t('sample.clue.tableName');
    table2d.imageIdentifier = bg2d.identifier;
    table2d.width = 20;
    table2d.height = 15;
    table2d.is2DMode = true;
    table2d.gridColor = '#3a201880';
    table2d.initialize();

    // Initial view: 2D clue board (tech demo)
    table3d.selected = false;
    table2d.selected = true;
    TableSelecter.instance.viewTableIdentifier = table2d.identifier;
    TableSelecter.instance.viewedTableIdentifier = table2d.identifier;
    EventSystem.trigger('SELECT_GAME_TABLE', { identifier: table2d.identifier });
  }

  makeDefaultTabletopObjects() {
    this.seedClassicBattleObjects(DEFAULT_TABLE_3D_ID);
    this.seedClueBoardObjects(DEFAULT_TABLE_2D_ID);
    TabletopObject.migrateUnboundTablePieces(DEFAULT_TABLE_2D_ID);
  }

  private seedClassicBattleObjects(tableId: string) {
    let testCharacter: GameCharacter = null;
    let testFile: ImageFile = null;
    let fileContext: ImageContext = null;

    testCharacter = new GameCharacter('testCharacter_1');
    fileContext = ImageFile.createEmpty('testCharacter_1_image').toContext();
    fileContext.url = './assets/images/mon_052.gif';
    testFile = ImageStorage.instance.add(fileContext);
    ImageTag.create(testFile.identifier).tag = '*default ' + this.i18n.t('action.newCharacter');
    testCharacter.location.x = 5 * 50;
    testCharacter.location.y = 9 * 50;
    testCharacter.initialize();
    testCharacter.createTestGameDataElement(this.i18n.t('sample.monsterA'), 1, testFile.identifier);
    testCharacter.setLocation('table', tableId);

    testCharacter = new GameCharacter('testCharacter_2');
    testCharacter.location.x = 8 * 50;
    testCharacter.location.y = 8 * 50;
    testCharacter.initialize();
    testCharacter.createTestGameDataElement(this.i18n.t('sample.monsterB'), 1, testFile.identifier);
    testCharacter.setLocation('table', tableId);

    testCharacter = new GameCharacter('testCharacter_3');
    fileContext = ImageFile.createEmpty('testCharacter_3_image').toContext();
    fileContext.url = './assets/images/mon_128.gif';
    testFile = ImageStorage.instance.add(fileContext);
    ImageTag.create(testFile.identifier).tag = '*default ' + this.i18n.t('action.newCharacter');
    testCharacter.location.x = 4 * 50;
    testCharacter.location.y = 2 * 50;
    testCharacter.initialize();
    testCharacter.createTestGameDataElement(this.i18n.t('sample.monsterC'), 3, testFile.identifier);
    testCharacter.setLocation('table', tableId);

    testCharacter = new GameCharacter('testCharacter_4');
    fileContext = ImageFile.createEmpty('testCharacter_4_image').toContext();
    fileContext.url = './assets/images/mon_150.gif';
    testFile = ImageStorage.instance.add(fileContext);
    ImageTag.create(testFile.identifier).tag = '*default ' + this.i18n.t('action.newCharacter');
    testCharacter.location.x = 6 * 50;
    testCharacter.location.y = 11 * 50;
    testCharacter.initialize();
    testCharacter.createTestGameDataElement(this.i18n.t('sample.characterA'), 1, testFile.identifier);
    testCharacter.setLocation('table', tableId);

    testCharacter = new GameCharacter('testCharacter_5');
    fileContext = ImageFile.createEmpty('testCharacter_5_image').toContext();
    fileContext.url = './assets/images/mon_211.gif';
    testFile = ImageStorage.instance.add(fileContext);
    ImageTag.create(testFile.identifier).tag = '*default ' + this.i18n.t('action.newCharacter');
    testCharacter.location.x = 12 * 50;
    testCharacter.location.y = 12 * 50;
    testCharacter.initialize();
    testCharacter.createTestGameDataElement(this.i18n.t('sample.characterB'), 1, testFile.identifier);
    testCharacter.setLocation('table', tableId);

    testCharacter = new GameCharacter('testCharacter_6');
    fileContext = ImageFile.createEmpty('testCharacter_6_image').toContext();
    fileContext.url = './assets/images/mon_135.gif';
    testFile = ImageStorage.instance.add(fileContext);
    ImageTag.create(testFile.identifier).tag = '*default ' + this.i18n.t('action.newCharacter');
    testCharacter.location.x = 5 * 50;
    testCharacter.location.y = 13 * 50;
    testCharacter.initialize();
    testCharacter.createTestGameDataElement(this.i18n.t('sample.characterC'), 1, testFile.identifier);
    testCharacter.setLocation('table', tableId);
  }

  private seedClueBoardObjects(tableId: string) {
    const clueA = this.seedClueCharacter('clueCharacter_1', './assets/images/mon_150.gif',
      this.i18n.t('sample.clue.suspectA'), 3 * 50, 4 * 50, tableId, 'polaroid', 'red', -8);
    const clueB = this.seedClueCharacter('clueCharacter_2', './assets/images/mon_211.gif',
      this.i18n.t('sample.clue.suspectB'), 10 * 50, 3 * 50, tableId, 'photo', 'yellow', 12);
    const clueC = this.seedClueCharacter('clueCharacter_3', './assets/images/mon_135.gif',
      this.i18n.t('sample.clue.evidence'), 14 * 50, 8 * 50, tableId, 'card', 'white', -15);
    const clueD = this.seedClueCharacter('clueCharacter_4', './assets/images/mon_052.gif',
      this.i18n.t('sample.clue.witness'), 6 * 50, 10 * 50, tableId, 'polaroid', 'green', 6);

    const noteA4 = TextNote.create(
      this.i18n.t('sample.clue.caseTitle'),
      this.i18n.t('sample.clue.caseBody'),
      12, 4, a4HeightForWidth(4), 'clueNote_a4');
    noteA4.location.x = 11 * 50;
    noteA4.location.y = 5 * 50;
    noteA4.rotate = -4;
    noteA4.isUpright = false;
    noteA4.applyPaperStyle('a4');
    noteA4.pushPin = true;
    noteA4.pushPinAngle = pinAngleFromId(noteA4.identifier);
    noteA4.pushPinColor = 'red';
    noteA4.setLocation('table', tableId);

    const sticky = TextNote.create(
      this.i18n.t('sample.clue.stickyTitle'),
      this.i18n.t('sample.clue.stickyBody'),
      14, 2, 2, 'clueNote_sticky');
    sticky.location.x = 4 * 50;
    sticky.location.y = 7 * 50;
    sticky.rotate = 7;
    sticky.isUpright = false;
    sticky.applyPaperStyle('sticky');
    sticky.pushPin = true;
    sticky.pushPinAngle = pinAngleFromId(sticky.identifier);
    sticky.pushPinColor = 'yellow';
    sticky.setLocation('table', tableId);

    ClueLink.create(clueA.identifier, clueB.identifier, { sag: 0.28, tableIdentifier: tableId, identifier: 'clueLink_1' });
    ClueLink.create(clueB.identifier, clueC.identifier, { sag: 0.2, tableIdentifier: tableId, identifier: 'clueLink_2' });
    ClueLink.create(clueA.identifier, noteA4.identifier, { sag: 0.32, tableIdentifier: tableId, identifier: 'clueLink_3' });
    ClueLink.create(clueD.identifier, sticky.identifier, { sag: 0.18, tableIdentifier: tableId, identifier: 'clueLink_4' });
    ClueLink.create(clueC.identifier, clueD.identifier, { sag: 0.25, tableIdentifier: tableId, identifier: 'clueLink_5' });
  }

  private seedClueCharacter(
    id: string,
    imageUrl: string,
    name: string,
    x: number,
    y: number,
    tableId: string,
    frame: TokenFrameStyle,
    pinColor: PushPinColor,
    rotate: number,
  ): GameCharacter {
    const fileContext = ImageFile.createEmpty(id + '_image').toContext();
    fileContext.url = imageUrl;
    const testFile = ImageStorage.instance.add(fileContext);
    ImageTag.create(testFile.identifier).tag = '*default ' + this.i18n.t('action.newCharacter');
    const ch = new GameCharacter(id);
    ch.location.x = x;
    ch.location.y = y;
    ch.rotate = rotate;
    ch.initialize();
    ch.createTestGameDataElement(name, 1, testFile.identifier);
    ch.tokenFrame = frame;
    ch.tokenFrameCaption = name;
    ch.isShowName = true;
    ch.pushPin = true;
    ch.pushPinAngle = pinAngleFromId(id);
    ch.pushPinColor = pinColor;
    ch.setLocation('table', tableId);
    return ch;
  }

  makeDefaultContextMenuActions(position: PointerCoordinate): ContextMenuAction[] {
    if (this.GuestMode()) return [];
    const actions: ContextMenuAction[] = [
      this.getCreateCharacterMenu(position),
      this.getCreateTableMaskMenu(position),
      this.getCreateTerrainMenu(position),
      this.getCreateTextNoteMenu(position),
      this.getCreateBlankCardMenu(position),
      this.getCreateTrumpMenu(position),
      this.getCreateDiceSymbolMenu(position),
      this.getCreateRangeMenu(position),
    ];
    return actions;
  }

  private getCreateCharacterMenu(position: PointerCoordinate): ContextMenuAction {
    return {
      name: this.i18n.t('action.addCharacter'), action: () => {
        let character = this.createGameCharacter(position);
        EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: character.identifier, className: character.aliasName });
        SoundEffect.play(PresetSound.piecePut);
      }
    }
  }

  private getCreateTableMaskMenu(position: PointerCoordinate): ContextMenuAction {
    return {
      name: this.i18n.t('action.addMapMask'), action: () => {
        this.createGameTableMask(position);
        SoundEffect.play(PresetSound.cardPut);
      }
    }
  }

  private getCreateTerrainMenu(position: PointerCoordinate): ContextMenuAction {
    return {
      name: this.i18n.t('action.addTerrain'), action: () => {
        this.createTerrain(position);
        SoundEffect.play(PresetSound.blockPut);
      }
    }
  }

  private getCreateTextNoteMenu(position: PointerCoordinate): ContextMenuAction {
    return {
      name: this.i18n.t('action.addSharedNote'), action: () => {
        this.createTextNote(position);
        SoundEffect.play(PresetSound.cardPut);
      }
    }
  }


  private getCreateBlankCardMenu(position: PointerCoordinate): ContextMenuAction {
    return {
      name: this.i18n.t('action.addBlankCard'), action: () => {
        this.createBlankCard(position);
        SoundEffect.play(PresetSound.cardPut);
      }
    }
  }

  private getCreateTrumpMenu(position: PointerCoordinate): ContextMenuAction {
    return {
      name: this.i18n.t('action.addCardStack'), action: () => {
        this.createTrump(position);
        SoundEffect.play(PresetSound.cardPut);
      }
    }
  }

  private getCreateDiceSymbolMenu(position: PointerCoordinate): ContextMenuAction {
    let dices: { menuName: string, diceName: string, type: DiceType, imagePathPrefix: string }[] = [
      { menuName: this.i18n.t('action.coin'), diceName: this.i18n.t('action.coinName'), type: DiceType.D2, imagePathPrefix: '2_coin' },
      { menuName: 'D4', diceName: 'D4', type: DiceType.D4, imagePathPrefix: '4_dice' },
      { menuName: 'D6', diceName: 'D6', type: DiceType.D6, imagePathPrefix: '6_dice' },
      { menuName: 'D6 (Black)', diceName: 'D6', type: DiceType.D6, imagePathPrefix: '6_dice_black' },
      { menuName: 'D8', diceName: 'D8', type: DiceType.D8, imagePathPrefix: '8_dice' },
      { menuName: 'D10', diceName: 'D10', type: DiceType.D10, imagePathPrefix: '10_dice' },
      { menuName: 'D10 (00-90)', diceName: 'D10', type: DiceType.D10_10TIMES, imagePathPrefix: '100_dice' },
      { menuName: 'D12', diceName: 'D12', type: DiceType.D12, imagePathPrefix: '12_dice' },
      { menuName: 'D20', diceName: 'D20', type: DiceType.D20, imagePathPrefix: '20_dice' },
    ];
    let subMenus: ContextMenuAction[] = [];

    dices.forEach(item => {
      subMenus.push({
        name: item.menuName, action: () => {
          this.createDiceSymbol(position, item.diceName, item.type, item.imagePathPrefix);
          SoundEffect.play(PresetSound.dicePut);
        }
      });
    });
    return { name: this.i18n.t('action.addDice'), action: null, subActions: subMenus };
  }

  private getCreateRangeMenu(position: PointerCoordinate): ContextMenuAction {
    let dices: { menuName: string, typeName: string }[] = [
      { menuName: this.i18n.t('action.rangeCone'), typeName: 'CORN'},
      { menuName: this.i18n.t('action.rangeLine'), typeName: 'LINE'},
      { menuName: this.i18n.t('action.rangeCircle'), typeName: 'CIRCLE'},
      { menuName: this.i18n.t('action.rangeSquare'), typeName: 'SQUARE'},
      { menuName: this.i18n.t('action.rangeDiamond'), typeName: 'DIAMOND'},
    ];
    let subMenus: ContextMenuAction[] = [];

    dices.forEach(item => {
      subMenus.push({
        name: item.menuName, action: () => {
          this.createRangeArea(position, item.typeName);
          SoundEffect.play(PresetSound.dicePut);
        }
      });
    });
    return { name: this.i18n.t('action.addRange'), action: null, subActions: subMenus };
  }

  private getViewTable(): GameTable {
    return TableSelecter.instance.viewTable;
  }
}
