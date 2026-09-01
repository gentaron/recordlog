import type { AsrEngineId } from '@shared/types';
import { cloudWhisper } from './cloud';
import { localWhisper } from './local';
import { AsrError, type AsrEngine, type AsrInput, type AsrProgress, type AsrResult } from './types';

export * from './types';
export { cloudWhisper } from './cloud';
export { localWhisper, preloadLocalWhisper, disposeLocalWhisper } from './local';
export { LiveCaptions, liveCaptionsSupported } from './live';

export type EnginePreference = 'auto' | 'cloud-whisper' | 'local-whisper';

const ENGINES: Record<'cloud-whisper' | 'local-whisper', AsrEngine> = {
  'cloud-whisper': cloudWhisper,
  'local-whisper': localWhisper,
};

export const engineLabel = (id: AsrEngineId): string =>
  id === 'cloud-whisper'
    ? 'Cloud Whisper'
    : id === 'local-whisper'
      ? 'On-device Whisper'
      : id === 'web-speech'
        ? 'ブラウザ音声認識'
        : '手入力';

/**
 * Runs the preferred engine and falls back rather than losing a thought:
 * offline or a failing Worker drops to on-device Whisper, and a device that
 * cannot run the model comes back to the cloud.
 */
export async function transcribe(
  input: AsrInput,
  preference: EnginePreference = 'auto',
  onProgress?: (p: AsrProgress) => void,
): Promise<AsrResult> {
  const order: ('cloud-whisper' | 'local-whisper')[] =
    preference === 'local-whisper'
      ? ['local-whisper', 'cloud-whisper']
      : preference === 'cloud-whisper'
        ? ['cloud-whisper']
        : navigator.onLine
          ? ['cloud-whisper', 'local-whisper']
          : ['local-whisper', 'cloud-whisper'];

  let last: unknown;
  for (const id of order) {
    const engine = ENGINES[id];
    if (!(await engine.isAvailable())) continue;
    try {
      const result = await engine.transcribe(input, onProgress);
      if (result.text) return result;
      // An empty transcript from a take with audio in it means the engine gave
      // up; let the next one try before we call it silence.
      last = new AsrError('音声を認識できませんでした', id);
    } catch (error) {
      last = error;
      if (input.signal?.aborted) throw error;
    }
  }
  throw last instanceof Error ? last : new AsrError('利用できる音声認識エンジンがありません', 'manual');
}
