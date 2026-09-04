import {
  computeStreamHealthMetrics,
  isInboundStale,
  shouldRecycleStaleDataChannel,
  STALE_HEALTH_THRESHOLD,
  STALE_INBOUND_MS,
} from './skyway-stream-health';

describe('skyway-stream-health', () => {
  describe('computeStreamHealthMetrics', () => {
    it('returns health 1 within 10s silence', () => {
      const m = computeStreamHealthMetrics(5000, 120);
      expect(m.healthRate).toBe(1);
      expect(m.ping).toBe(120);
    });

    it('degrades health after 10s without inbound', () => {
      const m = computeStreamHealthMetrics(60000, 120);
      expect(m.healthRate).toBeLessThan(STALE_HEALTH_THRESHOLD);
      expect(m.ping).toBe(60000);
    });
  });

  describe('isInboundStale', () => {
    it('flags long silence with low health', () => {
      expect(isInboundStale(STALE_INBOUND_MS + 1000, 0.1)).toBeTrue();
    });

    it('does not flag brief silence', () => {
      expect(isInboundStale(5000, 1)).toBeFalse();
    });
  });

  describe('shouldRecycleStaleDataChannel', () => {
    it('never recycles (upstream alignment)', () => {
      expect(shouldRecycleStaleDataChannel(STALE_INBOUND_MS + 1000, 0.05)).toBeFalse();
      expect(shouldRecycleStaleDataChannel(60000, 0.1)).toBeFalse();
    });
  });
});
