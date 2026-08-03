import { AppLocale, DEFAULT_LOCALE, I18nDictionary, I18nParams } from './types';
import { en } from './en';
import { en_ui } from './en-ui';
import { en_tutorial } from './en-tutorial';
import { en_ctx } from './en-ctx';
import { en_sheet } from './en-sheet';
import { en_obj } from './en-obj';
import { ja } from './ja';
import { ja_ui } from './ja-ui';
import { ja_tutorial } from './ja-tutorial';
import { ja_ctx } from './ja-ctx';
import { ja_sheet } from './ja-sheet';
import { ja_obj } from './ja-obj';
import { zhCN } from './zh-CN';
import { zhCN_ui } from './zh-CN-ui';
import { zhCN_tutorial } from './zh-CN-tutorial';
import { zhCN_ctx } from './zh-CN-ctx';
import { zhCN_sheet } from './zh-CN-sheet';
import { zhCN_obj } from './zh-CN-obj';
import { zhTW } from './zh-TW';
import { zhTW_ui } from './zh-TW-ui';
import { zhTW_tutorial } from './zh-TW-tutorial';
import { zhTW_ctx } from './zh-TW-ctx';
import { zhTW_sheet } from './zh-TW-sheet';
import { zhTW_obj } from './zh-TW-obj';

export * from './types';
export { ensureI18nLocalesRegistered, toIntlLocale } from './locales';

export const I18N_DICTIONARIES: Record<AppLocale, I18nDictionary> = {
  'zh-TW': { ...zhTW, ...zhTW_ui, ...zhTW_tutorial, ...zhTW_ctx, ...zhTW_sheet, ...zhTW_obj },
  'zh-CN': { ...zhCN, ...zhCN_ui, ...zhCN_tutorial, ...zhCN_ctx, ...zhCN_sheet, ...zhCN_obj },
  en: { ...en, ...en_ui, ...en_tutorial, ...en_ctx, ...en_sheet, ...en_obj },
  ja: { ...ja, ...ja_ui, ...ja_tutorial, ...ja_ctx, ...ja_sheet, ...ja_obj },
};

const LOCALE_STORAGE_KEY = 'udonarium.ui.locale';

/** Resolve UI locale without Angular DI (for class / network layers). */
export function resolveLocale(): AppLocale {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY) as AppLocale;
      if (stored && I18N_DICTIONARIES[stored]) return stored;
    }
  } catch { /* ignore */ }
  return DEFAULT_LOCALE;
}

/** Translate a key; safe to call outside Angular. */
export function translate(key: string, params?: I18nParams, locale: AppLocale = resolveLocale()): string {
  const dict = I18N_DICTIONARIES[locale] || I18N_DICTIONARIES[DEFAULT_LOCALE];
  let text = dict[key] ?? I18N_DICTIONARIES[DEFAULT_LOCALE][key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{\\{${name}\\}\\}`, 'g'), String(value));
    }
  }
  return text;
}
