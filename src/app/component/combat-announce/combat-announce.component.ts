import { animate, keyframes, style, transition, trigger } from '@angular/animations';
import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { EventSystem } from '@udonarium/core/system';
import { I18nService } from 'service/i18n.service';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';

export interface CombatRoundAnnounceData {
  round: number;
  name?: string;
  kind?: 'begin' | 'round';
}

export interface TimerAnnounceData {
  message: string;
  label?: string;
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
  kind: 'begin' | 'round' | 'timer' = 'round';
  timerMessage = '';
  private hideTimer: ReturnType<typeof setTimeout> = null;
  private animKey = 0;

  constructor(
    private ngZone: NgZone,
    private changeDetector: ChangeDetectorRef,
    private i18n: I18nService
  ) {}

  get label(): string {
    if (this.kind === 'timer') return this.i18n.t('timer.announce');
    return this.i18n.t(this.kind === 'begin' ? 'combat.begin' : 'combat.nextRound');
  }

  /** Force re-enter animation when announce fires again while still visible. */
  get showKey(): number {
    return this.animKey;
  }

  ngOnInit() {
    EventSystem.register(this)
      .on<CombatRoundAnnounceData>('COMBAT_ROUND_ANNOUNCE', -1000, event => {
        this.ngZone.run(() => this.showCombat(event.data));
      })
      .on<TimerAnnounceData>('TABLE_TIMER_ANNOUNCE', -1000, event => {
        this.ngZone.run(() => this.showTimer(event.data));
      });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    if (this.hideTimer) clearTimeout(this.hideTimer);
  }

  private showCombat(data: CombatRoundAnnounceData) {
    if (!data || !(data.round > 0)) return;
    this.round = data.round;
    this.name = (data.name || '').trim();
    this.timerMessage = '';
    this.kind = data.kind === 'begin' ? 'begin' : 'round';
    this.present();
    SoundEffect.playLocal(this.kind === 'begin' ? PresetSound.surprise : PresetSound.selectionStart);
  }

  private showTimer(data: TimerAnnounceData) {
    const message = (data?.message || data?.label || '').trim();
    if (!message) return;
    this.timerMessage = message;
    this.name = (data?.label || '').trim();
    this.round = 0;
    this.kind = 'timer';
    this.present();
    SoundEffect.playLocal(PresetSound.surprise);
  }

  private present() {
    this.animKey += 1;
    this.visible = false;
    this.changeDetector.detectChanges();
    this.visible = true;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.visible = false;
      this.hideTimer = null;
      this.changeDetector.markForCheck();
    }, 2800);
  }
}
