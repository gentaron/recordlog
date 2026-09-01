/**
 * RecordLog capture processor.
 *
 * Runs on the audio rendering thread so nothing on the main thread — layout,
 * React, garbage collection — can drop a sample. Per 128-frame quantum it:
 *
 *   1. removes DC offset with a one-pole high-pass (kills the mic rumble that
 *      wrecks Whisper's first token),
 *   2. tracks a percentile-ish adaptive noise floor,
 *   3. decides speech / silence with hysteresis + hangover,
 *   4. batches samples into 2048-frame blocks and transfers them out.
 *
 * The main thread only ever sees already-clean blocks plus cheap telemetry.
 */

const BLOCK = 2048;
const TELEMETRY_EVERY = 4; // ~11 ms * 4 at 48 kHz

class CaptureProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [];
  }

  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};

    /** Speech starts when level rises this many dB above the noise floor. */
    this.openDb = o.openDb ?? 9;
    /** ...and ends only once it falls back to within this many dB. */
    this.closeDb = o.closeDb ?? 5;
    /** Keep the gate open this long after the last voiced quantum. */
    this.hangoverMs = o.hangoverMs ?? 620;
    /** Ignore blips shorter than this so keyboard clicks don't open the gate. */
    this.onsetMs = o.onsetMs ?? 90;

    this.buffer = new Float32Array(BLOCK);
    this.filled = 0;

    this.hpPrevIn = 0;
    this.hpPrevOut = 0;
    // ~30 Hz high-pass at typical rates.
    this.hpCoeff = Math.exp((-2 * Math.PI * 30) / sampleRate);

    this.noiseFloor = 1e-4;
    this.speaking = false;
    this.voicedRun = 0;
    this.silenceRun = 0;
    /** Milliseconds since the last quantum that looked like voice, gate aside. */
    this.sinceVoiceMs = 0;
    this.peakHold = 0;
    this.quantum = 0;
    this.totalFrames = 0;
    this.clipped = 0;
    this.running = true;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg === 'stop') {
        this.flush(true);
        this.running = false;
      } else if (msg === 'flush') {
        this.flush(false);
      }
    };
  }

  flush(final) {
    if (this.filled > 0) {
      const out = this.buffer.slice(0, this.filled);
      this.port.postMessage({ type: 'audio', samples: out, final: !!final }, [out.buffer]);
      this.filled = 0;
    } else if (final) {
      this.port.postMessage({ type: 'audio', samples: new Float32Array(0), final: true });
    }
  }

  process(inputs) {
    if (!this.running) return false;

    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Down-mix whatever the device gives us to mono.
    const chCount = input.length;
    const ch0 = input[0];
    if (!ch0) return true;
    const n = ch0.length;
    const quantumMs = (n / sampleRate) * 1000;

    let sumSq = 0;
    let peak = 0;

    for (let i = 0; i < n; i++) {
      let s = ch0[i];
      for (let c = 1; c < chCount; c++) s += input[c][i];
      s /= chCount;

      // One-pole DC blocker: y[n] = a*(y[n-1] + x[n] - x[n-1])
      const y = this.hpCoeff * (this.hpPrevOut + s - this.hpPrevIn);
      this.hpPrevIn = s;
      this.hpPrevOut = y;

      const a = y < 0 ? -y : y;
      if (a > peak) peak = a;
      if (a >= 0.999) this.clipped++;
      sumSq += y * y;

      this.buffer[this.filled++] = y;
      if (this.filled === BLOCK) {
        const out = this.buffer.slice(0);
        this.port.postMessage({ type: 'audio', samples: out, final: false }, [out.buffer]);
        this.filled = 0;
      }
    }

    this.totalFrames += n;

    const rms = Math.sqrt(sumSq / n) + 1e-9;
    // Noise floor tracks down fast and up slowly: it should follow the room,
    // not the speaker.
    const alpha = rms < this.noiseFloor ? 0.15 : 0.0015;
    this.noiseFloor = this.noiseFloor + alpha * (rms - this.noiseFloor);
    if (this.noiseFloor < 1e-5) this.noiseFloor = 1e-5;

    const snrDb = 20 * Math.log10(rms / this.noiseFloor);
    this.sinceVoiceMs = snrDb > this.closeDb ? 0 : this.sinceVoiceMs + quantumMs;

    if (this.speaking) {
      if (snrDb < this.closeDb) {
        this.silenceRun += quantumMs;
        if (this.silenceRun >= this.hangoverMs) {
          this.speaking = false;
          this.voicedRun = 0;
          this.port.postMessage({ type: 'vad', speaking: false, at: this.totalFrames / sampleRate });
        }
      } else {
        this.silenceRun = 0;
      }
    } else {
      if (snrDb > this.openDb) {
        this.voicedRun += quantumMs;
        if (this.voicedRun >= this.onsetMs) {
          this.speaking = true;
          this.silenceRun = 0;
          this.port.postMessage({ type: 'vad', speaking: true, at: this.totalFrames / sampleRate });
        }
      } else {
        this.voicedRun = 0;
      }
    }

    this.peakHold = peak > this.peakHold ? peak : this.peakHold * 0.86;

    if (++this.quantum % TELEMETRY_EVERY === 0) {
      this.port.postMessage({
        type: 'level',
        rms,
        peak: this.peakHold,
        snrDb,
        noiseFloor: this.noiseFloor,
        speaking: this.speaking,
        silenceMs: this.sinceVoiceMs,
        clipped: this.clipped,
        seconds: this.totalFrames / sampleRate,
      });
    }

    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
