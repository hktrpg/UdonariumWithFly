import { ChatMessage } from './chat-message';
import { ChatTabList } from './chat-tab-list';
import { ObjectSerializer } from './core/synchronize-object/object-serializer';
import { ObjectStore } from './core/synchronize-object/object-store';
import { EventSystem } from './core/system';

describe('ChatTabList empty XML wipe (room ZIP / folder backup)', () => {
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

  it('empty fly_chat clears empty lobby sample tabs (no DELETE broadcast)', () => {
    ChatTabList.instance.addChatTab('Main', 'MainTab');
    ChatTabList.instance.addChatTab('Sub', 'SubTab');
    const deleted: string[] = [];
    spyOn(EventSystem, 'call').and.callFake(((eventName: string, data?: { identifier?: string }) => {
      if (eventName === 'DELETE_GAME_OBJECT' && data?.identifier) deleted.push(data.identifier);
    }) as typeof EventSystem.call);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<chat-tab-list syncId="ChatTabList"/>`;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    ObjectSerializer.instance.parseXml(doc.documentElement);

    expect(ChatTabList.instance.chatTabs.length).toBe(0);
    expect(ObjectStore.instance.get('MainTab')).toBeFalsy();
    expect(ObjectStore.instance.get('SubTab')).toBeFalsy();
    expect(deleted).not.toContain('MainTab');
    expect(deleted).not.toContain('SubTab');
  });

  it('refuses empty fly_chat when tabs still have messages', () => {
    const tab = ChatTabList.instance.addChatTab('Main', 'MainTab');
    const msg = new ChatMessage();
    msg.value = 'keep me';
    msg.initialize();
    tab.appendChild(msg);

    const deleted: string[] = [];
    spyOn(EventSystem, 'call').and.callFake(((eventName: string, data?: { identifier?: string }) => {
      if (eventName === 'DELETE_GAME_OBJECT' && data?.identifier) deleted.push(data.identifier);
    }) as typeof EventSystem.call);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<chat-tab-list syncId="ChatTabList"/>`;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    ObjectSerializer.instance.parseXml(doc.documentElement);

    expect(ChatTabList.instance.chatTabs.length).toBe(1);
    expect(ObjectStore.instance.get('MainTab')).toBeTruthy();
    expect(tab.chatMessages.length).toBe(1);
    expect(deleted).not.toContain('MainTab');
  });

  it('non-empty XML replaces tabs via destroyLocal (no broadcast DELETE)', () => {
    ChatTabList.instance.addChatTab('Main', 'MainTab');
    ChatTabList.instance.addChatTab('Sub', 'SubTab');
    const deleted: string[] = [];
    spyOn(EventSystem, 'call').and.callFake(((eventName: string, data?: { identifier?: string }) => {
      if (eventName === 'DELETE_GAME_OBJECT' && data?.identifier) deleted.push(data.identifier);
    }) as typeof EventSystem.call);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<chat-tab-list syncId="ChatTabList">
  <chat-tab name="Restored" syncId="RestoredTab"/>
</chat-tab-list>`;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    ObjectSerializer.instance.parseXml(doc.documentElement);

    expect(deleted).not.toContain('MainTab');
    expect(deleted).not.toContain('SubTab');
    expect(ObjectStore.instance.get('MainTab')).toBeFalsy();
    expect(ObjectStore.instance.get('SubTab')).toBeFalsy();
    expect(ChatTabList.instance.chatTabs.map(t => t.identifier)).toEqual(['RestoredTab']);
    expect(ObjectStore.instance.get('RestoredTab')).toBeTruthy();
  });
});
