import {
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  ViewChild
} from '@angular/core';
import { ChatMessageService } from 'service/chat-message.service';
import { ChatMessage, ChatMessageContext } from '@udonarium/chat-message';
import { ChatTab } from '@udonarium/chat-tab';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem } from '@udonarium/core/system';
import { ResettableTimeout } from '@udonarium/core/system/util/resettable-timeout';
import { setZeroTimeout } from '@udonarium/core/system/util/zero-timeout';

import { PanelService } from 'service/panel.service';

type ScrollPosition = { top: number, bottom: number, clientHeight: number, scrollHeight: number, };

const ua = window.navigator.userAgent.toLowerCase();
const isiOS = ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1 || ua.indexOf('macintosh') > -1 && 'ontouchend' in document;

@Component({
    selector: 'chat-tab',
    templateUrl: './chat-tab.component.html',
    styleUrls: ['./chat-tab.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ChatTabComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges, AfterViewChecked {
  @Input() compact: boolean = false;
  @Input() leftOnly: boolean = false;
  
  sampleMessages: ChatMessage[] = [
    this.makeSampleMessage('System', null, '教學Zzzzzz', null, `歡迎使用 HKTRPG 烏冬桌（基於 Udonarium with Fly）。
地圖是 2.5D；資料在玩家之間互傳，伺服器不幫你長期保管棋子與圖片。
★ 離開前請「保存 ZIP」；下次「讀取 ZIP」。不存就會像煙火一樣沒了。
建議桌面版 Chrome。輸入第一則聊天後，此教學會自動隱藏。
完整說明：https://bothelp.hktrpg.com/guide`, 'mine', 0),

    this.makeSampleMessage('System', null, '教學Zzzzzz', null, `＜視角＞空白處拖曳＝平移　右鍵拖曳＝旋轉　滾輪＝縮放
＜物件＞拖曳移動　拖旋轉把手轉向　右鍵＝選單　雙擊＝預設動作
＜選取＞左鍵點物件＝選取（會高亮）　點空白／Esc＝取消
　　　　Shift＋拖曳＝框選　Ctrl＋點＝加減選
＜鍵盤＞選取後：WASD／方向鍵移動（可對角）
　　　　Shift＋WASD＝面向　Delete＝刪除（角色進回收區）
　　　　Ctrl＋C／X／V＝複製／剪下／貼上
圖片、音樂可直接拖進瀏覽器匯入。`, 'mine', 0),

    this.makeSampleMessage('System', null, '教學Zzzzzz', null, `＜聊天＞上方可切頻道；工具列（本機）：提示音／靠左／列表／靜音／精簡
　　　　精簡＝收起標籤與工具列，右上小鈕可還原
＜骰子＞輸入區選規則後直接打指令（BCDice）；角色卡欄位可快速擲骰
＜訪客＞開房可「允許訪客」；訪客功能受限。有密碼仍要密碼
＜筆記＞選單可開「筆記倉庫」整理桌面／公用／私人筆記
＜密語＞不會進 ZIP；換了連線 ID 後舊密語也看不到，請留意。`, 'mine', 0),

    this.makeSampleMessage('System', null, '連結:', null, `本站：https://z01.hktrpg.com
教學：https://bothelp.hktrpg.com/guide
Discord：https://support.hktrpg.com
Facebook：https://www.facebook.com/groups/HKTRPG
百科：https://www.hktrpg.com/
原版烏冬：https://udonarium.app/
with Fly：https://nanasunana.github.io/
支援開發：https://www.patreon.com/HKTRPG`, 'mine', Date.UTC(2026, 7, 3, 0, 0, 0)),
  ];

  private topTimestamp = 0;
  private botomTimestamp = 0;

  private needUpdate = true;

  @ViewChild('logContainer', { static: true }) logContainerRef: ElementRef<HTMLDivElement>;
  @ViewChild('messageContainer', { static: true }) messageContainerRef: ElementRef<HTMLDivElement>;

  private topElm: HTMLElement = null;
  private bottomElm: HTMLElement = null;
  private topElmBox: DOMRect = null;
  private bottomElmBox: DOMRect = null;

  private topIndex = 0;
  private bottomIndex = 0;

  //private minMessageHeight: number = 26;
  private get minMessageHeight(): number {
    if (this.compact) return 26; 
    let chatMessage = this.chatTab.chatMessages[this.chatTab.chatMessages.length - 1]
    return (chatMessage && chatMessage.isOperationLog) ? 26 : 61;
  }

  private preScrollTop = 0;
  private scrollSpeed = 0;

  private _chatMessages: ChatMessage[] = [];
  get chatMessages(): ChatMessage[] {
    if (!this.chatTab) return [];
    if (this.needUpdate) {
      this.needUpdate = false;
      let chatMessages = this.chatTab ? this.chatTab.chatMessages : [];
      this.adjustIndex();

      this._chatMessages = chatMessages.slice(this.topIndex, this.bottomIndex + 1);
      this.topTimestamp = 0 < this._chatMessages.length ? this._chatMessages[0].timestamp : 0;
      this.botomTimestamp = 0 < this._chatMessages.length ? this._chatMessages[this._chatMessages.length - 1].timestamp : 0;
    }
    return this._chatMessages;
  }

  get minScrollHeight(): number {
    return this.chatTab.chatMessages.reduce((height, chatMessage) => { height += chatMessage.isDisplayable ? (this.compact || chatMessage.isOperationLog ? 26 : 61) : 0; return height }, 0);
    //let length = this.chatTab ? this.chatTab.chatMessages.length : this.sampleMessages.length;
    //return (length < 10000 ? length : 10000) * this.minMessageHeight;
  }

  get topSpace(): number { return this.minScrollHeight - this.bottomSpace; }

  get bottomSpace(): number {
    return 0 < this.chatMessages.length
      ? (this.chatTab.chatMessages.length - this.bottomIndex - 1) * this.minMessageHeight
      : 0;
  }

  get isEmpty(): boolean { return this.chatTab.chatMessages.every(chatMessage => !chatMessage.isDisplayable); }

  private scrollEventShortTimer: ResettableTimeout = null;
  private scrollEventLongTimer: ResettableTimeout = null;
  private addMessageEventTimer: NodeJS.Timeout = null;

  private callbackOnScroll: any = () => this.onScroll();
  private callbackOnScrollToBottom: any = () => this.resetMessages();

  @Input() chatTab: ChatTab;
  @Output() onAddMessage: EventEmitter<null> = new EventEmitter();

  constructor(
    private chatMessageService: ChatMessageService,
    private ngZone: NgZone,
    private changeDetector: ChangeDetectorRef,
    private panelService: PanelService
  ) { }

  ngOnInit() {
    EventSystem.register(this)
      .on('MESSAGE_ADDED', event => {
        let message = ObjectStore.instance.get<ChatMessage>(event.data.messageIdentifier);
        if (!message || !this.chatTab.contains(message)) return;

        if (this.topTimestamp <= message.timestamp) {
          this.changeDetector.markForCheck();
          this.needUpdate = true;
          this.onMessageInit();
        }
      })
      .on(`UPDATE_GAME_OBJECT/aliasName/${ChatMessage.aliasName}`, event => {
        let message = ObjectStore.instance.get<ChatMessage>(event.data.identifier);
        if (message
          && this.topTimestamp <= message.timestamp && message.timestamp <= this.botomTimestamp
          && this.chatTab.contains(message)) {
          this.changeDetector.markForCheck();
        }
      });
  }

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => {
      this.scrollEventShortTimer = new ResettableTimeout(() => this.lazyScrollUpdate(), 33);
      this.scrollEventLongTimer = new ResettableTimeout(() => this.lazyScrollUpdate(false), 66);
      this.onScroll();
      this.panelService.scrollablePanel.addEventListener('scroll', this.callbackOnScroll, false);
      this.panelService.scrollablePanel.addEventListener('scrolltobottom', this.callbackOnScrollToBottom, false);
    });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    this.panelService.scrollablePanel.removeEventListener('scroll', this.callbackOnScroll, false);
    this.panelService.scrollablePanel.removeEventListener('scrolltobottom', this.callbackOnScrollToBottom, false);
    this.scrollEventShortTimer.clear();
    this.scrollEventLongTimer.clear();
    if (this.addMessageEventTimer) clearTimeout(this.addMessageEventTimer);
    this.addMessageEventTimer = null;
  }

  ngOnChanges() {
    Promise.resolve().then(() => this.resetMessages());
  }

  ngAfterViewChecked() {
    if (!this.topElm || !this.bottomElm) return;
    this.ngZone.runOutsideAngular(() => {
      Promise.resolve().then(() => this.adjustScrollPosition());
    });
  }

  onMessageInit() {
    if (this.addMessageEventTimer != null) return;
    this.ngZone.runOutsideAngular(() => {
      this.addMessageEventTimer = setTimeout(() => {
        this.addMessageEventTimer = null;
        this.ngZone.run(() => this.onAddMessage.emit());
      }, 0);
    });
  }

  resetMessages() {
    let lastIndex = this.chatTab.chatMessages.length - 1;
    this.topIndex = lastIndex - Math.floor(this.panelService.scrollablePanel.clientHeight / this.minMessageHeight);
    this.bottomIndex = lastIndex;
    this.needUpdate = true;
    this.preScrollTop = -1;
    this.scrollSpeed = 0;
    this.topElm = this.bottomElm = null;
    this.adjustIndex();
    this.changeDetector.markForCheck();
  }

  trackByChatMessage(index: number, message: ChatMessage) {
    return message.identifier;
  }

  checkAnimated(message: ChatMessage): boolean {
    //console.log(this.chatMessageService.getTime())
    return !(message.timestamp + 1000 >= this.chatMessageService.getTime());
  }

  private adjustIndex() {
    let chatMessages = this.chatTab ? this.chatTab.chatMessages : [];
    let lastIndex = 0 < chatMessages.length ? chatMessages.length - 1 : 0;

    if (this.topIndex < 0) {
      this.topIndex = 0;
    }
    if (lastIndex < this.bottomIndex) {
      this.bottomIndex = lastIndex;
    }

    if (this.topIndex < 0) this.topIndex = 0;
    if (this.bottomIndex < 0) this.bottomIndex = 0;
    if (lastIndex < this.topIndex) this.topIndex = lastIndex;
    if (lastIndex < this.bottomIndex) this.bottomIndex = lastIndex;
  }

  private getScrollPosition(): ScrollPosition {
    let top = this.panelService.scrollablePanel.scrollTop;
    let clientHeight = this.panelService.scrollablePanel.clientHeight;
    let scrollHeight = this.panelService.scrollablePanel.scrollHeight;
    if (top < 0) top = 0;
    if (scrollHeight - clientHeight < top)
      top = scrollHeight - clientHeight;
    let bottom = top + clientHeight;
    return { top, bottom, clientHeight, scrollHeight };
  }

  private adjustScrollPosition() {
    if (!this.topElm || !this.bottomElm) return;

    let hasTopElm = this.logContainerRef.nativeElement.contains(this.topElm);
    let hasBotomElm = this.logContainerRef.nativeElement.contains(this.bottomElm);

    let { hasTopBlank, hasBotomBlank } = this.checkBlank(hasTopElm, hasBotomElm);

    this.topElm = this.bottomElm = null;

    if (hasTopBlank || hasBotomBlank || (!hasTopElm && !hasBotomElm)) {
      setZeroTimeout(() => this.lazyScrollUpdate());
    }
  }

  private checkBlank(hasTopElm: boolean, hasBotomElm: boolean) {
    let hasTopBlank = !hasTopElm;
    let hasBotomBlank = !hasBotomElm;

    if (!hasTopElm && !hasBotomElm) return { hasTopBlank, hasBotomBlank };

    let elm: HTMLElement = null;
    let prevBox: DOMRect = null;
    let currentBox: DOMRect = null;
    let diff: number = 0;
    if (hasBotomElm) {
      elm = this.bottomElm;
      prevBox = this.bottomElmBox;
    } else if (hasTopElm) {
      elm = this.topElm;
      prevBox = this.topElmBox;
    }
    currentBox = elm.getBoundingClientRect();
    diff = prevBox.top - currentBox.top - this.scrollSpeed;
    if ((!hasTopBlank || !hasBotomBlank) && 0.5 ** 2 < diff ** 2) {
      this.panelService.scrollablePanel.scrollTop -= diff;
    }

    let logBox: DOMRect = this.logContainerRef.nativeElement.getBoundingClientRect();
    let messageBox: DOMRect = this.messageContainerRef.nativeElement.getBoundingClientRect();

    let messageBoxTop = messageBox.top - logBox.top;
    let messageBoxBottom = messageBoxTop + messageBox.height;

    let scrollPosition = this.getScrollPosition();

    hasTopBlank = scrollPosition.top < messageBoxTop;
    hasBotomBlank = messageBoxBottom < scrollPosition.bottom && scrollPosition.bottom < scrollPosition.scrollHeight;

    return { hasTopBlank, hasBotomBlank };
  }

  private markForReadIfNeeded() {
    if (!this.chatTab.hasUnread) return;

    let scrollPosition = this.getScrollPosition();
    if (scrollPosition.scrollHeight <= scrollPosition.bottom + 100) {
      setZeroTimeout(() => {
        this.chatTab.markForRead();
        this.changeDetector.markForCheck();
        this.ngZone.run(() => { });
      });
    }
  }

  onScroll() {
    this.scrollEventShortTimer.reset();
    if (!this.scrollEventLongTimer.isActive) {
      this.scrollEventLongTimer.reset();
    }
  }

  private lazyScrollUpdate(isNormalUpdate: boolean = true) {
    this.scrollEventShortTimer.stop();
    this.scrollEventLongTimer.stop();

    let chatMessageElements = this.messageContainerRef.nativeElement.querySelectorAll<HTMLElement>('chat-message');

    let messageBoxTop = this.messageContainerRef.nativeElement.offsetTop;
    let messageBoxBottom = messageBoxTop + this.messageContainerRef.nativeElement.clientHeight;

    let preTopIndex = this.topIndex;
    let preBottomIndex = this.bottomIndex;

    let scrollPosition = this.getScrollPosition();
    this.scrollSpeed = scrollPosition.top - this.preScrollTop;
    this.preScrollTop = scrollPosition.top;

    let hasTopBlank = scrollPosition.top < messageBoxTop;
    let hasBotomBlank = messageBoxBottom < scrollPosition.bottom && scrollPosition.bottom < scrollPosition.scrollHeight;

    if (!isNormalUpdate) {
      this.scrollEventShortTimer.reset();
    }

    if (!isNormalUpdate && !hasTopBlank && !hasBotomBlank) {
      return;
    }

    let scrollWideTop = scrollPosition.top - (!isNormalUpdate && hasTopBlank ? 100 : 1200);
    let scrollWideBottom = scrollPosition.bottom + (!isNormalUpdate && hasBotomBlank ? 100 : 1200);

    this.markForReadIfNeeded();
    this.calcItemIndexRange(messageBoxTop, messageBoxBottom, scrollWideTop, scrollWideBottom, scrollPosition, chatMessageElements);

    let isChangedIndex = this.topIndex != preTopIndex || this.bottomIndex != preBottomIndex;
    if (!isChangedIndex) return;

    this.needUpdate = true;

    this.topElm = chatMessageElements[0];
    this.bottomElm = chatMessageElements[chatMessageElements.length - 1];
    this.topElmBox = this.topElm.getBoundingClientRect();
    this.bottomElmBox = this.bottomElm.getBoundingClientRect();

    setZeroTimeout(() => {
      let scrollPosition = this.getScrollPosition();
      this.scrollSpeed = scrollPosition.top - this.preScrollTop;
      this.preScrollTop = scrollPosition.top;
      this.changeDetector.markForCheck();
      this.ngZone.run(() => { });
    });
  }

  private calcElementMaxHeight(chatMessageElements: NodeListOf<HTMLElement>): number {
    let maxHeight = this.minMessageHeight;
    for (let i = chatMessageElements.length - 1; 0 <= i; i--) {
      let height = chatMessageElements[i].clientHeight;
      if (maxHeight < height) maxHeight = height;
    }
    return maxHeight;
  }

  private calcItemIndexRange(messageBoxTop: number, messageBoxBottom: number, scrollWideTop: number, scrollWideBottom: number, scrollPosition: ScrollPosition, chatMessageElements: NodeListOf<HTMLElement>) {
    if (scrollWideTop >= messageBoxBottom || messageBoxTop >= scrollWideBottom) {
      let lastIndex = this.chatTab.chatMessages.length - 1;
      let scrollBottomHeight = scrollPosition.scrollHeight - scrollPosition.top - scrollPosition.clientHeight;

      this.bottomIndex = lastIndex - Math.floor(scrollBottomHeight / this.minMessageHeight);
      this.topIndex = this.bottomIndex - Math.floor(scrollPosition.clientHeight / this.minMessageHeight);

      this.bottomIndex += 1;
      this.topIndex -= 1;
    } else {
      let maxHeight = this.calcElementMaxHeight(chatMessageElements);
      if (scrollWideTop < messageBoxTop) {
        this.topIndex -= Math.floor((messageBoxTop - scrollWideTop) / maxHeight) + 1;
      } else if (scrollWideTop > messageBoxTop) {
        if (!isiOS) this.topIndex += Math.floor((scrollWideTop - messageBoxTop) / maxHeight);
      }

      if (messageBoxBottom > scrollWideBottom) {
        if (!isiOS) this.bottomIndex -= Math.floor((messageBoxBottom - scrollWideBottom) / maxHeight);
      } else if (messageBoxBottom < scrollWideBottom) {
        this.bottomIndex += Math.floor((scrollWideBottom - messageBoxBottom) / maxHeight) + 1;
      }
    }
    this.adjustIndex();
  }

  private makeSampleMessage(from: string, to: string, name: string, toName: string, text: string, tag = 'mine', timestamp = 0): ChatMessage {
    let message = new ChatMessage();
    message.from = from;
    message.to = to;
    message.name = name;
    message.toName = toName;
    message.color = '#444444';
    message.toColor = toName ? '#444444' : null;
    message.tag = tag;
    message.value = text;
    message.setAttribute('timestamp', timestamp);
    return message;
  }
}
