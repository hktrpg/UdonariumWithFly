import { Injectable, OnDestroy } from '@angular/core';
import * as localForage from 'localforage';

import { Jukebox, JUKEBOX_WEATHER_TRACK } from '@udonarium/Jukebox';
import { GameTable, WeatherType } from '@udonarium/game-table';
import { EventSystem } from '@udonarium/core/system';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { TableSelecter } from '@udonarium/table-selecter';
import { AudioPlayer } from '@udonarium/core/file-storage/audio-player';

import { WeatherLoopPlayer } from './weather-loop-player';

/** Built-in weather loops under assets/audio/weather/ (files optional). */
const WEATHER_SE_PATH: Partial<Record<WeatherType, string>> = {
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

function resolveAssetUrl(relativePath: string): string {
  try {
    return new URL(relativePath, document.baseURI).href;
  } catch {
    return relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  }
}

/**
 * Local weather ambience on Jukebox track 5 (index 4).
 * Local-only playback with crossfade loop — does not sync room BGM assignment.
 */
@Injectable({ providedIn: 'root' })
export class WeatherSeService implements OnDestroy {
  static readonly STORAGE_KEY = 'udon.weatherSe.enabled';

  private enabled = true;
  private lastType: WeatherType | null = null;
  private lastUrl = '';
  private ready = false;
  private needsUnlockRetry = false;
  private readonly loopPlayer = new WeatherLoopPlayer();

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
    const path = WEATHER_SE_PATH[type];
    if (!path) {
      if (this.lastUrl) this.stop();
      this.lastType = type;
      this.lastUrl = '';
      this.needsUnlockRetry = false;
      return;
    }
    const url = resolveAssetUrl(path);
    const already =
      this.lastType === type
      && this.lastUrl === url
      && !this.needsUnlockRetry
      && this.loopPlayer.isPlaying();
    if (already) return;

    this.lastType = type;
    this.lastUrl = url;
    this.startPlayback(url);
  }

  private startPlayback(url: string) {
    AudioPlayer.ensureContextRunning();
    try {
      this.jukebox()?.stopBuiltInLocal(JUKEBOX_WEATHER_TRACK);
    } catch { /* ignore */ }

    if (AudioPlayer.isAmbientMute || AudioPlayer.ambientVolume <= 0) {
      this.needsUnlockRetry = true;
      return;
    }

    const ok = this.loopPlayer.play(url, 1);
    this.needsUnlockRetry = !ok;
    window.setTimeout(() => {
      if (!this.enabled || this.lastUrl !== url) return;
      this.needsUnlockRetry = !this.loopPlayer.isPlaying();
    }, 250);
  }

  private retryAfterUnlock() {
    if (!this.enabled || !this.lastUrl || this.lastType === 'none' || !this.lastType) {
      this.needsUnlockRetry = false;
      return;
    }
    if (!this.needsUnlockRetry && this.loopPlayer.isPlaying()) return;
    this.startPlayback(this.lastUrl);
  }

  private stop() {
    this.loopPlayer.stop();
    try {
      this.jukebox()?.stopBuiltInLocal(JUKEBOX_WEATHER_TRACK);
    } catch { /* ignore */ }
  }
}
