import { useEffect } from 'react';
import { formatDuration } from '@/lib/time';
import { MicIcon, PauseIcon, PlayIcon, StopIcon, CloseIcon } from '@/components/Icon';
import { Visualizer } from './Visualizer';
import type { useCapture } from './useCapture';

type Capture = ReturnType<typeof useCapture>;

const STATE_LABEL: Record<Capture['state'], string> = {
  idle: '押して話す',
  requesting: 'マイクを起動中…',
  recording: '聞いています',
  paused: '一時停止中',
  processing: '文字にしています…',
};

/**
 * The one control that matters. Fixed to the bottom of the viewport, sized for
 * a thumb, and always reachable — you should never have to navigate to record.
 */
export function RecordDock({ capture }: { capture: Capture }) {
  const { state, elapsed, level, liveText, interim, progress } = capture;
  const busy = state === 'recording' || state === 'paused';

  // Space toggles recording, Escape throws the take away.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (state === 'idle') void capture.start();
        else if (busy) void capture.stop();
      } else if (e.key === 'Escape' && busy) {
        capture.cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, capture, state]);

  const caption = [liveText, interim].filter(Boolean).join(' ').trim();
  const clipping = level.clipped > 40;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4"
      style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
    >
      {/* The dock floats over the list. Without this the text scrolling under
          the record button collides with it and both become unreadable. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-16 bottom-0 bg-gradient-to-t from-[var(--color-void)] from-45% via-[color-mix(in_oklab,var(--color-void)_88%,transparent)] to-transparent"
      />

      <div className="pointer-events-auto relative w-full max-w-2xl">
        {(busy || state === 'processing') && (
          <div className="panel rl-rise mb-3 px-4 py-3">
            <div className="flex items-center justify-between text-[11px] text-[var(--color-mist)]">
              <span className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    state === 'recording'
                      ? 'rl-pulse bg-[var(--color-ember)]'
                      : state === 'paused'
                        ? 'bg-[var(--color-amber-warn)]'
                        : 'bg-[var(--color-signal)]'
                  }`}
                />
                {STATE_LABEL[state]}
                {level.speaking && state === 'recording' ? ' · 発話中' : ''}
              </span>
              <span className="font-mono tabular-nums">{formatDuration(elapsed)}</span>
            </div>

            {clipping && (
              <p className="mt-2 text-[11px] text-[var(--color-amber-warn)]">
                音が割れています。少しマイクから離してください。
              </p>
            )}

            {progress && (
              <p className="mt-2 text-[11px] text-[var(--color-signal)]">
                {progress.phase === 'loading-model'
                  ? `モデルを読み込み中${progress.ratio ? ` ${Math.round(progress.ratio * 100)}%` : ''}`
                  : progress.phase === 'uploading'
                    ? '音声を送信中…'
                    : '文字起こし中…'}
              </p>
            )}

            {caption && (
              <p className="mt-2 max-h-24 overflow-y-auto text-[13px] leading-relaxed text-[var(--color-chalk)]">
                {liveText}
                {interim && <span className="text-[var(--color-mist)]"> {interim}</span>}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-center gap-5">
          {busy && (
            <button
              type="button"
              onClick={capture.cancel}
              aria-label="録音を破棄"
              className="focus-ring panel flex h-12 w-12 items-center justify-center text-[var(--color-mist)] hover:text-[var(--color-ember)]"
            >
              <CloseIcon />
            </button>
          )}

          <div className="relative flex h-[168px] w-[168px] items-center justify-center">
            <Visualizer active={state === 'recording'} read={capture.readFrequencies} />
            <button
              type="button"
              disabled={state === 'requesting' || state === 'processing'}
              onClick={() => (state === 'idle' ? void capture.start() : void capture.stop())}
              aria-label={state === 'idle' ? '録音を開始' : '録音を終了して保存'}
              aria-pressed={busy}
              className={`focus-ring relative flex h-[86px] w-[86px] items-center justify-center rounded-full border transition-all duration-200 active:scale-95 disabled:opacity-60 ${
                busy
                  ? 'border-[color-mix(in_oklab,var(--color-ember)_60%,transparent)] bg-[color-mix(in_oklab,var(--color-ember)_18%,var(--color-ink))] text-[var(--color-ember)]'
                  : 'border-[color-mix(in_oklab,var(--color-signal)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-signal)_12%,var(--color-ink))] text-[var(--color-signal)] hover:bg-[color-mix(in_oklab,var(--color-signal)_20%,var(--color-ink))]'
              }`}
            >
              {busy ? <StopIcon width={30} height={30} /> : <MicIcon width={32} height={32} />}
            </button>
          </div>

          {busy && (
            <button
              type="button"
              onClick={() => void capture.togglePause()}
              aria-label={state === 'paused' ? '録音を再開' : '一時停止'}
              className="focus-ring panel flex h-12 w-12 items-center justify-center text-[var(--color-mist)] hover:text-[var(--color-chalk)]"
            >
              {state === 'paused' ? <PlayIcon /> : <PauseIcon />}
            </button>
          )}
        </div>

        {state === 'idle' && (
          <p className="mt-2 text-center text-[11px] text-[var(--color-mist)]">
            {STATE_LABEL.idle}
            <span className="ml-2 hidden sm:inline">スペースキーでも開始・終了できます</span>
          </p>
        )}
      </div>
    </div>
  );
}
