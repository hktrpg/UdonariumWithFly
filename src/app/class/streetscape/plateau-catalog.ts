import { STREETSCAPE_ERRORS } from './errors';
import { throwIfAborted } from './source';

const PLATEAU_API = 'https://api.plateauview.mlit.go.jp';

export type PlateauCityEntry = {
  cityCode: string;
  city: string;
  pref: string;
  prefCode: string;
};

export type PlateauBldgFile = {
  code: string;
  maxLod: number;
  url: string;
  fileSize: number;
  features: number;
};

export type PlateauCityGmlHit = {
  cityCode: string;
  cityName: string;
  year: number;
  files: PlateauBldgFile[];
};

export type PlateauCitySuggestion = {
  label: string;
  cityCode: string;
  city: string;
  pref: string;
};

let citiesCache: PlateauCityEntry[] | null = null;
let citiesPromise: Promise<PlateauCityEntry[]> | null = null;

/** Latest PLATEAU municipality list (for typeahead). */
export async function loadPlateauCities(signal?: AbortSignal): Promise<PlateauCityEntry[]> {
  if (citiesCache) return citiesCache;
  if (!citiesPromise) {
    citiesPromise = (async () => {
      const res = await fetch(`${PLATEAU_API}/datacatalog/plateau-datasets`, { signal });
      if (!res.ok) throw new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
      const json = await res.json() as {
        latest_citygml?: Array<Record<string, unknown>>;
        citygml?: Array<Record<string, unknown>>;
      };
      const rows = json.latest_citygml?.length ? json.latest_citygml : (json.citygml || []);
      const byCode = new Map<string, PlateauCityEntry>();
      for (const row of rows) {
        const cityCode = String(row.city_code || row.cityCode || '').trim();
        const city = String(row.city || row.cityName || '').trim();
        if (!cityCode || !city) continue;
        if (byCode.has(cityCode)) continue;
        byCode.set(cityCode, {
          cityCode,
          city,
          pref: String(row.pref || '').trim(),
          prefCode: String(row.pref_code || row.prefCode || '').trim(),
        });
      }
      citiesCache = Array.from(byCode.values()).sort((a, b) =>
        (a.pref + a.city).localeCompare(b.pref + b.city, 'ja'));
      return citiesCache;
    })().catch(err => {
      citiesPromise = null;
      throw err;
    });
  }
  return citiesPromise;
}

export function suggestPlateauCities(
  cities: PlateauCityEntry[],
  query: string,
  limit = 10,
): PlateauCitySuggestion[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const out: PlateauCitySuggestion[] = [];
  for (const c of cities) {
    const hay = `${c.city} ${c.pref} ${c.cityCode}`.toLowerCase();
    if (!hay.includes(q) && !c.city.includes(query) && !c.pref.includes(query)) continue;
    out.push({
      label: c.pref ? `${c.pref} ${c.city}` : c.city,
      cityCode: c.cityCode,
      city: c.city,
      pref: c.pref,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Geocode / municipality search → CityGML building file list. */
export async function searchPlateauCityGml(
  query: string,
  signal?: AbortSignal,
): Promise<PlateauCityGmlHit[]> {
  const q = String(query || '').trim();
  if (!q) throw new Error(STREETSCAPE_ERRORS.NO_QUERY);
  throwIfAborted(signal);
  const path = `g:${encodeURIComponent(q)}`;
  const url = `${PLATEAU_API}/datacatalog/citygml/${path}?types=bldg`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(STREETSCAPE_ERRORS.NO_STREET_MATCH);
  const json = await res.json() as {
    cities?: Array<{
      cityCode?: string;
      cityName?: string;
      year?: number;
      files?: { bldg?: Array<Record<string, unknown>> };
    }>;
  };
  const hits: PlateauCityGmlHit[] = [];
  for (const city of json.cities || []) {
    const files: PlateauBldgFile[] = [];
    for (const f of city.files?.bldg || []) {
      const fileUrl = String(f.url || '').trim();
      const code = String(f.code || '').trim();
      if (!fileUrl || !code) continue;
      files.push({
        code,
        maxLod: Math.max(0, Math.floor(Number(f.maxLod) || 0)),
        url: fileUrl,
        fileSize: Math.max(0, Math.floor(Number(f.fileSize) || 0)),
        features: Math.max(0, Math.floor(Number(f.features) || 0)),
      });
    }
    if (!files.length) continue;
    hits.push({
      cityCode: String(city.cityCode || '').trim(),
      cityName: String(city.cityName || '').trim(),
      year: Math.floor(Number(city.year) || 0),
      files,
    });
  }
  if (!hits.length) throw new Error(STREETSCAPE_ERRORS.NO_STREET_MATCH);
  return hits;
}

/**
 * Prefer a mid-size LoD1+ mesh under ~40 MiB; otherwise the smallest file.
 * Full municipality ZIPs are multi‑GB — we only download one mesh GML.
 */
export function pickPlateauBldgFile(files: PlateauBldgFile[]): PlateauBldgFile {
  if (!files.length) throw new Error(STREETSCAPE_ERRORS.NO_FEATURE);
  const softMax = 40 * 1024 * 1024;
  const ranked = files.slice().sort((a, b) => {
    const aLod = a.maxLod >= 1 ? 0 : 1;
    const bLod = b.maxLod >= 1 ? 0 : 1;
    if (aLod !== bLod) return aLod - bLod;
    const aOver = a.fileSize > softMax ? 1 : 0;
    const bOver = b.fileSize > softMax ? 1 : 0;
    if (aOver !== bOver) return aOver - bOver;
    return a.fileSize - b.fileSize;
  });
  return ranked[0];
}

export async function fetchPlateauText(
  url: string,
  signal?: AbortSignal,
  onProgress?: (loaded: number, total: number) => void,
): Promise<string> {
  throwIfAborted(signal);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
  const total = Number(res.headers.get('Content-Length') || 0);
  if (!res.body || !onProgress) {
    const text = await res.text();
    onProgress?.(text.length, total || text.length);
    return text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    throwIfAborted(signal);
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.length) {
      chunks.push(value);
      loaded += value.length;
      onProgress(loaded, total);
    }
  }
  const all = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder('utf-8').decode(all);
}
