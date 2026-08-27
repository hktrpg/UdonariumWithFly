import {
  filterOutOpen3dhkBuildingIds,
  matchOpen3dhkBuildingsByIds,
  open3dhkBuildingVariantKey,
} from './open3dhk-building-id';

describe('open3dhkBuildingVariantKey', () => {
  it('strips the GLTF vs GLTF0 product letter', () => {
    expect(open3dhkBuildingVariantKey('B352541799701063C0'))
      .toBe('b3525417997010630');
    expect(open3dhkBuildingVariantKey('b352541799701063a0'))
      .toBe('b3525417997010630');
    expect(open3dhkBuildingVariantKey('b391661694001063c1'))
      .toBe('b3916616940010631');
  });

  it('returns null for non-LandsD ids', () => {
    expect(open3dhkBuildingVariantKey('b1')).toBeNull();
    expect(open3dhkBuildingVariantKey('')).toBeNull();
  });
});

describe('matchOpen3dhkBuildingsByIds', () => {
  const gltf = [
    { id: 'b352541799701063a0' },
    { id: 'b352671784102063a0' },
    { id: 'b391661694001063a1' },
  ];

  it('maps GLTF0 C-suffix ids onto textured GLTF A-suffix folders', () => {
    const selected = matchOpen3dhkBuildingsByIds(gltf, [
      'B352541799701063C0',
      'b352671784102063c0',
      'b391661694001063c1',
    ], 30);
    expect(selected.map(b => b.id)).toEqual([
      'b352541799701063a0',
      'b352671784102063a0',
      'b391661694001063a1',
    ]);
  });

  it('keeps exact matches when the ZIP already uses the same id', () => {
    const selected = matchOpen3dhkBuildingsByIds(gltf, ['b352541799701063a0'], 1);
    expect(selected.map(b => b.id)).toEqual(['b352541799701063a0']);
  });

  it('returns none when preferred ids are not in the sheet', () => {
    expect(matchOpen3dhkBuildingsByIds(gltf, ['b999999999999999c0'], 8)).toEqual([]);
  });
});

describe('filterOutOpen3dhkBuildingIds', () => {
  it('drops already-placed buildings including GLTF0↔GLTF variants', () => {
    const pool = [
      { id: 'b352541799701063a0' },
      { id: 'b352671784102063a0' },
      { id: 'other' },
    ];
    const left = filterOutOpen3dhkBuildingIds(pool, ['B352541799701063C0', 'other']);
    expect(left.map(b => b.id)).toEqual(['b352671784102063a0']);
  });
});
