import { useApp } from '@/store/app';
import { AlertIcon, CheckIcon } from './Icon';

const TONE = {
  ok: 'border-[color-mix(in_oklab,var(--color-leaf)_45%,transparent)] text-[var(--color-leaf)]',
  error: 'border-[color-mix(in_oklab,var(--color-ember)_45%,transparent)] text-[var(--color-ember)]',
  info: 'border-[var(--color-edge)] text-[var(--color-chalk)]',
} as const;

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);

  if (!toasts.length) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`panel rl-rise pointer-events-auto flex max-w-md items-center gap-2 px-4 py-2.5 text-[13px] shadow-2xl ${TONE[t.kind]}`}
        >
          {t.kind === 'ok' ? <CheckIcon width={16} height={16} /> : null}
          {t.kind === 'error' ? <AlertIcon width={16} height={16} /> : null}
          <span className="text-left text-[var(--color-chalk)]">{t.text}</span>
        </button>
      ))}
    </div>
  );
}
