import { Component, ElementRef, Input, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ChatPalette } from '@udonarium/chat-palette';
import { ChatTab } from '@udonarium/chat-tab';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { DiceBot } from '@udonarium/dice-bot';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ChatInputComponent } from 'component/chat-input/chat-input.component';
import { TextViewComponent } from 'component/text-view/text-view.component';
import { ChatMessageService } from 'service/chat-message.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';

@Component({
    selector: 'chat-palette',
    templateUrl: './chat-palette.component.html',
    styleUrls: ['./chat-palette.component.css'],
    standalone: false
})
export class ChatPaletteComponent implements OnInit, OnDestroy {
  @ViewChild('chatInput', { static: true }) chatInputComponent: ChatInputComponent;
  @ViewChild('chatPlette') chatPletteElementRef: ElementRef<HTMLSelectElement>;
  @Input() character: GameCharacter = null;

  get palette(): ChatPalette { return this.character.chatPalette; }
  
  paletteCache: string[] = [];
  paletteRenewInterval: boolean = true;
  paletteRenewIntervalId = setInterval(() => {
    this.paletteRenewInterval = true;
  }, 200);
  get filteredPaletteStrings(): string[] {
    this.ngZone.run(() => {
      if (this.paletteRenewInterval) {
        this.paletteRenewInterval = false;
        this.paletteCache = this.character.chatPalette.getPalette().filter(text => this.filter(text));
      }
    });
    return this.paletteCache;
  }

  get color(): string {
    return this.chatInputComponent.color;
  }

  private _gameType: string = '';
  get gameType(): string { return !this._gameType ? 'DiceBot' : this._gameType; };
  set gameType(gameType: string) {
    this._gameType = gameType;
    if (this.character.chatPalette) this.character.chatPalette.dicebot = gameType;
  };

  get sendFrom(): string { return this.character.identifier; }
  set sendFrom(sendFrom: string) {
    this.onSelectedCharacter(sendFrom);
  }

  chatTabidentifier: string = '';
  text: string = '';
  sendTo: string = '';

  isEdit: boolean = false;
  editPalette: string = '';

  filterText: string = '';

  private doubleClickTimer: NodeJS.Timer = null;

  private selectedPaletteIndex = -1;

  get diceBotInfos() { return DiceBot.diceBotInfos }

  get chatTab(): ChatTab { return ObjectStore.instance.get<ChatTab>(this.chatTabidentifier); }
  get myPeer(): PeerCursor { return PeerCursor.myCursor; }
  get otherPeers(): PeerCursor[] { return [PeerCursor.myCursor, ...Network.peers.filter(peer => peer.isOpen).map(peer => PeerCursor.findByPeerId(peer.peerId))].filter(peerCursor => peerCursor); /* ObjectStore.instance.getObjects(PeerCursor); */ }

  constructor(
    public chatMessageService: ChatMessageService,
    private panelService: PanelService,
    private pointerDeviceService: PointerDeviceService,
    private ngZone: NgZone
  ) { }

  ngOnInit() {
    Promise.resolve().then(() => this.updatePanelTitle());
    this.chatTabidentifier = this.chatMessageService.chatTabs ? this.chatMessageService.chatTabs[0].identifier : '';
    this.gameType = this.character.chatPalette ? this.character.chatPalette.dicebot : '';
    EventSystem.register(this)
      .on('DELETE_GAME_OBJECT', event => {
        if (this.character && this.character.identifier === event.data.identifier) {
          this.panelService.close();
        }
        if (this.chatTabidentifier === event.data.identifier) {
          this.chatTabidentifier = this.chatMessageService.chatTabs ? this.chatMessageService.chatTabs[0].identifier : '';
        }
      });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    clearInterval(this.paletteRenewIntervalId);
    if (this.isEdit) this.toggleEditMode();
  }

  updatePanelTitle() {
    this.panelService.title = this.character.name + ' 的聊天面板';
  }

  onSelectedCharacter(identifier: string) {
    if (this.isEdit) this.toggleEditMode();
    let object = ObjectStore.instance.get(identifier);
    if (object instanceof GameCharacter) {
      this.character = object;
      let gameType = this.character.chatPalette ? this.character.chatPalette.dicebot : '';
      if (0 < gameType.length) this.gameType = gameType;
    }
    this.updatePanelTitle();
  }

  clickPalette(line: string) {
    if (!this.chatPletteElementRef.nativeElement) return;
    const evaluatedLine = this.palette.evaluate(line, this.character.rootDataElement);
    if (this.doubleClickTimer && this.selectedPaletteIndex === this.chatPletteElementRef.nativeElement.selectedIndex) {
      clearTimeout(this.doubleClickTimer);
      this.doubleClickTimer = null;
      this.chatInputComponent.sendChat(null);
    } else {
      this.selectedPaletteIndex = this.chatPletteElementRef.nativeElement.selectedIndex;
      this.text = evaluatedLine;
      let textArea: HTMLTextAreaElement = this.chatInputComponent.textAreaElementRef.nativeElement;
      textArea.value = this.text;
      this.doubleClickTimer = setTimeout(() => { this.doubleClickTimer = null }, 400);
    }
  }

  moveToInput(e: Event) {
    if (!this.chatPletteElementRef.nativeElement) return;
    const selectedPaletteIndex = this.chatPletteElementRef.nativeElement.selectedIndex;
    if (selectedPaletteIndex <= 0) {
      this.text = this._tempText;
      this.chatInputComponent.textAreaElementRef.nativeElement.value = this._tempText;
      this.chatInputComponent.textAreaElementRef.nativeElement.focus();
      e.preventDefault();
    }
  }

  arrowPalette() {
    if (!this.chatPletteElementRef.nativeElement) return;
    this.selectedPaletteIndex = this.chatPletteElementRef.nativeElement.selectedIndex;
    if (this.selectedPaletteIndex >= 0 && this.chatPletteElementRef.nativeElement.options[this.selectedPaletteIndex]) {
      this.ngZone.run(() => {
        this.text = this.palette.evaluate(this.chatPletteElementRef.nativeElement.options[this.selectedPaletteIndex].value, this.character.rootDataElement);
        let textArea: HTMLTextAreaElement = this.chatInputComponent.textAreaElementRef.nativeElement;
        textArea.value = this.text;
      });
    }
  }

  enterPalette(line: string, e: Event=null) {
    if (!this.chatPletteElementRef.nativeElement) return;
    this.text = this.palette.evaluate(line, this.character.rootDataElement);
    //this.chatInputComponent.sendChat(null);
    this.chatInputComponent.focusInput();
    //this.chatPletteElementRef.nativeElement.selectedIndex = -1;
    //this.filterText = '';
    if (e) e.preventDefault();
  }

  private _tempText: string;
  moveToPalette(tempText: string) {
    this._tempText = tempText;
    if (!this.chatPletteElementRef.nativeElement) return;
    if (this.chatPletteElementRef.nativeElement.options.length <= 0) return;
    if (this.chatPletteElementRef.nativeElement.selectedIndex <= 0) this.chatPletteElementRef.nativeElement.options[0].selected = true;
    this.chatPletteElementRef.nativeElement.focus();
  }

  sendChat(value: { text: string, gameType: string, sendFrom: string, sendTo: string,
    color?: string, isInverse?:boolean, isHollow?: boolean, isBlackPaint?: boolean, aura?: number, isUseFaceIcon?: boolean, characterIdentifier?: string, standIdentifier?: string, standName?: string, isUseStandImage?: boolean }) {
    if (this.chatTab) {
      let text = this.palette.evaluate(value.text, this.character.rootDataElement);
      this.chatMessageService.sendMessage(
        this.chatTab, 
        text, 
        value.gameType, 
        value.sendFrom, 
        value.sendTo,
        value.color, 
        value.isInverse,
        value.isHollow,
        value.isBlackPaint,
        value.aura,
        value.isUseFaceIcon,
        value.characterIdentifier,
        value.standIdentifier,
        value.standName,
        value.isUseStandImage
      );
      this.filterText = '';
    }
  }

  resetPletteSelect() {
    if (!this.chatPletteElementRef.nativeElement) return;
    this.chatPletteElementRef.nativeElement.selectedIndex = -1;
  }

  toggleEditMode() {
    this.isEdit = this.isEdit ? false : true;
    if (this.isEdit) {
      this.editPalette = this.palette.value + '';
    } else {
      this.palette.setPalette(this.editPalette);
    }
  }

  filter(value: string): boolean {
    if (this.filterText == null || this.filterText.trim() == '') return true;
    const nomarizeFilterText = StringUtil.toHalfWidth(this.filterText.replace(/[―ー—‐]/g, '-').replace(/[\u3041-\u3096]/g, m => String.fromCharCode(m.charCodeAt(0) + 0x60))).replace(/[\r\n\s]+/, ' ').toUpperCase().trim();
    const nomarizeValue = StringUtil.toHalfWidth(value.replace(/[―ー—‐]/g, '-').replace(/[\u3041-\u3096]/g, m => String.fromCharCode(m.charCodeAt(0) + 0x60))).replace(/[\r\n\s]+/, ' ').toUpperCase().trim();
    if (nomarizeValue.indexOf(nomarizeFilterText) >= 0) return true;
    const nomarizeEvaluateValue = StringUtil.toHalfWidth(!/[{｛]/.test(value) ? value : this.palette.evaluate(value, this.character.rootDataElement).replace(/[―ー—‐]/g, '-').replace(/[\u3041-\u3096]/g, m => String.fromCharCode(m.charCodeAt(0) + 0x60))).replace(/[\r\n\s]+/, ' ').toUpperCase().trim();
    return nomarizeEvaluateValue.indexOf(nomarizeFilterText) >= 0;
  }

  helpChatPallet() {
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x, top: coordinate.y, width: 560, height: 620 };
    let textView = this.panelService.open(TextViewComponent, option);
    textView.title = '聊天記法與聊天面板的使用方法';
    textView.shadowing = '💭';
    textView.text = [
`　參數操作指令、骰子機器人指令不區分全形與半形；骰子機器人指令與參數名稱亦不區分英文字母大小寫。若要併用，請以空白分隔，依序書寫參數操作指令、骰子機器人指令、聊天訊息，各段皆可省略。

　可將聊天內容預先準備在聊天面板。每一行寫一則內容：單擊可呼叫到聊天欄，雙擊則傳送。

・參數操作指令
　以角色傳送聊天時，可在開頭依序書寫 : 、參數名、操作（增加 + 、減少 -、代入 =）、操作內容，即可從聊天操作角色參數。操作內容若寫入骰子機器人指令，可用擲骰結果進行操作（操作資源、數值、能力值時，最後需回傳一個數字）。
　若操作使用 > ，可將骰子機器人指令（不實際擲骰）直接代入參數（目前 name、size、height、altitude 無法操作）。亦可用 : 分隔書寫多個操作；參數操作指令不會顯示在聊天中。

參數操作指令範例）
　:HP+2d6:MP-4　 以 2d6 回復 HP，並消耗 4 點 MP。
　:浸食率+1D10　 登場！

資源操作會套用最大值：指令操作不會超過最大值；若已超過最大值則不會再增加。

　核取方塊在操作為 + 時不論內容皆會開啟，為 - 時則關閉。代入空字串、0、off、☐（空核取方塊）（ = 或 > ）時為關閉，其餘代入為開啟；若代入回傳成功/失敗的擲骰結果（ = ），成功為開啟、失敗為關閉。

・骰子機器人指令
　從聊天傳送骰子機器人指令即可擲骰或查表。實際指令請參照各遊戲系統的骰子機器人說明。亦可透過骰子機器人表功能擴充指令。

・參數參照
　以 { 與 } 包住參數名時，從聊天面板選取或傳送聊天時會替換為參數內容。參數名開頭加上 $ 可參照套用前述參數操作指令後的值。
　此外參照 $數值 可取得參數操作的實際變化量（僅資源、數值、能力值，並考慮擲骰結果與最大值截斷）。數值從 1 開始：1 為參數操作指令的第一個結果，2 為第二個結果…。

參數參照範例）
　:HP-2d6　2d6+{筋力}+2　 HP{$1}、筋力+2 判定（目前 HP {$HP}）

・附加的值
　在聊天面板任一列以 //名稱=值 的形式書寫，即可像參數一樣從聊天訊息參照（無法用指令操作）。

附加的值範例）
　//現在天氣=雨

只要聊天面板任一列有如上範例，該角色傳送的指令或聊天訊息中的 {現在天氣} 就會替換為 雨。

・換行、空白
　聊天訊息中寫入 \\n 會在該處換行（n 為小寫，\\n 本身不顯示）。聊天面板一列只能寫一則傳送內容且無法直接換行，因此可用此方式換行。
　寫入 \\s （半形 s）為半形空白，\\ｓ （全形 ｓ）為全形空白（此為區分全半形的例外）。指令中不能寫空白時可改用此寫法。例外：骰子機器人指令 CHOICE 以空白分隔時可寫空白，但該情況下不能再寫聊天訊息（空白分隔的最後一段也會被視為 CHOICE 指令的一部分）。

・注音（假名）
　要加注音的文字，開頭加 | （豎線），結尾以 《 與 》 包住注音內容。

注音範例）
　接招吧！｜約定的勝利之劍《Excalibur》！

・💭
　以角色傳送聊天時，「 與 」包住的內容會以💭顯示。`];
  }
}
