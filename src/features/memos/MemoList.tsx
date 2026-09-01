import { useMemo, useState } from 'react';
import type { LocalMemo } from '@/lib/db/local';
import { formatDayLabel, formatDuration } from '@/lib/time';
import { useApp, timezone, today } from '@/store/app';
import { LayersIcon, MicIcon } from '@/components/Icon';
import { MemoCard } from './MemoCard';

function groupByDay(memos: LocalMemo[]): [string, LocalMemo[]][] {
  const map = new Map<string, LocalMemo[]>();
  for (const memo of memos) {
    const list = map.get(memo.day);
    if (list) list.push(memo);
    else map.set(memo.day, [memo]);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, list]) => [day, list.sort((a, b) => b.createdAt - a.createdAt)] as [string, LocalMemo[]]);
}

export function MemoList({ query }: { query: string }) {
  const memos = useApp((s) => s.memos);
  const digests = useApp((s) => s.digests);
  const runDigest = useApp((s) => s.runDigest);
  const [running, setRunning] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return memos;
    return memos.filter(
      (m) =>
        m.text.toLowerCase().includes(q) ||
        (m.title ?? '').toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [memos, query]);

  const groups = useMemo(() => groupByDay(filtered), [filtered]);
  const digestDays = useMemo(() => new Set(digests.map((d) => d.day)), [digests]);

  if (memos.length === 0) {
    return (
      <div className="panel mt-8 px-6 py-10 text-center">
        <MicIcon width={30} height={30} className="mx-auto text-[var(--color-signal)]" />
        <p className="mt-3 text-[15px] font-semibold">まだ何も残っていません</p>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-[var(--color-mist)]">
          下のボタンを押して、考えていることをそのまま喋ってください。 文字起こしはすぐ、整理は毎日 1
          回まとめて走ります。
        </p>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <p className="mt-10 text-center text-[13px] text-[var(--color-mist)]">
        「{query}」に一致するメモはありません
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-7">
      {groups.map(([day, list]) => {
        const seconds = list.reduce((n, m) => n + m.durationMs, 0);
        const stacked = digestDays.has(day);
        const isToday = day === today();

        return (
          <section key={day}>
            <header className="sticky top-0 z-10 -mx-1 mb-2.5 flex items-center gap-3 bg-[color-mix(in_oklab,var(--color-void)_82%,transparent)] px-1 py-2 backdrop-blur-md">
              <h2 className="text-[13px] font-semibold tracking-wide text-[var(--color-chalk)]">
                {formatDayLabel(day, timezone())}
              </h2>
              <span className="text-[11px] text-[var(--color-mist)]">
                {list.length}件 · {formatDuration(seconds)}
              </span>
              <span className="flex-1" />
              {stacked ? (
                <span className="chip text-[var(--color-leaf)]">
                  <LayersIcon width={12} height={12} />
                  積層済み
                </span>
              ) : (
                <button
                  type="button"
                  disabled={running === day}
                  onClick={async () => {
                    setRunning(day);
                    await runDigest(day);
                    setRunning(null);
                  }}
                  className="focus-ring chip hover:text-[var(--color-signal)] disabled:opacity-50"
                  title={
                    isToday ? '今日ぶんを先に積む（通常は深夜 3 時に自動で走ります）' : 'この日をまとめる'
                  }
                >
                  <LayersIcon width={12} height={12} />
                  {running === day ? 'まとめ中…' : '今すぐ積む'}
                </button>
              )}
            </header>

            <div className="flex flex-col gap-2.5">
              {list.map((memo) => (
                <MemoCard key={memo.id} memo={memo} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
