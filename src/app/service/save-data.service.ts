import { Injectable, NgZone } from '@angular/core';

import { ChatTabList } from '@udonarium/chat-tab-list';
import { FileArchiver } from '@udonarium/core/file-storage/file-archiver';
import { AudioState } from '@udonarium/core/file-storage/audio-file';
import { AudioStorage } from '@udonarium/core/file-storage/audio-storage';
import { ImageFile, ImageState } from '@udonarium/core/file-storage/image-file';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { PdfState } from '@udonarium/core/file-storage/pdf-file';
import { PdfStorage } from '@udonarium/core/file-storage/pdf-storage';
import { VideoState } from '@udonarium/core/file-storage/video-file';
import { VideoStorage } from '@udonarium/core/file-storage/video-storage';
import { MimeType } from '@udonarium/core/file-storage/mime-type';
import { GameObject } from '@udonarium/core/synchronize-object/game-object';
import { PromiseQueue } from '@udonarium/core/system/util/promise-queue';
import { XmlUtil } from '@udonarium/core/system/util/xml-util';
import { DataSummarySetting } from '@udonarium/data-summary-setting';
import { DiceRollTableList } from '@udonarium/dice-roll-table-list';
import { Room } from '@udonarium/room';

import Beautify from 'vkbeautify';

import { ImageTagList } from '@udonarium/image-tag-list';
import { ChatTab } from '@udonarium/chat-tab';
import { CutInList } from '@udonarium/cut-in-list';
import { AuraNameConfig } from '@udonarium/table-fx/aura-name-config';
import { SceneToolPermission } from '@udonarium/table-fx/scene-tool-permission';
import { CombatTracker } from '@udonarium/table-fx/combat-tracker';
import { ScenePresetList } from '@udonarium/scene-preset-list';
import { ScenarioTextList } from '@udonarium/scenario-text-list';
import { AudioLibrary } from '@udonarium/audio-library';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { ChatMessageService } from './chat-message.service';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { I18nService } from './i18n.service';
import { ModalService } from './modal.service';
import saveAs from 'file-saver';
import * as localForage from 'localforage';

type UpdateCallback = (percent: number) => void;

export type SaveIncludeAudioAskContext = 'zip' | 'folder';

@Injectable({
  providedIn: 'root'
})
export class SaveDataService {
  private static queue: PromiseQueue = new PromiseQueue('SaveDataServiceQueue');
  static readonly INCLUDE_AUDIO_STORAGE_KEY = 'udonarium.save.includeAudio';

  /** Cached preference (default true until loaded). */
  private includeAudioCache: boolean | undefined;

  constructor(
    private ngZone: NgZone,
    private chatMessageService: ChatMessageService,
    private i18n: I18nService,
    private modalService: ModalService
  ) { }

  /** Sync view of preference for settings toggles (defaults to true before load). */
  get includeAudio(): boolean {
    return this.includeAudioCache !== false;
  }

  async initializeIncludeAudioPreference(): Promise<void> {
    await this.getIncludeAudio();
  }

  async getIncludeAudio(): Promise<boolean> {
    if (this.includeAudioCache !== undefined) return this.includeAudioCache;
    try {
      const v = await localForage.getItem<boolean | string>(SaveDataService.INCLUDE_AUDIO_STORAGE_KEY);
      this.includeAudioCache = !(v === false || v === 'false');
    } catch {
      this.includeAudioCache = true;
    }
    return this.includeAudioCache;
  }

  async setIncludeAudio(include: boolean): Promise<void> {
    this.includeAudioCache = !!include;
    try {
      await localForage.setItem(SaveDataService.INCLUDE_AUDIO_STORAGE_KEY, this.includeAudioCache);
    } catch { /* ignore */ }
  }

  /**
   * Ask whether to pack music files into a room save.
   * Returns include flag, or null if cancelled.
   * Folder bind always writes the choice as the local default; ZIP uses remember checkbox.
   */
  async askIncludeAudio(context: SaveIncludeAudioAskContext): Promise<boolean | null> {
    if (!ModalService.defaultParentViewContainerRef) {
      return this.getIncludeAudio();
    }
    const current = await this.getIncludeAudio();
    const result = await this.modalService.open<{ choice: string; remember: boolean } | false>(ConfirmationComponent, {
      title: this.i18n.t('save.includeAudio.title'),
      text: this.i18n.t(context === 'folder' ? 'save.includeAudio.textFolder' : 'save.includeAudio.textZip'),
      help: this.i18n.t('save.includeAudio.help'),
      materialIcon: 'library_music',
      type: ConfirmationType.OK_CANCEL,
      okLabel: this.i18n.t('confirm.ok'),
      cancelLabel: this.i18n.t('confirm.cancel'),
      choices: [
        { id: 'include', label: this.i18n.t('save.includeAudio.include') },
        { id: 'exclude', label: this.i18n.t('save.includeAudio.exclude') },
      ],
      choiceValue: current ? 'include' : 'exclude',
      rememberLabel: context === 'zip' ? this.i18n.t('save.includeAudio.remember') : '',
      rememberValue: context === 'zip',
    });
    if (!result) return null;
    const include = result.choice === 'include';
    if (context === 'folder' || result.remember) {
      await this.setIncludeAudio(include);
    }
    return include;
  }

  saveRoomAsync(fileName?: string, updateCallback?: UpdateCallback, includeAudio?: boolean): Promise<void> {
    const name = fileName ?? this.i18n.t('save.roomFilePrefix');
    this.chatMessageService.sendOperationLog(this.i18n.t('save.roomDownloaded', { file: name }));
    return SaveDataService.queue.add((resolve, reject) => resolve(this._saveRoomAsync(name, updateCallback, includeAudio)));
  }

  saveRoomToDirectoryAsync(
    dirHandle: FileSystemDirectoryHandle,
    roomId: string,
    displayName: string,
    updateCallback?: UpdateCallback,
    auth?: {
      allowUser: boolean;
      allowGuest: boolean;
      secrets?: {
        v: 1;
        salt: string;
        iv: string;
        data: string;
      };
    },
    includeAudio?: boolean
  ): Promise<void> {
    return SaveDataService.queue.add((resolve, reject) =>
      resolve(this._saveRoomToDirectoryAsync(dirHandle, roomId, displayName, updateCallback, auth, includeAudio))
    );
  }

  buildRoomFiles(includeAudio = true): File[] {
    let files: File[] = [];
    let roomXml = this.convertToXml(new Room());
    let chatXml = this.convertToXml(ChatTabList.instance);
    let diceRollTableXml = this.convertToXml(DiceRollTableList.instance);
    let cutInXml = this.convertToXml(CutInList.instance);
    let summarySetting = this.convertToXml(DataSummarySetting.instance);
    let auraNameXml = this.convertToXml(AuraNameConfig.instance);
    let combatXml = this.convertToXml(CombatTracker.instance);
    let scenePermXml = this.convertToXml(SceneToolPermission.instance);
    let scenePresetXml = this.convertToXml(ScenePresetList.instance);
    let scenarioTextXml = this.convertToXml(ScenarioTextList.instance);
    files.push(new File([roomXml], 'fly_data.xml', { type: 'text/plain' }));
    files.push(new File([chatXml], 'fly_chat.xml', { type: 'text/plain' }));
    files.push(new File([diceRollTableXml], 'fly_rollTable.xml', { type: 'text/plain' }));
    files.push(new File([cutInXml], 'fly_cutIn.xml', { type: 'text/plain' }));
    files.push(new File([summarySetting], 'summary.xml', { type: 'text/plain' }));
    files.push(new File([auraNameXml], 'fly_auraNames.xml', { type: 'text/plain' }));
    files.push(new File([combatXml], 'fly_combat.xml', { type: 'text/plain' }));
    files.push(new File([scenePermXml], 'fly_scenePerm.xml', { type: 'text/plain' }));
    files.push(new File([scenePresetXml], 'fly_scenePreset.xml', { type: 'text/plain' }));
    files.push(new File([scenarioTextXml], 'fly_scenarioText.xml', { type: 'text/plain' }));
    files.push(new File([this.convertToXml(AudioLibrary.instance)], 'fly_audioLibrary.xml', { type: 'text/plain' }));

    let images: ImageFile[] = [];
    images = images.concat(this.searchImageFiles(roomXml));
    images = images.concat(this.searchImageFiles(chatXml));
    images = images.concat(this.searchImageFiles(cutInXml));
    for (const image of images) {
      if (image.state === ImageState.COMPLETE) {
        files.push(new File([image.blob], image.identifier + '.' + MimeType.extension(image.blob.type), { type: image.blob.type }));
      }
    }
    let imageTagXml = this.convertToXml(ImageTagList.create(images));
    files.push(new File([imageTagXml], 'fly_imageTag.xml', { type: 'text/plain' }));

    // User-uploaded BGM / SE (preset asset sounds are isHidden and omitted).
    if (includeAudio) {
      const urlAudioManifest: { identifier: string; name: string; url: string }[] = [];
      for (const audio of AudioStorage.instance.audios) {
        if (audio.isHidden) continue;
        if (audio.state === AudioState.COMPLETE && audio.blob) {
          const ext = MimeType.extension(audio.blob.type) || 'mp3';
          files.push(new File([audio.blob], audio.identifier + '.' + ext, { type: audio.blob.type }));
        } else if (audio.state === AudioState.URL && StringUtil.validUrl(audio.url)) {
          urlAudioManifest.push({
            identifier: audio.identifier,
            name: audio.name,
            url: audio.url
          });
        }
      }
      if (urlAudioManifest.length > 0) {
        files.push(new File([JSON.stringify(urlAudioManifest)], 'fly_audioUrls.json', { type: 'application/json' }));
      }
    }

    // PDFs attached to notes (referenced by pdfIdentifier in room XML).
    const pdfIds = new Set<string>();
    const pdfIdMatches = roomXml.matchAll(/pdfIdentifier[=:][\s"]*([a-f0-9]{64})/gi);
    for (const m of pdfIdMatches) pdfIds.add(m[1]);
    for (const pdf of PdfStorage.instance.pdfs) {
      if (pdf.state === PdfState.COMPLETE && pdf.blob) pdfIds.add(pdf.identifier);
    }
    for (const id of pdfIds) {
      const pdf = PdfStorage.instance.get(id);
      if (pdf && pdf.state === PdfState.COMPLETE && pdf.blob) {
        files.push(new File([pdf.blob], pdf.identifier + '.pdf', { type: 'application/pdf' }));
      }
    }

    // Videos attached to notes.
    const videoIds = new Set<string>();
    const videoIdMatches = roomXml.matchAll(/videoIdentifier[=:][\s"]*([a-f0-9]{64})/gi);
    for (const m of videoIdMatches) videoIds.add(m[1]);
    for (const video of VideoStorage.instance.videos) {
      if (video.state === VideoState.COMPLETE && video.blob) videoIds.add(video.identifier);
    }
    for (const id of videoIds) {
      const video = VideoStorage.instance.get(id);
      if (video && video.state === VideoState.COMPLETE && video.blob) {
        const ext = MimeType.extension(video.blob.type) || 'mp4';
        files.push(new File([video.blob], video.identifier + '.' + ext, { type: video.blob.type || 'video/mp4' }));
      }
    }
    return files;
  }

  private async _saveRoomAsync(fileName?: string, updateCallback?: UpdateCallback, includeAudio?: boolean): Promise<void> {
    fileName = fileName ?? this.i18n.t('save.roomFilePrefix');
    const packAudio = includeAudio != null ? includeAudio : await this.getIncludeAudio();
    return this.saveAsync(this.buildRoomFiles(packAudio), this.appendTimestamp(fileName), updateCallback);
  }

  private async _saveRoomToDirectoryAsync(
    dirHandle: FileSystemDirectoryHandle,
    roomId: string,
    displayName: string,
    updateCallback?: UpdateCallback,
    auth?: {
      allowUser: boolean;
      allowGuest: boolean;
      secrets?: {
        v: 1;
        salt: string;
        iv: string;
        data: string;
      };
    },
    includeAudio?: boolean
  ): Promise<void> {
    const packAudio = includeAudio != null ? includeAudio : await this.getIncludeAudio();
    const files = this.buildRoomFiles(packAudio);
    let progresPercent = -1;
    const zipBlob = await FileArchiver.instance.createZipBlobAsync(files, meta => {
      if (!updateCallback) return;
      let percent = meta.percent | 0;
      if (percent <= progresPercent) return;
      progresPercent = percent;
      this.ngZone.run(() => updateCallback(progresPercent));
    });
    const zipFile = `${roomId}.zip`;
    await FileArchiver.instance.writeBlobToDirectory(dirHandle, zipFile, zipBlob);
    const meta: Record<string, unknown> = {
      roomId,
      displayName,
      savedAt: new Date().toISOString(),
      zipFile,
      includeAudio: packAudio,
    };
    if (auth) {
      meta.allowUser = !!auth.allowUser;
      meta.allowGuest = !!auth.allowGuest;
      if (auth.secrets) meta.secrets = auth.secrets;
      // Never write plaintext passwords into the backup folder.
    }
    await FileArchiver.instance.writeBlobToDirectory(
      dirHandle,
      `${roomId}.meta.json`,
      new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' })
    );
  }

  saveGameObjectAsync(gameObject: GameObject, fileName: string = 'fly_xml_data', updateCallback?: UpdateCallback): Promise<void> {
    this.chatMessageService.sendOperationLog(this.i18n.t('save.objectDownloaded', {
      type: this.aliasLabel(gameObject.aliasName),
      file: fileName
    }));
    return SaveDataService.queue.add((resolve, reject) => resolve(this._saveGameObjectAsync(gameObject, fileName, updateCallback)));
  }

  private _saveGameObjectAsync(gameObject: GameObject, fileName: string = 'fly_xml_data', updateCallback?: UpdateCallback): Promise<void> {
    let files: File[] = [];
    let xml: string = this.convertToXml(gameObject);

    files.push(new File([xml], 'fly_data.xml', { type: 'text/plain' }));
    //files = files.concat(this.searchImageFiles(xml));
    
    let images: ImageFile[] = [];
    images = images.concat(this.searchImageFiles(xml));
    for (const image of images) {
      if (image.state === ImageState.COMPLETE) {
        files.push(new File([image.blob], image.identifier + '.' + MimeType.extension(image.blob.type), { type: image.blob.type }));
      }
    }
    let imageTagXml = this.convertToXml(ImageTagList.create(images));
    
    files.push(new File([imageTagXml], 'fly_imageTag.xml', { type: 'text/plain' }));
    return this.saveAsync(files, this.appendTimestamp(fileName), updateCallback);
  }

  private saveAsync(files: File[], zipName: string, updateCallback?: UpdateCallback): Promise<void> {
    let progresPercent = -1;
    return FileArchiver.instance.saveAsync(files, zipName, meta => {
      if (!updateCallback) return;
      let percent = meta.percent | 0;
      if (percent <= progresPercent) return;
      progresPercent = percent;
      this.ngZone.run(() => updateCallback(progresPercent));
    });
  }

  private convertToXml(gameObject: GameObject): string {
    let xmlDeclaration = '<?xml version="1.0" encoding="UTF-8"?>';
    return xmlDeclaration + '\n' + Beautify.xml(gameObject.toXml(), 2);
  }

  private searchImageFiles(xml: string): ImageFile[] {
    let xmlElement: Element = XmlUtil.xml2element(xml);
    let files: ImageFile[] = [];
    if (!xmlElement) return files;

    let images: { [identifier: string]: ImageFile } = {};
    let imageElements = xmlElement.ownerDocument.querySelectorAll('*[type="image"]');

    for (let i = 0; i < imageElements.length; i++) {
      let identifier = imageElements[i].innerHTML;
      images[identifier] = ImageStorage.instance.get(identifier);

      let shadowIdentifier = imageElements[i].getAttribute('currentValue');
      if (shadowIdentifier) images[shadowIdentifier] = ImageStorage.instance.get(shadowIdentifier);
    }

    imageElements = xmlElement.ownerDocument.querySelectorAll('*[imageIdentifier], *[toImageIdentifier], *[backgroundImageIdentifier], *[backgroundImageIdentifier2]');

    for (let i = 0; i < imageElements.length; i++) {
      let identifier = imageElements[i].getAttribute('imageIdentifier');
      if (identifier) images[identifier] = ImageStorage.instance.get(identifier);

      let toIdentifier = imageElements[i].getAttribute('toImageIdentifier');
      if (toIdentifier) images[identifier] = ImageStorage.instance.get(toIdentifier);

      let backgroundImageIdentifier = imageElements[i].getAttribute('backgroundImageIdentifier');
      if (backgroundImageIdentifier) images[backgroundImageIdentifier] = ImageStorage.instance.get(backgroundImageIdentifier);

      let backgroundImageIdentifier2 = imageElements[i].getAttribute('backgroundImageIdentifier2');
      if (backgroundImageIdentifier2) images[backgroundImageIdentifier2] = ImageStorage.instance.get(backgroundImageIdentifier2);
    }
    for (let identifier in images) {
      let image = images[identifier];
      //if (image && image.state === ImageState.COMPLETE) {
      //  files.push(new File([image.blob], image.identifier + '.' + MimeType.extension(image.blob.type), { type: image.blob.type }));
      //}
      if (image) {
        files.push(image);
      }
    }
    return files;
  }

  private appendTimestamp(fileName: string): string {
    let date = new Date();
    let year = date.getFullYear();
    let month = ('00' + (date.getMonth() + 1)).slice(-2);
    let day = ('00' + date.getDate()).slice(-2);
    let hours = ('00' + date.getHours()).slice(-2);
    let minutes = ('00' + date.getMinutes()).slice(-2);

    return fileName + `_${year}-${month}-${day}_${hours}${minutes}`;
  }

  saveChatLog(logFormat: number, fileName: string, chatTabs: ChatTab[]=null, dateFormat='HH:mm', isWriteOerationLog=true) {
    const mimeType = (logFormat == 0 ? 'text/plain' : 'text/html');
    const ext = (logFormat == 0 ? '.txt' : '.html');
    const trueFileName = 'fly_' + this.appendTimestamp(fileName) + ext;
    this.chatMessageService.sendOperationLog(this.i18n.t('save.chatLogDownloaded', { file: trueFileName }));
    //const xml = ChatTabList.instance.log(logFormat, dateFormat, isWriteOerationLog, chatTabs);
    
    //const files: File[] = [];
    //files.push(new File([xml], trueFileName, {type: `${mimeType};charset=utf-8`}));

    saveAs(new Blob([ChatTabList.instance.log(logFormat, dateFormat, isWriteOerationLog, null, chatTabs)], {type: `${mimeType};charset=utf-8`}), trueFileName);
  }

  async saveChatLogAsync(logFormat: number, fileName: string, chatTabs: ChatTab[]=null, dateFormat='HH:mm', isWriteOerationLog=true, updateCallback?: UpdateCallback): Promise<void> {
    const trueFileName = 'fly_' + this.appendTimestamp(fileName);
    this.chatMessageService.sendOperationLog(this.i18n.t('save.chatLogZipDownloaded', { file: trueFileName }));
    const files: File[] = [];
    const images: ImageFile[] = (chatTabs ? chatTabs : [ChatTabList.instance]).reduce<ImageFile[]>((acm, obj) => acm.concat(this.searchImageFiles(this.convertToXml(obj))), []);
    const imageDict = {};
    const basename = path => path.split('/').pop().split('.').shift();
    let isLicenseIncluded = false;
    let isCopyrightIncluded = false;
    for (const image of images) {
      if (!imageDict[image.identifier]) {
        if (image.state === ImageState.COMPLETE) {
          const fileName = image.identifier + '.' + MimeType.extension(image.blob.type);
          imageDict[image.identifier] = 'images/' + fileName;
          files.push(new File([image.blob], 'images/' + fileName, { type: image.blob.type }));
        } else if (image.state === ImageState.URL) {
          if (image.url.startsWith('http')) {
            if (StringUtil.validUrl(image.url)) imageDict[image.identifier] = image.url;
          } else {
            await fetch(image.url)
              .then(response => response.blob())
              .then(blob => {
                const fileName = basename(image.identifier) + '.' + MimeType.extension(blob.type);
                imageDict[image.identifier] = 'udonarium_assets/' + fileName;
                files.push(new File([blob], 'udonarium_assets/' + fileName, { type: blob.type }))
              });
            if (image.url.indexOf('/dice/') >= 0) {
              if (!isLicenseIncluded) {
                await fetch('./assets/images/dice/license.txt')
                  .then(response => response.blob())
                  .then(blob => {
                    files.push(new File([blob], 'udonarium_assets/license.txt', { type: 'text/plain' }));
                    isLicenseIncluded = true;
                  });
              }
            } else {
              if (!isCopyrightIncluded) {
                await fetch('./assets/images/copyright.txt')
                  .then(response => response.blob())
                  .then(blob => {
                    files.push(new File([blob], 'udonarium_assets/copyright.txt', { type: 'text/plain' }));
                    isCopyrightIncluded = true;
                  });
              }
            }
          }
        }
      }
    }
    files.push(new File([ChatTabList.instance.log(logFormat, dateFormat, isWriteOerationLog, imageDict, chatTabs)], 'index.html', {type: 'text/html;charset=utf-8'}));
    return this.saveAsync(files, trueFileName, updateCallback);
  }

  private aliasLabel(aliasName: string): string {
    const key = `alias.${aliasName}`;
    const text = this.i18n.t(key);
    return text === key ? (StringUtil.aliasNameToClassName(aliasName) || aliasName) : text;
  }
}
