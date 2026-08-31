import { ChatTabList } from './chat-tab-list';
import { ObjectSynchronizer } from './core/synchronize-object/object-synchronizer';
import { ObjectStore } from './core/synchronize-object/object-store';
import { EventSystem } from './core/system';

describe('ObjectSynchronizer lobby sample chat tabs', () => {
  beforeEach(() => {
    ObjectSynchronizer.instance.initialize();
    for (const tab of [...ChatTabList.instance.allChatTabs]) tab.destroy();
    ObjectStore.instance.clearDeleteHistory();
  });

  afterEach(() => {
    for (const tab of [...ChatTabList.instance.allChatTabs]) tab.destroy();
    ObjectStore.instance.clearDeleteHistory();
    ObjectSynchronizer.instance.destroy();
  });

  it('does not create MainTab/SubTab from peer UPDATE when local room has no samples', () => {
    ChatTabList.instance.addChatTab('RoomOnly', 'RoomTab');
    expect(ObjectStore.instance.get('MainTab')).toBeFalsy();

    EventSystem.trigger({
      eventName: 'UPDATE_GAME_OBJECT',
      data: {
        aliasName: 'chat-tab',
        identifier: 'MainTab',
        majorVersion: 99,
        minorVersion: 0.5,
        syncData: {
          value: '',
          attributes: { name: '主要標籤' },
          parentIdentifier: 'ChatTabList',
          majorIndex: 0,
          minorIndex: 0,
        },
      },
      sendFrom: 'joiner-peer',
    });

    expect(ObjectStore.instance.get('MainTab')).toBeFalsy();
    expect(ChatTabList.instance.allChatTabs.map(t => t.identifier)).toEqual(['RoomTab']);
  });

  it('still updates MainTab when it already exists locally', () => {
    const tab = ChatTabList.instance.addChatTab('主要標籤', 'MainTab');
    expect(tab.name).toBe('主要標籤');

    EventSystem.trigger({
      eventName: 'UPDATE_GAME_OBJECT',
      data: {
        aliasName: 'chat-tab',
        identifier: 'MainTab',
        majorVersion: tab.version + 1,
        minorVersion: 0.1,
        syncData: {
          value: '',
          attributes: {
            name: '主要標籤-peer',
            isUseStandImage: true,
            recieveOperationLogLevel: 0,
            isPrivate: false,
            memberUserIds: '',
            creatorUserId: '',
            isArchived: false,
          },
          parentIdentifier: 'ChatTabList',
          majorIndex: 0,
          minorIndex: 0,
        },
      },
      sendFrom: 'peer-a',
    });

    expect(ObjectStore.instance.get('MainTab')).toBeTruthy();
    expect(ChatTabList.instance.allChatTabs.some(t => t.identifier === 'MainTab')).toBeTrue();
  });
});
