import { useEffect, useRef, useState } from 'react';
import { engineLabel } from '@/lib/asr';
import { getAudio, type LocalMemo } from '@/lib/db/local';
import { formatClock, formatDuration } from '@/lib/time';
import { useApp, timezone } from '@/store/app';
import { AlertIcon, PencilIcon, PlayIcon, SparkIcon, StopIcon, TrashIcon } from '@/components/Icon';

export function MemoCard({ memo }: { memo: LocalMemo }) {
  const patchMemo = useApp((s) => s.patchMemo);
  const removeMemo = useApp((s) => s.removeMemo);
  const refineMemo = useApp((s) => s.refineMemo);
  const sync = useApp((s) => s.sync);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memo.text);
  const [refining, setRefining] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const hasAudio = memo.audioKey !== null || memo.engine !== 'manual';

  const togglePlay = async () => {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }

    // Prefer the local copy: instant, and works with no network.
    let src: string | null = null;
    const local = await getAudio(memo.id);
    if (local) {
      urlRef.current = URL.createObjectURL(local);
      src = urlRef.current;
    } else if (memo.audioKey) {
      src = `/api/audio/${memo.audioKey}`;
    }
    if (!src) return;

    const audio = new Audio(src);
    audio.onended = () => setPlaying(false);
    audio.onerror = () => setPlaying(false);
    audioRef.current = audio;
    await audio.play().catch(() => setPlaying(false));
    setPlaying(true);
  };

  const saveEdit = async () => {
    setEditing(false);
    if (draft.trim() === memo.text.trim()) return;
    await patchMemo(memo.id, { text: draft.trim() });
    void sync(true);
  };

  const runRefine = async () => {
    setRefining(true);
    await refineMemo(memo.id);
    setRefining(false);
  };

  return (
    <article className="panel rl-rise px-4 py-3.5">
      <header className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--color-mist)]">
        <time className="font-mono text-[var(--color-chalk)] tabular-nums">
          {formatClock(memo.createdAt, timezone())}
        </time>
        {memo.durationMs > 0 && (
          <span className="font-mono tabular-nums">{formatDuration(memo.durationMs)}</span>
        )}
        <span className="chip">{engineLabel(memo.engine)}</span>
        {memo.status === 'stacked' && <span className="chip text-[var(--color-leaf)]">積層済み</span>}
        {memo.dirty && <span className="chip text-[var(--color-amber-warn)]">未同期</span>}
        {memo.transcribing && <span className="chip text-[var(--color-signal)]">文字起こし中…</span>}
      </header>

      {memo.title && (
        <h3 className="mb-1 text-[14px] font-semibold text-[var(--color-chalk)]">{memo.title}</h3>
      )}

      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(16, Math.max(3, draft.split('\n').length + 1))}
            autoFocus
            className="focus-ring w-full resize-y rounded-lg border border-[var(--color-edge)] bg-[var(--color-void)] p-3 text-[14px] leading-relaxed outline-none"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void saveEdit()}
              className="focus-ring rounded-lg bg-[color-mix(in_oklab,var(--color-signal)_22%,var(--color-ink))] px-3 py-1.5 text-[12px] text-[var(--color-signal)]"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(memo.text);
                setEditing(false);
              }}
              className="focus-ring rounded-lg px-3 py-1.5 text-[12px] text-[var(--color-mist)]"
            >
              取り消す
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[14px] leading-[1.85] whitespace-pre-wrap text-[var(--color-chalk)]">
          {memo.text || <span className="text-[var(--color-mist)]">（無音でした）</span>}
        </p>
      )}

      {memo.error && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--color-ember)]">
          <AlertIcon width={14} height={14} />
          {memo.error}
        </p>
      )}

      {memo.tags.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {memo.tags.map((tag) => (
            <li key={tag} className="chip text-[var(--color-signal)]">
              #{tag}
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-3 flex items-center gap-1 border-t border-[var(--color-edge)] pt-2.5 text-[var(--color-mist)]">
        {hasAudio && (
          <button
            type="button"
            onClick={() => void togglePlay()}
            aria-label={playing ? '再生を止める' : '録音を再生'}
            className="focus-ring rounded-lg p-1.5 hover:text-[var(--color-chalk)]"
          >
            {playing ? <StopIcon width={16} height={16} /> : <PlayIcon width={16} height={16} />}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setDraft(memo.text);
            setEditing((v) => !v);
          }}
          aria-label="編集"
          className="focus-ring rounded-lg p-1.5 hover:text-[var(--color-chalk)]"
        >
          <PencilIcon width={16} height={16} />
        </button>
        <button
          type="button"
          disabled={refining || !memo.text}
          onClick={() => void runRefine()}
          aria-label="AI で整える"
          title="AI で整える"
          className="focus-ring rounded-lg p-1.5 hover:text-[var(--color-signal)] disabled:opacity-40"
        >
          <SparkIcon width={16} height={16} className={refining ? 'animate-spin' : undefined} />
        </button>

        <span className="flex-1" />

        {confirmDelete ? (
          <span className="flex items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => void removeMemo(memo.id)}
              className="focus-ring rounded-lg px-2 py-1 text-[var(--color-ember)]"
            >
              削除する
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="focus-ring rounded-lg px-2 py-1"
            >
              やめる
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label="削除"
            className="focus-ring rounded-lg p-1.5 hover:text-[var(--color-ember)]"
          >
            <TrashIcon width={16} height={16} />
          </button>
        )}
      </footer>
    </article>
  );
}
