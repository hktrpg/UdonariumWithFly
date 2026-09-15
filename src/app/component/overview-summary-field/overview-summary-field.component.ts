import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { checkPropertyDisplayValue } from '@udonarium/check-property-display';
import { DataElement } from '@udonarium/data-element';
import { GameCharacter } from '@udonarium/game-character';

@Component({
  selector: 'overview-summary-field',
  templateUrl: './overview-summary-field.component.html',
  styleUrls: ['./overview-summary-field.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class OverviewSummaryFieldComponent {
  @Input() dataElm: DataElement = null;
  @Input() character: GameCharacter | null = null;
  @Input() showSendButton = false;
  @Input() variant: 'preview' | 'compact' = 'preview';

  checkValue(dataElm: DataElement): string {
    return checkPropertyDisplayValue(dataElm.currentValue, dataElm.value);
  }

  resourcePercent(dataElm: DataElement): number {
    const max = Number(dataElm.value);
    const current = Number(dataElm.currentValue);
    if (!max || Number.isNaN(max) || Number.isNaN(current)) return 0;
    return Math.max(0, Math.min(100, (current / max) * 100));
  }
}
