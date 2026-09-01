import type { Digest, DigestSection, Memo } from '../../shared/types';
import { dayKey, shiftDay } from '../../shared/day';
import type { Env } from '../env';
import { chatJson } from './ai';
import { daysAwaitingDigest, getDigest, markStacked, memosForDay, recordRun, saveDigest } from './db';

/**
 * The daily stack.
 *
 * Once a day the cron folds everything you said into one organized document:
 * an overview, themed sections that cite the memos they came from, the things
 * that turned out to be actions, and the threads worth pulling on tomorrow.
 * Then the memos are marked `stacked` so they stop showing up as loose ends.
 */

/** Rough character budget per model call; long days are summarized in passes. */
const CHUNK_CHARS = 7000;

const SYSTEM = `あなたは、話し手が一日のあいだに口述した音声メモを、あとから読み返せる一枚の記録に編集する編集者です。

原則:
- 事実に忠実であること。メモに書かれていないことを足さない。推測は書かない。
- 話し言葉のゆらぎ（言い直し、フィラー、音声認識の誤り）は整えてよいが、意味は変えない。
- 明らかな音声認識の誤変換は、文脈から自然に補正してよい。
- 見出しは内容から立てる。テンプレート的な見出し（「その他」「雑感」）は避ける。
- 日本語で書く。簡潔に、断定的に。敬体（です・ます）は使わず、常体で書く。
- 出力は指定された JSON のみ。説明文やコードフェンスを付けない。`;

const SCHEMA = {
  name: 'daily_digest',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            heading: { type: 'string' },
            bullets: { type: 'array', items: { type: 'string' } },
            refs: { type: 'array', items: { type: 'string' } },
          },
          required: ['heading', 'bullets', 'refs'],
        },
      },
      actions: { type: 'array', items: { type: 'string' } },
      threads: { type: 'array', items: { type: 'string' } },
      highlights: { type: 'array', items: { type: 'string' } },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['summary', 'sections', 'actions', 'threads', 'highlights', 'tags'],
  },
} as const;

interface RawDigest {
  summary?: string;
  sections?: { heading?: string; bullets?: string[]; refs?: string[] }[];
  actions?: string[];
  threads?: string[];
  highlights?: string[];
  tags?: string[];
}

const clock = (at: number, tz: string): string =>
  new Intl.DateTimeFormat('ja-JP', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(at));

/** Renders memos as `[m3] 14:02 ...` so the model can cite them cheaply. */
function renderMemos(memos: Memo[], tz: string, offset: number): string {
  return memos
    .map((m, i) => {
      const label = `m${offset + i + 1}`;
      const secs = Math.round(m.durationMs / 1000);
      const head = m.title ? `${m.title} — ` : '';
      return `[${label}] ${clock(m.createdAt, tz)} (${secs}秒)\n${head}${m.text.trim()}`;
    })
    .join('\n\n');
}

function chunk(memos: Memo[]): Memo[][] {
  const out: Memo[][] = [];
  let current: Memo[] = [];
  let size = 0;
  for (const m of memos) {
    const len = m.text.length + 40;
    if (current.length && size + len > CHUNK_CHARS) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(m);
    size += len;
  }
  if (current.length) out.push(current);
  return out;
}

const asStrings = (v: unknown, limit = 12): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, limit)
    : [];

/** Turns `m3` style refs back into real memo ids. */
function resolveRefs(refs: string[], memos: Memo[]): string[] {
  const ids = new Set<string>();
  for (const ref of refs) {
    const n = Number(/^m(\d+)$/i.exec(ref.trim())?.[1]);
    const memo = Number.isFinite(n) ? memos[n - 1] : undefined;
    if (memo) ids.add(memo.id);
  }
  return [...ids];
}

async function summarizeChunk(env: Env, memos: Memo[], tz: string, offset: number): Promise<string> {
  const body = renderMemos(memos, tz, offset);
  const text = await chatJson<{ notes?: string[] }>(
    env,
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `次は同じ日の音声メモの一部です。あとで一日ぶんをまとめるための中間メモを作ってください。
各項目は「[m番号] 内容」の形式で、内容は一文。重要な固有名詞・数字・決定・宿題は必ず残すこと。

出力 JSON: {"notes": ["[m1] ...", "[m2] ..."]}

---
${body}`,
      },
    ],
    { maxTokens: 1500 },
  );
  return asStrings(text?.notes, 60).join('\n');
}

export async function buildDigest(
  env: Env,
  day: string,
  trigger: 'cron' | 'manual',
): Promise<{ digest: Digest | null; reason?: string }> {
  const tz = env.APP_TIMEZONE || 'Asia/Tokyo';
  const memos = (await memosForDay(env, day)).filter((m) => m.text.trim().length > 0);

  if (memos.length === 0) {
    await recordRun(env, { day, trigger, status: 'empty', memoCount: 0 });
    return { digest: null, reason: 'この日のメモはありません' };
  }

  try {
    const groups = chunk(memos);
    let body: string;

    if (groups.length === 1) {
      body = renderMemos(memos, tz, 0);
    } else {
      // Map: condense each chunk. Reduce: one pass over the condensed notes.
      let offset = 0;
      const notes: string[] = [];
      for (const group of groups) {
        notes.push(await summarizeChunk(env, group, tz, offset));
        offset += group.length;
      }
      body = notes.filter(Boolean).join('\n');
    }

    const raw = await chatJson<RawDigest>(
      env,
      [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `${day} に口述された音声メモです。時系列順に並んでいます。
これを、あとから読み返して意味が分かる一日の記録に編集してください。

- summary: その日を 2〜3 文で。何を考え、何が動いたか。
- sections: 話題ごとにまとめる。3〜6 個。heading は内容を表す具体的な短い句。bullets は各 2〜5 個。refs にはその節の根拠になったメモ番号（例 "m3"）を入れる。
- actions: やると言ったこと・宿題。無ければ空配列。
- threads: 結論が出ていない問い、明日引き継ぐ考え。
- highlights: そのまま残す価値のある言い回しを、話し手の言葉で最大 3 つ。
- tags: 検索用の短いタグを 3〜8 個（#は付けない）。

---
${body}`,
        },
      ],
      { maxTokens: 2600, jsonSchema: SCHEMA as unknown as Record<string, unknown> },
    );

    if (!raw) {
      await recordRun(env, {
        day,
        trigger,
        status: 'error',
        memoCount: memos.length,
        detail: 'model returned no JSON',
      });
      return { digest: null, reason: 'AI の応答を解釈できませんでした' };
    }

    const sections: DigestSection[] = (Array.isArray(raw.sections) ? raw.sections : [])
      .map((s) => ({
        heading: (s.heading ?? '').trim(),
        bullets: asStrings(s.bullets, 8),
        memoIds: resolveRefs(asStrings(s.refs, 20), memos),
      }))
      .filter((s) => s.heading && s.bullets.length)
      .slice(0, 8);

    const digest: Digest = {
      day,
      createdAt: Date.now(),
      summary: (raw.summary ?? '').trim(),
      sections,
      actions: asStrings(raw.actions),
      threads: asStrings(raw.threads),
      highlights: asStrings(raw.highlights, 3),
      tags: asStrings(raw.tags, 8).map((t) => t.replace(/^#/, '')),
      memoCount: memos.length,
      model: env.LLM_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    };

    if (!digest.summary && sections.length === 0) {
      await recordRun(env, {
        day,
        trigger,
        status: 'error',
        memoCount: memos.length,
        detail: 'empty digest',
      });
      return { digest: null, reason: 'まとめを生成できませんでした' };
    }

    await saveDigest(env, digest);
    await markStacked(
      env,
      memos.map((m) => m.id),
      day,
    );
    await recordRun(env, { day, trigger, status: 'ok', memoCount: memos.length });
    return { digest };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await recordRun(env, { day, trigger, status: 'error', memoCount: memos.length, detail });
    return { digest: null, reason: `まとめに失敗しました: ${detail}` };
  }
}

/**
 * What the cron actually runs.
 *
 * At 03:00 local the previous day is complete, so that is the day we stack.
 * Any earlier day that still has loose memos — the app was closed, the run
 * failed, the account was over quota — gets caught up in the same pass.
 */
export async function runDailyStack(env: Env): Promise<{ day: string; ok: boolean }[]> {
  const tz = env.APP_TIMEZONE || 'Asia/Tokyo';
  const today = dayKey(Date.now(), tz);
  const target = shiftDay(today, -1);

  const catchUp = (await daysAwaitingDigest(env, target, 6)).filter((d) => d !== target);
  const days = [target, ...catchUp];

  const outcomes: { day: string; ok: boolean }[] = [];
  for (const day of days) {
    const existing = await getDigest(env, day);
    const pending = await memosForDay(env, day, true);
    // Already stacked and nothing new arrived since: leave it alone.
    if (existing && pending.length === 0) continue;

    const { digest } = await buildDigest(env, day, 'cron');
    outcomes.push({ day, ok: !!digest });
  }
  return outcomes;
}

/** Deletes R2 audio past the retention window. Transcripts are kept forever. */
export async function pruneAudio(env: Env): Promise<number> {
  if (!env.AUDIO) return 0;
  const days = Number(env.KEEP_AUDIO_DAYS ?? '14');
  if (!Number.isFinite(days) || days <= 0) return 0;
  const cutoff = shiftDay(dayKey(Date.now(), env.APP_TIMEZONE || 'Asia/Tokyo'), -days);

  const { results } = await env.DB.prepare(
    'SELECT id, audio_key FROM memos WHERE audio_key IS NOT NULL AND day < ?1 LIMIT 200',
  )
    .bind(cutoff)
    .all<{ id: string; audio_key: string }>();

  let removed = 0;
  for (const row of results ?? []) {
    try {
      await env.AUDIO.delete(row.audio_key);
      await env.DB.prepare('UPDATE memos SET audio_key = NULL WHERE id = ?1').bind(row.id).run();
      removed++;
    } catch (error) {
      console.warn('audio prune failed', row.audio_key, error);
    }
  }
  return removed;
}
