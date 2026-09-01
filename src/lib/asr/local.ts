import { AsrError, type AsrEngine, type AsrInput, type AsrProgress, type AsrResult } from './types';

interface WorkerReply {
  id?: number;
  type: 'loaded' | 'result' | 'progress' | 'error' | 'disposed';
  text?: string;
  tier?: 'webgpu' | 'wasm';
  segments?: { start: number; end: number; text: string }[];
  message?: string;
  file?: string;
  loaded?: number;
  total?: number;
}

let worker: Worker | null = null;
let seq = 0;

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker('/workers/whisper-worker.js', { type: 'module', name: 'whisper' });
  }
  return worker;
}

export function disposeLocalWhisper(): void {
  worker?.terminate();
  worker = null;
}

async function call(
  type: 'load' | 'transcribe',
  payload: Record<string, unknown>,
  onProgress?: (p: AsrProgress) => void,
  transfer: Transferable[] = [],
): Promise<WorkerReply> {
  const w = ensureWorker();
  const id = ++seq;

  return new Promise<WorkerReply>((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerReply>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        const ratio = msg.total ? (msg.loaded ?? 0) / msg.total : undefined;
        onProgress?.({
          phase: 'loading-model',
          ...(ratio !== undefined ? { ratio } : {}),
          ...(msg.file ? { detail: msg.file } : {}),
        });
        return;
      }
      if (msg.id !== id) return;
      w.removeEventListener('message', onMessage);
      if (msg.type === 'error') reject(new AsrError(msg.message ?? 'unknown error', 'local-whisper'));
      else resolve(msg);
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, type, payload }, transfer);
  });
}

/** Warms the model up so the first real recording isn't the one that waits. */
export async function preloadLocalWhisper(onProgress?: (p: AsrProgress) => void): Promise<string> {
  const reply = await call('load', {}, onProgress);
  return reply.tier ?? 'wasm';
}

/**
 * Whisper running entirely in the browser via transformers.js (WebGPU when the
 * device has it). Free, private, and works with the network switched off — the
 * cost is a one-time model download.
 */
export const localWhisper: AsrEngine = {
  id: 'local-whisper',
  label: 'On-device Whisper',
  description: '端末の中だけで動く Whisper。音声を一切外に出さない。初回だけモデルを取得する。',

  async isAvailable() {
    return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
  },

  async transcribe(input: AsrInput, onProgress?: (p: AsrProgress) => void): Promise<AsrResult> {
    onProgress?.({ phase: 'loading-model' });
    // The worker takes ownership of the samples, so hand it a copy.
    const audio = input.audio.slice();
    const reply = await call(
      'transcribe',
      {
        audio,
        language: input.language === 'auto' ? null : input.language.split('-')[0],
      },
      onProgress,
      [audio.buffer],
    );
    onProgress?.({ phase: 'transcribing' });

    return {
      text: (reply.text ?? '').trim(),
      lang: input.language,
      engine: 'local-whisper',
      ...(reply.segments ? { segments: reply.segments } : {}),
      audioKey: null,
    };
  },
};
