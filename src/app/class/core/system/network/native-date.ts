/** Set in src/native-date-polyfill.ts before zone.js (fallback when iframe is unavailable). */
export type NativeDateGlobal = typeof globalThis & { __udonariumNativeDate?: DateConstructor };

/** Capture pre-zone `Date` for polyfills entry (must stay dependency-free). */
export function stashNativeDateEarly(): void {
  const g = globalThis as NativeDateGlobal;
  if (g.__udonariumNativeDate) return;
  try {
    if (Number.isFinite(new Date().getTime())) {
      g.__udonariumNativeDate = Date;
    }
  } catch {
    // iframe fallback in nativeDateConstructor()
  }
}

let pristineDateIframe: HTMLIFrameElement | null = null;
let pristineDateCtor: DateConstructor | null = null;

function dateCtorWorks(DateCtor: DateConstructor): boolean {
  try {
    const d = new DateCtor();
    const t = typeof d.getTime === 'function' ? d.getTime() : NaN;
    return Number.isFinite(t);
  } catch {
    return false;
  }
}

/** Hidden iframe realm: zone.js and crypto libs never patch this Date. */
function pristineDateFromIframe(): DateConstructor | null {
  if (pristineDateCtor && dateCtorWorks(pristineDateCtor)) return pristineDateCtor;
  if (typeof document === 'undefined') return null;
  try {
    if (!pristineDateIframe) {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('tabindex', '-1');
      frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
      document.documentElement.appendChild(frame);
      pristineDateIframe = frame;
    }
    const ctor = pristineDateIframe.contentWindow?.['Date'] as DateConstructor | undefined;
    if (ctor && dateCtorWorks(ctor)) {
      pristineDateCtor = ctor;
      return ctor;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Install a main-realm Date wrapper that delegates to a pristine constructor. */
function bindPristineDate(ctor: DateConstructor): DateConstructor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const factory = function (...args: any[]) {
    return args.length === 0 ? new ctor() : new (ctor as any)(...args);
  } as DateConstructor;
  factory.UTC = ctor.UTC.bind(ctor);
  factory.parse = ctor.parse.bind(ctor);
  factory.now = ctor.now.bind(ctor);
  Object.setPrototypeOf(factory, ctor);
  return factory;
}

/** Date constructor safe for jsrsasign init (unpatched browser Date when possible). */
export function nativeDateConstructor(): DateConstructor {
  const iframe = pristineDateFromIframe();
  if (iframe) return iframe;

  const g = globalThis as NativeDateGlobal;
  const cached = g.__udonariumNativeDate;
  if (cached && dateCtorWorks(cached)) return cached;

  g.__udonariumNativeDate = Date;
  return Date;
}

/** Run fn while global Date is the native constructor (for dynamic SkyWay chunk load). */
export async function withNativeDateForLoad<T>(fn: () => Promise<T>): Promise<T> {
  const pristine = nativeDateConstructor();
  const bound = bindPristineDate(pristine);
  if (!dateCtorWorks(bound)) {
    throw new Error('No working Date constructor for SkyWay load');
  }
  const before = globalThis.Date;
  globalThis.Date = bound;
  try {
    return await fn();
  } finally {
    globalThis.Date = before;
  }
}
