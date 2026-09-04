import { StreetscapePackV1 } from './pack-schema';
import { StreetscapeCountryId } from './streetscape-country';

/** Survives GameTableSetting panel close/reopen (component destroy). */
export type StreetscapeUiSession = {
  status: string;
  attribution: string;
  street: string;
  country: StreetscapeCountryId;
  maxFeatures: number;
  /** Count for the post-create「新增模型」row. */
  addModelCount: number;
  /** Sheet / mesh context after a successful create — enables incremental models. */
  active: {
    country: StreetscapeCountryId;
    tableId: string;
    sheet: string;
    title?: string;
    street?: string;
    worldExtent: { minX: number; maxX: number; minZ: number; maxZ: number };
    placedBuildingIds: string[];
    plateau?: {
      cityCode: string;
      cityName: string;
      meshCode: string;
      gmlUrl: string;
    };
  } | null;
  deferred: {
    tableId: string;
    sheet: string;
    title?: string;
    street?: string;
    maxFeatures: number;
    buildingIds: string[];
    estimatedFacadeBytes: number;
    worldExtent: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
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
  country: 'hk',
  maxFeatures: 4,
  addModelCount: 4,
  active: null,
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
    country: next.country === 'jp' ? 'jp' : 'hk',
    maxFeatures: Math.max(1, Math.floor(Number(next.maxFeatures) || 4)),
    addModelCount: Math.max(1, Math.floor(Number(next.addModelCount) || 4)),
    active: next.active
      ? {
        ...next.active,
        country: next.active.country === 'jp' ? 'jp' : 'hk',
        placedBuildingIds: (next.active.placedBuildingIds || []).slice(),
        worldExtent: { ...next.active.worldExtent },
        plateau: next.active.plateau
          ? { ...next.active.plateau }
          : undefined,
      }
      : null,
    deferred: next.deferred
      ? {
        ...next.deferred,
        buildingIds: (next.deferred.buildingIds || []).slice(),
        worldExtent: next.deferred.worldExtent
          ? { ...next.deferred.worldExtent }
          : null,
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
  session = { ...EMPTY, active: null, deferred: null, exportPack: null };
}
