import { Injectable } from '@angular/core';
import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
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

import { ContextMenuAction } from './context-menu.service';
import { I18nService } from './i18n.service';
import { PointerCoordinate } from './pointer-device.service';

import { ImageTag } from '@udonarium/image-tag';
import { RangeArea } from '@udonarium/range';

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
    let gameTable = new GameTable('gameTable');
    let testBgFile: ImageFile = null;
    let bgFileContext = ImageFile.createEmpty('testTableBackgroundImage_image').toContext();
    bgFileContext.url = './assets/images/BG10a_80.jpg';
    testBgFile = ImageStorage.instance.add(bgFileContext);
    ImageTag.create(testBgFile.identifier).tag = '*default ' + this.i18n.t('char.table');
    gameTable.name = this.i18n.t('action.firstTable');
    gameTable.imageIdentifier = testBgFile.identifier;
    gameTable.width = 20;
    gameTable.height = 15;
    gameTable.initialize();

    TableSelecter.instance.viewTableIdentifier = gameTable.identifier;
    EventSystem.trigger('SELECT_GAME_TABLE', { identifier: gameTable.identifier });
  }

  makeDefaultTabletopObjects() {
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

    testCharacter = new GameCharacter('testCharacter_2');
    testCharacter.location.x = 8 * 50;
    testCharacter.location.y = 8 * 50;
    testCharacter.initialize();
    testCharacter.createTestGameDataElement(this.i18n.t('sample.monsterB'), 1, testFile.identifier);

    testCharacter = new GameCharacter('testCharacter_3');
    fileContext = ImageFile.createEmpty('testCharacter_3_image').toContext();
    fileContext.url = './assets/images/mon_128.gif';
    testFile = ImageStorage.instance.add(fileContext);
    ImageTag.create(testFile.identifier).tag = '*default ' + this.i18n.t('action.newCharacter');
    testCharacter.location.x = 4 * 50;
    testCharacter.location.y = 2 * 50;
    testCharacter.initialize();
    testCharacter.createTestGameDataElement(this.i18n.t('sample.monsterC'), 3, testFile.identifier);

    testCharacter = new GameCharacter('testCharacter_4');
    fileContext = ImageFile.createEmpty('testCharacter_4_image').toContext();
    fileContext.url = './assets/images/mon_150.gif';
    testFile = ImageStorage.instance.add(fileContext);
    ImageTag.create(testFile.identifier).tag = '*default ' + this.i18n.t('action.newCharacter');
    testCharacter.location.x = 6 * 50;
    testCharacter.location.y = 11 * 50;
    testCharacter.initialize();
    testCharacter.createTestGameDataElement(this.i18n.t('sample.characterA'), 1, testFile.identifier);

    testCharacter = new GameCharacter('testCharacter_5');
    fileContext = ImageFile.createEmpty('testCharacter_5_image').toContext();
    fileContext.url = './assets/images/mon_211.gif';
    testFile = ImageStorage.instance.add(fileContext);
    ImageTag.create(testFile.identifier).tag = '*default ' + this.i18n.t('action.newCharacter');
    testCharacter.location.x = 12 * 50;
    testCharacter.location.y = 12 * 50;
    testCharacter.initialize();
    testCharacter.createTestGameDataElement(this.i18n.t('sample.characterB'), 1, testFile.identifier);

    testCharacter = new GameCharacter('testCharacter_6');
    fileContext = ImageFile.createEmpty('testCharacter_6_image').toContext();
    fileContext.url = './assets/images/mon_135.gif';
    testFile = ImageStorage.instance.add(fileContext);

    ImageTag.create(testFile.identifier).tag = '*default ' + this.i18n.t('action.newCharacter');
    testCharacter.initialize();
    testCharacter.location.x = 5 * 50;
    testCharacter.location.y = 13 * 50;
    testCharacter.initialize();
    testCharacter.createTestGameDataElement(this.i18n.t('sample.characterC'), 1, testFile.identifier);

    TabletopObject.migrateUnboundTablePieces(TableSelecter.instance.viewTableIdentifier);
  }

  makeDefaultContextMenuActions(position: PointerCoordinate): ContextMenuAction[] {
    if (this.GuestMode()) return [];
    return [
      this.getCreateCharacterMenu(position),
      this.getCreateTableMaskMenu(position),
      this.getCreateTerrainMenu(position),
      this.getCreateTextNoteMenu(position),
      this.getCreateBlankCardMenu(position),
      this.getCreateTrumpMenu(position),
      this.getCreateDiceSymbolMenu(position),
      this.getCreateRangeMenu(position),
    ];
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
