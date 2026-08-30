import { Injectable } from '@angular/core';
import * as localForage from 'localforage';

export type UiThemeId = 'classic' | 'remake' | 'expedition';

export const UI_THEME_IDS: readonly UiThemeId[] = ['classic', 'remake', 'expedition'] as const;

const STORAGE_KEY = 'udonanaumu-ui-theme';
const DEFAULT_THEME: UiThemeId = 'remake';

@Injectable({ providedIn: 'root' })
export class UiThemeService {
  private current: UiThemeId = DEFAULT_THEME;
  private ready: Promise<void>;

  constructor() {
    this.apply(DEFAULT_THEME);
    this.ready = localForage.getItem<string>(STORAGE_KEY).then(stored => {
      const next = UiThemeService.parse(stored);
      if (next !== this.current) this.apply(next);
    }).catch(() => { /* keep default */ });
  }

  /** Resolves after local preference is loaded (or fails). */
  whenReady(): Promise<void> {
    return this.ready;
  }

  get theme(): UiThemeId {
    return this.current;
  }

  setTheme(theme: UiThemeId) {
    const next = UiThemeService.parse(theme) ?? DEFAULT_THEME;
    if (next === this.current) return;
    this.apply(next);
    localForage.setItem(STORAGE_KEY, next).catch(() => {});
  }

  private apply(theme: UiThemeId) {
    this.current = theme;
    document.documentElement.dataset.uiTheme = theme;
  }

  private static parse(value: unknown): UiThemeId | null {
    if (value === 'classic' || value === 'remake' || value === 'expedition') return value;
    return null;
  }
}
