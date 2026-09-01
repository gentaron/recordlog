import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * A new build is live. We never reload out from under a recording, so the
 * update is offered rather than applied.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check for a new build once an hour while the app is open.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="panel rl-rise mb-4 flex items-center gap-3 px-4 py-3">
      <p className="flex-1 text-[12.5px] text-[var(--color-chalk)]">新しいバージョンがあります</p>
      <button
        type="button"
        onClick={() => void updateServiceWorker(true)}
        className="focus-ring rounded-lg border border-[color-mix(in_oklab,var(--color-signal)_45%,transparent)] px-3 py-1.5 text-[12px] text-[var(--color-signal)]"
      >
        更新する
      </button>
      <button
        type="button"
        onClick={() => setNeedRefresh(false)}
        className="focus-ring rounded-lg px-2 py-1.5 text-[12px] text-[var(--color-mist)]"
      >
        あとで
      </button>
    </div>
  );
}
