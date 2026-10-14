import { describe, expect, it } from 'vitest';
import { toIsoDay } from '../components/ui/CalendarRangePicker';
import { createdAtRangeFilters, localDayEndIso, localDayStartIso } from './date-range';

/**
 * These tests run in whatever timezone the machine is in, which is exactly the
 * point: the helpers promise *local* calendar days, so every assertion is
 * phrased in local terms instead of hard-coding a UTC offset.
 */
describe('localDayStartIso / localDayEndIso', () => {
  it('brackets the local calendar day it was given', () => {
    const day = '2026-03-14';
    const start = localDayStartIso(day)!;
    const end = localDayEndIso(day)!;

    expect(toIsoDay(new Date(start))).toBe(day);
    expect(toIsoDay(new Date(end))).toBe(day);
  });

  it('contains every instant a record stamped on that local day could have', () => {
    const day = '2026-03-14';
    const start = new Date(localDayStartIso(day)!).getTime();
    const end = new Date(localDayEndIso(day)!).getTime();

    // Local midnight and local end-of-day, written the way a browser renders a
    // picker selection.
    const localNoon = new Date(`${day}T12:00:00`).getTime();
    const localFirstSecond = new Date(`${day}T00:00:01`).getTime();
    const localLastSecond = new Date(`${day}T23:59:58`).getTime();

    for (const instant of [localFirstSecond, localNoon, localLastSecond]) {
      expect(instant).toBeGreaterThanOrEqual(start);
      expect(instant).toBeLessThanOrEqual(end);
    }
  });

  it('never overlaps the neighbouring days', () => {
    const yesterdayEnd = new Date(localDayEndIso('2026-03-13')!).getTime();
    const todayStart = new Date(localDayStartIso('2026-03-14')!).getTime();
    const todayEnd = new Date(localDayEndIso('2026-03-14')!).getTime();
    const tomorrowStart = new Date(localDayStartIso('2026-03-15')!).getTime();

    expect(yesterdayEnd).toBeLessThan(todayStart);
    expect(todayEnd).toBeLessThan(tomorrowStart);
  });

  it('agrees with toIsoDay for a record created right now', () => {
    const now = new Date();
    const day = toIsoDay(now);
    const stamp = now.toISOString();

    expect(stamp >= localDayStartIso(day)!).toBe(true);
    expect(stamp <= localDayEndIso(day)!).toBe(true);
  });

  it('rejects anything that is not a plain calendar day', () => {
    for (const bad of ['', undefined, '2026-3-4', '2026-03-14T00:00:00.000Z', 'yesterday']) {
      expect(localDayStartIso(bad as string | undefined)).toBeUndefined();
      expect(localDayEndIso(bad as string | undefined)).toBeUndefined();
    }
  });
});

describe('createdAtRangeFilters', () => {
  it('omits bounds that were not supplied, keeping the range half-open', () => {
    expect(createdAtRangeFilters()).toEqual({});
    expect(createdAtRangeFilters('', '')).toEqual({});
    expect(Object.keys(createdAtRangeFilters('2026-03-14', ''))).toEqual(['since']);
    expect(Object.keys(createdAtRangeFilters(undefined, '2026-03-14'))).toEqual(['until']);
  });

  it('produces both bounds for a closed range', () => {
    const range = createdAtRangeFilters('2026-03-14', '2026-03-20');
    expect(range.since).toBe(localDayStartIso('2026-03-14'));
    expect(range.until).toBe(localDayEndIso('2026-03-20'));
  });

  it('is usable as a lexicographic bound pair over stored ISO strings', () => {
    // `createdAt` is an ISO-8601 UTC string, so Firestore range queries on it
    // behave like string ordering. A same-day record must sort inside the range.
    const range = createdAtRangeFilters('2026-03-14', '2026-03-14');
    const sameDay = new Date(`${'2026-03-14'}T12:00:00`).toISOString();

    expect(sameDay >= range.since!).toBe(true);
    expect(sameDay <= range.until!).toBe(true);
  });
});
