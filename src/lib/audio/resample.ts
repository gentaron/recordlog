/**
 * Kaiser-windowed polyphase sinc resampler.
 *
 * Whisper wants 16 kHz mono. Browsers hand us 44.1/48 kHz. Naive decimation
 * (taking every third sample) folds everything above 8 kHz back into the band
 * as aliasing, which is exactly where sibilants live — it is the single most
 * common reason browser transcripts come back mushy. This does the job
 * properly: a linear-phase low-pass baked into the interpolation kernel.
 */

/** Modified Bessel function of the first kind, order 0. */
function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const halfSq = (x / 2) * (x / 2);
  for (let k = 1; k < 40; k++) {
    term *= halfSq / (k * k);
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}

const sinc = (x: number): number => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

export interface ResamplerOptions {
  /** Filter length. 32 taps ≈ 80 dB stopband with beta 9. */
  taps?: number;
  /** Kaiser beta. Higher = deeper stopband, wider transition. */
  beta?: number;
  /** Sub-sample phases in the polyphase table. */
  phases?: number;
}

/** Builds a reusable kernel; building it is the expensive part, not running it. */
export function createResampler(inRate: number, outRate: number, opts: ResamplerOptions = {}) {
  const taps = opts.taps ?? 32;
  const beta = opts.beta ?? 9;
  const phases = opts.phases ?? 512;
  const half = taps >> 1;
  const ratio = outRate / inRate;

  // Cut just below the lower Nyquist, with a little headroom for the transition.
  const fc = 0.5 * Math.min(1, ratio) * 0.94;
  const denom = besselI0(beta);

  const table = new Float32Array(phases * taps);
  for (let p = 0; p < phases; p++) {
    const frac = p / phases;
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      const d = frac + (half - 1 - j);
      const w = Math.abs(d) >= half ? 0 : besselI0(beta * Math.sqrt(1 - (d / half) ** 2)) / denom;
      const h = 2 * fc * sinc(2 * fc * d) * w;
      table[p * taps + j] = h;
      sum += h;
    }
    // Normalize each phase to unity DC gain so the output level is stable.
    if (sum !== 0) {
      for (let j = 0; j < taps; j++) table[p * taps + j] = table[p * taps + j]! / sum;
    }
  }

  return function resample(input: Float32Array): Float32Array {
    if (inRate === outRate) return input;
    const step = inRate / outRate;
    const outLen = Math.max(0, Math.floor(input.length / step));
    const out = new Float32Array(outLen);
    const len = input.length;

    for (let i = 0; i < outLen; i++) {
      const t = i * step;
      const n0 = Math.floor(t);
      const frac = t - n0;
      const p = Math.min(phases - 1, (frac * phases) | 0) * taps;
      const base = n0 - half + 1;

      let acc = 0;
      if (base >= 0 && base + taps <= len) {
        for (let j = 0; j < taps; j++) acc += input[base + j]! * table[p + j]!;
      } else {
        // Edge clamping keeps the first and last few milliseconds intact.
        for (let j = 0; j < taps; j++) {
          const idx = base + j;
          const s = idx < 0 ? input[0]! : idx >= len ? input[len - 1]! : input[idx]!;
          acc += s * table[p + j]!;
        }
      }
      out[i] = acc;
    }
    return out;
  };
}

/** Concatenates the blocks the worklet streamed to us into one contiguous buffer. */
export function concatFloat32(blocks: Float32Array[], total?: number): Float32Array {
  const len = total ?? blocks.reduce((n, b) => n + b.length, 0);
  const out = new Float32Array(len);
  let off = 0;
  for (const b of blocks) {
    if (off + b.length > len) {
      out.set(b.subarray(0, len - off), off);
      break;
    }
    out.set(b, off);
    off += b.length;
  }
  return out;
}
