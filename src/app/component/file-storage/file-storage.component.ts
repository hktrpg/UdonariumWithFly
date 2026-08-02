import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';

import { FileArchiver } from '@udonarium/core/file-storage/file-archiver';
import { ImageFile, ImageState } from '@udonarium/core/file-storage/image-file';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { EventSystem, Network } from '@udonarium/core/system';

import { PanelService } from 'service/panel.service';
import { ImageTagList } from '@udonarium/image-tag-list';
import { ImageTag } from '@udonarium/image-tag';
import { animate, keyframes, style, transition, trigger } from '@angular/animations';
import { UUID } from '@udonarium/core/system/util/uuid';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { ModalService } from 'service/modal.service';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { AppComponent } from '../../app.component';
import { ChatMessageService } from 'service/chat-message.service';

@Component({
    selector: 'file-storage',
    templateUrl: './file-storage.component.html',
    styleUrls: ['./file-storage.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    animations: [
        trigger('scaleInOut', [
            transition('void => *', [
                animate('200ms ease', keyframes([
                    style({ transform: 'scale3d(0, 0, 0)', offset: 0 }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0)', offset: 1.0 })
                ]))
            ]),
            transition('* => void', [
                animate('180ms ease', style({ transform: 'scale3d(0, 0, 0)' }))
            ])
        ]),
        trigger('fadeAndUpInOut', [
            transition('void => *', [
                animate('100ms ease-in-out', keyframes([
                    style({ 'transform-origin': 'center bottom', transform: 'translateY(8px) scaleY(0)', opacity: 0.6 }),
                    style({ 'transform-origin': 'center bottom', transform: 'translateY(0px) scaleY(1.0)', opacity: 1.0 })
                ]))
            ]),
            transition('* => void', [
                animate('100ms ease-in-out', style({ 'transform-origin': 'center bottom', transform: 'translateY(0px) scaleY(1.0)', opacity: 1.0 })),
                animate('100ms ease-in-out', style({ 'transform-origin': 'center bottom', transform: 'translateY(8px) scaleY(0)', opacity: 0.6 }))
            ])
        ])
    ],
    standalone: false
})
export class FileStorageComponent implements OnInit, OnDestroy, AfterViewInit {
  panelId;
  private _searchNoTagImage = true;
  serchCondIsOr = true;
  addingTagWord = '';
  searchWords: string[] = [];
  deletedWords: string[] = [];
  selectedImageFiles: ImageFile[] = [];

  isSort = true;
  static sortOrder: string[] = [];

  isShowHideImages = false;

  //static imageCount = 0;

  get images(): ImageFile[] {
    const searchResultImages = ImageTagList.searchImages(this.searchWords, (this.searchNoTagImage && this.countAllImagesHasWord(null) > 0), this.serchCondIsOr, this.isShowHideImages);
    const searchResultImageIdentifiers = searchResultImages.map(image => image.identifier);
    this.selectedImageFiles = this.selectedImageFiles.filter(image => searchResultImageIdentifiers.includes(image.identifier));
    return this.isSort ? ImageTagList.sortImagesByWords(searchResultImages, FileStorageComponent.sortOrder) : searchResultImages;
  }
  
  get searchNoTagImage(): boolean {
    return this._searchNoTagImage;
  }

  set searchNoTagImage(value: boolean) {
    if (value) {
      FileStorageComponent.sortOrder.unshift(null);
    } else {
      FileStorageComponent.sortOrder = FileStorageComponent.sortOrder.filter(key => key != null);
    }
    FileStorageComponent.sortOrder = Array.from(new Set(FileStorageComponent.sortOrder));
    this._searchNoTagImage = value;
    EventSystem.trigger('CHANGE_SORT_ORDER', null);
  }

  get searchAllImage(): boolean {
    if (!this.searchNoTagImage && this.countAllImagesHasWord(null) > 0) return false;
    for (const word of this.allImagesOwnWords) {
      if (!this.searchWords.includes(word)) {
        return false;
      }
    } 
    return true;
  }

  get isSelected(): boolean {
    let ret = this.selectedImageFiles.length > 0;
    if (!ret) this.addingTagWord = '';
    return ret;
  }

  get selectedImagesIsHidden(): boolean {
    return ImageTagList.imagesIsHidden(this.selectedImageFiles);
  }

  get allImagesOwnWords(): string[] {
    return ImageTagList.allImagesOwnWords(this.isShowHideImages);
  }

  constructor(
    private changeDetector: ChangeDetectorRef,
    private panelService: PanelService,
    private modalService: ModalService,
    private chatMessageService: ChatMessageService
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }

  
  ngOnInit() {
    Promise.resolve().then(() => this.panelService.title = '圖片庫');
    this.searchWords = this.allImagesOwnWords;
    //FileStorageComponent.sortOrder = [null].concat(this.searchWords);
    this.panelId = UUID.generateUuid();
    // 含隱藏項目的數量
    //FileStorageComponent.imageCount = ImageStorage.instance.images.length;
  }

  ngAfterViewInit() {
    EventSystem.register(this)
    .on('SYNCHRONIZE_FILE_LIST', event => {
      if (event.isSendFromSelf) {
        /* 能否只對自己？
        console.log(event.data)
        if (this.serchCondIsOr) {
          let isNotagAdd = false;
          for (let i = FileStorageComponent.imageCount - 1; i < event.data.length; i++) {
            const imageTag = ImageTag.get(event.data[i].identifier);
            let noTag = true;
            if (imageTag && imageTag.tag != null && imageTag.tag.trim() != '') {
              if (this.isShowHideImages || !imageTag.hide) {
                for (const word of imageTag.words) {
                  FileStorageComponent.sortOrder.unshift(word);
                  this.searchWords.push(word);
                }
              }
              noTag = false;
            }
            isNotagAdd = isNotagAdd || noTag;
          }
          if (isNotagAdd) {
            FileStorageComponent.sortOrder.unshift(null);
            this._searchNoTagImage = true;
          }
          FileStorageComponent.sortOrder = Array.from(new Set(FileStorageComponent.sortOrder));
          this.searchWords = Array.from(new Set(this.searchWords)).sort();
        }
        */
        this.changeDetector.markForCheck();
      }
      //FileStorageComponent.imageCount = event.data.length;
    })
    .on('OPERATE_IMAGE_TAGS', event => {
      this.changeDetector.markForCheck();
    })
    .on('CHANGE_SORT_ORDER', event => {
      if (event.isSendFromSelf) this.changeDetector.markForCheck();
    });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  allImages(): ImageFile[] {
    return ImageTagList.allImages(this.isShowHideImages);
  }

  countAllImagesHasWord(word): number {
    return ImageTagList.countAllImagesHasWord(word, this.isShowHideImages);
  }

  countImagesHasWord(word): number {
    let count = 0;
    if (word != null && word.trim() === '') return count;
    for (const imageFile of this.images) {
      const imageTag = ImageTag.get(imageFile.identifier);
      if (word == null) {
        if (!imageTag || imageTag.tag == null || imageTag.tag.trim() == '') count++;
      } else {
        if (imageTag && imageTag.containsWords(word.trim(), false)) count++;
      }
    }
    return count;
  }

  handleFileSelect(event: Event) {
    if (this.GuestMode()) return;
    let input = <HTMLInputElement>event.target;
    let files = input.files;
    if (files.length) FileArchiver.instance.load(files);
    input.value = '';
  }

  selected(file: ImageFile) {
    return this.selectedImageFiles.map(imageFile => imageFile.identifier).includes(file.identifier)
  }

  selectedImagesOwnWords(hasAll=false): string[] {
    return ImageTagList.imagesOwnWords(this.selectedImageFiles, hasAll);
  }

  onSelectedWord(searchWord: string) {
    //this.selectedImageFiles = [];
    if (searchWord == null || searchWord.trim() === '') return;
    if (this.searchWords.includes(searchWord)) {
      this.searchWords = this.searchWords.filter(word => searchWord !== word);
      FileStorageComponent.sortOrder = FileStorageComponent.sortOrder.filter(word => searchWord !== word);
    } else {
      this.searchWords.push(searchWord);
      FileStorageComponent.sortOrder.unshift(searchWord);
    }
    FileStorageComponent.sortOrder = Array.from(new Set(FileStorageComponent.sortOrder));
    EventSystem.trigger('CHANGE_SORT_ORDER', searchWord);
  }

  onSelectedFile(file: ImageFile) {
    if (this.GuestMode()) return;
    if (this.selected(file)) {
      this.selectedImageFiles = this.selectedImageFiles.filter(imageFile => imageFile.identifier !== file.identifier);
    } else {
      this.selectedImageFiles.push(file);
    }
  }

  getTagWords(image: ImageFile): string[] {
    const imageTag = ImageTag.get(image.identifier);
    //console.log(imageTag ? imageTag.words : []);
    return imageTag ? imageTag.words : [];
  }

  getHidden(image: ImageFile): boolean {
    const imageTag = ImageTag.get(image.identifier);
    return imageTag ? imageTag.hide : false;
  }

  onSearchAllImage() {
    if (this.searchAllImage) {
      this.searchWords = [];
      this._searchNoTagImage = false;
    } else {
      this.searchWords = this.allImagesOwnWords;
      this._searchNoTagImage = true;
    }
  }

  onUnselect() {
    this.selectedImageFiles = [];
  }

  onShowHiddenImages($event: Event) {
    if (this.isShowHideImages) {
      this.isShowHideImages = false;
    } else {
      $event.preventDefault();
      this.modalService.open(ConfirmationComponent, {
        title: '顯示已設為隱藏的圖片', 
        text: '要顯示已設為隱藏的圖片嗎？',
        help: '請注意劇透等內容。',
        type: ConfirmationType.OK_CANCEL,
        materialIcon: 'visibility',
        action: () => {
          this.chatMessageService.sendOperationLog('從圖片庫顯示了已設為隱藏的圖片');
          this.isShowHideImages = true;
          (<HTMLInputElement>$event.target).checked = true;
          this.changeDetector.markForCheck();
        }
      });
    }
  }

  setectedImagesToHidden(toHidden: boolean) {
    this.modalService.open(ConfirmationComponent, {
      title: toHidden ? '設為隱藏' : '解除隱藏設定', 
      text: `要${ toHidden ? '將圖片設為隱藏' : '解除圖片的隱藏設定'}嗎？`,
      help: toHidden ? '將選擇的圖片設為隱藏。\n這是為了避免「無意中看到劇透」等情況，並非對其他人完全隱藏。' : '解除選擇圖片的隱藏設定。',
      type: ConfirmationType.OK_CANCEL,
      materialIcon: toHidden ? 'visibility_off' : 'visibility',
      action: () => {
        for (const image of this.selectedImageFiles) {
          const imageTag = ImageTag.get(image.identifier) || ImageTag.create(image.identifier);
          imageTag.hide = toHidden;
          EventSystem.call('OPERATE_IMAGE_TAGS', imageTag.identifier);
        }
      }
    });
  }

  addTagWord() {
    if (this.addingTagWord == null || this.addingTagWord.trim() == '') return;
    const words = this.addingTagWord.trim().split(/\s+/);
    this.modalService.open(ConfirmationComponent, {
      title: '為圖片新增標籤', 
      text: `要為圖片新增標籤嗎？`,
      helpHtml: '將為選擇的圖片新增 ' + words.map(word => `<b class="word-tag">${ StringUtil.escapeHtml(word) }</b>`).join(' ') + ' 。',
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'sell',
      action: () => {
        let addedWords = null;
        for (const image of this.selectedImageFiles) {
          const imageTag = ImageTag.get(image.identifier) || ImageTag.create(image.identifier);
          //imageTag.addWords(words);
          // TODO: 目前會回傳全部；希望只回傳實際新增的標籤
          addedWords = imageTag.addWords(words);
        }
        if (addedWords) {
          if (this.serchCondIsOr) this.searchWords.push(...addedWords);
          FileStorageComponent.sortOrder.unshift(...addedWords);
        }
        if (this.serchCondIsOr) this.searchWords = Array.from(new Set(this.searchWords)).sort();
        FileStorageComponent.sortOrder = Array.from(new Set(FileStorageComponent.sortOrder));
        EventSystem.trigger('CHANGE_SORT_ORDER', addedWords);
        this.addingTagWord = '';
      }
    });
  }

  removeTagWord(word: string) {
    this.modalService.open(ConfirmationComponent, {
      title: '從圖片刪除標籤', 
      text: `要從圖片刪除標籤嗎？`,
      helpHtml: `將從選擇的圖片刪除 <b class="word-tag">${ StringUtil.escapeHtml(word) }</b> 。`,
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'sell',
      action: () => {
        if (word == null || word.trim() == '') return;
        for (const image of this.selectedImageFiles) {
          let imageTag = ImageTag.get(image.identifier);
          if (imageTag) imageTag.removeWords(word);
        }
        const allImagesOwnWords = this.allImagesOwnWords;
        this.searchWords = this.searchWords.filter(word => allImagesOwnWords.includes(word));
        this.deletedWords.push(word);
        this.deletedWords = Array.from(new Set(this.deletedWords));
        EventSystem.trigger('CHANGE_SORT_ORDER', this.deletedWords);
      }
    });
  }

  identify(index, image){
    return image.identifier;
  }

  suggestWords(): string[] {
    const selectedWords = this.selectedImagesOwnWords(true);
    return Array.from(new Set(this.allImagesOwnWords.concat(this.deletedWords))).filter(word => word.indexOf('*') !== 0 && !selectedWords.includes(word));
  }

  chanageImageView(imageFile: ImageFile) {
    if (imageFile.state === ImageState.COMPLETE) {
      if (AppComponent.imageUrl) URL.revokeObjectURL(AppComponent.imageUrl);
      AppComponent.imageUrl = URL.createObjectURL(imageFile.blob);
    } else {
      AppComponent.imageUrl = imageFile.url;
    }
  }
}
