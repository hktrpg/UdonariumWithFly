import { STREETSCAPE_ERRORS } from './errors';
import { StreetscapeQuery, StreetscapeSource } from './source';

const sources = new Map<string, StreetscapeSource>();

export function registerStreetscapeSource(source: StreetscapeSource): void {
  if (!source?.id) throw new Error(STREETSCAPE_ERRORS.UNKNOWN_SOURCE);
  sources.set(source.id, source);
}

export function getStreetscapeSource(id: string): StreetscapeSource | undefined {
  return sources.get(id);
}

export function listStreetscapeSources(): StreetscapeSource[] {
  return [...sources.values()];
}

export function resolveStreetscapeSource(query: StreetscapeQuery): StreetscapeSource {
  const id = query.type === 'file' ? 'pack-file'
    : query.type === 'catalog' ? 'pack-catalog'
    : query.type === 'open3dhk' ? 'open3dhk'
    : '';
  const source = sources.get(id);
  if (!source) throw new Error(STREETSCAPE_ERRORS.UNKNOWN_SOURCE);
  return source;
}

export function resetStreetscapeSourcesForTests(): void {
  sources.clear();
}
