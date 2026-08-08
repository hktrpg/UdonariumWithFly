import { Injectable } from '@angular/core';

import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { FileArchiver } from '@udonarium/core/file-storage/file-archiver';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { DiceSymbol, DiceType } from '@udonarium/dice-symbol';
import { GameCharacter } from '@udonarium/game-character';
import { GameTableMask } from '@udonarium/game-table-mask';
import { Network } from '@udonarium/core/system';
import { ImageTag } from '@udonarium/image-tag';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TableSelecter } from '@udonarium/table-selecter';
import { Terrain } from '@udonarium/terrain';

import { DropCreateChooserComponent, DropCreateChoice } from 'component/drop-create-chooser/drop-create-chooser.component';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { NoteImportService } from 'service/note-import.service';
import { PointerCoordinate } from 'service/pointer-device.service';

const MEGA = 1024 * 1024;
const MAX_IMAGE = 2 * MEGA;
const MAX_PDF = 20 * MEGA;
const MAX_VIDEO = 50 * MEGA;

type DropKind = 'image' | 'pdf' | 'video' | 'text';
type DropChoice = 'token' | 'note' | 'card' | 'stack' | 'terrain' | 'mask' | 'coin' | 'library';

@Injectable({ providedIn: 'root' })
export class TabletopFileDropService {
  private busy = false;

  constructor(
    private modalService: ModalService,
    private noteImport: NoteImportService,
    private i18n: I18nService,
  ) { }

  hasFileDrag(e: DragEvent): boolean {
    if (e.dataTransfer?.files?.length) return true;
    const types = Array.from(e.dataTransfer?.types || []);
    if (types.includes('Files')) return true;
    const items = e.dataTransfer?.items;
    if (!items) return false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') return true;
    }
    return false;
  }

  async handleDrop(files: FileList | File[], position: PointerCoordinate): Promise<void> {
    if (this.busy || Network.GuestMode()) return;
    const accepted = this.filterAccepted(Array.from(files || []));
    if (!accepted.length) return;

    this.busy = true;
    try {
      const images = accepted.filter(f => this.classify(f) === 'image');
      const notes = accepted.filter(f => this.isNoteCapable(f));
      const choices = this.buildChoices(images.length, notes.length, accepted.length);
      if (!choices.length) return;

      const defaultChoice = choices.some(c => c.id === 'token')
        ? 'token'
        : (choices.some(c => c.id === 'note') ? 'note' : choices[0].id);

      const result = await this.modalService.open<{ choice: string } | false | null>(DropCreateChooserComponent, {
        title: this.i18n.t('dropCreate.subtitle', { count: accepted.length }),
        text: this.i18n.t('dropCreate.text', { count: accepted.length }),
        help: this.i18n.t('dropCreate.help'),
        okLabel: this.i18n.t('dropCreate.ok'),
        cancelLabel: this.i18n.t('common.cancel'),
        choices,
        choiceValue: defaultChoice,
        panelWidth: '440px',
      });

      if (!result || !result.choice) return;
      const created = await this.create(result.choice as DropChoice, accepted, images, notes, position);
      if (created) SoundEffect.play(PresetSound.cardPut);
    } finally {
      this.busy = false;
    }
  }

  private buildChoices(imageCount: number, noteCount: number, totalCount: number): DropCreateChoice[] {
    const choices: DropCreateChoice[] = [];
    if (imageCount > 0) {
      choices.push({
        id: 'token',
        label: this.i18n.t('dropCreate.token', { count: imageCount }),
        icon: 'person',
        hint: this.i18n.t('dropCreate.hint.token'),
      });
      choices.push({
        id: 'card',
        label: this.i18n.t('dropCreate.card', { count: imageCount }),
        icon: 'style',
        hint: this.i18n.t('dropCreate.hint.card'),
      });
      if (imageCount >= 2) {
        choices.push({
          id: 'stack',
          label: this.i18n.t('dropCreate.stack', { count: imageCount }),
          icon: 'layers',
          hint: this.i18n.t('dropCreate.hint.stack'),
        });
      }
      choices.push({
        id: 'terrain',
        label: this.i18n.t('dropCreate.terrain'),
        icon: 'landscape',
        hint: this.i18n.t('dropCreate.hint.terrain'),
      });
      choices.push({
        id: 'mask',
        label: this.i18n.t('dropCreate.mask', { count: imageCount }),
        icon: 'layers_clear',
        hint: this.i18n.t('dropCreate.hint.mask'),
      });
      choices.push({
        id: 'coin',
        label: this.i18n.t('dropCreate.coin'),
        icon: 'monetization_on',
        hint: this.i18n.t('dropCreate.hint.coin'),
      });
    }
    if (noteCount > 0) {
      choices.push({
        id: 'note',
        label: this.i18n.t('dropCreate.note', { count: noteCount }),
        icon: 'description',
        hint: this.i18n.t('dropCreate.hint.note'),
      });
    }
    if (totalCount > 0) {
      choices.push({
        id: 'library',
        label: this.i18n.t('dropCreate.library', { count: totalCount }),
        icon: 'photo_library',
        hint: this.i18n.t('dropCreate.hint.library'),
      });
    }
    return choices;
  }

  private async create(
    choice: DropChoice,
    accepted: File[],
    images: File[],
    notes: File[],
    position: PointerCoordinate,
  ): Promise<boolean> {
    switch (choice) {
      case 'token':
        return this.createTokens(images, position);
      case 'note': {
        const created = await this.noteImport.importFiles(notes, { addToTable: true, position });
        return created.length > 0;
      }
      case 'card':
        return this.createCards(images, position);
      case 'stack':
        return this.createCardStack(images, position);
      case 'terrain':
        return this.createTerrain(images, position);
      case 'mask':
        return this.createMasks(images, position);
      case 'coin':
        return this.createCoin(images, position);
      case 'library':
        return this.importToLibrary(accepted);
      default:
        return false;
    }
  }

  /** Media → FileArchiver; text/json/xml/html → note inventory (or room XML via archiver). */
  private async importToLibrary(files: File[]): Promise<boolean> {
    const media: File[] = [];
    const noteFiles: File[] = [];
    for (const file of files) {
      const kind = this.classify(file);
      if (kind === 'image' || kind === 'pdf' || kind === 'video') media.push(file);
      else if (kind === 'text') noteFiles.push(file);
    }
    let ok = false;
    if (media.length) {
      await FileArchiver.instance.load(media);
      ok = true;
    }
    // Room XML etc. still go through FileArchiver text/xml path.
    const xmlLike = noteFiles.filter(f => this.isXmlLike(f));
    const plainText = noteFiles.filter(f => !this.isXmlLike(f));
    if (xmlLike.length) {
      await FileArchiver.instance.load(xmlLike);
      ok = true;
    }
    if (plainText.length) {
      const created = await this.noteImport.importFiles(plainText, { addToTable: false });
      if (created.length) ok = true;
    }
    return ok;
  }

  private isXmlLike(file: File): boolean {
    const type = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    return type === 'application/xml' || type === 'text/xml' || name.endsWith('.xml');
  }

  private async createTokens(files: File[], position: PointerCoordinate): Promise<boolean> {
    if (!files.length) return false;
    const grid = 50;
    for (let i = 0; i < files.length; i++) {
      const image = await ImageStorage.instance.addAsync(files[i]);
      const name = this.baseName(files[i].name) || this.i18n.t('action.newCharacter');
      const character = GameCharacter.create(name, 1, image.identifier);
      const col = i % 5;
      const row = Math.floor(i / 5);
      character.location.x = position.x - 25 + col * grid;
      character.location.y = position.y - 25 + row * grid;
      character.posZ = position.z;
      character.setLocation('table');
    }
    return true;
  }

  private async createCards(files: File[], position: PointerCoordinate): Promise<boolean> {
    if (!files.length) return false;
    const backId = this.ensureDefaultCardBack();
    const grid = 50;
    for (let i = 0; i < files.length; i++) {
      const image = await ImageStorage.instance.addAsync(files[i]);
      const name = this.baseName(files[i].name) || this.i18n.t('action.cardName');
      const card = Card.create(name, image.identifier, backId);
      const col = i % 5;
      const row = Math.floor(i / 5);
      card.location.x = position.x - 25 + col * grid;
      card.location.y = position.y - 25 + row * grid;
      card.posZ = position.z;
      card.setLocation('table');
    }
    return true;
  }

  private async createCardStack(files: File[], position: PointerCoordinate): Promise<boolean> {
    if (!files.length) return false;
    const backId = this.ensureDefaultCardBack();
    const stack = CardStack.create(this.i18n.t('dropCreate.stackName'));
    stack.location.x = position.x - 25;
    stack.location.y = position.y - 25;
    stack.posZ = position.z;
    stack.setLocation('table');
    for (const file of files) {
      const image = await ImageStorage.instance.addAsync(file);
      const name = this.baseName(file.name) || this.i18n.t('action.cardName');
      stack.putOnBottom(Card.create(name, image.identifier, backId));
    }
    return true;
  }

  private async createTerrain(files: File[], position: PointerCoordinate): Promise<boolean> {
    if (!files.length) return false;
    const viewTable = TableSelecter.instance.viewTable;
    if (!viewTable) return false;
    const wall = await ImageStorage.instance.addAsync(files[0]);
    const floor = files[1]
      ? await ImageStorage.instance.addAsync(files[1])
      : wall;
    const name = this.baseName(files[0].name) || this.i18n.t('action.terrainName');
    const terrain = Terrain.create(name, 2, 2, 2, wall.identifier, floor.identifier);
    terrain.location.x = position.x - 50;
    terrain.location.y = position.y - 50;
    terrain.posZ = position.z;
    viewTable.appendChild(terrain);
    return true;
  }

  private async createMasks(files: File[], position: PointerCoordinate): Promise<boolean> {
    if (!files.length) return false;
    const viewTable = TableSelecter.instance.viewTable;
    if (!viewTable) return false;
    const grid = 50;
    for (let i = 0; i < files.length; i++) {
      const image = await ImageStorage.instance.addAsync(files[i]);
      const name = this.baseName(files[i].name) || this.i18n.t('action.mapMaskName');
      const mask = GameTableMask.create(name, 5, 5, 100);
      mask.setImage(image.identifier);
      const col = i % 5;
      const row = Math.floor(i / 5);
      mask.location.x = position.x - 25 + col * grid;
      mask.location.y = position.y - 25 + row * grid;
      mask.posZ = position.z;
      viewTable.appendChild(mask);
    }
    return true;
  }

  private async createCoin(files: File[], position: PointerCoordinate): Promise<boolean> {
    if (!files.length) return false;
    const headsImg = await ImageStorage.instance.addAsync(files[0]);
    const tailsImg = files[1]
      ? await ImageStorage.instance.addAsync(files[1])
      : headsImg;
    const name = this.baseName(files[0].name) || this.i18n.t('action.coinName');
    const coin = DiceSymbol.create(name, DiceType.D2, 1);
    const faces = coin.faces;
    if (faces[0]) coin.imageDataElement.getFirstElementByName(faces[0]).value = headsImg.identifier;
    if (faces[1]) coin.imageDataElement.getFirstElementByName(faces[1]).value = tailsImg.identifier;
    coin.face = faces[0] || coin.face;
    coin.location.x = position.x - 25;
    coin.location.y = position.y - 25;
    coin.posZ = position.z;
    coin.setLocation('table');
    return true;
  }

  private ensureDefaultCardBack(): string {
    const backUrl = './assets/images/trump/z01.gif';
    let back = ImageStorage.instance.get(backUrl);
    if (!back) {
      back = ImageStorage.instance.add(backUrl);
      ImageTag.create(back.identifier).tag = '*default ' + this.i18n.t('action.cardName');
    }
    return back.identifier;
  }

  private filterAccepted(files: File[]): File[] {
    const out: File[] = [];
    for (const file of files) {
      const kind = this.classify(file);
      if (!kind) continue;
      if (!this.withinSize(file, kind)) continue;
      out.push(file);
    }
    return out;
  }

  private classify(file: File): DropKind | null {
    if (!file) return null;
    const type = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    if (type.indexOf('image/') === 0 || /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(name)) return 'image';
    if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (type.indexOf('video/') === 0 || /\.(mp4|webm|mov|m4v|ogv)$/i.test(name)) return 'video';
    if (
      type.indexOf('text/') === 0
      || type === 'application/json'
      || /\.(txt|md|csv|json|html?|xml)$/i.test(name)
    ) return 'text';
    return null;
  }

  private isNoteCapable(file: File): boolean {
    return !!this.classify(file);
  }

  private withinSize(file: File, kind: DropKind): boolean {
    if (kind === 'image' && file.size > MAX_IMAGE) return false;
    if (kind === 'pdf' && file.size > MAX_PDF) return false;
    if (kind === 'video' && file.size > MAX_VIDEO) return false;
    return true;
  }

  private baseName(fileName: string): string {
    return (fileName || '').replace(/\.[^.]+$/, '').trim();
  }
}
