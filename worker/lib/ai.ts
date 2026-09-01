import type { Env } from '../env';

/* ------------------------------------------------------------------ */
/* Speech to text                                                      */
/* ------------------------------------------------------------------ */

export interface TranscriptionOut {
  text: string;
  language: string;
  segments?: { start: number; end: number; text: string }[];
}

/** btoa() blows the call stack on big arrays; chunk it. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

interface WhisperTurboResponse {
  text?: string;
  transcription_info?: { language?: string; language_probability?: number; duration?: number };
  segments?: { start?: number; end?: number; text?: string }[];
}

/**
 * Whisper large-v3-turbo on Workers AI.
 *
 * The turbo model takes base64 and returns segments; the older `@cf/openai/whisper`
 * takes a byte array and returns plain text. We try the configured model first
 * and degrade to the classic one, because a transcript from the older model
 * beats no transcript at all.
 */
export async function transcribeAudio(
  env: Env,
  audio: Uint8Array,
  language: string,
): Promise<TranscriptionOut> {
  const lang = language && language !== 'auto' ? language.split('-')[0] : undefined;
  const model = env.ASR_MODEL || '@cf/openai/whisper-large-v3-turbo';

  try {
    const res = (await env.AI.run(
      model as Parameters<Ai['run']>[0],
      {
        audio: toBase64(audio),
        task: 'transcribe',
        ...(lang ? { language: lang } : {}),
        // Whisper hallucinates confident nonsense on pure silence; the VAD filter
        // is the single most effective guard against it.
        vad_filter: true,
      } as never,
    )) as WhisperTurboResponse;

    const text = (res?.text ?? '').trim();
    if (text) {
      return {
        text,
        language: res.transcription_info?.language ?? lang ?? 'ja',
        segments: (res.segments ?? [])
          .filter((s) => (s.text ?? '').trim())
          .map((s) => ({ start: s.start ?? 0, end: s.end ?? 0, text: (s.text ?? '').trim() })),
      };
    }
  } catch (error) {
    console.warn('turbo whisper failed, falling back', error);
  }

  const legacy = (await env.AI.run(
    '@cf/openai/whisper' as Parameters<Ai['run']>[0],
    {
      audio: [...audio],
    } as never,
  )) as { text?: string };

  return { text: (legacy?.text ?? '').trim(), language: lang ?? 'ja' };
}

/* ------------------------------------------------------------------ */
/* Text generation                                                     */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  response?: string;
  result?: { response?: string };
}

export async function chat(
  env: Env,
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; jsonSchema?: Record<string, unknown> } = {},
): Promise<string> {
  const model = env.LLM_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const payload: Record<string, unknown> = {
    messages,
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.2,
  };
  if (opts.jsonSchema) {
    payload.response_format = { type: 'json_schema', json_schema: opts.jsonSchema };
  }

  const res = (await env.AI.run(model as Parameters<Ai['run']>[0], payload as never)) as
    ChatResponse | string;
  if (typeof res === 'string') return res;
  return res.response ?? res.result?.response ?? '';
}

/**
 * Pulls the first JSON object out of a model response.
 *
 * Even with JSON mode on, small/fast models like to wrap output in prose or a
 * fenced block. Rather than fail the whole daily digest on a stray backtick, we
 * scan for the first balanced object.
 */
export function extractJson<T>(raw: string): T | null {
  if (!raw) return null;
  const text = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();

  try {
    return JSON.parse(text) as T;
  } catch {
    /* fall through to scanning */
  }

  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Calls the model and parses JSON, retrying once at temperature 0. */
export async function chatJson<T>(
  env: Env,
  messages: ChatMessage[],
  opts: { maxTokens?: number; jsonSchema?: Record<string, unknown> } = {},
): Promise<T | null> {
  for (const temperature of [0.2, 0]) {
    const raw = await chat(env, messages, { ...opts, temperature });
    const parsed = extractJson<T>(raw);
    if (parsed) return parsed;
  }
  return null;
}
