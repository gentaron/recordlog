import { dayKey, shiftDay, DEFAULT_TZ } from '@shared/day';

export { dayKey, shiftDay, DEFAULT_TZ };

/** Presentation helpers. Day arithmetic itself lives in `@shared/day`. */
export function isToday(day: string, timeZone: string = DEFAULT_TZ): boolean {
  return day === dayKey(Date.now(), timeZone);
}

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'] as const;

export function formatDayLabel(day: string, timeZone: string = DEFAULT_TZ): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  const wd = WEEKDAYS_JA[dt.getUTCDay()] ?? '';
  const today = dayKey(Date.now(), timeZone);
  if (day === today) return `今日 · ${m}月${d}日(${wd})`;
  if (day === shiftDay(today, -1)) return `昨日 · ${m}月${d}日(${wd})`;
  return `${y}年${m}月${d}日(${wd})`;
}

export function formatClock(at: number, timeZone: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(at));
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "3分前" / "2時間前" — relative, in Japanese. */
export function formatRelative(at: number, now = Date.now()): string {
  const diff = Math.round((at - now) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('ja-JP', { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}
