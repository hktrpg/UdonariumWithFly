import {
  parsePlateauBuildingsFromGml,
  selectPlateauBuildings,
  latLonToLocalMeters,
} from './plateau-gml-parse';
import { buildingBboxToLocal, envelopeToLocalFrame } from './geo-mercator';
import { asciiStlBox } from './plateau-pack';
import { pickPlateauBldgFile } from './plateau-catalog';

describe('parsePlateauBuildingsFromGml', () => {
  const sample = `<?xml version="1.0"?>
<core:CityModel>
  <gml:boundedBy>
    <gml:Envelope>
      <gml:lowerCorner>35.67 139.68 0</gml:lowerCorner>
      <gml:upperCorner>35.68 139.70 80</gml:upperCorner>
    </gml:Envelope>
  </gml:boundedBy>
  <bldg:Building gml:id="bldg_a">
    <bldg:measuredHeight uom="m">12.5</bldg:measuredHeight>
    <bldg:lod0RoofEdge>
      <gml:MultiSurface><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing>
        <gml:posList>35.671 139.691 0 35.671 139.692 0 35.672 139.692 0 35.672 139.691 0 35.671 139.691 0</gml:posList>
      </gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember></gml:MultiSurface>
    </bldg:lod0RoofEdge>
  </bldg:Building>
  <bldg:Building gml:id="bldg_b">
    <bldg:measuredHeight uom="m">20</bldg:measuredHeight>
    <bldg:lod0RoofEdge>
      <gml:MultiSurface><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing>
        <gml:posList>35.675 139.695 0 35.675 139.696 0 35.676 139.696 0 35.676 139.695 0 35.675 139.695 0</gml:posList>
      </gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember></gml:MultiSurface>
    </bldg:lod0RoofEdge>
  </bldg:Building>
</core:CityModel>`;

  it('reads envelope and lod0 footprints', () => {
    const { envelope, buildings } = parsePlateauBuildingsFromGml(sample);
    expect(envelope?.minLat).toBeCloseTo(35.67, 5);
    expect(buildings.length).toBe(2);
    expect(buildings[0].id).toBe('bldg_a');
    expect(buildings[0].height).toBeCloseTo(12.5, 5);
    expect(buildings[0].ring.length).toBeGreaterThanOrEqual(4);
  });

  it('treats measuredHeight -9999 as missing', () => {
    const gml = sample.replace('12.5', '-9999');
    const { buildings } = parsePlateauBuildingsFromGml(gml);
    expect(buildings[0].height).toBe(10);
  });

  it('selectPlateauBuildings skips excluded ids', () => {
    const { buildings } = parsePlateauBuildingsFromGml(sample);
    const selected = selectPlateauBuildings(buildings, 10, ['bldg_a']);
    expect(selected.map(b => b.id)).toEqual(['bldg_b']);
  });

  it('places southern building further down the pack Z axis than northern', () => {
    const { envelope, buildings } = parsePlateauBuildingsFromGml(sample);
    expect(envelope).toBeTruthy();
    const frame = envelopeToLocalFrame(envelope!);
    const a = buildings.find(b => b.id === 'bldg_a')!;
    const b = buildings.find(b => b.id === 'bldg_b')!;
    // bldg_a ~35.671, bldg_b ~35.675 → b is north → smaller Z
    const localA = buildingBboxToLocal(a, frame);
    const localB = buildingBboxToLocal(b, frame);
    expect(localB.z).toBeLessThan(localA.z);
    const vA = (localA.z + localA.d / 2) / frame.depth;
    const vB = (localB.z + localB.d / 2) / frame.depth;
    expect(vB).toBeLessThan(vA);
  });
});

describe('latLonToLocalMeters', () => {
  it('maps east/north offsets in metres', () => {
    const p = latLonToLocalMeters(35.68, 139.71, 35.68, 139.70);
    expect(p.z).toBeCloseTo(0, 5);
    expect(p.x).toBeGreaterThan(800);
  });
});

describe('asciiStlBox', () => {
  it('emits a solid with facets', () => {
    const stl = asciiStlBox('demo', 10, 20, 8);
    expect(stl).toContain('solid demo');
    expect(stl).toContain('endsolid');
    expect((stl.match(/facet normal/g) || []).length).toBe(12);
  });

  it('survives parseStl Z-up→Y-up with height on Y and footprint on XZ', async () => {
    const { parseStl } = await import('@udonarium/terrain-model/load-stl');
    const w = 10;
    const h = 20;
    const d = 8;
    const stl = asciiStlBox('demo', w, h, d);
    const mesh = parseStl(new TextEncoder().encode(stl).buffer);
    expect(mesh.aabb.max[0] - mesh.aabb.min[0]).toBeCloseTo(w, 5);
    expect(mesh.aabb.max[1] - mesh.aabb.min[1]).toBeCloseTo(h, 5);
    expect(mesh.aabb.max[2] - mesh.aabb.min[2]).toBeCloseTo(d, 5);
  });
});

describe('pickPlateauBldgFile', () => {
  it('prefers lod1 under size soft-cap', () => {
    const picked = pickPlateauBldgFile([
      { code: 'big', maxLod: 2, url: 'u1', fileSize: 80e6, features: 100 },
      { code: 'ok', maxLod: 1, url: 'u2', fileSize: 12e6, features: 50 },
      { code: 'tiny0', maxLod: 0, url: 'u3', fileSize: 5e6, features: 20 },
    ]);
    expect(picked.code).toBe('ok');
  });
});
