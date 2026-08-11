import { AudioPlayer } from '@udonarium/core/file-storage/audio-player';

/** Seamless ambient loop with head/tail crossfade (no hard loop click). */
export class WeatherLoopPlayer {
  private static readonly OVERLAP_SEC = 0.85;
  private static readonly FADE_STEPS = 12;

  private url = '';
  private a: HTMLAudioElement | null = null;
  private b: HTMLAudioElement | null = null;
  private active: HTMLAudioElement | null = null;
  private standby: HTMLAudioElement | null = null;
  private crossfadeStarted = false;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private onTimeUpdate: (() => void) | null = null;
  private wired = new WeakSet<HTMLAudioElement>();

  play(url: string, volume = 1): boolean {
    this.stop();
    if (!url) return false;
    this.url = url;
    this.a = this.createElement(url, volume);
    this.b = this.createElement(url, volume);
    this.active = this.a;
    this.standby = this.b;
    this.crossfadeStarted = false;
    this.onTimeUpdate = () => this.tickCrossfade();
    this.active.addEventListener('timeupdate', this.onTimeUpdate);
    this.active.play().catch(() => { /* autoplay policy */ });
    return true;
  }

  stop() {
    this.clearFade();
    for (const el of [this.a, this.b]) {
      if (!el) continue;
      if (this.onTimeUpdate) el.removeEventListener('timeupdate', this.onTimeUpdate);
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.a = this.b = this.active = this.standby = null;
    this.onTimeUpdate = null;
    this.crossfadeStarted = false;
    this.url = '';
  }

  isPlaying(): boolean {
    return !!(this.active && !this.active.paused);
  }

  setVolume(volume: number) {
    const v = Math.max(0, Math.min(1, volume));
    if (this.active) this.active.volume = v;
    if (this.standby && this.standby.paused) this.standby.volume = v;
  }

  private createElement(url: string, volume: number): HTMLAudioElement {
    const el = new Audio(url);
    el.loop = false;
    el.preload = 'auto';
    el.volume = volume;
    this.wireAmbient(el);
    return el;
  }

  /** Route through ambient gain so mute/volume sliders apply. */
  private wireAmbient(el: HTMLAudioElement) {
    if (this.wired.has(el)) return;
    void AudioPlayer.ambientNode;
    try {
      const source = AudioPlayer.audioContext.createMediaElementSource(el);
      source.connect(AudioPlayer.ambientNode);
      this.wired.add(el);
    } catch {
      // Fallback: direct element volume only.
    }
  }

  private tickCrossfade() {
    const current = this.active;
    const next = this.standby;
    if (!current || !next || this.crossfadeStarted) return;
    const duration = current.duration;
    if (!duration || !isFinite(duration)) return;
    const remain = duration - current.currentTime;
    if (remain > WeatherLoopPlayer.OVERLAP_SEC || remain <= 0) return;
    this.crossfadeStarted = true;
    next.currentTime = 0;
    next.volume = 0;
    void next.play().catch(() => { this.crossfadeStarted = false; });

    const target = current.volume;
    let step = 0;
    this.clearFade();
    this.fadeTimer = setInterval(() => {
      step++;
      const t = step / WeatherLoopPlayer.FADE_STEPS;
      if (current) current.volume = Math.max(0, target * (1 - t));
      if (next) next.volume = Math.max(0, target * t);
      if (step >= WeatherLoopPlayer.FADE_STEPS) {
        this.clearFade();
        if (current) {
          current.pause();
          current.currentTime = 0;
        }
        if (next) next.volume = target;
        this.active = next;
        this.standby = current;
        this.crossfadeStarted = false;
        if (this.onTimeUpdate && current) current.removeEventListener('timeupdate', this.onTimeUpdate);
        if (this.onTimeUpdate && this.active) this.active.addEventListener('timeupdate', this.onTimeUpdate);
      }
    }, (WeatherLoopPlayer.OVERLAP_SEC * 1000) / WeatherLoopPlayer.FADE_STEPS);
  }

  private clearFade() {
    if (this.fadeTimer != null) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
  }
}
