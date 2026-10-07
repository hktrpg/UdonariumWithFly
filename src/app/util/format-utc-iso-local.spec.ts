import { formatUtcIsoToLocal, utcMsFromIsoInstant } from './format-utc-iso-local';

describe('formatUtcIsoToLocal', () => {
  it('parses Zulu ISO without new Date(string)', () => {
    expect(utcMsFromIsoInstant('2026-09-22T19:45:22.000Z')).toBe(Date.UTC(2026, 8, 22, 19, 45, 22, 0));
  });

  it('formats a known instant in local wall time', () => {
    const utcMs = Date.UTC(2026, 0, 1, 0, 30, 0);
    const iso = new Date(utcMs).toISOString();
    const formatted = formatUtcIsoToLocal(iso);
    const expected = (() => {
      const d = new Date(utcMs);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    })();
    expect(formatted).toBe(expected);
  });

  it('returns raw string when ISO is invalid', () => {
    expect(formatUtcIsoToLocal('not-a-date')).toBe('not-a-date');
  });

  it('formats via utcMs when Date constructor rejects ISO strings', () => {
    const utcMs = Date.UTC(2026, 8, 22, 19, 45, 22, 0);
    const RealDate = Date;
    const BrokenDate = Object.assign(
      function (value?: unknown) {
        if (typeof value === 'string') {
          throw new TypeError('patched Date rejects strings');
        }
        return new RealDate(value as number);
      },
      { UTC: RealDate.UTC, parse: RealDate.parse, now: RealDate.now },
    ) as unknown as DateConstructor;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Date = BrokenDate;

    try {
      expect(formatUtcIsoToLocal('2026-09-22T19:45:22.000Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).Date = RealDate;
    }
  });
});
