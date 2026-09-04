import {
  chooseGsiAerialZoom,
  gsiSeamlessphotoUrl,
  latToTileY,
  lonToTileX,
  tileRangeForBox,
  tileXToLon,
  tileYToLat,
} from './gsi-aerial-floor';

describe('gsi-aerial-floor', () => {
  // Shibuya station ≈ 35.658, 139.701
  const shibuya = {
    minLat: 35.655,
    maxLat: 35.662,
    minLon: 139.698,
    maxLon: 139.705,
  };

  it('lon/lat ↔ tile are inverses near Tokyo', () => {
    const z = 15;
    const x = lonToTileX(139.701, z);
    const y = latToTileY(35.658, z);
    expect(tileXToLon(x, z)).toBeCloseTo(139.701, 5);
    expect(tileYToLat(y, z)).toBeCloseTo(35.658, 4);
  });

  it('tileRange covers the bbox at zoom 15', () => {
    const r = tileRangeForBox(shibuya, 15);
    expect(r.maxX).toBeGreaterThanOrEqual(r.minX);
    expect(r.maxY).toBeGreaterThanOrEqual(r.minY);
    expect((r.maxX - r.minX + 1) * (r.maxY - r.minY + 1)).toBeLessThanOrEqual(64);
  });

  it('chooseGsiAerialZoom stays within seamlessphoto 14–18 and tile budget', () => {
    const z = chooseGsiAerialZoom(shibuya, 36);
    expect(z).toBeGreaterThanOrEqual(14);
    expect(z).toBeLessThanOrEqual(18);
    const r = tileRangeForBox(shibuya, z);
    expect((r.maxX - r.minX + 1) * (r.maxY - r.minY + 1)).toBeLessThanOrEqual(36);
  });

  it('builds the official seamlessphoto URL template', () => {
    expect(gsiSeamlessphotoUrl(15, 29080, 12940))
      .toBe('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/15/29080/12940.jpg');
  });
});
