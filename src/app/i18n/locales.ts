import { registerLocaleData } from '@angular/common';
import localeEn from '@angular/common/locales/en';
import localeJa from '@angular/common/locales/ja';
import localeZhHans from '@angular/common/locales/zh-Hans';
import localeZhHant from '@angular/common/locales/zh-Hant';
import { AppLocale } from './types';

let registered = false;

export function ensureI18nLocalesRegistered() {
  if (registered) return;
  registerLocaleData(localeZhHant, 'zh-Hant');
  registerLocaleData(localeZhHans, 'zh-Hans');
  registerLocaleData(localeJa, 'ja');
  registerLocaleData(localeEn, 'en');
  registered = true;
}

/** BCP 47 / Angular locale id for DatePipe and formatDate. */
export function toIntlLocale(locale: AppLocale): string {
  switch (locale) {
    case 'zh-TW': return 'zh-Hant';
    case 'zh-CN': return 'zh-Hans';
    case 'ja': return 'ja';
    default: return 'en';
  }
}
