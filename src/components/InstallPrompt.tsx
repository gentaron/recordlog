import { useEffect, useState } from 'react';
import { DownloadIcon, CloseIcon } from './Icon';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED = 'recordlog:install-dismissed';

/**
 * The install nudge. Chrome/Edge/Android get a real prompt; iOS Safari has no
 * API for it, so those users get the two-step instruction instead.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISSED)) return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    const ua = navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua);
    const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isIos && !standalone) {
      const timer = setTimeout(() => setShowIos(true), 6000);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('beforeinstallprompt', onPrompt);
      };
    }
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISSED, '1');
    setDeferred(null);
    setShowIos(false);
  };

  if (!deferred && !showIos) return null;

  return (
    <div className="panel rl-rise mb-4 flex items-start gap-3 px-4 py-3">
      <DownloadIcon className="mt-0.5 shrink-0 text-[var(--color-signal)]" width={18} height={18} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">ホーム画面に入れる</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--color-mist)]">
          {showIos
            ? '共有ボタン → 「ホーム画面に追加」で、アプリと同じように開けます。'
            : 'アプリのように全画面で開き、オフラインでも録音できます。'}
        </p>
        {deferred && (
          <button
            type="button"
            onClick={async () => {
              await deferred.prompt();
              await deferred.userChoice;
              dismiss();
            }}
            className="focus-ring mt-2 rounded-lg border border-[color-mix(in_oklab,var(--color-signal)_45%,transparent)] px-3 py-1.5 text-[12px] text-[var(--color-signal)]"
          >
            インストール
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="閉じる"
        className="focus-ring rounded-lg p-1 text-[var(--color-mist)]"
      >
        <CloseIcon width={16} height={16} />
      </button>
    </div>
  );
}
