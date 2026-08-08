import { ChatTab } from '@udonarium/chat-tab';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { GameTable } from '@udonarium/game-table';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ScenePreset } from '@udonarium/scene-preset';
import { ScenePresetList } from '@udonarium/scene-preset-list';
import { TableSelecter } from '@udonarium/table-selecter';
import { ChatWindowComponent } from 'component/chat-window/chat-window.component';
import { ChatMessageService } from 'service/chat-message.service';

export type TabletopClickAction = 'none' | 'chat' | 'table' | 'preset';

export interface TabletopClickActionHost {
  clickAction: TabletopClickAction;
  clickPayload: string;
  clickGameType: string;
}

export function resolveActiveChatTab(chatMessageService: ChatMessageService): ChatTab {
  const id = ChatWindowComponent.activeChatTabIdentifier;
  const tab = id ? ObjectStore.instance.get<ChatTab>(id) : null;
  if (tab) return tab;
  return chatMessageService.chatTabs[0] || null;
}

export function executeTabletopClickAction(
  host: TabletopClickActionHost,
  chatMessageService: ChatMessageService
): boolean {
  if (!host || host.clickAction === 'none') return false;
  switch (host.clickAction) {
    case 'chat': {
      const text = (host.clickPayload || '').trim();
      if (!text) return false;
      const tab = resolveActiveChatTab(chatMessageService);
      const peer = PeerCursor.myCursor;
      if (!tab || !peer) return false;
      const gameType = (host.clickGameType || 'DiceBot').trim() || 'DiceBot';
      chatMessageService.sendMessage(tab, text, gameType, peer.identifier, null, peer.color);
      return true;
    }
    case 'table': {
      const tableId = (host.clickPayload || '').trim();
      if (!tableId) return false;
      const table = ObjectStore.instance.get<GameTable>(tableId);
      if (!(table instanceof GameTable)) return false;
      const selecter = TableSelecter.instance;
      if (PeerCursor.myCursor?.isGMMode) selecter.activateTable(table.identifier);
      else if (table.playerCanView) selecter.viewTableLocal(table.identifier);
      return true;
    }
    case 'preset': {
      const presetId = (host.clickPayload || '').trim();
      if (!presetId) return false;
      const preset = ObjectStore.instance.get<ScenePreset>(presetId);
      if (!(preset instanceof ScenePreset)) return false;
      ScenePresetList.instance.applyPreset(preset, { chatTab: resolveActiveChatTab(chatMessageService) });
      return true;
    }
    default:
      return false;
  }
}
