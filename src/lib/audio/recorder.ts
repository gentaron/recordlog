import { createResampler, concatFloat32 } from './resample';
import { normalize, trimSilence, peakOf, rmsOf } from './dsp';
import { encodeWav } from './wav';

export const TARGET_RATE = 16_000;

export interface LevelSnapshot {
  /** 0..1, smoothed, for the meter. */
  rms: number;
  peak: number;
  /** How far above the tracked noise floor we are, in dB. */
  snrDb: number;
  speaking: boolean;
  /** Milliseconds since the last voiced frame. */
  silenceMs: number;
  /** Samples that hit full scale — a nonzero, growing count means "back off". */
  clipped: number;
  seconds: number;
}

export interface CaptureResult {
  /** Conditioned mono audio at {@link TARGET_RATE}. */
  audio: Float32Array;
  wav: Blob;
  durationMs: number;
  sampleRate: number;
  peak: number;
  rms: number;
  /** True when the take contains no detectable speech. */
  silent: boolean;
}

export interface RecorderEvents {
  onLevel?: (level: LevelSnapshot) => void;
  onSpeaking?: (speaking: boolean) => void;
  /** Fired when a long pause suggests the thought ended. */
  onAutoStop?: () => void;
  onError?: (error: Error) => void;
}

export interface RecorderOptions extends RecorderEvents {
  /** Stop by itself after this much continuous silence. 0 disables. */
  autoStopSilenceMs?: number;
  /** Hard cap so a forgotten recording can't eat the device. */
  maxDurationMs?: number;
  /** Let the browser's own AEC/NS/AGC run. Off gives Whisper a rawer, better signal. */
  browserProcessing?: boolean;
}

const WORKLET_URL = '/worklets/capture-processor.js';

/** Nothing above this many samples is kept in memory (≈ 30 min at 48 kHz). */
const MAX_SAMPLES = 48_000 * 60 * 30;

export class Recorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private wakeLock: WakeLockSentinel | null = null;

  private blocks: Float32Array[] = [];
  private sampleCount = 0;
  private startedAt = 0;
  private pausedAt: number | null = null;
  private pausedMs = 0;
  private everSpoke = false;
  private stopping: Promise<CaptureResult> | null = null;
  private resolveStop: ((r: CaptureResult) => void) | null = null;

  readonly options: RecorderOptions;
  state: 'idle' | 'recording' | 'paused' | 'stopping' = 'idle';

  constructor(options: RecorderOptions = {}) {
    this.options = {
      autoStopSilenceMs: 0,
      maxDurationMs: 15 * 60 * 1000,
      browserProcessing: true,
      ...options,
    };
  }

  static get supported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof AudioWorkletNode !== 'undefined'
    );
  }

  /** The raw context rate — useful for showing the user what the device gave us. */
  get inputSampleRate(): number {
    return this.ctx?.sampleRate ?? 0;
  }

  get elapsedMs(): number {
    if (!this.startedAt) return 0;
    const end = this.pausedAt ?? Date.now();
    return end - this.startedAt - this.pausedMs;
  }

  /** Live spectrum for the visualiser. Returns null when not recording. */
  readFrequencies(target: Uint8Array): boolean {
    if (!this.analyser) return false;
    this.analyser.getByteFrequencyData(target as Uint8Array<ArrayBuffer>);
    return true;
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') throw new Error('recorder is already running');
    if (!Recorder.supported) throw new Error('この端末はブラウザ録音に対応していません');

    const p = this.options.browserProcessing !== false;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48_000 },
        echoCancellation: p,
        noiseSuppression: p,
        autoGainControl: p,
      },
      video: false,
    });

    const Ctx: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    await this.ctx.audioWorklet.addModule(WORKLET_URL);

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.72;

    this.node = new AudioWorkletNode(this.ctx, 'capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      processorOptions: { hangoverMs: 620, openDb: 9, closeDb: 5 },
    });
    this.node.port.onmessage = (e) => this.onWorkletMessage(e.data);

    this.source.connect(this.analyser);
    this.source.connect(this.node);

    this.blocks = [];
    this.sampleCount = 0;
    this.pausedMs = 0;
    this.pausedAt = null;
    this.everSpoke = false;
    this.startedAt = Date.now();
    this.state = 'recording';

    void this.acquireWakeLock();
  }

  pause(): void {
    if (this.state !== 'recording') return;
    this.state = 'paused';
    this.pausedAt = Date.now();
    void this.ctx?.suspend();
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    if (this.pausedAt) this.pausedMs += Date.now() - this.pausedAt;
    this.pausedAt = null;
    this.state = 'recording';
    await this.ctx?.resume();
  }

  /** Stops, conditions the audio, and hands back a ready-to-transcribe take. */
  stop(): Promise<CaptureResult> {
    if (this.stopping) return this.stopping;
    if (this.state === 'idle') return Promise.resolve(this.finish());

    this.state = 'stopping';
    this.stopping = new Promise<CaptureResult>((resolve) => {
      this.resolveStop = resolve;
      // The worklet answers with a final block; if the graph is already gone,
      // don't hang the UI on it.
      const timer = setTimeout(() => this.settle(), 400);
      this.settleTimer = timer;
      try {
        void this.ctx?.resume().then(() => this.node?.port.postMessage('stop'));
      } catch {
        this.settle();
      }
    });
    return this.stopping;
  }

  /** Throws the take away and releases the microphone. */
  cancel(): void {
    this.teardown();
    this.blocks = [];
    this.sampleCount = 0;
    this.state = 'idle';
    this.stopping = null;
    this.resolveStop = null;
  }

  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  private onWorkletMessage(msg: {
    type: 'audio' | 'level' | 'vad';
    samples?: Float32Array;
    final?: boolean;
    speaking?: boolean;
    rms?: number;
    peak?: number;
    snrDb?: number;
    silenceMs?: number;
    clipped?: number;
    seconds?: number;
  }): void {
    if (msg.type === 'audio') {
      const s = msg.samples;
      if (s && s.length && this.sampleCount < MAX_SAMPLES) {
        this.blocks.push(s);
        this.sampleCount += s.length;
      }
      if (msg.final) this.settle();
      return;
    }

    if (msg.type === 'vad') {
      if (msg.speaking) this.everSpoke = true;
      this.options.onSpeaking?.(!!msg.speaking);
      return;
    }

    const level: LevelSnapshot = {
      rms: msg.rms ?? 0,
      peak: msg.peak ?? 0,
      snrDb: msg.snrDb ?? 0,
      speaking: !!msg.speaking,
      silenceMs: msg.silenceMs ?? 0,
      clipped: msg.clipped ?? 0,
      seconds: msg.seconds ?? 0,
    };
    this.options.onLevel?.(level);

    if (this.state !== 'recording') return;

    const auto = this.options.autoStopSilenceMs ?? 0;
    if (auto > 0 && this.everSpoke && level.silenceMs >= auto) {
      this.options.onAutoStop?.();
      return;
    }
    const max = this.options.maxDurationMs ?? 0;
    if (max > 0 && this.elapsedMs >= max) this.options.onAutoStop?.();
  }

  private settle(): void {
    if (!this.resolveStop) return;
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    const resolve = this.resolveStop;
    this.resolveStop = null;
    const result = this.finish();
    this.teardown();
    this.state = 'idle';
    this.stopping = null;
    resolve(result);
  }

  private finish(): CaptureResult {
    const rate = this.ctx?.sampleRate || 48_000;
    const raw = concatFloat32(this.blocks, this.sampleCount);
    this.blocks = [];

    if (raw.length === 0) {
      return {
        audio: new Float32Array(0),
        wav: encodeWav(new Float32Array(0), TARGET_RATE),
        durationMs: 0,
        sampleRate: TARGET_RATE,
        peak: 0,
        rms: 0,
        silent: true,
      };
    }

    const trimmed = trimSilence(raw, rate);
    const resample = createResampler(rate, TARGET_RATE);
    const down = resample(trimmed.audio);
    const audio = normalize(down);

    const peak = peakOf(audio);
    const rms = rmsOf(audio);
    return {
      audio,
      wav: encodeWav(audio, TARGET_RATE),
      durationMs: Math.round((audio.length / TARGET_RATE) * 1000),
      sampleRate: TARGET_RATE,
      peak,
      rms,
      silent: !this.everSpoke || rms < 1.2e-3,
    };
  }

  private teardown(): void {
    try {
      this.node?.port.close();
    } catch {
      /* already closed */
    }
    this.node?.disconnect();
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.node = null;
    this.source = null;
    this.analyser = null;
    this.stream = null;
    this.ctx = null;
    void this.releaseWakeLock();
  }

  private async acquireWakeLock(): Promise<void> {
    try {
      this.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      // Denied or unsupported — recording still works, the screen may just sleep.
      this.wakeLock = null;
    }
  }

  private async releaseWakeLock(): Promise<void> {
    try {
      await this.wakeLock?.release();
    } catch {
      /* ignore */
    }
    this.wakeLock = null;
  }
}
