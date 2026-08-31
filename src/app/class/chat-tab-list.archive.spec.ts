import { ChatMessage } from './chat-message';
import { ChatTabList } from './chat-tab-list';
import { ObjectStore } from './core/synchronize-object/object-store';

describe('ChatTabList archive (hide without destroy)', () => {
  beforeEach(() => {
    for (const tab of [...ChatTabList.instance.allChatTabs]) {
      tab.destroy();
    }
    ObjectStore.instance.clearDeleteHistory();
  });

  afterEach(() => {
    for (const tab of [...ChatTabList.instance.allChatTabs]) {
      tab.destroy();
    }
    ObjectStore.instance.clearDeleteHistory();
  });

  it('archived tabs stay in store but leave active chatTabs', () => {
    ChatTabList.instance.addChatTab('Keep', 'KeepTab');
    const tab = ChatTabList.instance.addChatTab('ArchiveMe', 'ArchiveTab');
    const msg = new ChatMessage();
    msg.value = 'hello';
    msg.initialize();
    tab.appendChild(msg);

    tab.isArchived = true;

    expect(ObjectStore.instance.get('ArchiveTab')).toBeTruthy();
    expect(ChatTabList.instance.chatTabs.map(t => t.identifier)).toEqual(['KeepTab']);
    expect(ChatTabList.instance.archivedChatTabs.map(t => t.identifier)).toEqual(['ArchiveTab']);
    expect(ChatTabList.instance.allChatTabs.map(t => t.identifier).sort()).toEqual(['ArchiveTab', 'KeepTab']);
    expect(tab.canView()).toBeFalse();

    tab.isArchived = false;
    expect(ChatTabList.instance.chatTabs.map(t => t.identifier).sort()).toEqual(['ArchiveTab', 'KeepTab']);
    expect(tab.canView()).toBeTrue();
  });
});
