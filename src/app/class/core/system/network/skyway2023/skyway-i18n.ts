import type { I18nParams } from 'i18n';

/** Lazy i18n for the SkyWay chunk — avoids static `i18n` import (large bundle + TDZ risk). */
export function skywayI18n(key: string, params?: I18nParams, fallback?: string): string {
  try {
    const { translate } = require('i18n') as typeof import('i18n');
    return translate(key, params);
  } catch {
    return fallback ?? key;
  }
}
