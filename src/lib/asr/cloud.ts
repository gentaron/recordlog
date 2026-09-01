import type { TranscribeResponse } from '@shared/types';
import { AsrError, type AsrEngine, type AsrInput, type AsrProgress, type AsrResult } from './types';

/**
 * Whisper large-v3-turbo on Cloudflare Workers AI.
 *
 * This is the default: best accuracy per byte uploaded, nothing to download,
 * and it runs inside the free Workers AI daily allowance.
 */
export const cloudWhisper: AsrEngine = {
  id: 'cloud-whisper',
  label: 'Cloud Whisper',
  description: 'Workers AI の Whisper large-v3-turbo。いちばん精度が高く、端末に負荷をかけない。',

  async isAvailable() {
    return typeof navigator === 'undefined' ? true : navigator.onLine;
  },

  async transcribe(input: AsrInput, onProgress?: (p: AsrProgress) => void): Promise<AsrResult> {
    onProgress?.({ phase: 'uploading' });

    const form = new FormData();
    form.append('audio', input.wav, 'take.wav');
    form.append('language', input.language);
    form.append('durationMs', String(input.durationMs));
    form.append('storeAudio', input.storeAudio ? '1' : '0');

    let res: Response;
    try {
      res = await fetch('/api/transcribe', {
        method: 'POST',
        body: form,
        signal: input.signal ?? null,
        credentials: 'same-origin',
      });
    } catch (cause) {
      throw new AsrError('サーバーに届きませんでした', 'cloud-whisper', cause);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AsrError(`文字起こしに失敗しました (${res.status}) ${detail}`.trim(), 'cloud-whisper');
    }

    onProgress?.({ phase: 'transcribing' });
    const data = (await res.json()) as TranscribeResponse;
    return {
      text: (data.text ?? '').trim(),
      lang: data.lang || input.language,
      engine: 'cloud-whisper',
      segments: data.segments,
      audioKey: data.audioKey ?? null,
    };
  },
};
