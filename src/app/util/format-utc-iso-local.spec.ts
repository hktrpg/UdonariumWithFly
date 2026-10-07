import { formatUtcIsoToLocal, utcMsFromIsoInstant } from './format-utc-iso-local';

function localWallFromUtcMs(utcMs: number): string {
  const d = new Date(utcMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

describe('formatUtcIsoToLocal', () => {
  const realDate = Date;

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Date = realDate;
  });

  it('parses Zulu ISO without new Date(string)', () => {
    expect(utcMsFromIsoInstant('2026-09-22T19:45:22.000Z')).toBe(Date.UTC(2026, 8, 22, 19, 45, 22, 0));
  });

  it('formats a known instant in local wall time', () => {
    const iso = '2026-01-01T00:30:00.000Z';
    const utcMs = utcMsFromIsoInstant(iso)!;
    expect(formatUtcIsoToLocal(iso)).toBe(localWallFromUtcMs(utcMs));
  });

  it('returns raw string when ISO is invalid', () => {
    expect(formatUtcIsoToLocal('not-a-date')).toBe('not-a-date');
  });

  it('formats via utcMs when Date constructor rejects ISO strings', () => {
    const iso = '2026-09-22T19:45:22.000Z';
    const utcMs = utcMsFromIsoInstant(iso)!;
    const BrokenDate = Object.assign(
      function (value?: unknown) {
        if (typeof value === 'string') {
          throw new TypeError('patched Date rejects strings');
        }
        return new realDate(value as number);
      },
      { UTC: realDate.UTC, parse: realDate.parse, now: realDate.now },
    ) as unknown as DateConstructor;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Date = BrokenDate;

    expect(formatUtcIsoToLocal(iso)).toBe(localWallFromUtcMs(utcMs));
  });
});
