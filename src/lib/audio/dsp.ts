/**
 * Post-capture conditioning. Everything here runs once, on the finished
 * recording, and is tuned for one job: give the speech model the cleanest
 * possible 16 kHz mono signal.
 */

/** Peak level of a buffer, in linear amplitude. */
export function peakOf(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]!);
    if (a > p) p = a;
  }
  return p;
}

export function rmsOf(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i]! * buf[i]!;
  return Math.sqrt(s / Math.max(1, buf.length));
}

/**
 * Brings quiet recordings up without crushing loud ones.
 * Targets -1 dBFS peak but never applies more than `maxGainDb`, so a nearly
 * silent room stays silent instead of becoming a wall of amplified hiss.
 */
export function normalize(buf: Float32Array, maxGainDb = 20, targetPeak = 0.89): Float32Array {
  const peak = peakOf(buf);
  if (peak < 1e-5) return buf;
  const maxGain = 10 ** (maxGainDb / 20);
  const gain = Math.min(maxGain, targetPeak / peak);
  if (gain > 0.999 && gain < 1.001) return buf;
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]! * gain;
    // Soft clip only on the way past full scale; transparent below it.
    out[i] = v > 1 || v < -1 ? Math.tanh(v) : v;
  }
  return out;
}

export interface TrimResult {
  audio: Float32Array;
  /** Seconds removed from the head. */
  leadingTrimmed: number;
  trailingTrimmed: number;
}

/**
 * Trims dead air from both ends using an energy threshold relative to the
 * recording's own noise floor, keeping a short pad so words are never clipped.
 */
export function trimSilence(buf: Float32Array, rate: number, padMs = 180): TrimResult {
  const win = Math.max(1, Math.floor((rate * 20) / 1000)); // 20 ms windows
  const frames = Math.floor(buf.length / win);
  if (frames < 3) return { audio: buf, leadingTrimmed: 0, trailingTrimmed: 0 };

  const energies = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = 0; i < win; i++) s += buf[f * win + i]! ** 2;
    energies[f] = Math.sqrt(s / win);
  }

  // Noise floor = 20th percentile; speech gate = 4x that, floored so a truly
  // silent take doesn't get gated on numerical dust.
  const sorted = Float32Array.from(energies).sort();
  const floor = Math.max(sorted[Math.floor(frames * 0.2)] ?? 0, 1e-5);
  const gate = Math.max(floor * 4, 2e-4);

  let first = 0;
  while (first < frames && energies[first]! < gate) first++;
  if (first === frames) return { audio: buf, leadingTrimmed: 0, trailingTrimmed: 0 };
  let last = frames - 1;
  while (last > first && energies[last]! < gate) last--;

  const pad = Math.floor((rate * padMs) / 1000);
  const start = Math.max(0, first * win - pad);
  const end = Math.min(buf.length, (last + 1) * win + pad);
  return {
    audio: buf.subarray(start, end),
    leadingTrimmed: start / rate,
    trailingTrimmed: (buf.length - end) / rate,
  };
}
