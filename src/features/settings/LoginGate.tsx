import { useState } from 'react';
import { useApp } from '@/store/app';
import { MicIcon } from '@/components/Icon';

/** Shown when the deployment has a passphrase set and this device has no session. */
export function LoginGate() {
  const login = useApp((s) => s.login);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value || busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await login(value);
    setBusy(false);
    if (!ok) {
      setFailed(true);
      setValue('');
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <form onSubmit={submit} className="panel w-full max-w-sm px-6 py-8 text-center">
        <MicIcon width={30} height={30} className="mx-auto text-[var(--color-signal)]" />
        <h1 className="mt-3 text-[17px] font-semibold">RecordLog</h1>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--color-mist)]">
          パスフレーズを入力してください
        </p>

        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="current-password"
          autoFocus
          aria-label="パスフレーズ"
          className="focus-ring mt-5 w-full rounded-lg border border-[var(--color-edge)] bg-[var(--color-void)] px-3 py-2.5 text-center text-[14px] outline-none"
        />

        {failed && <p className="mt-2 text-[12px] text-[var(--color-ember)]">パスフレーズが違います</p>}

        <button
          type="submit"
          disabled={busy || !value}
          className="focus-ring mt-4 w-full rounded-lg border border-[color-mix(in_oklab,var(--color-signal)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-signal)_16%,transparent)] py-2.5 text-[13px] text-[var(--color-signal)] disabled:opacity-45"
        >
          {busy ? '確認中…' : '開く'}
        </button>
      </form>
    </main>
  );
}
