import {
  OPEN3DHK_API_KEY,
  open3dhkSheetZipDirectUrl,
  open3dhkSheetZipFetchUrls,
  open3dhkSheetZipProxyUrl,
  open3dhkSheetZipUrl,
} from './open3dhk-url';

describe('open3dhk-url', () => {
  it('builds proxy and data11 URLs with the prod key', () => {
    expect(open3dhkSheetZipProxyUrl('11-SW-4B', 'GLTF0')).toBe(
      '/streetscape-open3dhk/GLTF0/11-SW-4B.zip',
    );
    expect(open3dhkSheetZipDirectUrl('11-SW-4B', 'GLTF0')).toBe(
      `https://data11.map.gov.hk/api/3d-zip/GLTF0/11-SW-4B.zip?key=${OPEN3DHK_API_KEY}`,
    );
  });

  it('lists proxy first then no-key CDN before keyed fallbacks', () => {
    const urls = open3dhkSheetZipFetchUrls('11-SW-4B', 'GLTF');
    expect(urls[0]).toContain('/streetscape-open3dhk/');
    expect(urls[1]).toBe('https://download.map.gov.hk/api/3d-zip/GLTF/11-SW-4B.zip');
    expect(urls[2]).toBe('https://data11.map.gov.hk/api/3d-zip/GLTF/11-SW-4B.zip');
    expect(urls.some(u => u.includes('key='))).toBeTrue();
  });

  it('keeps legacy download URL without key', () => {
    expect(open3dhkSheetZipUrl('11-SW-4B', 'GLTF')).toBe(
      'https://download.map.gov.hk/api/3d-zip/GLTF/11-SW-4B.zip',
    );
  });
});
