import { STREETSCAPE_ERRORS } from './errors';
import { throwIfAborted } from './source';

export const DEFAULT_STREET_SHEET_INDEX_URL = 'assets/streetscape/hk-street-sheets.json';

export type StreetSheetEntry = {
  zh?: string;
  en?: string;
  sheet: string;
  kind?: 'street' | 'place';
};

export type StreetSheetIndexV1 = {
  version: 1;
  attribution?: string;
  entries: StreetSheetEntry[];
};

export type StreetSheetSuggestion = StreetSheetEntry & {
  label: string;
};

let cached: StreetSheetIndexV1 | null = null;
let inflight: Promise<StreetSheetIndexV1> | null = null;

/** Test / rebuild helper. */
export function resetStreetSheetIndexCache(): void {
  cached = null;
  inflight = null;
}

export async function loadStreetSheetIndex(
  url = DEFAULT_STREET_SHEET_INDEX_URL,
  signal?: AbortSignal,
): Promise<StreetSheetIndexV1> {
  throwIfAborted(signal);
  if (cached) return cached;
  if (!inflight) {
    inflight = (async () => {
      const res = await fetch(url, { cache: 'force-cache', signal });
      if (!res.ok) throw new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
      const json = await res.json();
      const index = parseStreetSheetIndex(json);
      cached = index;
      return index;
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export function parseStreetSheetIndex(json: unknown): StreetSheetIndexV1 {
  if (!json || typeof json !== 'object') throw new Error(STREETSCAPE_ERRORS.INVALID_PACK);
  const o = json as Record<string, unknown>;
  if (o.version !== 1 || !Array.isArray(o.entries)) {
    throw new Error(STREETSCAPE_ERRORS.INVALID_PACK);
  }
  const entries: StreetSheetEntry[] = [];
  for (const raw of o.entries) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const sheet = typeof e.sheet === 'string' ? e.sheet.trim() : '';
    if (!sheet) continue;
    const zh = typeof e.zh === 'string' ? e.zh.trim() : '';
    const en = typeof e.en === 'string' ? e.en.trim() : '';
    if (!zh && !en) continue;
    const kind = e.kind === 'place' || e.kind === 'street' ? e.kind : undefined;
    entries.push({
      sheet,
      ...(zh ? { zh } : {}),
      ...(en ? { en } : {}),
      ...(kind ? { kind } : {}),
    });
  }
  return {
    version: 1,
    attribution: typeof o.attribution === 'string' ? o.attribution : undefined,
    entries,
  };
}

/** Open3Dhk 1:1000 sheet id, e.g. 11-SW-4B or 6-NE-13D. */
export function looksLikeOpen3dhkSheetId(q: string): boolean {
  return /^\d{1,2}-[A-Z]{2}-\d+[A-Z]?$/i.test((q || '').trim());
}

function normalizeMatchKey(q: string): string {
  return (q || '')
    .trim()
    .toLowerCase()
    // Drop spaces / common address punctuation so「石 崗 上村 6A…」still hits「石崗上村」.
    .replace(/[\s,，.。、;；:：'"`]+/g, '');
}

export function suggestStreetSheets(
  index: StreetSheetIndexV1,
  query: string,
  limit = 12,
): StreetSheetSuggestion[] {
  const q = (query || '').trim();
  if (!q || looksLikeOpen3dhkSheetId(q)) return [];
  const needle = normalizeMatchKey(q);
  if (!needle) return [];
  const starts: StreetSheetSuggestion[] = [];
  const includes: StreetSheetSuggestion[] = [];
  for (const e of index.entries) {
    const zh = e.zh || '';
    const en = e.en || '';
    const zhKey = normalizeMatchKey(zh);
    const enKey = normalizeMatchKey(en);
    const hitStart = (zhKey && zhKey.startsWith(needle)) || (enKey && enKey.startsWith(needle))
      || (zhKey && needle.startsWith(zhKey) && zhKey.length >= 2)
      || (enKey && needle.startsWith(enKey) && enKey.length >= 2);
    const hitInc = !hitStart && (
      (zhKey && zhKey.includes(needle)) || (enKey && enKey.includes(needle))
      || (zhKey && needle.includes(zhKey) && zhKey.length >= 2)
      || (enKey && needle.includes(enKey) && enKey.length >= 2)
    );
    if (!hitStart && !hitInc) continue;
    const label = zh && en ? `${zh} / ${en}` : (zh || en);
    const item: StreetSheetSuggestion = { ...e, label };
    (hitStart ? starts : includes).push(item);
    if (starts.length >= limit) break;
  }
  return [...starts, ...includes].slice(0, limit);
}

export function resolveStreetToSheet(
  index: StreetSheetIndexV1,
  query: string,
): StreetSheetSuggestion | null {
  const q = (query || '').trim();
  if (!q) return null;
  if (looksLikeOpen3dhkSheetId(q)) {
    return { sheet: q.toUpperCase(), label: q.toUpperCase() };
  }
  const needle = normalizeMatchKey(q);
  let exact: StreetSheetSuggestion | null = null;
  for (const e of index.entries) {
    const zh = e.zh || '';
    const en = e.en || '';
    if (
      (zh && normalizeMatchKey(zh) === needle)
      || (en && normalizeMatchKey(en) === needle)
    ) {
      const label = zh && en ? `${zh} / ${en}` : (zh || en);
      exact = { ...e, label };
      break;
    }
  }
  if (exact) return exact;

  // Longest directory name that prefixes the query (address paste).
  let best: StreetSheetSuggestion | null = null;
  let bestLen = 0;
  for (const e of index.entries) {
    for (const name of [e.zh, e.en]) {
      if (!name) continue;
      const nn = normalizeMatchKey(name);
      if (nn.length < 2 || !needle.startsWith(nn)) continue;
      if (nn.length <= bestLen) continue;
      bestLen = nn.length;
      const zh = e.zh || '';
      const en = e.en || '';
      best = { ...e, label: zh && en ? `${zh} / ${en}` : (zh || en) };
    }
  }
  if (best) return best;

  const suggestions = suggestStreetSheets(index, q, 1);
  return suggestions[0] || null;
}

/** Inject a fixture index (unit tests). */
export function setStreetSheetIndexForTests(index: StreetSheetIndexV1 | null): void {
  cached = index;
  inflight = null;
}
