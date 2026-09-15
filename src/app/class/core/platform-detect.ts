const UA = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';

/** iPhone, iPad, or iPadOS desktop mode. */
export const isIOS =
  UA.indexOf('iphone') > -1
  || UA.indexOf('ipad') > -1
  || (UA.indexOf('macintosh') > -1 && typeof document !== 'undefined' && 'ontouchend' in document);

export const isAndroid = UA.indexOf('android') > -1;

export function needsSyntheticContextMenu(): boolean {
  return isIOS || isAndroid;
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** `navigator.deviceMemory` in GB, or null when unavailable (common on Safari). */
export function deviceMemoryGb(): number | null {
  const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof dm === 'number' && dm > 0 ? dm : null;
}

export function hardwareConcurrency(): number {
  const n = navigator.hardwareConcurrency;
  return typeof n === 'number' && n > 0 ? n : 4;
}
