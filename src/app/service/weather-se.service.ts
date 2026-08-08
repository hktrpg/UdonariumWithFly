import { Injectable, OnDestroy } from '@angular/core';
import * as localForage from 'localforage';

import { Jukebox, JUKEBOX_WEATHER_TRACK } from '@udonarium/Jukebox';
import { GameTable, WeatherType } from '@udonarium/game-table';
import { EventSystem } from '@udonarium/core/system';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { TableSelecter } from '@udonarium/table-selecter';
import { AudioPlayer } from '@udonarium/core/file-storage/audio-player';

/** Built-in weather loops under assets/audio/weather/ (files optional). */
const WEATHER_SE_URL: Partial<Record<WeatherType, string>> = {
  rain: 'assets/audio/weather/rain.ogg',
  thunderstorm: 'assets/audio/weather/thunderstorm.ogg',
  wind: 'assets/audio/weather/wind.ogg',
  burning: 'assets/audio/weather/burning.ogg',
  snow: 'assets/audio/weather/snow.ogg',
  sandstorm: 'assets/audio/weather/sandstorm.ogg',
  fog: 'assets/audio/weather/wind.ogg',
  sakura: 'assets/audio/weather/wind.ogg',
  maple: 'assets/audio/weather/wind.ogg',
};

/**
 * Local weather ambience on Jukebox track 5 (index 4).
 * Local-only playback via playBuiltInLocal — does not sync room BGM assignment.
 */
@Injectable({ providedIn: 'root' })
export class WeatherSeService implements OnDestroy {
  static readonly STORAGE_KEY = 'udon.weatherSe.enabled';

  private enabled = true;
  private lastType: WeatherType | null = null;
  private lastUrl = '';
  private ready = false;
  private needsUnlockRetry = false;

  constructor() {
    localForage.getItem<boolean>(WeatherSeService.STORAGE_KEY).then(v => {
      this.enabled = v !== false; // default true
      this.ready = true;
      this.syncFromTable();
    }).catch(() => {
      this.ready = true;
      this.syncFromTable();
    });

    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', event => {
        const alias = event?.data?.aliasName;
        if (alias && alias !== GameTable.aliasName) return;
        this.syncFromTable();
      })
      .on('SELECT_GAME_TABLE', () => this.syncFromTable())
      .on('VIEW_GAME_TABLE', () => this.syncFromTable())
      .on('JUKEBOX_AUDIO_UNLOCKED', () => this.retryAfterUnlock());
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    this.stop();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean) {
    this.enabled = !!enabled;
    localForage.setItem(WeatherSeService.STORAGE_KEY, this.enabled).catch(() => {});
    this.lastType = null;
    this.lastUrl = '';
    this.needsUnlockRetry = false;
    this.syncFromTable();
  }

  syncFromTable() {
    if (!this.ready) return;
    const table = TableSelecter.instance?.viewTable;
    const type: WeatherType = table?.weatherType || 'none';
    this.applyWeatherType(type);
  }

  private jukebox(): Jukebox | null {
    return ObjectStore.instance.get<Jukebox>('Jukebox') || null;
  }

  private applyWeatherType(type: WeatherType) {
    if (!this.enabled || type === 'none') {
      if (this.lastType !== 'none' || this.lastUrl) this.stop();
      this.lastType = 'none';
      this.lastUrl = '';
      this.needsUnlockRetry = false;
      return;
    }
    const url = WEATHER_SE_URL[type];
    if (!url) {
      if (this.lastUrl) this.stop();
      this.lastType = type;
      this.lastUrl = '';
      this.needsUnlockRetry = false;
      return;
    }
    const box = this.jukebox();
    const already =
      this.lastType === type
      && this.lastUrl === url
      && !this.needsUnlockRetry
      && !!box?.isLocalPlaying(JUKEBOX_WEATHER_TRACK);
    if (already) return;

    this.lastType = type;
    this.lastUrl = url;
    this.startPlayback(url);
  }

  private startPlayback(url: string) {
    const box = this.jukebox();
    if (!box) {
      this.needsUnlockRetry = true;
      return;
    }
    AudioPlayer.ensureContextRunning();
    const ok = box.playBuiltInLocal(JUKEBOX_WEATHER_TRACK, url, true);
    this.needsUnlockRetry = !ok;
    window.setTimeout(() => {
      if (!this.enabled || this.lastUrl !== url) return;
      const playing = !!this.jukebox()?.isLocalPlaying(JUKEBOX_WEATHER_TRACK);
      this.needsUnlockRetry = !playing;
    }, 150);
  }

  private retryAfterUnlock() {
    if (!this.enabled || !this.lastUrl || this.lastType === 'none' || !this.lastType) {
      this.needsUnlockRetry = false;
      return;
    }
    if (!this.needsUnlockRetry && this.jukebox()?.isLocalPlaying(JUKEBOX_WEATHER_TRACK)) return;
    this.startPlayback(this.lastUrl);
  }

  private stop() {
    try {
      this.jukebox()?.stopBuiltInLocal(JUKEBOX_WEATHER_TRACK);
    } catch { /* ignore */ }
  }
}
