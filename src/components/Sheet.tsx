import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from './Icon';

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** A bottom sheet: modal on phones, a centred card on wide screens. */
export function Sheet({ open, title, onClose, children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="panel rl-rise relative flex max-h-[88vh] w-full max-w-lg flex-col rounded-b-none sm:rounded-b-[18px]"
      >
        <header className="flex items-center justify-between border-b border-[var(--color-edge)] px-5 py-4">
          <h2 className="text-[15px] font-semibold tracking-wide">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="focus-ring rounded-full p-1.5 text-[var(--color-mist)] hover:text-[var(--color-chalk)]"
          >
            <CloseIcon />
          </button>
        </header>
        <div
          className="overflow-y-auto px-5 py-4"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
