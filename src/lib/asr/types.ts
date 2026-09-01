import type { AsrEngineId } from '@shared/types';

export interface AsrSegment {
  start: number;
  end: number;
  text: string;
}

export interface AsrResult {
  text: string;
  lang: string;
  engine: AsrEngineId;
  segments?: AsrSegment[];
  /** Only set by engines that upload the audio. */
  audioKey?: string | null;
}

export interface AsrInput {
  /** Conditioned 16 kHz mono audio. */
  audio: Float32Array;
  wav: Blob;
  durationMs: number;
  /** BCP-47 hint, or `auto`. */
  language: string;
  /** Keep the original audio server-side. */
  storeAudio: boolean;
  signal?: AbortSignal;
}

export interface AsrProgress {
  phase: 'loading-model' | 'uploading' | 'transcribing';
  /** 0..1 when known. */
  ratio?: number;
  detail?: string;
}

export interface AsrEngine {
  readonly id: AsrEngineId;
  readonly label: string;
  readonly description: string;
  /** Whether this engine can run right now on this device/network. */
  isAvailable(): Promise<boolean>;
  transcribe(input: AsrInput, onProgress?: (p: AsrProgress) => void): Promise<AsrResult>;
}

export class AsrError extends Error {
  constructor(
    message: string,
    readonly engine: AsrEngineId,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AsrError';
  }
}
