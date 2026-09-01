import { useMemo, useState } from 'react';
import type { Digest } from '@shared/types';
import { formatDayLabel, shiftDay } from '@/lib/time';
import { useApp, timezone, today } from '@/store/app';
import { DownloadIcon, LayersIcon, SparkIcon } from '@/components/Icon';

function toMarkdown(digest: Digest): string {
  const lines = [`# ${digest.day}`, '', digest.summary, ''];
  for (const s of digest.sections) {
    lines.push(`## ${s.heading}`, ...s.bullets.map((b) => `- ${b}`), '');
  }
  if (digest.actions.length) lines.push('## やること', ...digest.actions.map((a) => `- [ ] ${a}`), '');
  if (digest.threads.length) lines.push('## 続き', ...digest.threads.map((t) => `- ${t}`), '');
  if (digest.highlights.length) lines.push('## そのまま残す', ...digest.highlights.map((h) => `> ${h}`), '');
  if (digest.tags.length) lines.push('', digest.tags.map((t) => `#${t}`).join(' '));
  return lines.join('\n');
}

function DigestCard({ digest }: { digest: Digest }) {
  const memos = useApp((s) => s.memos);
  const byId = useMemo(() => new Map(memos.map((m) => [m.id, m])), [memos]);
  const [open, setOpen] = useState<string | null>(null);

  const download = () => {
    const blob = new Blob([toMarkdown(digest)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recordlog-${digest.day}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <article className="panel rl-rise px-5 py-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">{formatDayLabel(digest.day, timezone())}</h2>
        <span className="chip">{digest.memoCount} 件から</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={download}
          aria-label="Markdown で書き出す"
          title="Markdown で書き出す"
          className="focus-ring rounded-lg p-1.5 text-[var(--color-mist)] hover:text-[var(--color-chalk)]"
        >
          <DownloadIcon width={16} height={16} />
        </button>
      </header>

      {digest.summary && (
        <p className="mb-4 text-[14px] leading-[1.9] text-[var(--color-chalk)]">{digest.summary}</p>
      )}

      <div className="flex flex-col gap-4">
        {digest.sections.map((section, i) => (
          <section key={`${section.heading}-${i}`}>
            <h3 className="mb-1.5 text-[13px] font-semibold text-[var(--color-signal)]">{section.heading}</h3>
            <ul className="flex flex-col gap-1.5">
              {section.bullets.map((b, j) => (
                <li key={j} className="flex gap-2 text-[13.5px] leading-[1.8] text-[var(--color-chalk)]">
                  <span className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-[var(--color-mist)]" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>

            {section.memoIds.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setOpen(open === section.heading ? null : section.heading)}
                  className="focus-ring mt-1.5 text-[11px] text-[var(--color-mist)] hover:text-[var(--color-signal)]"
                >
                  {open === section.heading ? '出典を閉じる' : `出典 ${section.memoIds.length} 件`}
                </button>
                {open === section.heading && (
                  <ul className="mt-1.5 flex flex-col gap-1.5 border-l border-[var(--color-edge)] pl-3">
                    {section.memoIds.map((id) => {
                      const memo = byId.get(id);
                      return (
                        <li key={id} className="text-[12px] leading-relaxed text-[var(--color-mist)]">
                          {memo ? memo.text.slice(0, 160) : '（このメモは端末にありません）'}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </section>
        ))}
      </div>

      {digest.actions.length > 0 && (
        <section className="mt-4">
          <h3 className="mb-1.5 text-[13px] font-semibold text-[var(--color-leaf)]">やること</h3>
          <ul className="flex flex-col gap-1.5">
            {digest.actions.map((a, i) => (
              <li key={i} className="flex gap-2 text-[13.5px] leading-[1.8]">
                <span className="mt-[0.35em] h-3.5 w-3.5 shrink-0 rounded border border-[var(--color-edge)]" />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {digest.threads.length > 0 && (
        <section className="mt-4">
          <h3 className="mb-1.5 text-[13px] font-semibold text-[var(--color-amber-warn)]">続き</h3>
          <ul className="flex flex-col gap-1.5 text-[13.5px] leading-[1.8] text-[var(--color-chalk)]">
            {digest.threads.map((t, i) => (
              <li key={i}>— {t}</li>
            ))}
          </ul>
        </section>
      )}

      {digest.highlights.length > 0 && (
        <section className="mt-4 flex flex-col gap-2">
          {digest.highlights.map((h, i) => (
            <blockquote
              key={i}
              className="border-l-2 border-[var(--color-signal)] pl-3 text-[13.5px] leading-[1.8] text-[var(--color-chalk)] italic"
            >
              {h}
            </blockquote>
          ))}
        </section>
      )}

      {digest.tags.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {digest.tags.map((t) => (
            <li key={t} className="chip text-[var(--color-signal)]">
              #{t}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function DigestPanel() {
  const digests = useApp((s) => s.digests);
  const runDigest = useApp((s) => s.runDigest);
  const memos = useApp((s) => s.memos);
  const [running, setRunning] = useState(false);

  const yesterday = shiftDay(today(), -1);
  const pendingYesterday = memos.some((m) => m.day === yesterday && m.status === 'pending');

  return (
    <div className="flex flex-col gap-5">
      <div className="panel flex flex-wrap items-center gap-x-3 gap-y-3 px-5 py-4">
        <LayersIcon className="text-[var(--color-signal)]" />
        <div className="min-w-48 flex-1">
          <p className="text-[13px] font-semibold">毎日 3:00 に、前日ぶんを 1 回だけ積みます</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--color-mist)]">
            Cloudflare の Cron Trigger が走り、その日に話したメモを AI が 1 枚にまとめて保管します。
            取りこぼした日は次の実行でまとめて追いつきます。
          </p>
        </div>
        <button
          type="button"
          disabled={running}
          onClick={async () => {
            setRunning(true);
            await runDigest(pendingYesterday ? yesterday : today());
            setRunning(false);
          }}
          className="focus-ring flex w-full items-center justify-center gap-1.5 rounded-lg border border-[color-mix(in_oklab,var(--color-signal)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-signal)_14%,transparent)] px-3 py-2 text-[12px] text-[var(--color-signal)] disabled:opacity-50 sm:w-auto"
        >
          <SparkIcon width={15} height={15} className={running ? 'animate-spin' : undefined} />
          {running ? 'まとめ中…' : '今すぐ走らせる'}
        </button>
      </div>

      {digests.length === 0 ? (
        <p className="mt-6 text-center text-[13px] leading-relaxed text-[var(--color-mist)]">
          まだ積み上がったものはありません。
          <br />
          今日の分は明朝 3:00 に自動でまとまります。
        </p>
      ) : (
        digests.map((d) => <DigestCard key={d.day} digest={d} />)
      )}
    </div>
  );
}
