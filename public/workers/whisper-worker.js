/**
 * On-device Whisper, for when you want the audio to never leave the phone
 * (or when the network is gone). Loads transformers.js from a CDN at first use
 * so none of this weight lands in the app bundle.
 *
 * Tiering:
 *   WebGPU  -> whisper-large-v3-turbo  (state of the art, ~800 MB, cached by the browser)
 *   WASM    -> whisper-base            (~80 MB, still solid for close-mic speech)
 */

// Pinned deliberately: the 3.x pipeline API is what this file is written against.
const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

const MODELS = {
  webgpu: {
    id: 'onnx-community/whisper-large-v3-turbo',
    device: 'webgpu',
    dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
  },
  wasm: {
    id: 'onnx-community/whisper-base',
    device: 'wasm',
    dtype: 'q8',
  },
};

let transcriber = null;
let loadedTier = null;

async function hasWebGPU() {
  try {
    if (!navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

async function load(preferredTier) {
  const tier = preferredTier ?? ((await hasWebGPU()) ? 'webgpu' : 'wasm');
  if (transcriber && loadedTier === tier) return tier;

  const { pipeline, env } = await import(/* webpackIgnore: true */ `${TRANSFORMERS}`);
  env.allowLocalModels = false;
  env.useBrowserCache = true;

  const cfg = MODELS[tier];
  transcriber = await pipeline('automatic-speech-recognition', cfg.id, {
    device: cfg.device,
    dtype: cfg.dtype,
    progress_callback: (p) => {
      if (p.status === 'progress' || p.status === 'done' || p.status === 'initiate') {
        self.postMessage({
          type: 'progress',
          file: p.file,
          status: p.status,
          loaded: p.loaded ?? 0,
          total: p.total ?? 0,
        });
      }
    },
  });
  loadedTier = tier;
  return tier;
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data ?? {};
  try {
    if (type === 'load') {
      const tier = await load(payload?.tier);
      self.postMessage({ id, type: 'loaded', tier });
      return;
    }

    if (type === 'transcribe') {
      const tier = await load(payload?.tier);
      const audio = payload.audio; // Float32Array @ 16 kHz
      const out = await transcriber(audio, {
        // Whisper's own window; longer audio is chunked with overlap so words
        // straddling a boundary are not lost.
        chunk_length_s: 30,
        stride_length_s: 5,
        language: payload.language || null,
        task: 'transcribe',
        return_timestamps: true,
        temperature: 0,
        no_repeat_ngram_size: 6,
      });

      const chunks = Array.isArray(out?.chunks) ? out.chunks : [];
      self.postMessage({
        id,
        type: 'result',
        text: (out?.text ?? '').trim(),
        tier,
        segments: chunks.map((c) => ({
          start: c.timestamp?.[0] ?? 0,
          end: c.timestamp?.[1] ?? 0,
          text: (c.text ?? '').trim(),
        })),
      });
      return;
    }

    if (type === 'dispose') {
      transcriber = null;
      loadedTier = null;
      self.postMessage({ id, type: 'disposed' });
      return;
    }
  } catch (error) {
    self.postMessage({ id, type: 'error', message: String(error?.message ?? error) });
  }
};
