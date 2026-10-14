/**
 * Calendar-day boundaries shared by the dashboard list filters.
 *
 * `createdAt` is stored as a full UTC ISO string (`new Date().toISOString()`),
 * while the date pickers hand back a plain `YYYY-MM-DD` *calendar day* and the
 * calendar dots group records by the **local** day (`toIsoDay`). Turning a day
 * into query bounds therefore has exactly one correct answer: the instants at
 * which that day starts and ends *in the user's timezone*.
 *
 * Getting this wrong is easy and silent. `${day}T00:00:00.000Z` looks right but
 * is UTC midnight — in UTC+5:30 that is 05:30 local, so a report issued at
 * 02:00 belongs to the previous UTC day and drops out of a "Today" filter even
 * though the calendar dot for today is lit. Both the Firestore `where()` bounds
 * and any client-side day filter must come from here so the two can never
 * disagree.
 */

/** Parses `YYYY-MM-DD` as a *local* midnight without any string-parse ambiguity. */
function parts(day: string): [number, number, number] {
  const [year, month, date] = day.split('-').map(Number);
  return [year, month - 1, date];
}

function isCalendarDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Inclusive lower bound for a local calendar day, as a UTC ISO string.
 * Returns `undefined` for anything that is not a `YYYY-MM-DD` day, so callers
 * can pass an empty picker value straight through.
 */
export function localDayStartIso(day: string | undefined): string | undefined {
  if (!isCalendarDay(day)) return undefined;
  const [year, monthIndex, date] = parts(day);
  return new Date(year, monthIndex, date, 0, 0, 0, 0).toISOString();
}

/** Inclusive upper bound for a local calendar day — its last millisecond. */
export function localDayEndIso(day: string | undefined): string | undefined {
  if (!isCalendarDay(day)) return undefined;
  const [year, monthIndex, date] = parts(day);
  return new Date(year, monthIndex, date, 23, 59, 59, 999).toISOString();
}

/**
 * The `createdAt` bounds for an optional `[from, to]` day range, ready to be
 * spread into `useCollectionList`'s `filters`. A missing or malformed bound is
 * simply omitted, so a half-open range stays half-open.
 */
export function createdAtRangeFilters(
  fromDay?: string,
  toDay?: string,
): {
  since?: string;
  until?: string;
} {
  const since = localDayStartIso(fromDay);
  const until = localDayEndIso(toDay);
  return {
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
  };
}
