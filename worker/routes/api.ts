import { Hono } from 'hono';
import type { Memo, RefineResponse, SessionInfo, SyncRequest, TranscribeResponse } from '../../shared/types';
import { dayKey, isDayKey, shiftDay } from '../../shared/day';
import type { Env } from '../env';
import { authRequired, clearCookie, isAuthenticated, sessionCookie, verifyPassphrase } from '../lib/auth';
import { chatJson, transcribeAudio } from '../lib/ai';
import { buildDigest } from '../lib/digest';
import {
  deletionsSince,
  getDigest,
  listDigests,
  memosChangedSince,
  softDeleteStatement,
  upsertMemoStatement,
} from '../lib/db';

type App = { Bindings: Env };

/** Audio uploads are capped well under the Workers request limit. */
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const MAX_SYNC_MEMOS = 200;

export const api = new Hono<App>();

/* ---------------- auth gate ---------------- */

api.use('*', async (c, next) => {
  const open = c.req.path === '/api/session' || c.req.path === '/api/health';
  if (!open && !(await isAuthenticated(c.req.raw, c.env))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});

api.get('/health', (c) => c.json({ ok: true, at: Date.now() }));

/* ---------------- session ---------------- */

const sessionInfo = async (c: { req: { raw: Request }; env: Env }): Promise<SessionInfo> => ({
  authenticated: await isAuthenticated(c.req.raw, c.env),
  authRequired: authRequired(c.env),
  timezone: c.env.APP_TIMEZONE || 'Asia/Tokyo',
  asrModel: c.env.ASR_MODEL || '@cf/openai/whisper-large-v3-turbo',
  llmModel: c.env.LLM_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  audioArchive: !!c.env.AUDIO,
});

api.get('/session', async (c) => c.json(await sessionInfo(c)));

api.post('/session', async (c) => {
  const body = await c.req.json<{ passphrase?: string }>().catch(() => ({}) as { passphrase?: string });
  if (!(await verifyPassphrase(c.env, body.passphrase ?? ''))) {
    // A uniform delay makes brute-forcing over the network unattractive.
    await new Promise((r) => setTimeout(r, 600));
    return c.json({ error: 'パスフレーズが違います' }, 401);
  }
  c.header('set-cookie', await sessionCookie(c.env));
  return c.json(await sessionInfo(c));
});

api.delete('/session', (c) => {
  c.header('set-cookie', clearCookie());
  return c.body(null, 204);
});

/* ---------------- transcription ---------------- */

api.post('/transcribe', async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('audio');
  if (!(file instanceof File)) return c.json({ error: '音声が添付されていません' }, 400);
  if (file.size > MAX_AUDIO_BYTES) return c.json({ error: '音声が大きすぎます' }, 413);
  if (file.size < 1024) return c.json({ error: '音声が短すぎます' }, 400);

  const language = String(form?.get('language') ?? 'auto');
  const storeAudio = String(form?.get('storeAudio') ?? '0') === '1';
  const bytes = new Uint8Array(await file.arrayBuffer());

  let audioKey: string | null = null;
  if (storeAudio && c.env.AUDIO) {
    const day = dayKey(Date.now(), c.env.APP_TIMEZONE || 'Asia/Tokyo');
    audioKey = `audio/${day}/${crypto.randomUUID()}.wav`;
    try {
      await c.env.AUDIO.put(audioKey, bytes, { httpMetadata: { contentType: 'audio/wav' } });
    } catch (error) {
      // Losing the archive copy must never lose the transcript.
      console.warn('r2 put failed', error);
      audioKey = null;
    }
  }

  try {
    const out = await transcribeAudio(c.env, bytes, language);
    const body: TranscribeResponse = {
      text: out.text,
      lang: out.language,
      audioKey,
      ...(out.segments?.length ? { segments: out.segments } : {}),
    };
    return c.json(body);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return c.json({ error: '文字起こしに失敗しました', detail }, 502);
  }
});

/* ---------------- single-memo cleanup ---------------- */

const REFINE_SCHEMA = {
  name: 'memo_refine',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      text: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['title', 'text', 'tags'],
  },
};

api.post('/refine', async (c) => {
  const body = await c.req.json<{ text?: string }>().catch(() => ({}) as { text?: string });
  const text = (body.text ?? '').trim();
  if (!text) return c.json({ error: 'テキストが空です' }, 400);

  const out = await chatJson<RefineResponse>(
    c.env,
    [
      {
        role: 'system',
        content:
          '音声認識された話し言葉を、意味を変えずに読みやすく整える編集者です。フィラー（えーと、あの、まあ）と言い直しを取り除き、明らかな誤変換を文脈から直し、自然な改行を入れます。内容の追加・要約・意見は一切しません。出力は JSON のみ。',
      },
      {
        role: 'user',
        content: `次のメモを整えてください。
- title: 12文字以内の見出し
- text: 整えた本文（元の情報は落とさない）
- tags: 2〜5個の短いタグ（#なし）

---
${text}`,
      },
    ],
    { maxTokens: 1400, jsonSchema: REFINE_SCHEMA },
  );

  if (!out) return c.json({ error: '整形に失敗しました' }, 502);
  return c.json({
    title: (out.title ?? '').trim().slice(0, 40),
    text: (out.text ?? text).trim(),
    tags: Array.isArray(out.tags)
      ? out.tags
          .filter((t) => typeof t === 'string')
          .map((t) => t.replace(/^#/, '').trim())
          .filter(Boolean)
          .slice(0, 5)
      : [],
  } satisfies RefineResponse);
});

/* ---------------- sync ---------------- */

const sanitize = (m: Partial<Memo>, tz: string): Memo | null => {
  if (!m || typeof m.id !== 'string' || !m.id) return null;
  const createdAt = Number(m.createdAt) || Date.now();
  return {
    id: m.id.slice(0, 64),
    createdAt,
    updatedAt: Number(m.updatedAt) || Date.now(),
    day: isDayKey(m.day) ? m.day : dayKey(createdAt, tz),
    text: String(m.text ?? '').slice(0, 40_000),
    rawText: String(m.rawText ?? '').slice(0, 40_000),
    title: m.title ? String(m.title).slice(0, 120) : null,
    tags: Array.isArray(m.tags) ? m.tags.filter((t) => typeof t === 'string').slice(0, 12) : [],
    durationMs: Number(m.durationMs) || 0,
    lang: String(m.lang ?? 'ja-JP').slice(0, 16),
    engine: (m.engine ?? 'cloud-whisper') as Memo['engine'],
    audioKey: m.audioKey ? String(m.audioKey).slice(0, 200) : null,
    status: m.status === 'stacked' ? 'stacked' : 'pending',
    stackedInto: isDayKey(m.stackedInto) ? m.stackedInto : null,
  };
};

api.post('/sync', async (c) => {
  const tz = c.env.APP_TIMEZONE || 'Asia/Tokyo';
  const body = await c.req.json<Partial<SyncRequest>>().catch(() => ({}) as Partial<SyncRequest>);

  const incoming = (Array.isArray(body.memos) ? body.memos : [])
    .slice(0, MAX_SYNC_MEMOS)
    .map((m) => sanitize(m, tz))
    .filter((m): m is Memo => m !== null);
  const deleted = (Array.isArray(body.deleted) ? body.deleted : [])
    .filter((id): id is string => typeof id === 'string')
    .slice(0, MAX_SYNC_MEMOS);
  const since = Number.isFinite(Number(body.since)) ? Number(body.since) : 0;

  const now = Date.now();
  const statements = [
    ...incoming.map((m) => upsertMemoStatement(c.env, m)),
    ...deleted.map((id) => softDeleteStatement(c.env, id, now)),
  ];
  if (statements.length) await c.env.DB.batch(statements);

  // Don't echo back what this client just sent; `since` is exclusive of them
  // only by timestamp, so filter explicitly.
  const sent = new Set(incoming.map((m) => m.id));
  const [changed, removed] = await Promise.all([
    memosChangedSince(c.env, since),
    deletionsSince(c.env, since),
  ]);

  return c.json({
    memos: changed.filter((m) => !sent.has(m.id)),
    deleted: removed.filter((id) => !deleted.includes(id)),
    now,
  });
});

/* ---------------- digests ---------------- */

api.get('/digests', async (c) => {
  const limit = Math.min(120, Math.max(1, Number(c.req.query('limit') ?? 30) || 30));
  return c.json({ digests: await listDigests(c.env, limit) });
});

api.post('/digests/run', async (c) => {
  const tz = c.env.APP_TIMEZONE || 'Asia/Tokyo';
  const body = await c.req.json<{ day?: string }>().catch(() => ({}) as { day?: string });
  const day = isDayKey(body.day) ? body.day : shiftDay(dayKey(Date.now(), tz), 0);
  const { digest, reason } = await buildDigest(c.env, day, 'manual');
  return c.json({ day, digest, ...(reason ? { reason } : {}) });
});

api.get('/digests/:day', async (c) => {
  const day = c.req.param('day');
  if (!isDayKey(day)) return c.json({ error: 'invalid day' }, 400);
  return c.json({ digest: await getDigest(c.env, day) });
});

/* ---------------- archived audio ---------------- */

api.get('/audio/*', async (c) => {
  if (!c.env.AUDIO) return c.json({ error: 'この配備では音声を保管していません' }, 404);
  const key = c.req.path.replace('/api/audio/', '');
  if (!key.startsWith('audio/')) return c.json({ error: 'not found' }, 404);
  const object = await c.env.AUDIO.get(key);
  if (!object) return c.json({ error: 'not found' }, 404);
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'audio/wav',
      'cache-control': 'private, max-age=3600',
    },
  });
});
