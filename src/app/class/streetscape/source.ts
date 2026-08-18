import { StreetscapePackV1 } from './pack-schema';

export type StreetscapeQuery =
  | { type: 'file'; files: File[] }
  | { type: 'catalog'; id: string; catalogUrl?: string }
  | { type: 'open3dhk'; street?: string; sheet?: string; radiusMeters?: number; packUrl?: string };

export type StreetscapePackLoad = {
  pack: StreetscapePackV1;
  openFeature(id: string, signal?: AbortSignal): Promise<File[]>;
  openFloor(signal?: AbortSignal): Promise<Blob>;
};

export type StreetscapeSource = {
  readonly id: string;
  resolve(query: StreetscapeQuery, signal?: AbortSignal): Promise<StreetscapePackLoad>;
};

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('STREETSCAPE_CANCELLED');
    err.name = 'AbortError';
    throw err;
  }
}
