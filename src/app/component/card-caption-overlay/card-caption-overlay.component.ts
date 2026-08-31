import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { CardCaptionOverlayService, CardCaptionOverlayState } from 'service/card-caption-overlay.service';

@Component({
  selector: 'card-caption-overlay',
  templateUrl: './card-caption-overlay.component.html',
  styleUrls: ['./card-caption-overlay.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class CardCaptionOverlayComponent implements OnInit, OnDestroy {
  state: CardCaptionOverlayState | null = null;
  private sub: Subscription | null = null;

  constructor(
    private overlay: CardCaptionOverlayService,
    private changeDetector: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.sub = this.overlay.state$.subscribe(state => {
      this.state = state;
      this.changeDetector.markForCheck();
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }
}
