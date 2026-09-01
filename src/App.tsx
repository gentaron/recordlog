import { useEffect, useMemo, useRef, useState } from 'react';
import { InstallPrompt } from '@/components/InstallPrompt';
import { GearIcon, LayersIcon, MicIcon, SyncIcon } from '@/components/Icon';
import { Toasts } from '@/components/Toasts';
import { UpdateBanner } from '@/components/UpdateBanner';
import { DigestPanel } from '@/features/digest/DigestPanel';
import { MemoList } from '@/features/memos/MemoList';
import { RecordDock } from '@/features/recorder/RecordDock';
import { useCapture } from '@/features/recorder/useCapture';
import { LoginGate } from '@/features/settings/LoginGate';
import { SettingsSheet } from '@/features/settings/SettingsSheet';
import { formatRelative } from '@/lib/time';
import { useApp, today } from '@/store/app';

type Tab = 'memos' | 'digests';

export default function App() {
  const ready = useApp((s) => s.ready);
  const locked = useApp((s) => s.locked);
  const memos = useApp((s) => s.memos);
  const online = useApp((s) => s.online);
  const syncing = useApp((s) => s.syncing);
  const lastSyncAt = useApp((s) => s.lastSyncAt);
  const hydrate = useApp((s) => s.hydrate);
  const sync = useApp((s) => s.sync);

  // Launch intent from the manifest shortcuts, read once at mount.
  const [tab, setTab] = useState<Tab>(() =>
    new URLSearchParams(window.location.search).get('view') === 'digest' ? 'digests' : 'memos',
  );
  const [query, setQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const capture = useCapture();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // `?action=record` opens straight into a recording, then the query is dropped
  // so a reload doesn't start another one.
  const launched = useRef(false);
  useEffect(() => {
    if (launched.current) return;
    launched.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'record') void capture.start();
    if ([...params.keys()].length) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [capture]);

  const todayCount = useMemo(() => memos.filter((m) => m.day === today()).length, [memos]);
  // Only count what `syncNow` would actually push, so a failed capture with no
  // transcript doesn't leave a badge stuck on the sync button forever.
  const unsynced = useMemo(
    () => memos.filter((m) => m.dirty && !m.transcribing && m.text.trim().length > 0).length,
    [memos],
  );

  if (locked) return <LoginGate />;

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <MicIcon width={26} height={26} className="animate-pulse text-[var(--color-signal)]" />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-[280px]">
      <header
        className="sticky top-0 z-20 -mx-4 mb-4 bg-[color-mix(in_oklab,var(--color-void)_80%,transparent)] px-4 pt-3 pb-2 backdrop-blur-xl"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-wide">
            <MicIcon width={17} height={17} className="text-[var(--color-signal)]" />
            RecordLog
          </h1>
          <span className="text-[11px] text-[var(--color-mist)]">今日 {todayCount} 件</span>

          <span className="flex-1" />

          <button
            type="button"
            onClick={() => void sync()}
            aria-label="いま同期する"
            title={
              !online
                ? 'オフライン（端末に保存されています）'
                : lastSyncAt
                  ? `最終同期 ${formatRelative(lastSyncAt)}`
                  : '同期する'
            }
            className={`focus-ring relative rounded-lg p-1.5 ${
              online
                ? 'text-[var(--color-mist)] hover:text-[var(--color-chalk)]'
                : 'text-[var(--color-amber-warn)]'
            }`}
          >
            <SyncIcon width={17} height={17} className={syncing ? 'animate-spin' : undefined} />
            {unsynced > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-amber-warn)] px-1 text-[9px] font-semibold text-[var(--color-void)]">
                {unsynced > 9 ? '9+' : unsynced}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="設定"
            className="focus-ring rounded-lg p-1.5 text-[var(--color-mist)] hover:text-[var(--color-chalk)]"
          >
            <GearIcon width={17} height={17} />
          </button>
        </div>

        <nav className="mt-3 flex items-center gap-1.5" aria-label="表示切り替え">
          {(
            [
              ['memos', 'メモ', MicIcon],
              ['digests', '積層', LayersIcon],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={`focus-ring flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] transition-colors ${
                tab === id
                  ? 'bg-[color-mix(in_oklab,var(--color-signal)_16%,transparent)] text-[var(--color-signal)]'
                  : 'text-[var(--color-mist)] hover:text-[var(--color-chalk)]'
              }`}
            >
              <Icon width={14} height={14} />
              {label}
            </button>
          ))}

          {tab === 'memos' && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="検索"
              aria-label="メモを検索"
              className="focus-ring ml-auto w-28 rounded-lg border border-[var(--color-edge)] bg-[var(--color-void)] px-2.5 py-1.5 text-[12px] transition-all outline-none focus:w-40"
            />
          )}
        </nav>
      </header>

      <UpdateBanner />
      <InstallPrompt />

      {!capture.supported && (
        <div className="panel mb-4 px-4 py-3 text-[12.5px] leading-relaxed text-[var(--color-amber-warn)]">
          このブラウザでは録音できません。Chrome / Safari / Edge の最新版でお試しください。
        </div>
      )}

      {tab === 'memos' ? <MemoList query={query} /> : <DigestPanel />}

      <RecordDock capture={capture} />
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toasts />
    </div>
  );
}
