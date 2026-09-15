import {
  Directive,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { MobileLayoutService } from 'service/mobile-layout.service';

const SKELETON = 'assets/images/skeleton.png';

/**
 * Defer setting img[src] until near viewport (mobile only).
 * Desktop keeps immediate binding for zero behavior change.
 */
@Directive({
  selector: 'img[appLazyImg]',
  standalone: false,
})
export class LazyImgDirective implements OnInit, OnChanges, OnDestroy {
  @Input('appLazyImg') lazySrc = '';

  private observer: IntersectionObserver | null = null;
  private loaded = false;
  private mobileMode = false;
  private mobileSub: Subscription | null = null;

  constructor(
    private el: ElementRef<HTMLImageElement>,
    private mobileLayout: MobileLayoutService,
  ) { }

  ngOnInit(): void {
    this.mobileMode = this.mobileLayout.isMobile;
    this.mobileSub = this.mobileLayout.isMobile$.subscribe(mobile => {
      if (mobile === this.mobileMode) return;
      this.mobileMode = mobile;
      this.loaded = false;
      this.disconnect();
      this.apply();
    });
    this.apply();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['lazySrc']) {
      this.loaded = false;
      this.disconnect();
      this.apply();
    }
  }

  ngOnDestroy(): void {
    this.mobileSub?.unsubscribe();
    this.disconnect();
  }

  private apply(): void {
    const img = this.el.nativeElement;
    const src = (this.lazySrc || '').trim();
    if (!src) {
      img.removeAttribute('src');
      return;
    }
    if (!this.mobileMode) {
      img.src = src;
      this.disconnect();
      return;
    }
    if (this.loaded) {
      img.src = src;
      return;
    }
    if (!this.observer) {
      img.loading = 'lazy';
      img.src = SKELETON;
      this.observer = new IntersectionObserver(
        entries => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            this.loadNow();
            this.disconnect();
            break;
          }
        },
        { rootMargin: '120px' },
      );
      this.observer.observe(img);
    }
  }

  private loadNow(): void {
    const src = (this.lazySrc || '').trim();
    if (!src || this.loaded) return;
    this.loaded = true;
    this.el.nativeElement.src = src;
  }

  private disconnect(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}
