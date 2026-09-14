import { TestBed } from '@angular/core/testing';
import { ChatTab } from '@udonarium/chat-tab';
import { DataElement } from '@udonarium/data-element';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ChatMessageService } from './chat-message.service';
import { DataElementChatSendService } from './data-element-chat-send.service';

describe('DataElementChatSendService', () => {
  let service: DataElementChatSendService;
  let chatMessageService: jasmine.SpyObj<ChatMessageService>;
  const chatTab = { identifier: 'tab-1' } as ChatTab;

  beforeEach(() => {
    chatMessageService = jasmine.createSpyObj('ChatMessageService', ['sendMessage'], {
      chatTabs: [chatTab],
      gameType: 'DiceBot',
    });
    TestBed.configureTestingModule({
      providers: [
        DataElementChatSendService,
        { provide: ChatMessageService, useValue: chatMessageService },
      ],
    });
    service = TestBed.inject(DataElementChatSendService);
  });

  it('sends resource fields as current/max name', () => {
    const dataElm = DataElement.create('HP', 20, { type: 'numberResource', currentValue: 8 });
    service.send(dataElm);
    expect(chatMessageService.sendMessage).toHaveBeenCalledWith(
      chatTab,
      '8/20 HP',
      'DiceBot',
      PeerCursor.myCursor.identifier,
    );
  });

  it('uses snapshot overrides instead of data element values', () => {
    const dataElm = DataElement.create('HP', 20, { type: 'numberResource', currentValue: 8 });
    service.send(dataElm, { snapshot: { name: 'HP', value: 20, currentValue: 3 } });
    expect(chatMessageService.sendMessage).toHaveBeenCalledWith(
      chatTab,
      '3/20 HP',
      'DiceBot',
      PeerCursor.myCursor.identifier,
    );
  });

  it('evaluates chat palette for character senders', () => {
    const character = Object.create(GameCharacter.prototype) as GameCharacter;
    character.identifier = 'char-1';
    character.chatPalette = {
      dicebot: 'Cthulhu',
      evaluate: (text: string) => text.replace('敏捷', '12'),
    } as any;
    character.rootDataElement = null;

    const dataElm = DataElement.create('敏捷', 12, { type: 'abilityScore' });
    service.send(dataElm, { character });
    expect(chatMessageService.sendMessage).toHaveBeenCalledWith(
      chatTab,
      '12 12',
      'Cthulhu',
      'char-1',
    );
  });
});
