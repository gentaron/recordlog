/**
 * Day arithmetic used by both the PWA and the cron job. A memo's day and the
 * digest's day must be computed identically on both sides or the daily stack
 * silently drops the memos recorded near midnight.
 */

export const DEFAULT_TZ = 'Asia/Tokyo';

/** `YYYY-MM-DD` for an instant, in a given IANA timezone. */
export function dayKey(at: number | Date = Date.now(), timeZone: string = DEFAULT_TZ): string {
  const d = typeof at === 'number' ? new Date(at) : at;
  // `en-CA` formats as YYYY-MM-DD, which is exactly the key we want.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export const isDayKey = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
