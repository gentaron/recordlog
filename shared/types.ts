/**
 * The wire contract shared by the PWA and the Worker.
 * Anything crossing the network is defined exactly once, here.
 */

/** A single spoken capture, after speech-to-text. */
export interface Memo {
  id: string;
  /** Unix ms of when the recording started. */
  createdAt: number;
  updatedAt: number;
  /** Calendar day the memo belongs to, in the user's timezone: `YYYY-MM-DD`. */
  day: string;
  /** The transcript as it will be shown and stacked. */
  text: string;
  /** The untouched ASR output, kept so a cleanup can always be re-done or undone. */
  rawText: string;
  /** Short label the AI (or the user) gave this memo. */
  title: string | null;
  tags: string[];
  durationMs: number;
  /** BCP-47-ish language tag reported by the recognizer. */
  lang: string;
  /** Which speech engine produced `rawText`. */
  engine: AsrEngineId;
  /** R2 object key for the original audio, when it was kept. */
  audioKey: string | null;
  /** `pending` until the daily job has folded it into a digest. */
  status: MemoStatus;
  /** Day of the digest that consumed this memo. */
  stackedInto: string | null;
}

export type MemoStatus = 'pending' | 'stacked';

export type AsrEngineId = 'cloud-whisper' | 'local-whisper' | 'web-speech' | 'manual';

/** One day, folded by the AI into a single organized document. */
export interface Digest {
  /** `YYYY-MM-DD` — also the primary key; one digest per day. */
  day: string;
  createdAt: number;
  /** 1-3 sentence overview of the day. */
  summary: string;
  /** Organized body, grouped by theme. */
  sections: DigestSection[];
  /** Things the AI spotted as actionable. */
  actions: string[];
  /** Open questions / threads worth pulling on tomorrow. */
  threads: string[];
  highlights: string[];
  tags: string[];
  memoCount: number;
  model: string;
}

export interface DigestSection {
  heading: string;
  bullets: string[];
  /** Ids of the memos that fed this section. */
  memoIds: string[];
}

/* ------------------------------------------------------------------ */
/* API payloads                                                        */
/* ------------------------------------------------------------------ */

export interface TranscribeResponse {
  text: string;
  lang: string;
  /** Present when the Worker stored the audio in R2. */
  audioKey: string | null;
  /** Word/segment timings, when the model returned them. */
  segments?: { start: number; end: number; text: string }[];
}

export interface RefineResponse {
  title: string;
  text: string;
  tags: string[];
}

export interface SyncRequest {
  memos: Memo[];
  /** Ids the client has deleted since its last sync. */
  deleted: string[];
  /** Only return server memos touched at or after this Unix ms. */
  since: number;
}

export interface SyncResponse {
  memos: Memo[];
  deleted: string[];
  now: number;
}

export interface DigestRunResponse {
  day: string;
  digest: Digest | null;
  /** Why nothing was produced, when `digest` is null. */
  reason?: string;
}

export interface ApiError {
  error: string;
  detail?: string;
}

export interface SessionInfo {
  authenticated: boolean;
  /** False when the deployment has no passphrase configured (single-user/dev mode). */
  authRequired: boolean;
  timezone: string;
  asrModel: string;
  llmModel: string;
}
