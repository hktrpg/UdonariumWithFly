import {
  matchCatalogStreet,
  normalizeOpen3dhkFormat,
  readResponseBlobWithProgress,
} from './open3dhk-source';
import { open3dhkSheetZipUrl } from './open3dhk-url';
import { StreetscapeSourceProgress } from './source';

describe('matchCatalogStreet', () => {
  const streets = [
    { id: 'nathan', title: '彌敦道（尖沙咀）', packUrl: '', street: '彌敦道', sheet: '11-SW-4B' },
  ];

  it('matches sheet id or street name', () => {
    expect(matchCatalogStreet(streets, { sheet: '11-sw-4b' })?.id).toBe('nathan');
    expect(matchCatalogStreet(streets, { street: '彌敦道' })?.id).toBe('nathan');
  });
});

describe('open3dhkSheetZipUrl', () => {
  it('builds GLTF0 and textured GLTF Individualised URLs', () => {
    expect(open3dhkSheetZipUrl('11-SW-4B')).toBe(
      'https://download.map.gov.hk/api/3d-zip/GLTF0/11-SW-4B.zip',
    );
    expect(open3dhkSheetZipUrl('11-SW-4B', 'GLTF')).toBe(
      'https://download.map.gov.hk/api/3d-zip/GLTF/11-SW-4B.zip',
    );
  });
});

describe('normalizeOpen3dhkFormat', () => {
  it('maps unknown to GLTF0 and GLTF to textured', () => {
    expect(normalizeOpen3dhkFormat(undefined)).toBe('GLTF0');
    expect(normalizeOpen3dhkFormat('GLTF0')).toBe('GLTF0');
    expect(normalizeOpen3dhkFormat('GLTF')).toBe('GLTF');
  });
});

describe('readResponseBlobWithProgress', () => {
  it('reports byte progress while streaming the body', async () => {
    const chunk1 = new Uint8Array(300 * 1024).fill(1);
    const chunk2 = new Uint8Array(100 * 1024).fill(2);
    let i = 0;
    const chunks = [chunk1, chunk2];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < chunks.length) controller.enqueue(chunks[i++]);
        else controller.close();
      },
    });
    const total = chunk1.length + chunk2.length;
    const res = new Response(stream, {
      status: 200,
      headers: { 'Content-Length': String(total), 'Content-Type': 'application/zip' },
    });
    const reports: StreetscapeSourceProgress[] = [];
    const blob = await readResponseBlobWithProgress(res, undefined, p => reports.push({ ...p }));
    expect(blob.size).toBe(total);
    expect(reports.some(r => r.phase === 'download' && r.current > 0)).toBeTrue();
    expect(reports[reports.length - 1]).toEqual({
      phase: 'download',
      current: total,
      total,
    });
  });
});
