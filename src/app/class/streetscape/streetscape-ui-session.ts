import { StreetscapePackV1 } from './pack-schema';

/** Survives GameTableSetting panel close/reopen (component destroy). */
export type StreetscapeUiSession = {
  status: string;
  attribution: string;
  street: string;
  maxFeatures: number;
  deferred: {
    tableId: string;
    sheet: string;
    title?: string;
    street?: string;
    maxFeatures: number;
    buildingIds: string[];
    estimatedFacadeBytes: number;
    worldExtent: { minX: number; maxX: number; minZ: number; maxZ: number };
  } | null;
  exportPack: {
    pack: StreetscapePackV1;
    files: File[];
    fileName: string;
  } | null;
};

const EMPTY: StreetscapeUiSession = {
  status: '',
  attribution: '',
  street: '',
  maxFeatures: 4,
  deferred: null,
  exportPack: null,
};

let session: StreetscapeUiSession = { ...EMPTY };

export function getStreetscapeUiSession(): StreetscapeUiSession {
  return session;
}

export function setStreetscapeUiSession(next: StreetscapeUiSession): void {
  session = {
    status: next.status || '',
    attribution: next.attribution || '',
    street: next.street || '',
    maxFeatures: Math.max(1, Math.floor(Number(next.maxFeatures) || 4)),
    deferred: next.deferred
      ? {
        ...next.deferred,
        buildingIds: (next.deferred.buildingIds || []).slice(),
        worldExtent: { ...next.deferred.worldExtent },
      }
      : null,
    exportPack: next.exportPack
      ? {
          pack: next.exportPack.pack,
          files: next.exportPack.files.slice(),
          fileName: next.exportPack.fileName,
        }
      : null,
  };
}

/** Test / room-reset helper. */
export function clearStreetscapeUiSession(): void {
  session = { ...EMPTY, deferred: null, exportPack: null };
}
