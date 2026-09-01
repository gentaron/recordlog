/**
 * Synthesizes speech-shaped audio for the end-to-end capture test.
 *
 * Chromium's built-in fake microphone is a pure tone, which a speech VAD is
 * right to reject. This makes something with the two properties that actually
 * matter: formant resonances, and a ~4.5 Hz syllable envelope.
 *
 *   node scripts/make-speech.mjs tests/e2e/artifacts/speech.wav
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const RATE = 48000;
const SECONDS = 6;
const n = RATE * SECONDS;
const buf = new Float32Array(n);

let f1a = 0,
  f1b = 0,
  f2a = 0,
  f2b = 0;
const reson = (x, freq, q, a1, a2) => {
  const r = Math.exp((-Math.PI * freq) / (q * RATE));
  const c = 2 * r * Math.cos((2 * Math.PI * freq) / RATE);
  const y = x + c * a1 - r * r * a2;
  return y;
};

for (let i = 0; i < n; i++) {
  const t = i / RATE;
  // Two spoken phrases with a pause between them.
  const voiced = (t > 0.6 && t < 2.6) || (t > 3.2 && t < 5.4);
  if (!voiced) {
    buf[i] = (Math.random() - 0.5) * 0.0008;
    continue;
  }

  // Glottal-ish buzz at a wobbling 120 Hz.
  const f0 = 120 + 12 * Math.sin(2 * Math.PI * 0.7 * t);
  const phase = (t * f0) % 1;
  const excite = (phase < 0.12 ? 1 : -0.08) + (Math.random() - 0.5) * 0.25;

  const y1 = reson(excite, 700, 9, f1a, f1b);
  f1b = f1a;
  f1a = y1;
  const y2 = reson(excite, 1800, 12, f2a, f2b);
  f2b = f2a;
  f2a = y2;

  // Syllable envelope ~4.5 Hz — this is what an energy VAD keys off.
  const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4.5 * t - Math.PI / 2);
  buf[i] = (y1 * 0.06 + y2 * 0.03) * (0.25 + 0.75 * env);
}

let peak = 0;
for (const v of buf) peak = Math.max(peak, Math.abs(v));
const gain = 0.6 / (peak || 1);

const out = Buffer.alloc(44 + n * 2);
out.write('RIFF', 0);
out.writeUInt32LE(36 + n * 2, 4);
out.write('WAVE', 8);
out.write('fmt ', 12);
out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20);
out.writeUInt16LE(1, 22);
out.writeUInt32LE(RATE, 24);
out.writeUInt32LE(RATE * 2, 28);
out.writeUInt16LE(2, 32);
out.writeUInt16LE(16, 34);
out.write('data', 36);
out.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) {
  const s = Math.max(-1, Math.min(1, buf[i] * gain));
  out.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
}
const out_path = process.argv[2] ?? 'tests/e2e/artifacts/speech.wav';
mkdirSync(dirname(out_path), { recursive: true });
writeFileSync(out_path, out);
console.log('wrote', out_path, `${(out.length / 1024).toFixed(0)} KB`);
