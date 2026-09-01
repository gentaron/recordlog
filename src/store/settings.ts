import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { EnginePreference } from '@/lib/asr';

export interface Settings {
  /** Which speech engine to reach for first. */
  engine: EnginePreference;
  /** BCP-47 tag, or `auto` to let the model decide. */
  language: string;
  /** Show words as they are spoken (Web Speech API, where available). */
  liveCaptions: boolean;
  /** Keep the original audio in R2 so you can re-listen later. */
  storeAudioRemote: boolean;
  /** Keep a copy on the device too (pruned after a week). */
  keepAudioLocal: boolean;
  /** Run the AI tidy-up on every memo as soon as it is transcribed. */
  autoRefine: boolean;
  /** Stop recording after this much silence. 0 = never. */
  autoStopSilenceMs: number;
  /** Let the browser apply echo cancellation / noise suppression / AGC. */
  browserProcessing: boolean;
  haptics: boolean;
}

const DEFAULTS: Settings = {
  engine: 'auto',
  language: 'ja-JP',
  liveCaptions: true,
  storeAudioRemote: true,
  keepAudioLocal: true,
  autoRefine: true,
  autoStopSilenceMs: 0,
  browserProcessing: true,
  haptics: true,
};

interface SettingsStore extends Settings {
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  reset(): void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (key, value) => set({ [key]: value } as Pick<Settings, typeof key>),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'recordlog:settings',
      version: 1,
      partialize: ({ set: _set, reset: _reset, ...rest }) => rest,
    },
  ),
);

export const LANGUAGES: { value: string; label: string }[] = [
  { value: 'ja-JP', label: '日本語' },
  { value: 'en-US', label: 'English' },
  { value: 'zh-CN', label: '中文' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'auto', label: '自動判定' },
];

export function haptic(pattern: number | number[] = 12): void {
  if (!useSettings.getState().haptics) return;
  navigator.vibrate?.(pattern);
}
