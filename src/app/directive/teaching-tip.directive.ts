import { Directive, ElementRef, Input, NgZone, OnDestroy, OnInit } from '@angular/core';
import { TeachingTipService } from 'service/teaching-tip.service';

@Directive({
  selector: '[appTeachingTip]',
  standalone: false,
})
export class TeachingTipDirective implements OnInit, OnDestroy {
  @Input('appTeachingTip') tipKey = '';
  @Input() appTeachingTipDelayMs = 0;
  @Input() appTeachingTipEstimatedHeight = 120;

  private openTimer: ReturnType<typeof setTimeout> | null = null;

  private cancelOpenTimer() {
    if (this.openTimer !== null) clearTimeout(this.openTimer);
    this.openTimer = null;
  }

  private readonly onEnter = () => {
    // Coarse / touch pointers synthesize sticky mouseenter after tap — never show tips then.
    if (!this.service.isAvailable || !this.tipKey) return;
    this.cancelOpenTimer();
    const open = () => this.ngZone.run(() => this.service.show(this.tipKey, this.el.nativeElement, this.appTeachingTipEstimatedHeight));
    if (this.appTeachingTipDelayMs > 0) {
      this.openTimer = setTimeout(() => {
        this.openTimer = null;
        open();
      }, this.appTeachingTipDelayMs);
    } else {
      open();
    }
  };
  private readonly onLeave = () => {
    this.cancelOpenTimer();
    this.ngZone.run(() => this.service.hide(this.el.nativeElement));
  };
  private readonly onDown = () => {
    this.cancelOpenTimer();
    this.ngZone.run(() => this.service.hideAll());
  };

  constructor(
    private el: ElementRef<HTMLElement>,
    private service: TeachingTipService,
    private ngZone: NgZone,
  ) { }

  ngOnInit() {
    this.ngZone.runOutsideAngular(() => {
      this.el.nativeElement.addEventListener('mouseenter', this.onEnter);
      this.el.nativeElement.addEventListener('mouseleave', this.onLeave);
      this.el.nativeElement.addEventListener('pointerdown', this.onDown);
    });
  }

  ngOnDestroy() {
    this.cancelOpenTimer();
    this.el.nativeElement.removeEventListener('mouseenter', this.onEnter);
    this.el.nativeElement.removeEventListener('mouseleave', this.onLeave);
    this.el.nativeElement.removeEventListener('pointerdown', this.onDown);
    this.service.hide(this.el.nativeElement);
  }
}
