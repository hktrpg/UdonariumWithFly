import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { EventSystem } from '@udonarium/core/system';
import {
  APP_LOCALES,
  AppLocale,
  DEFAULT_LOCALE,
  I18N_DICTIONARIES,
  I18nParams,
  translate,
} from 'i18n';

@Injectable({
  providedIn: 'root'
})
export class I18nService {
  static readonly STORAGE_KEY = 'udonarium.ui.locale';

  /** Bumped on locale change so impure pipes refresh. */
  revision = 0;

  readonly locales = APP_LOCALES;

  private readonly localeSubject = new BehaviorSubject<AppLocale>(this.resolveInitialLocale());
  readonly locale$ = this.localeSubject.asObservable();

  constructor() {
    this.applyDocumentLang(this.locale);
  }

  get locale(): AppLocale {
    return this.localeSubject.value;
  }

  /** True after the user (or an explicit set) has persisted a language choice. */
  get hasStoredLocale(): boolean {
    try {
      const stored = localStorage.getItem(I18nService.STORAGE_KEY) as AppLocale;
      return !!(stored && I18N_DICTIONARIES[stored]);
    } catch {
      return false;
    }
  }

  setLocale(locale: AppLocale) {
    if (!I18N_DICTIONARIES[locale]) return;
    if (locale === this.locale && this.hasStoredLocale) return;
    try {
      localStorage.setItem(I18nService.STORAGE_KEY, locale);
    } catch { /* ignore quota / private mode */ }
    if (locale === this.locale) return;
    this.localeSubject.next(locale);
    this.revision++;
    this.applyDocumentLang(locale);
    EventSystem.trigger('LOCALE_CHANGED', locale);
  }

  t(key: string, params?: I18nParams): string {
    return translate(key, params, this.locale);
  }

  /** Prefer saved preference; otherwise browser languages. */
  private resolveInitialLocale(): AppLocale {
    try {
      const stored = localStorage.getItem(I18nService.STORAGE_KEY) as AppLocale;
      if (stored && I18N_DICTIONARIES[stored]) return stored;
    } catch { /* ignore */ }
    return this.detectBrowserLocale();
  }

  detectBrowserLocale(): AppLocale {
    if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
    const list: string[] = [];
    try {
      if (navigator.languages?.length) list.push(...navigator.languages);
      if (navigator.language) list.push(navigator.language);
    } catch { /* ignore */ }
    for (const raw of list) {
      const mapped = this.mapBrowserTag(raw);
      if (mapped) return mapped;
    }
    return DEFAULT_LOCALE;
  }

  private mapBrowserTag(raw: string): AppLocale | null {
    if (!raw) return null;
    const tag = raw.toLowerCase().replace(/_/g, '-');
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('en')) return 'en';
    if (tag.startsWith('zh')) {
      if (tag.includes('hant') || tag === 'zh-tw' || tag === 'zh-hk' || tag === 'zh-mo') return 'zh-TW';
      if (tag.includes('hans') || tag === 'zh-cn' || tag === 'zh-sg' || tag === 'zh-my') return 'zh-CN';
      // Bare "zh" → project default (Traditional)
      return DEFAULT_LOCALE;
    }
    return null;
  }

  private applyDocumentLang(locale: AppLocale) {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
  }
}
