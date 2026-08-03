import { animate, keyframes, style, transition, trigger } from '@angular/animations';
import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { EventSystem } from '@udonarium/core/system';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';

export interface CombatRoundAnnounceData {
  round: number;
  name?: string;
  kind?: 'begin' | 'round';
}

@Component({
  selector: 'combat-announce',
  templateUrl: './combat-announce.component.html',
  styleUrls: ['./combat-announce.component.css'],
  animations: [
    trigger('announce', [
      transition(':enter', [
        animate('520ms cubic-bezier(0.16, 1, 0.3, 1)', keyframes([
          style({ opacity: 0, transform: 'translate3d(-50%, -28px, 0) scale(0.92)', offset: 0 }),
          style({ opacity: 1, transform: 'translate3d(-50%, 0, 0) scale(1.04)', offset: 0.55 }),
          style({ opacity: 1, transform: 'translate3d(-50%, 0, 0) scale(1)', offset: 1 }),
        ])),
      ]),
      transition(':leave', [
        animate('320ms ease-in', keyframes([
          style({ opacity: 1, transform: 'translate3d(-50%, 0, 0)', offset: 0 }),
          style({ opacity: 0, transform: 'translate3d(-50%, -18px, 0)', offset: 1 }),
        ])),
      ]),
    ]),
  ],
  standalone: false,
})
export class CombatAnnounceComponent implements OnInit, OnDestroy {
  visible = false;
  round = 1;
  name = '';
  kind: 'begin' | 'round' = 'round';
  private hideTimer: ReturnType<typeof setTimeout> = null;
  private animKey = 0;

  constructor(
    private ngZone: NgZone,
    private changeDetector: ChangeDetectorRef,
  ) {}

  get label(): string {
    return this.kind === 'begin' ? '戰鬥開始' : '下一輪';
  }

  /** Force re-enter animation when announce fires again while still visible. */
  get showKey(): number {
    return this.animKey;
  }

  ngOnInit() {
    EventSystem.register(this)
      .on<CombatRoundAnnounceData>('COMBAT_ROUND_ANNOUNCE', -1000, event => {
        this.ngZone.run(() => this.show(event.data));
      });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    if (this.hideTimer) clearTimeout(this.hideTimer);
  }

  private show(data: CombatRoundAnnounceData) {
    if (!data || !(data.round > 0)) return;
    this.round = data.round;
    this.name = (data.name || '').trim();
    this.kind = data.kind === 'begin' ? 'begin' : 'round';
    this.animKey += 1;
    this.visible = false;
    this.changeDetector.detectChanges();
    this.visible = true;
    SoundEffect.playLocal(this.kind === 'begin' ? PresetSound.surprise : PresetSound.selectionStart);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.visible = false;
      this.hideTimer = null;
      this.changeDetector.markForCheck();
    }, 2800);
  }
}
