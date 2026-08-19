import { GameTable } from '@udonarium/game-table';
import { StreetscapePackV1 } from './pack-schema';

/** Synced GameTable.mapCredit value for LandsD / Open3Dhk streetscape tables. */
export const LANDSD_OPEN3DHK_MAP_CREDIT = 'landsd-open3dhk';

export function isLandsdOpen3dhkPack(pack: Pick<StreetscapePackV1, 'id' | 'attribution'>): boolean {
  const id = pack.id || '';
  if (id.startsWith('open3dhk-')) return true;
  const attr = pack.attribution || '';
  if (/\bnot official\b/i.test(attr) || /\bsynthetic\b/i.test(attr)) return false;
  return /Lands Department|LandsD|Open3Dhk/i.test(attr);
}

export function isLandsdMapCredit(value: string | undefined | null): boolean {
  return (value || '') === LANDSD_OPEN3DHK_MAP_CREDIT;
}

/** Persist source credit on the table so every peer sees the map-face notice. */
export function applyStreetscapeMapCredit(table: GameTable, pack: StreetscapePackV1): void {
  table.mapAttribution = pack.attribution || '';
  table.mapCredit = isLandsdOpen3dhkPack(pack) ? LANDSD_OPEN3DHK_MAP_CREDIT : '';
}
