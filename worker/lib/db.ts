import type { Digest, DigestSection, Memo, MemoStatus, AsrEngineId } from '../../shared/types';
import type { Env } from '../env';

/** Shape of a `memos` row as D1 returns it. */
interface MemoRow {
  id: string;
  created_at: number;
  updated_at: number;
  day: string;
  text: string;
  raw_text: string;
  title: string | null;
  tags: string;
  duration_ms: number;
  lang: string;
  engine: string;
  audio_key: string | null;
  status: string;
  stacked_into: string | null;
  deleted_at: number | null;
}

interface DigestRow {
  day: string;
  created_at: number;
  summary: string;
  sections: string;
  actions: string;
  threads: string;
  highlights: string;
  tags: string;
  memo_count: number;
  model: string;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const toMemo = (row: MemoRow): Memo => ({
  id: row.id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  day: row.day,
  text: row.text,
  rawText: row.raw_text,
  title: row.title,
  tags: parseJson<string[]>(row.tags, []),
  durationMs: row.duration_ms,
  lang: row.lang,
  engine: row.engine as AsrEngineId,
  audioKey: row.audio_key,
  status: row.status as MemoStatus,
  stackedInto: row.stacked_into,
});

export const toDigest = (row: DigestRow): Digest => ({
  day: row.day,
  createdAt: row.created_at,
  summary: row.summary,
  sections: parseJson<DigestSection[]>(row.sections, []),
  actions: parseJson<string[]>(row.actions, []),
  threads: parseJson<string[]>(row.threads, []),
  highlights: parseJson<string[]>(row.highlights, []),
  tags: parseJson<string[]>(row.tags, []),
  memoCount: row.memo_count,
  model: row.model,
});

const MEMO_COLUMNS =
  'id, created_at, updated_at, day, text, raw_text, title, tags, duration_ms, lang, engine, audio_key, status, stacked_into, deleted_at';

export async function memosChangedSince(env: Env, since: number, limit = 500): Promise<Memo[]> {
  const { results } = await env.DB.prepare(
    `SELECT ${MEMO_COLUMNS} FROM memos
     WHERE updated_at >= ?1 AND deleted_at IS NULL
     ORDER BY updated_at ASC LIMIT ?2`,
  )
    .bind(since, limit)
    .all<MemoRow>();
  return (results ?? []).map(toMemo);
}

export async function deletionsSince(env: Env, since: number): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT id FROM memos WHERE deleted_at IS NOT NULL AND deleted_at >= ?1',
  )
    .bind(since)
    .all<{ id: string }>();
  return (results ?? []).map((r) => r.id);
}

export async function memosForDay(env: Env, day: string, onlyPending = false): Promise<Memo[]> {
  const sql = onlyPending
    ? `SELECT ${MEMO_COLUMNS} FROM memos WHERE day = ?1 AND deleted_at IS NULL AND status = 'pending' ORDER BY created_at ASC`
    : `SELECT ${MEMO_COLUMNS} FROM memos WHERE day = ?1 AND deleted_at IS NULL ORDER BY created_at ASC`;
  const { results } = await env.DB.prepare(sql).bind(day).all<MemoRow>();
  return (results ?? []).map(toMemo);
}

/**
 * Upserts, but never lets a stale client overwrite a newer server row —
 * `updated_at` decides, which keeps two devices from fighting.
 */
export function upsertMemoStatement(env: Env, memo: Memo): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO memos (id, created_at, updated_at, day, text, raw_text, title, tags,
                        duration_ms, lang, engine, audio_key, status, stacked_into)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
     ON CONFLICT(id) DO UPDATE SET
       updated_at   = excluded.updated_at,
       day          = excluded.day,
       text         = excluded.text,
       raw_text     = excluded.raw_text,
       title        = excluded.title,
       tags         = excluded.tags,
       duration_ms  = excluded.duration_ms,
       lang         = excluded.lang,
       engine       = excluded.engine,
       audio_key    = COALESCE(excluded.audio_key, memos.audio_key),
       status       = excluded.status,
       stacked_into = excluded.stacked_into
     WHERE excluded.updated_at > memos.updated_at`,
  ).bind(
    memo.id,
    memo.createdAt,
    memo.updatedAt,
    memo.day,
    memo.text,
    memo.rawText,
    memo.title,
    JSON.stringify(memo.tags ?? []),
    memo.durationMs,
    memo.lang,
    memo.engine,
    memo.audioKey,
    memo.status,
    memo.stackedInto,
  );
}

export function softDeleteStatement(env: Env, id: string, at: number): D1PreparedStatement {
  return env.DB.prepare('UPDATE memos SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1').bind(id, at);
}

export async function saveDigest(env: Env, digest: Digest): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO digests (day, created_at, summary, sections, actions, threads, highlights, tags, memo_count, model)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
     ON CONFLICT(day) DO UPDATE SET
       created_at = excluded.created_at,
       summary    = excluded.summary,
       sections   = excluded.sections,
       actions    = excluded.actions,
       threads    = excluded.threads,
       highlights = excluded.highlights,
       tags       = excluded.tags,
       memo_count = excluded.memo_count,
       model      = excluded.model`,
  )
    .bind(
      digest.day,
      digest.createdAt,
      digest.summary,
      JSON.stringify(digest.sections),
      JSON.stringify(digest.actions),
      JSON.stringify(digest.threads),
      JSON.stringify(digest.highlights),
      JSON.stringify(digest.tags),
      digest.memoCount,
      digest.model,
    )
    .run();
}

export async function getDigest(env: Env, day: string): Promise<Digest | null> {
  const row = await env.DB.prepare('SELECT * FROM digests WHERE day = ?1').bind(day).first<DigestRow>();
  return row ? toDigest(row) : null;
}

export async function listDigests(env: Env, limit: number): Promise<Digest[]> {
  const { results } = await env.DB.prepare('SELECT * FROM digests ORDER BY day DESC LIMIT ?1')
    .bind(limit)
    .all<DigestRow>();
  return (results ?? []).map(toDigest);
}

export async function markStacked(env: Env, ids: string[], day: string): Promise<void> {
  if (!ids.length) return;
  const at = Date.now();
  await env.DB.batch(
    ids.map((id) =>
      env.DB.prepare(
        "UPDATE memos SET status = 'stacked', stacked_into = ?2, updated_at = ?3 WHERE id = ?1",
      ).bind(id, day, at),
    ),
  );
}

export async function recordRun(
  env: Env,
  run: {
    day: string;
    trigger: 'cron' | 'manual';
    status: 'ok' | 'empty' | 'error';
    memoCount: number;
    detail?: string;
  },
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO runs (id, ran_at, day, trigger, status, memo_count, detail) VALUES (?1,?2,?3,?4,?5,?6,?7)',
  )
    .bind(
      crypto.randomUUID(),
      Date.now(),
      run.day,
      run.trigger,
      run.status,
      run.memoCount,
      run.detail ?? null,
    )
    .run();
}

/** Days that have pending memos but no digest yet — the cron's catch-up list. */
export async function daysAwaitingDigest(env: Env, before: string, limit = 7): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT m.day AS day
     FROM memos m
     LEFT JOIN digests d ON d.day = m.day
     WHERE m.deleted_at IS NULL AND m.day < ?1 AND (d.day IS NULL OR m.status = 'pending')
     ORDER BY m.day DESC LIMIT ?2`,
  )
    .bind(before, limit)
    .all<{ day: string }>();
  return (results ?? []).map((r) => r.day);
}
