import {
  isPlausibleOpen3dhkZipSize,
  OPEN3DHK_MIN_ZIP_BYTES,
  Open3dhkHttpRangeReader,
  parseContentRangeTotal,
  RANGE_PREFETCH_BYTES,
} from './open3dhk-range-reader';

describe('parseContentRangeTotal', () => {
  it('parses totals from Content-Range', () => {
    expect(parseContentRangeTotal('bytes 0-0/1800123456')).toBe(1800123456);
    expect(parseContentRangeTotal('bytes 0-21/58')).toBe(58);
    expect(parseContentRangeTotal(null)).toBe(0);
    expect(parseContentRangeTotal('bytes */123')).toBe(123);
  });
});

describe('isPlausibleOpen3dhkZipSize', () => {
  it('rejects HTML fallbacks and tiny bodies', () => {
    expect(isPlausibleOpen3dhkZipSize(7157, 'text/html')).toBe(false);
    expect(isPlausibleOpen3dhkZipSize(7157, 'application/zip')).toBe(false);
    expect(isPlausibleOpen3dhkZipSize(OPEN3DHK_MIN_ZIP_BYTES - 1, null)).toBe(false);
  });

  it('accepts real sheet sizes', () => {
    expect(isPlausibleOpen3dhkZipSize(60_000_000, 'application/zip')).toBe(true);
    expect(isPlausibleOpen3dhkZipSize(1_800_000_000, null)).toBe(true);
  });
});

describe('Open3dhkHttpRangeReader prefetch', () => {
  it('coalesces zip.js local-header peeks into one Range GET', async () => {
    const ranges: string[] = [];
    spyOn(window, 'fetch').and.callFake((_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      const range = headers?.Range || '';
      ranges.push(range);
      const m = /bytes=(\d+)-(\d+)/.exec(range);
      const start = Number(m?.[1] || 0);
      const end = Number(m?.[2] || 0);
      const len = Math.max(0, end - start + 1);
      return Promise.resolve(new Response(new Uint8Array(len), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/1000000`, 'Content-Type': 'application/zip' },
      }));
    });
    const reader = new Open3dhkHttpRangeReader('https://example.test/sheet.zip', 1_000_000);
    await reader.readUint8Array(10_000, 30);
    await reader.readUint8Array(10_030, 28);
    await reader.readUint8Array(10_058, 650);
    expect(ranges.length).toBe(1);
    expect(ranges[0]).toBe(`bytes=10000-${10000 + RANGE_PREFETCH_BYTES - 1}`);
  });

  it('copies cache hits so zip.js DataView(array.buffer) sees the requested bytes', async () => {
    // zip.js getDataView is `new DataView(array.buffer)` — ignores byteOffset.
    // Prefetch past a prior member must not make the next local-header peek
    // read the start of the cached compressed payload.
    const LOCAL_SIG = 0x04034b50;
    const store = new Uint8Array(200_000);
    new DataView(store.buffer).setUint32(0, 0xDEADBEEF, true);
    new DataView(store.buffer).setUint32(10_000, LOCAL_SIG, true);

    spyOn(window, 'fetch').and.callFake((_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      const m = /bytes=(\d+)-(\d+)/.exec(headers?.Range || '');
      const start = Number(m?.[1] || 0);
      const end = Number(m?.[2] || 0);
      return Promise.resolve(new Response(store.slice(start, end + 1), {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/200000`,
          'Content-Type': 'application/zip',
        },
      }));
    });

    const reader = new Open3dhkHttpRangeReader('https://example.test/sheet.zip', 200_000);
    await reader.readUint8Array(0, 30); // populates prefetch cache from offset 0
    const header = await reader.readUint8Array(10_000, 30); // cache hit mid-buffer
    expect(header.byteOffset).toBe(0);
    expect(new DataView(header.buffer).getUint32(0, true)).toBe(LOCAL_SIG);
  });

  it('reports progress for cache hits and returned slices', async () => {
    spyOn(window, 'fetch').and.callFake((_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      const m = /bytes=(\d+)-(\d+)/.exec(headers?.Range || '');
      const start = Number(m?.[1] || 0);
      const end = Number(m?.[2] || 0);
      const len = Math.max(0, end - start + 1);
      return Promise.resolve(new Response(new Uint8Array(len), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/1000000`, 'Content-Type': 'application/zip' },
      }));
    });
    const reader = new Open3dhkHttpRangeReader('https://example.test/sheet.zip', 1_000_000);
    const seen: number[] = [];
    reader.onDataBytes = n => seen.push(n);
    await reader.readUint8Array(10_000, 30);
    await reader.readUint8Array(10_030, 28);
    expect(seen).toEqual([30, 28]);
  });
});
