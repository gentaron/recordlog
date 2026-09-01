import { describe, expect, it } from 'vitest';
import { createResampler, concatFloat32 } from '@/lib/audio/resample';
import { encodeWav } from '@/lib/audio/wav';
import { normalize, peakOf, rmsOf, trimSilence } from '@/lib/audio/dsp';

const tone = (freq: number, rate: number, seconds: number, amp = 0.5): Float32Array => {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
};

/** Peak magnitude at `freq` via a single-bin Goertzel. */
function magnitudeAt(buf: Float32Array, freq: number, rate: number): number {
  const k = (freq / rate) * buf.length;
  const w = (2 * Math.PI * k) / buf.length;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const s = buf[i]! + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return (2 * Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2)) / buf.length;
}

describe('resampler', () => {
  it('produces the right number of samples for 48k -> 16k', () => {
    const resample = createResampler(48_000, 16_000);
    expect(resample(tone(440, 48_000, 1)).length).toBe(16_000);
  });

  it('passes an in-band tone through at close to unity gain', () => {
    const resample = createResampler(48_000, 16_000);
    const out = resample(tone(1000, 48_000, 0.5, 0.5));
    // Ignore the filter's edge transient at both ends.
    const body = out.subarray(400, out.length - 400);
    expect(magnitudeAt(body, 1000, 16_000)).toBeGreaterThan(0.45);
    expect(peakOf(body)).toBeLessThan(0.62);
  });

  it('rejects content above the new Nyquist instead of aliasing it down', () => {
    // 12 kHz at 48 kHz would fold to 4 kHz at 16 kHz without a proper filter.
    const resample = createResampler(48_000, 16_000);
    const out = resample(tone(12_000, 48_000, 0.5, 0.5));
    const body = out.subarray(400, out.length - 400);
    expect(magnitudeAt(body, 4000, 16_000)).toBeLessThan(0.005);
    expect(rmsOf(body)).toBeLessThan(0.01);
  });

  it('is a no-op when the rates already match', () => {
    const input = tone(440, 16_000, 0.1);
    expect(createResampler(16_000, 16_000)(input)).toBe(input);
  });
});

describe('concatFloat32', () => {
  it('joins streamed blocks in order', () => {
    const out = concatFloat32([new Float32Array([1, 2]), new Float32Array([3]), new Float32Array([4, 5])]);
    expect([...out]).toEqual([1, 2, 3, 4, 5]);
  });

  it('never writes past an explicit total', () => {
    const out = concatFloat32([new Float32Array([1, 2, 3]), new Float32Array([4, 5])], 4);
    expect([...out]).toEqual([1, 2, 3, 4]);
  });
});

describe('normalize', () => {
  it('lifts a quiet take toward full scale', () => {
    const out = normalize(tone(440, 16_000, 0.1, 0.02));
    expect(peakOf(out)).toBeGreaterThan(0.15);
    expect(peakOf(out)).toBeLessThanOrEqual(1);
  });

  it('never applies more than the gain ceiling', () => {
    // 20 dB of gain on a 0.001 peak lands at 0.01, not at the 0.89 target.
    const out = normalize(tone(440, 16_000, 0.1, 0.001), 20);
    expect(peakOf(out)).toBeLessThan(0.02);
  });

  it('pulls a hot take back down without clipping', () => {
    const out = normalize(tone(440, 16_000, 0.1, 0.99));
    expect(peakOf(out)).toBeLessThanOrEqual(0.9);
  });
});

describe('trimSilence', () => {
  it('removes leading and trailing dead air but keeps the speech', () => {
    const rate = 16_000;
    const buf = new Float32Array(rate * 3);
    // One second of tone in the middle of three seconds of silence.
    const speech = tone(300, rate, 1, 0.4);
    buf.set(speech, rate);

    const { audio, leadingTrimmed, trailingTrimmed } = trimSilence(buf, rate);
    expect(leadingTrimmed).toBeGreaterThan(0.5);
    expect(trailingTrimmed).toBeGreaterThan(0.5);
    // The kept region is the speech plus the safety pad on each side.
    expect(audio.length / rate).toBeGreaterThan(1);
    expect(audio.length / rate).toBeLessThan(1.6);
  });

  it('leaves a take that is speech end to end alone', () => {
    const buf = tone(300, 16_000, 1, 0.4);
    expect(trimSilence(buf, 16_000).audio.length).toBe(buf.length);
  });
});

describe('encodeWav', () => {
  it('writes a valid 16-bit mono PCM header', async () => {
    const samples = tone(440, 16_000, 0.05, 0.5);
    const view = new DataView(await encodeWav(samples, 16_000).arrayBuffer());
    const tag = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(o + i)));

    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(tag(12)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000); // byte rate
    expect(view.getUint16(34, true)).toBe(16); // bit depth
    expect(tag(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(view.byteLength).toBe(44 + samples.length * 2);
  });

  it('round-trips sample values within 16-bit precision', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const view = new DataView(await encodeWav(samples, 16_000).arrayBuffer());
    for (let i = 0; i < samples.length; i++) {
      const decoded = view.getInt16(44 + i * 2, true) / 0x7fff;
      expect(Math.abs(decoded - samples[i]!)).toBeLessThan(0.001);
    }
  });
});
