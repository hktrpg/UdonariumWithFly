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
★ 離開前請「下載 ZIP」；下次「讀取 ZIP」。不存就會像煙火一樣沒了。
建議桌面版 Chrome。輸入第一則聊天後，此教學會自動隱藏。
完整說明：https://bothelp.hktrpg.com/guide`, 'mine', 0),

    this.makeSampleMessage('System', null, '教學Zzzzzz', null, `＜視角＞Shift＋左鍵拖曳＝平移地圖　右鍵拖曳＝旋轉視角　滾輪＝縮放
＜物件＞左鍵拖曳移動　拖旋轉把手轉向　右鍵＝選單
　　　　雙擊＝開啟詳情（角色／卡牌／牌堆／骰子／地形／筆記／遮罩／範圍等）
　　　　角色「下一張圖像」改在右鍵選單「切換下一張圖像」
　　　　卡牌翻面、牌堆抽牌、骰子擲骰：請用右鍵選單
＜選取＞左鍵點物件＝選取（高亮）　Ctrl＋點＝加減選
　　　　左鍵空白拖曳＝框選　點空白／Esc＝取消選取
圖片、音樂可直接拖進瀏覽器匯入。`, 'mine', 0),

    this.makeSampleMessage('System', null, '教學Zzzzzz', null, `＜鍵盤（選取後）＞WASD／方向鍵＝移動（可對角）
　　　　Shift＋WASD＝改變面向　Delete＝刪除（角色進回收區）
　　　　Ctrl＋C／X／V＝複製／剪下／貼上（貼在滑鼠游標處；選取文字時仍可複製文字）
　　　　[ ＝送到後層　] ＝送到前層
　　　　Ctrl＋滾輪＝旋轉 15°　Ctrl＋Shift＋滾輪＝旋轉 45°
　　　　拖曳放開時按住 Shift＝暫時不吸附格線　Esc＝取消選取
　　　　訪客模式無法使用編輯類快捷鍵。`, 'mine', 0),

    this.makeSampleMessage('System', null, '教學Zzzzzz', null, `＜聊天＞上方可切頻道；工具列（本機，ON＝開／OFF＝關）：
　　　　音樂／效果音／提示音／靠左／列表（一般氣泡）／精簡工具列
　　　　精簡＝收起標籤列與工具列，只留輸入區；右下小鈕可還原
＜骰子＞輸入區選規則後直接打指令（BCDice）
　　　　角色卡數值欄旁可「快速擲骰」送到目前聊天頻道
＜訪客＞開房可「允許訪客」；訪客功能受限。有密碼仍要密碼
＜筆記＞選單可開「筆記倉庫」整理桌面／公用／私人／回收區筆記
＜密語＞不會進 ZIP；換了連線 ID 後舊密語也看不到，請留意。`, 'mine', 0),

    this.makeSampleMessage('System', null, '教學Zzzzzz', null, `＜Ping＞地圖空白處長按＝標記；Shift＋長按＝警告標記
＜地圖設定＞黑暗／全域亮度／天氣（雨・雪・霧）／啟用視野
＜視野＞開啟後玩家只看得到自己的視野角色周圍（GM 不受限）
　　　　聊天選發言角色＝暫時帶入視野；關閉該聊天窗即取消
　　　　長留請右鍵勾「作為我的視野角色」；可設視野／亮光／昏暗光
　　　　棋子・遮罩・地形預設擋光；右鍵可關「與燈光互動」
　　　　狀態圖示常駐於名牌；套圈可在右鍵「套圈」選擇
＜場景工具＞僅 GM（選單）；選取／燈光／牆壁／矩形／橢圓／多邊形／手繪／文字
　　　　牆・多邊形：點加點，Enter／雙擊完成；Esc 取消；牆亦可右鍵完成
＜戰鬥輪＞選單開啟；可加入選取／桌面全部、擲先攻、回合與輪次
　　　　角色右鍵「加入戰鬥」；開始後會有回合宣告提示`, 'mine', 0),

    this.makeSampleMessage('System', null, '連結:', null, `根據 https://nanasunana.github.io/ 私家改造版重新中文化，並加入各種功能。
升級 1.13.2 版本`, 'mine', 1615253220000),

    this.makeSampleMessage('System', null, '連結:', null, `升級成 1.13.3b 版本
2021/05/11 改良 HTML 及 TXT 匯出功能，增加 COIN 功能
2021/05/13 更新 TOKEN 底部框大小
2021/05/27 更新 CutIn 功能（可使用 YouTube）；陰影會依高度改變`, 'mine', 1615253220000),

    this.makeSampleMessage('System', null, '連結:', null, `2021/08/17 更新成 F 版，更新組件版本。修正角色卡不能擲骰的 BUG，感謝吐司兔的回報。`, 'mine', 1635253220000),

    this.makeSampleMessage('System', null, '連結:', null, `2026 重大更新（hktrpg-main）
・改以最新 Udonarium with Fly 為基底（Angular 20、SkyWay 2023）
・介面全面繁體中文化；品牌與說明對齊 HKTRPG
・訪客模式、聊天精簡、筆記倉庫、角色卡快速擲骰
・聊天工具列：音樂／效果音／提示音／靠左／列表／精簡
・BCDice 4.9.0`, 'mine', Date.UTC(2026, 7, 3, 0, 0, 0)),

    this.makeSampleMessage('System', null, '連結:', null, `2026/08/03 操作更新
・桌面選取高亮；左鍵空白框選；Shift＋左鍵平移地圖
・雙擊物件開啟詳情（翻面／抽牌／擲骰改右鍵選單）
・鍵盤：WASD 移動、Shift＋WASD 面向、Delete、Ctrl＋C／X／V（貼在游標）
・[ / ] 調整前後層；Ctrl＋滾輪 15°／Ctrl＋Shift＋滾輪 45° 旋轉
・角色「切換下一張圖像」改右鍵；陰影隨尺寸／高度變化`, 'mine', Date.UTC(2026, 7, 3, 1, 0, 0)),

    this.makeSampleMessage('System', null, '連結:', null, `2026/08/03 場景・戰鬥・視野
・Ping：空白處長按標記；Shift＋長按警告
・地圖：黑暗／亮度／天氣；可啟用視野（擋光牆、點光源）
・場景工具（GM）：牆／燈／繪圖；Enter 完成牆與多邊形等
・聊天選角暫時帶入視野；僅手動「作為我的視野角色」會長留
・戰鬥輪：先攻、回合宣告；角色狀態圖示與底盤套圈
・地圖設定可下載地圖；狀態 icon 常駐顯示並自動換行`, 'mine', Date.UTC(2026, 7, 3, 1, 30, 0)),

    this.makeSampleMessage('System', null, '連結:', null, `本站：https://z01.hktrpg.com
教學：https://bothelp.hktrpg.com/guide
Discord：https://support.hktrpg.com
Facebook：https://www.facebook.com/groups/HKTRPG
百科：https://www.hktrpg.com/
原版烏冬：https://udonarium.app/
with Fly：https://nanasunana.github.io/
支援開發：https://www.patreon.com/HKTRPG`, 'mine', Date.UTC(2026, 7, 3, 2, 0, 0)),
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
