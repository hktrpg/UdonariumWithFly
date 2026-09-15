import { Injectable } from '@angular/core';
import { ChatTab } from '@udonarium/chat-tab';
import { DataElement } from '@udonarium/data-element';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ChatMessageService } from 'service/chat-message.service';

export interface DataElementChatSendSnapshot {
  name?: string;
  value?: number | string;
  currentValue?: number | string;
}

export interface DataElementChatSendOptions {
  character?: GameCharacter | null;
  /** When set, overrides dataElm fields (e.g. game-data-element debounced local state). */
  snapshot?: DataElementChatSendSnapshot;
}

@Injectable({
  providedIn: 'root'
})
export class DataElementChatSendService {
  constructor(private chatMessageService: ChatMessageService) { }

  /** Send field value (or current/max) + name to the first chat tab for quick dice/commands. */
  send(dataElm: DataElement | null | undefined, options: DataElementChatSendOptions = {}) {
    if (!dataElm) return;
    const chatTabs = this.chatMessageService.chatTabs;
    if (!chatTabs || chatTabs.length < 1) return;

    const chatTab: ChatTab = chatTabs[0];
    const snapshot = options.snapshot;
    const fieldName = snapshot?.name ?? dataElm.name;
    const fieldValue = snapshot?.value ?? dataElm.value;
    const fieldCurrentValue = snapshot?.currentValue ?? dataElm.currentValue;
    let payload = `${fieldValue ?? ''}`;
    if (fieldCurrentValue !== '' && fieldCurrentValue != null) {
      payload = `${fieldCurrentValue}/${fieldValue}`;
    }
    let text = `${payload} ${fieldName}`.trim();
    if (!text) return;

    const source = options.character ?? null;
    const sendFrom = (source instanceof GameCharacter)
      ? source.identifier
      : PeerCursor.myCursor.identifier;
    let gameType = this.chatMessageService.gameType || 'DiceBot';

    if (source instanceof GameCharacter && source.chatPalette) {
      const palette = source.chatPalette;
      text = palette.evaluate(text, source.rootDataElement);
      if (palette.dicebot) gameType = palette.dicebot;
    }

    this.chatMessageService.sendMessage(chatTab, text, gameType, sendFrom);
  }
}
