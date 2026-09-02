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

/**
 * The shape Workers AI answers with.
 *
 * `response` is deliberately `unknown`: with `response_format: json_schema`
 * the platform hands back an already-parsed object, not a JSON string. Typing
 * it as `string` is what let a `.trim()` through to production.
 */
interface ChatResponse {
  response?: unknown;
  result?: { response?: unknown };
}

/** Pulls the generated content out, whatever wrapper the model put it in. */
function responseOf(res: unknown): unknown {
  if (typeof res === 'string') return res;
  if (res && typeof res === 'object') {
    const r = res as ChatResponse;
    return r.response ?? r.result?.response ?? '';
  }
  return '';
}

async function runChat(
  env: Env,
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; jsonSchema?: Record<string, unknown> },
): Promise<unknown> {
  const model = env.LLM_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const payload: Record<string, unknown> = {
    messages,
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.2,
  };
  if (opts.jsonSchema) {
    payload.response_format = { type: 'json_schema', json_schema: opts.jsonSchema };
  }
  return responseOf(await env.AI.run(model as Parameters<Ai['run']>[0], payload as never));
}

/** Plain text generation. Objects are stringified rather than thrown away. */
export async function chat(
  env: Env,
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; jsonSchema?: Record<string, unknown> } = {},
): Promise<string> {
  const value = await runChat(env, messages, opts);
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Pulls the first JSON object out of a model response.
 *
 * JSON mode may hand back a parsed object already; without it, small/fast
 * models like to wrap output in prose or a fenced block. Rather than fail the
 * whole daily digest on a stray backtick, we scan for the first balanced object.
 */
export function extractJson<T>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null;
  // JSON mode: the platform already parsed it for us.
  if (typeof raw === 'object') return Array.isArray(raw) ? null : (raw as T);
  if (typeof raw !== 'string') return null;

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

/**
 * Calls the model and parses JSON.
 *
 * The retry drops `response_format` as well as the temperature: a model that
 * mishandles the schema will keep mishandling it at temperature 0, and asking
 * for JSON in the prompt alone is the path that always works.
 */
export async function chatJson<T>(
  env: Env,
  messages: ChatMessage[],
  opts: { maxTokens?: number; jsonSchema?: Record<string, unknown> } = {},
): Promise<T | null> {
  const attempts: { temperature: number; jsonSchema?: Record<string, unknown> }[] = [
    { temperature: 0.2, ...(opts.jsonSchema ? { jsonSchema: opts.jsonSchema } : {}) },
    { temperature: 0 },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const raw = await runChat(env, messages, { maxTokens: opts.maxTokens, ...attempt });
      const parsed = extractJson<T>(raw);
      if (parsed) return parsed;
    } catch (error) {
      // A model that rejects `response_format` outright throws here. That is
      // exactly the case the schema-less retry exists for, so keep going.
      lastError = error;
      console.warn('chatJson attempt failed', error);
    }
  }
  if (lastError) throw lastError;
  return null;
}
