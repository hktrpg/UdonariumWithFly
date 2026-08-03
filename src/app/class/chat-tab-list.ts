import { ChatMessage } from './chat-message';
import { ChatTab } from './chat-tab';
import { ImageFile } from './core/file-storage/image-file';
import { SyncObject } from './core/synchronize-object/decorator';
import { ObjectNode } from './core/synchronize-object/object-node';
import { InnerXml } from './core/synchronize-object/object-serializer';
import { translate } from 'i18n';
import { StringUtil } from './core/system/util/string-util';

@SyncObject('chat-tab-list')
export class ChatTabList extends ObjectNode implements InnerXml {
  private static _instance: ChatTabList;
  static get instance(): ChatTabList {
    if (!ChatTabList._instance) {
      ChatTabList._instance = new ChatTabList('ChatTabList');
      ChatTabList._instance.initialize();
    }
    return ChatTabList._instance;
  }

  get chatTabs(): ChatTab[] { return this.children as ChatTab[]; }

  addChatTab(chatTab: ChatTab): ChatTab
  addChatTab(tabName: string, identifier?: string): ChatTab
  addChatTab(...args: any[]): ChatTab {
    let chatTab: ChatTab = null;
    if (args[0] instanceof ChatTab) {
      chatTab = args[0];
    } else {
      let tabName: string = args[0];
      let identifier: string = args[1];
      chatTab = new ChatTab(identifier);
      chatTab.name = tabName;
      chatTab.initialize();
    }
    return this.appendChild(chatTab);
  }

  parseInnerXml(element: Element) {
    // 不允許從 XML 新建，改為更新既有物件
    for (let child of ChatTabList.instance.children) {
      child.destroy();
    }

    let context = ChatTabList.instance.toContext();
    context.syncData = this.toContext().syncData;
    ChatTabList.instance.apply(context);
    ChatTabList.instance.update();

    super.parseInnerXml.apply(ChatTabList.instance, [element]);
    this.destroy();
  }

  log(logFormat, dateFormat, isWriteOerationLog=true, imageDict?: {}, target?: ChatTab[]): string {
    if (!this.chatTabs || (target && target.length == 0)) return '';
    if (target && target.length > 1 && target.map(tab => tab.identifier).sort().join() == this.chatTabs.map(tab => tab.identifier).sort().join()) target = null;
    const messages = (target ? target : this.chatTabs).reduce((ac, chatTab) => {
        if (chatTab) ac.push(...chatTab.chatMessages.filter(chatMessage => chatMessage.isDisplayable && (isWriteOerationLog || !chatMessage.isOperationLog))
          .map(chatMessage => ({ index: chatMessage.index, tabName: chatTab.name, chatMessage: chatMessage }))); 
        return ac;
      }, []).sort((a, b) => a.index - b.index);
    const logBodyAry = [];
    let currentTabIdentifier = (messages.length > 0 ? messages[0].chatMessage.tabIdentifier : null);
    for (const message of messages) {
      if (currentTabIdentifier && currentTabIdentifier !== message.chatMessage.tabIdentifier) {
        currentTabIdentifier =  message.chatMessage.tabIdentifier;
        logBodyAry.push(logFormat == 0 ? '--------' : '<hr>');
      }
      logBodyAry.push(message.chatMessage.logFragment(logFormat, (target && target.length == 1) ? null : message.tabName, dateFormat, imageDict));
    }
    const logBody = logBodyAry.join("\n");
    return logFormat == 0 
      ? logBody
      : `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>${ StringUtil.escapeHtml(translate('chatLog.htmlTitle', {
        name: (!target ? translate('chatLog.fileAllTabs') : (target[0].name == '' ? translate('chat.unnamedTab') : target[0].name))
          + (target && target.length > 1 ? translate('chatLog.fileAndOthers') : ''),
        images: imageDict ? translate('chatLog.withImages') : ''
      })) }</title>
<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
<script>
  if (window.chrome) {
    document.documentElement.classList.add('is-chrome');
  }
</script>
<style>
${ ChatMessage.logCss(imageDict) }
</style>
</head>
<body>
${ logBody }
</body>
</html>`;
  }
}