import {
  computeBitrateBps,
  totalBytesFromRtcStats,
  updateStablePeakBitrate,
} from './webrtc-stats';
import { formatBitrate, formatPing } from '../peer-session-format';

describe('computeBitrateBps', () => {
  it('returns 0 until a previous sample exists', () => {
    expect(computeBitrateBps(0, 0, 10_000, 1000)).toBe(0);
  });

  it('computes bytes per second from two samples', () => {
    // +10_000 bytes over 0.5s → 20_000 B/s
    expect(computeBitrateBps(1_000, 1000, 11_000, 1500)).toBe(20_000);
  });

  it('returns 0 when counters reset or time does not advance', () => {
    expect(computeBitrateBps(5_000, 1000, 4_000, 2000)).toBe(0);
    expect(computeBitrateBps(5_000, 1000, 6_000, 1000)).toBe(0);
  });
});

describe('updateStablePeakBitrate', () => {
  it('needs a full window before raising peak (rejects one-shot spikes)', () => {
    let s = updateStablePeakBitrate(0, 0, [], 5_000_000, 1000);
    expect(s.peakBps).toBe(0);
    expect(s.recentInstants.length).toBe(1);

    s = updateStablePeakBitrate(s.peakBps, s.peakAtMs, s.recentInstants, 5_000_000, 2000);
    expect(s.peakBps).toBe(0);

    s = updateStablePeakBitrate(s.peakBps, s.peakAtMs, s.recentInstants, 5_000_000, 3000);
    expect(s.peakBps).toBe(5_000_000);
  });

  it('uses the min of the window as the stable rate', () => {
    let s = updateStablePeakBitrate(0, 0, [], 100_000, 1000);
    s = updateStablePeakBitrate(s.peakBps, s.peakAtMs, s.recentInstants, 80_000, 2000);
    s = updateStablePeakBitrate(s.peakBps, s.peakAtMs, s.recentInstants, 90_000, 3000);
    expect(s.peakBps).toBe(80_000);
  });

  it('keeps established peak through idle (window resets, peak stays)', () => {
    const established = updateStablePeakBitrate(80_000, 1000, [80_000, 80_000, 80_000], 0, 5000);
    expect(established.peakBps).toBe(80_000);
    expect(established.recentInstants).toEqual([]);
  });

  it('ignores noise below floor', () => {
    const s = updateStablePeakBitrate(0, 0, [], 800, 1000);
    expect(s.peakBps).toBe(0);
    expect(s.recentInstants).toEqual([]);
  });
});

describe('totalBytesFromRtcStats', () => {
  it('prefers transport byte totals', () => {
    const total = totalBytesFromRtcStats([
      { type: 'candidate-pair', state: 'succeeded', bytesSent: 100, bytesReceived: 50 },
      { type: 'transport', bytesSent: 1000, bytesReceived: 2000 },
    ]);
    expect(total).toBe(3000);
  });

  it('falls back to the busiest succeeded candidate-pair', () => {
    const total = totalBytesFromRtcStats([
      { type: 'candidate-pair', state: 'succeeded', bytesSent: 100, bytesReceived: 50 },
      { type: 'candidate-pair', state: 'succeeded', bytesSent: 400, bytesReceived: 200 },
      { type: 'candidate-pair', state: 'failed', bytesSent: 9999, bytesReceived: 9999 },
    ]);
    expect(total).toBe(600);
  });
});

describe('peer-session-format', () => {
  it('formats bitrate with b/s kb/s mb/s', () => {
    expect(formatBitrate(0)).toBe('0b/s');
    expect(formatBitrate(512)).toBe('512b/s');
    expect(formatBitrate(2.5 * 1024)).toBe('2.5kb/s');
    expect(formatBitrate(12.4 * 1024)).toBe('12kb/s');
    expect(formatBitrate(1.25 * 1024 * 1024)).toBe('1.3mb/s');
    expect(formatBitrate(Number.NaN)).toBe('—');
  });

  it('formats ping for ping: Nms label', () => {
    expect(formatPing(2)).toBe('2');
    expect(formatPing(4.2)).toBe('4.2');
    expect(formatPing(45.6)).toBe('46');
    expect(formatPing(Number.NaN)).toBe('—');
  });
});
