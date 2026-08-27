import { STREETSCAPE_ERRORS } from './errors';
import {
  fetchPlateauText,
  pickPlateauBldgFile,
  searchPlateauCityGml,
} from './plateau-catalog';
import { parsePlateauBuildingsFromGml } from './plateau-gml-parse';
import { buildPlateauStreetscapePack } from './plateau-pack';
import { StreetscapePackLoad, StreetscapeQuery, StreetscapeSource, throwIfAborted } from './source';

export const plateauSource: StreetscapeSource = {
  id: 'plateau',
  async resolve(query: StreetscapeQuery, signal?, onProgress?): Promise<StreetscapePackLoad> {
    if (query.type !== 'plateau') throw new Error(STREETSCAPE_ERRORS.NO_QUERY);
    throwIfAborted(signal);

    let gmlUrl = String(query.gmlUrl || '').trim();
    let meshCode = String(query.meshCode || '').trim();
    let cityCode = String(query.cityCode || '').trim();
    let cityName = String(query.cityName || query.street || '').trim();
    const maxFeatures = Math.max(1, Math.floor(Number(query.maxFeatures) || 4));

    if (!gmlUrl) {
      const q = String(query.street || query.cityName || '').trim();
      if (!q && !cityCode) throw new Error(STREETSCAPE_ERRORS.NO_QUERY);
      onProgress?.({ phase: 'download', current: 0, total: 0, message: 'index' });
      const hits = await searchPlateauCityGml(q || cityCode, signal);
      const hit = pickCityHit(hits, cityCode, cityName || q);
      cityCode = hit.cityCode;
      cityName = hit.cityName || cityName || q;
      const file = pickPlateauBldgFile(hit.files);
      gmlUrl = file.url;
      meshCode = file.code;
    }
    if (!gmlUrl || !meshCode) throw new Error(STREETSCAPE_ERRORS.NO_FEATURE);

    onProgress?.({ phase: 'download', current: 0, total: 0, message: 'fetch' });
    const text = await fetchPlateauText(gmlUrl, signal, (loaded, total) => {
      onProgress?.({ phase: 'download', current: loaded, total: total || 0, message: 'fetch' });
    });
    onProgress?.({ phase: 'unpack', current: 1, total: 2 });
    const parsed = parsePlateauBuildingsFromGml(text);
    if (!parsed.buildings.length) throw new Error(STREETSCAPE_ERRORS.NO_FEATURE);
    const load = buildPlateauStreetscapePack({
      cityCode: cityCode || 'jp',
      cityName: cityName || meshCode,
      meshCode,
      envelope: parsed.envelope,
      buildings: parsed.buildings,
      maxFeatures,
      excludeBuildingIds: query.excludeBuildingIds,
      title: query.title || `PLATEAU ${cityName || meshCode}`,
    });
    onProgress?.({ phase: 'unpack', current: 2, total: 2 });
    if (!load.pack.features.length) throw new Error(STREETSCAPE_ERRORS.NO_MORE_MODELS);
    return load;
  },
};

function pickCityHit(
  hits: Awaited<ReturnType<typeof searchPlateauCityGml>>,
  cityCode: string,
  nameHint: string,
) {
  if (cityCode) {
    const byCode = hits.find(h => h.cityCode === cityCode);
    if (byCode) return byCode;
  }
  const hint = nameHint.trim();
  if (hint) {
    const byName = hits.find(h => h.cityName === hint || hint.includes(h.cityName) || h.cityName.includes(hint));
    if (byName) return byName;
  }
  return hits[0];
}
