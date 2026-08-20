import { Reader } from '@zip.js/zip.js';

import { open3dhkDebug, open3dhkDebugHeartbeat, open3dhkDebugWarn, isOpen3dhkVerboseDebug } from './open3dhk-debug';
import { STREETSCAPE_ERRORS, isOpen3dhkUpstreamUnavailable } from './errors';
import { throwIfAborted } from './source';

/**
 * Official sheet ZIPs are tens of MiB (GLTF0) to multi‑GiB (GLTF).
 * Reject SPA/HTML fallbacks (~7 KiB) that webpack HTTPS proxy used to return.
 */
export const OPEN3DHK_MIN_ZIP_BYTES = 1024 * 1024;
/** Coalesce zip.js's 30-byte local-header peeks into one HTTP Range. */
export const RANGE_PREFETCH_BYTES = 64 * 1024;

/**
 * Probe total ZIP byte length via HEAD / Range without downloading the body.
 * zip.js HttpReader falls back to a full GET when Content-Range is missing —
 * that hangs for multi‑GB textured sheets. We refuse that path.
 */
export async function probeOpen3dhkZipByteLength(
  url: string,
  signal?: AbortSignal,
): Promise<number> {
  const abs = absoluteFetchUrl(url);
  open3dhkDebug('probe size: start', abs);
  throwIfAborted(signal);

  // 1) HEAD Content-Length (works well on same-origin proxy).
  try {
    const t0 = now();
    const stop = open3dhkDebugHeartbeat('HEAD ' + abs);
    const res = await fetch(abs, {
      method: 'HEAD',
      cache: 'no-store',
      credentials: 'omit',
      signal,
    });
    stop();
    const cl = res.headers.get('Content-Length');
    const ct = res.headers.get('Content-Type');
    open3dhkDebug('probe HEAD', {
      status: res.status,
      ok: res.ok,
      contentLength: cl,
      contentType: ct,
      acceptRanges: res.headers.get('Accept-Ranges'),
      ms: Math.round(now() - t0),
    });
    if (isOpen3dhkUpstreamErrorStatus(res.status)) {
      throw new Error(STREETSCAPE_ERRORS.UPSTREAM_UNAVAILABLE);
    }
    const n = Number(cl);
    if (res.ok && isPlausibleOpen3dhkZipSize(n, ct)) return n;
    if (res.ok && Number.isFinite(n) && n > 0 && n < OPEN3DHK_MIN_ZIP_BYTES) {
      open3dhkDebugWarn('probe HEAD: size too small (likely HTML fallback)', { n, ct });
    }
  } catch (err) {
    if (isOpen3dhkUpstreamUnavailable(err)) throw err;
    open3dhkDebugWarn('probe HEAD failed', err);
  }

  // 2) Range first byte → Content-Range: bytes 0-0/TOTAL
  try {
    const t0 = now();
    const stop = open3dhkDebugHeartbeat('Range bytes=0-0 ' + abs);
    const res = await fetch(abs, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
      credentials: 'omit',
      signal,
    });
    stop();
    const cr = res.headers.get('Content-Range');
    const ct = res.headers.get('Content-Type');
    open3dhkDebug('probe Range bytes=0-0', {
      status: res.status,
      contentRange: cr,
      contentLength: res.headers.get('Content-Length'),
      contentType: ct,
      ms: Math.round(now() - t0),
    });
    if (isOpen3dhkUpstreamErrorStatus(res.status)) {
      throw new Error(STREETSCAPE_ERRORS.UPSTREAM_UNAVAILABLE);
    }
    // Consume tiny body so the connection can close cleanly.
    await res.arrayBuffer().catch(() => undefined);
    const n = parseContentRangeTotal(cr);
    if (isPlausibleOpen3dhkZipSize(n, ct)) return n;
  } catch (err) {
    if (isOpen3dhkUpstreamUnavailable(err)) throw err;
    open3dhkDebugWarn('probe Range 0-0 failed', err);
  }

  // 3) Suffix EOCD peek (zip.js combineSizeEocd style).
  try {
    const t0 = now();
    const stop = open3dhkDebugHeartbeat('Range bytes=-22 ' + abs);
    const res = await fetch(abs, {
      method: 'GET',
      headers: { Range: 'bytes=-22' },
      cache: 'no-store',
      credentials: 'omit',
      signal,
    });
    stop();
    const cr = res.headers.get('Content-Range');
    const ct = res.headers.get('Content-Type');
    open3dhkDebug('probe Range bytes=-22', {
      status: res.status,
      contentRange: cr,
      contentLength: res.headers.get('Content-Length'),
      contentType: ct,
      ms: Math.round(now() - t0),
    });
    if (isOpen3dhkUpstreamErrorStatus(res.status)) {
      throw new Error(STREETSCAPE_ERRORS.UPSTREAM_UNAVAILABLE);
    }
    await res.arrayBuffer().catch(() => undefined);
    const n = parseContentRangeTotal(cr);
    if (isPlausibleOpen3dhkZipSize(n, ct)) return n;
  } catch (err) {
    if (isOpen3dhkUpstreamUnavailable(err)) throw err;
    open3dhkDebugWarn('probe Range -22 failed', err);
  }

  open3dhkDebugWarn('probe size: FAILED — no Content-Length / Content-Range');
  throw new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
}

export function isPlausibleOpen3dhkZipSize(n: number, contentType?: string | null): boolean {
  if (!Number.isFinite(n) || n < OPEN3DHK_MIN_ZIP_BYTES) return false;
  if (contentType && /text\/html/i.test(contentType)) return false;
  return true;
}

/**
 * Controlled HTTP Range reader for zip.js.
 * Never falls back to downloading the whole multi‑GB ZIP.
 */
export class Open3dhkHttpRangeReader extends Reader<string> {
  size: number;
  /** Fired after each successful Range body (for download progress during large entries). */
  onDataBytes?: (byteLength: number) => void;

  constructor(
    private readonly url: string,
    size: number,
    private readonly signal?: AbortSignal,
  ) {
    super(url);
    this.size = size;
  }

  async init(): Promise<void> {
    open3dhkDebug('ZipReader init', { url: this.url, size: this.size, sizeMiB: (this.size / (1024 * 1024)).toFixed(1) });
  }

  async readUint8Array(index: number, length: number): Promise<Uint8Array> {
    throwIfAborted(this.signal);
    if (index >= this.size) return new Uint8Array();
    if (index + length > this.size) length = this.size - index;
    const cached = this.sliceFromCache(index, length);
    if (cached) {
      // Count returned bytes (not the earlier prefetch) so mid-entry progress moves.
      this.onDataBytes?.(cached.byteLength);
      return cached;
    }

    // zip.js reads local headers in 30+28+~650 byte steps. Coalesce into one
    // Range so LandsD is not hit three times per tiny glTF (0.5–1.5s RTT each).
    const fetchLen = length >= RANGE_PREFETCH_BYTES
      ? length
      : Math.min(Math.max(length, RANGE_PREFETCH_BYTES), this.size - index);
    const buf = await this.fetchRange(index, fetchLen);
    if (buf.byteLength < length) {
      open3dhkDebugWarn('range GET: short body', { asked: length, got: buf.byteLength, index });
      throw new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
    }
    this.cacheStart = index;
    this.cacheData = buf;
    // Copy — zip.js uses `new DataView(array.buffer)` and ignores byteOffset.
    const out = buf.slice(0, length);
    this.onDataBytes?.(out.byteLength);
    return out;
  }

  private cacheStart = -1;
  private cacheData: Uint8Array | null = null;

  private sliceFromCache(index: number, length: number): Uint8Array | null {
    if (!this.cacheData || this.cacheStart < 0) return null;
    const offset = index - this.cacheStart;
    if (offset < 0 || offset + length > this.cacheData.byteLength) return null;
    // Must copy: zip.js `getDataView` is `new DataView(array.buffer)` (no byteOffset).
    return this.cacheData.slice(offset, offset + length);
  }

  private async fetchRange(index: number, length: number): Promise<Uint8Array> {
    const end = index + length - 1;
    const t0 = now();
    const verbose = isOpen3dhkVerboseDebug();
    if (verbose || length >= 8 * 1024) {
      open3dhkDebug('range GET', {
        bytes: `${index}-${end}`,
        length,
        lengthKiB: (length / 1024).toFixed(1),
      });
    }
    const stop = length > 256 * 1024
      ? open3dhkDebugHeartbeat(`range GET ${index}-${end}`)
      : () => undefined;
    try {
      const res = await fetch(this.url, {
        method: 'GET',
        headers: { Range: `bytes=${index}-${end}` },
        cache: 'no-store',
        credentials: 'omit',
        signal: this.signal,
      });
      if (verbose || length >= 8 * 1024) {
        open3dhkDebug('range GET response', {
          status: res.status,
          contentRange: res.headers.get('Content-Range'),
          contentLength: res.headers.get('Content-Length'),
          contentType: res.headers.get('Content-Type'),
          ms: Math.round(now() - t0),
        });
      }
      if (res.status !== 206 && res.status !== 200) {
        if (isOpen3dhkUpstreamErrorStatus(res.status)) {
          throw new Error(STREETSCAPE_ERRORS.UPSTREAM_UNAVAILABLE);
        }
        throw new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > length * 2 + 64 * 1024) {
        open3dhkDebugWarn('range GET: body much larger than requested — abort', {
          asked: length,
          got: buf.byteLength,
        });
        throw new Error(STREETSCAPE_ERRORS.FETCH_FAILED);
      }
      if (verbose || length >= 8 * 1024) {
        open3dhkDebug('range GET body', { got: buf.byteLength, ms: Math.round(now() - t0) });
      }
      return buf;
    } finally {
      stop();
    }
  }
}

export function parseContentRangeTotal(header: string | null): number {
  if (!header) return 0;
  // e.g. "bytes 0-0/1800123456" or "bytes 0-21/1800123456"
  const m = /\/\s*(\d+)\s*$/.exec(header.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function absoluteFetchUrl(url: string): string {
  try {
    return new URL(url, typeof document !== 'undefined' ? document.baseURI : 'http://localhost/').href;
  } catch {
    return url;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** LandsD CDN 502/503/504 HTML error pages — fail fast instead of hanging on direct fetch. */
export function isOpen3dhkUpstreamErrorStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}
