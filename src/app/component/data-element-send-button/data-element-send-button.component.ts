import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { DataElement } from '@udonarium/data-element';
import { GameCharacter } from '@udonarium/game-character';
import { DataElementChatSendService, DataElementChatSendSnapshot } from 'service/data-element-chat-send.service';

@Component({
  selector: 'data-element-send-button',
  templateUrl: './data-element-send-button.component.html',
  styleUrls: ['./data-element-send-button.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class DataElementSendButtonComponent {
  @Input() dataElm: DataElement = null;
  @Input() character: GameCharacter | null = null;
  @Input() snapshot: DataElementChatSendSnapshot | null = null;

  constructor(private sendService: DataElementChatSendService) { }

  send(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.sendService.send(this.dataElm, {
      character: this.character,
      snapshot: this.snapshot ?? undefined,
    });
  }
}
