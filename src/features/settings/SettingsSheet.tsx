import { useEffect, useState, type ReactNode } from 'react';
import { Sheet } from '@/components/Sheet';
import { estimateUsage } from '@/lib/db/local';
import { liveCaptionsSupported, preloadLocalWhisper } from '@/lib/asr';
import { useApp } from '@/store/app';
import { LANGUAGES, useSettings, type Settings } from '@/store/settings';

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--color-edge)] py-3.5 last:border-0">
      <div className="min-w-0">
        <p className="text-[13.5px] text-[var(--color-chalk)]">{label}</p>
        {hint && <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--color-mist)]">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={() => onChange(!value)}
      className={`focus-ring relative h-6 w-11 rounded-full border transition-colors ${
        value
          ? 'border-[color-mix(in_oklab,var(--color-signal)_60%,transparent)] bg-[color-mix(in_oklab,var(--color-signal)_35%,transparent)]'
          : 'border-[var(--color-edge)] bg-[var(--color-void)]'
      }`}
    >
      <span
        className={`absolute top-[3px] h-4 w-4 rounded-full transition-all ${
          value ? 'left-[25px] bg-[var(--color-signal)]' : 'left-[3px] bg-[var(--color-mist)]'
        }`}
      />
    </button>
  );
}

function Select<T extends string | number>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        const match = options.find((o) => String(o.value) === raw);
        if (match) onChange(match.value);
      }}
      className="focus-ring rounded-lg border border-[var(--color-edge)] bg-[var(--color-void)] px-2.5 py-1.5 text-[12.5px] outline-none"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings();
  const session = useApp((x) => x.session);
  const logout = useApp((x) => x.logout);
  const toast = useApp((x) => x.toast);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [preloading, setPreloading] = useState(false);

  useEffect(() => {
    if (open) void estimateUsage().then(setUsage);
  }, [open]);

  const set =
    <K extends keyof Settings>(key: K) =>
    (value: Settings[K]) =>
      s.set(key, value);
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

  return (
    <Sheet open={open} title="設定" onClose={onClose}>
      <section>
        <h3 className="mb-1 text-[11px] font-semibold tracking-widest text-[var(--color-mist)] uppercase">
          音声認識
        </h3>

        <Row label="エンジン" hint="自動なら、オンライン時はクラウド、圏外なら端末内に切り替わります。">
          <Select
            label="エンジン"
            value={s.engine}
            onChange={set('engine')}
            options={[
              { value: 'auto' as const, label: '自動' },
              { value: 'cloud-whisper' as const, label: 'Cloud Whisper' },
              { value: 'local-whisper' as const, label: '端末内 Whisper' },
            ]}
          />
        </Row>

        <Row label="言語" hint="話す言語。自動判定はやや精度が落ちます。">
          <Select label="言語" value={s.language} onChange={set('language')} options={LANGUAGES} />
        </Row>

        <Row
          label="リアルタイム字幕"
          hint={
            liveCaptionsSupported()
              ? '話している最中に文字を表示します。保存される本文は Whisper の結果です。'
              : 'このブラウザは対応していません。'
          }
        >
          <Toggle label="リアルタイム字幕" value={s.liveCaptions} onChange={set('liveCaptions')} />
        </Row>

        <Row label="録音後に AI で整える" hint="フィラーと言い直しを削り、見出しとタグを付けます。">
          <Toggle label="録音後に AI で整える" value={s.autoRefine} onChange={set('autoRefine')} />
        </Row>

        <Row
          label="ブラウザの音声処理"
          hint="エコー除去・ノイズ抑制・自動ゲイン。静かな部屋では切ったほうが素直な音になります。"
        >
          <Toggle
            label="ブラウザの音声処理"
            value={s.browserProcessing}
            onChange={set('browserProcessing')}
          />
        </Row>

        <Row label="無音で自動停止" hint="話し終わってからこの時間が経つと、自動で録音を閉じます。">
          <Select
            label="無音で自動停止"
            value={s.autoStopSilenceMs}
            onChange={set('autoStopSilenceMs')}
            options={[
              { value: 0, label: 'しない' },
              { value: 2000, label: '2 秒' },
              { value: 4000, label: '4 秒' },
              { value: 8000, label: '8 秒' },
            ]}
          />
        </Row>
      </section>

      <section className="mt-6">
        <h3 className="mb-1 text-[11px] font-semibold tracking-widest text-[var(--color-mist)] uppercase">
          保存
        </h3>

        <Row label="音声をサーバーに保管" hint="R2 に元音声を残します。既定では 14 日で自動削除。">
          <Toggle
            label="音声をサーバーに保管"
            value={s.storeAudioRemote}
            onChange={set('storeAudioRemote')}
          />
        </Row>

        <Row label="音声を端末にも残す" hint="オフラインでも聴き返せます。7 日で自動的に整理されます。">
          <Toggle label="音声を端末にも残す" value={s.keepAudioLocal} onChange={set('keepAudioLocal')} />
        </Row>

        <Row label="バイブレーション">
          <Toggle label="バイブレーション" value={s.haptics} onChange={set('haptics')} />
        </Row>

        {usage && (
          <Row label="この端末の使用量" hint={`${mb(usage.usage)} / ${mb(usage.quota)}`}>
            <span className="text-[12px] text-[var(--color-mist)]">
              {usage.quota ? `${((usage.usage / usage.quota) * 100).toFixed(1)}%` : '—'}
            </span>
          </Row>
        )}
      </section>

      <section className="mt-6">
        <h3 className="mb-1 text-[11px] font-semibold tracking-widest text-[var(--color-mist)] uppercase">
          端末内モデル
        </h3>
        <Row
          label="Whisper を先に取得しておく"
          hint="初回だけモデルをダウンロードします。以後は圏外でも文字起こしできます。"
        >
          <button
            type="button"
            disabled={preloading}
            onClick={async () => {
              setPreloading(true);
              try {
                const tier = await preloadLocalWhisper();
                toast(`端末内モデルを準備しました（${tier === 'webgpu' ? 'WebGPU' : 'WASM'}）`, 'ok');
              } catch {
                toast('モデルを取得できませんでした', 'error');
              } finally {
                setPreloading(false);
              }
            }}
            className="focus-ring rounded-lg border border-[var(--color-edge)] px-3 py-1.5 text-[12px] disabled:opacity-50"
          >
            {preloading ? '取得中…' : '取得する'}
          </button>
        </Row>
      </section>

      <section className="mt-6 text-[11.5px] leading-relaxed text-[var(--color-mist)]">
        <p>文字起こし: {session?.asrModel ?? '—'}</p>
        <p>整理: {session?.llmModel ?? '—'}</p>
        <p>タイムゾーン: {session?.timezone ?? '—'}</p>
        {session?.authRequired && (
          <button
            type="button"
            onClick={() => void logout()}
            className="focus-ring mt-3 rounded-lg border border-[var(--color-edge)] px-3 py-1.5 text-[12px] text-[var(--color-ember)]"
          >
            ログアウト
          </button>
        )}
      </section>
    </Sheet>
  );
}
