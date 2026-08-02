import { AfterViewInit, Component, ElementRef, Input, OnDestroy, OnInit, QueryList, ViewChildren } from '@angular/core';
import { EventSystem } from '@udonarium/core/system';
import { PanelOption, PanelService } from 'service/panel.service';
import { DataElement } from '@udonarium/data-element';
import { GameCharacter } from '@udonarium/game-character';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { StandElementComponent } from 'component/stand-element/stand-element.component';
import { UUID } from '@udonarium/core/system/util/uuid';
import { PointerDeviceService } from 'service/pointer-device.service';
import { TextViewComponent } from 'component/text-view/text-view.component';
import { ObjectSerializer } from '@udonarium/core/synchronize-object/object-serializer';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { ModalService } from 'service/modal.service';

@Component({
    selector: 'app-stand-setting',
    templateUrl: './stand-setting.component.html',
    styleUrls: ['./stand-setting.component.css'],
    standalone: false
})
export class StandSettingComponent implements OnInit, OnDestroy, AfterViewInit {
  @Input() character: GameCharacter = null;
　@ViewChildren(StandElementComponent) standElementComponents: QueryList<StandElementComponent>;

  panelId: string;
  standSettingXML = '';

  private _intervalId;
  private isSpeaking = false;

  constructor(
    private panelService: PanelService,
    private pointerDeviceService: PointerDeviceService,
    private modalService: ModalService
  ) { }

  get standElements(): DataElement[] {
    return this.character.standList.standElements;
  }

  get imageList(): ImageFile[] {
    if (!this.character) return [];
    let ret = [];
    let dupe = {};
    const tmp = this.character.imageDataElement.getElementsByName('imageIdentifier');
    const elements = tmp.concat(this.character.imageDataElement.getElementsByName('faceIcon'));
    for (let elm of elements) {
      if (dupe[elm.value]) continue;
      let file = this.imageElementToFile(elm);
      if (file) {
        dupe[elm.value] = true;
        ret.push(file);
      }
    }
    return ret;
  }

  get position(): number {
    if (!this.character || !this.character.standList) return 0;
    return this.character.standList.position;
  }

  set position(position: number) {
    if (!this.character || !this.character.standList) return;
    this.character.standList.position = position;
  }

  get height(): number {
    if (!this.character || !this.character.standList) return 0;
    return this.character.standList.height;
  }

  set height(height: number) {
    if (!this.character || !this.character.standList) return;
    this.character.standList.height = height;
  }

  get overviewIndex(): number {
    if (!this.character || !this.character.standList) return -1;
    return this.character.standList.overviewIndex;
  }

  set overviewIndex(overviewIndex: number) {
    if (!this.character || !this.character.standList) return;
    this.character.standList.overviewIndex = overviewIndex;
  }

  set isSortNameList(isSortNameList: boolean) {
    if (!this.character || !this.character.standList) return;
    this.character.standList.isSortNameList = isSortNameList;
  }

  get isSortNameList(): boolean {
    if (!this.character || !this.character.standList) return true;
    return this.character.standList.isSortNameList;
  }

  ngOnInit() {
    Promise.resolve().then(() => this.updatePanelTitle());
    EventSystem.register(this)
      .on('DELETE_GAME_OBJECT', -1000, event => {
        if (this.character && this.character.identifier === event.data.identifier) {
          this.panelService.close();
        }
      });
    this.panelId = UUID.generateUuid();
  }

  ngAfterViewInit() {
    this._intervalId = setInterval(() => {
      this.isSpeaking = !this.isSpeaking;
      this.standElementComponents.forEach(standElementComponent => {
        standElementComponent.isSpeaking = this.isSpeaking;
      });
    }, 3600);
  }

  ngOnDestroy() {
    clearInterval(this._intervalId)
    EventSystem.unregister(this);
  }

  updatePanelTitle() {
    this.panelService.title = this.character.name + ' 的立繪設定';
  }

  add() {
    this.character.standList.add(this.character.imageFile.identifier);
    this.standSettingXML = '';
  }

  delele(standElement: DataElement, index: number) {
    EventSystem.call('DELETE_STAND_IMAGE', {
      characterIdentifier: this.character.identifier,
      identifier: standElement.identifier
    });
    if (!this.character || !this.character.standList) return;
    this.modalService.open(ConfirmationComponent, {
      title: '刪除立繪設定', 
      text: '要刪除立繪設定嗎？',
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'person_off',
      action: () => {
        this.standSettingXML = standElement.toXml();
        let elm = this.character.standList.removeChild(standElement);
        if (elm) {
          if (this.character.standList.overviewIndex == index) {
            this.character.standList.overviewIndex = -1;
          } else if (this.character.standList.overviewIndex > index) {
            this.character.standList.overviewIndex -= 1;
          }
        }
      }
    });
  }
  
  restore() {
    if (!this.standSettingXML) return;
    let restoreStand = <DataElement>ObjectSerializer.instance.parseXml(this.standSettingXML);
    this.character.standList.appendChild(restoreStand);
    this.standSettingXML = '';
  }

  upStandIndex(standElement: DataElement) {
    this.standSettingXML = '';
    let parentElement = this.character.standList;
    let index: number = parentElement.children.indexOf(standElement);
    if (0 < index) {
      let prevElement = parentElement.children[index - 1];
      parentElement.insertBefore(standElement, prevElement);
      if (this.character.standList.overviewIndex == index) {
        this.character.standList.overviewIndex -= 1;
      } else if (this.character.standList.overviewIndex == index - 1) {
        this.character.standList.overviewIndex += 1;
      } 
    }
  }

  downStandIndex(standElement: DataElement) {
    this.standSettingXML = '';
    let parentElement = this.character.standList;
    let index: number = parentElement.children.indexOf(standElement);
    if (index < parentElement.children.length - 1) {
      let nextElement = parentElement.children[index + 1];
      parentElement.insertBefore(nextElement, standElement);
      if (this.character.standList.overviewIndex == index) {
        this.character.standList.overviewIndex += 1;
      } else if (this.character.standList.overviewIndex == index + 1) {
        this.character.standList.overviewIndex -= 1;
      } 
    }
  }

  helpStandSeteing() {
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x, top: coordinate.y, width: 600, height: 620 };
    let textView = this.panelService.open(TextViewComponent, option);
    textView.title = '立繪設定說明';
    textView.text = 
`　可設定角色立繪的名稱、位置與圖片高度（皆為相對畫面尺寸）、以及發送聊天時顯示立繪的條件。

　若為立繪設定名稱，會顯示在聊天視窗、聊天面板的清單中並可選擇。另外若設定了標籤，即使是相同角色，不同標籤也會播放登場、退場動畫。

　圖片的位置與高度也可個別指定；位置未勾選個別指定、高度為 0 時會使用整體設定。垂直位置調整（AdjY）是相對立繪圖片高度的指定（例如設為 -50% 時，圖片下半部會藏到畫面下緣之外）。

　條件的「指定圖片」是發送聊天時的角色圖片或臉部 IC。另外作為特殊條件，當聊天文字末尾為「@退場」或「@farewell」時，一律會讓該角色的立繪退場。

　優先順序由高到低為：

　　1. 以「@退場」、「@farewell」退場
　　2. 在聊天視窗、聊天面板清單中選擇的名稱
　　3. 「指定圖片 且 聊天末尾」
　　4. 「指定圖片 或 聊天末尾」
　　5. 「聊天末尾」
　　6. 「指定圖片」

　若都不符合則使用「預設」；相同優先順序有多個條件時，會隨機選擇其中一個。

　判定聊天末尾是否符合時，不區分全形半形、英文字母大小寫。另外為了與其他使用 BCDice 的線上團工具相容，判定時會將兩側有空白的「 ＞ 」與「 → 」視為相同。
　此外，以「@退場」、「@farewell」退場時，或設定了如「@笑」這類以「@」開頭的條件時，（無論立繪是否啟用、條件是否符合）以該角色發送時，符合條件的聊天文字末尾的 @ 之後都會被截掉。`;
  }

  private imageElementToFile(dataElm: DataElement): ImageFile {
    if (!dataElm) return null;
    return ImageStorage.instance.get(<string>dataElm.value);
  }
}
