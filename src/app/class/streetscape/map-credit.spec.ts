import { applyStreetscapeMapCredit, isLandsdOpen3dhkPack, isLandsdMapCredit } from './map-credit';
import { StreetscapePackV1 } from './pack-schema';
import { GameTable } from '@udonarium/game-table';

function pack(partial: Partial<StreetscapePackV1>): StreetscapePackV1 {
  return {
    version: 1,
    id: 'x',
    title: 't',
    attribution: '',
    metersPerUnit: 1,
    origin: { x: 0, z: 0 },
    extentMeters: { width: 10, depth: 10 },
    floor: { path: 'floor.png' },
    features: [],
    ...partial,
  };
}

describe('streetscape map-credit', () => {
  it('treats official Open3Dhk sheet packs as LandsD credit', () => {
    expect(isLandsdOpen3dhkPack(pack({
      id: 'open3dhk-11-SW-4B',
      attribution: 'Lands Department / Open3Dhk Individualised — sheet 11-SW-4B',
    }))).toBeTrue();
  });

  it('does not credit synthetic sample packs', () => {
    expect(isLandsdOpen3dhkPack(pack({
      id: 'sample-nathan',
      attribution: 'Synthetic demo geometry (not official LandsD / Open3Dhk sheet data)',
    }))).toBeFalse();
  });

  it('writes mapCredit onto the table', () => {
    const table = { mapAttribution: '', mapCredit: '' } as GameTable;
    applyStreetscapeMapCredit(table, pack({
      id: 'open3dhk-6-NE-13D',
      attribution: 'Lands Department / Open3Dhk Individualised — sheet 6-NE-13D',
    }));
    expect(table.mapAttribution).toContain('Lands Department');
    expect(isLandsdMapCredit(table.mapCredit)).toBeTrue();
  });
});
