import { describe, expect, it } from 'vitest';
import { dayKey, shiftDay, isDayKey } from '@shared/day';
import { chat, chatJson, extractJson } from '../worker/lib/ai';
import type { Env } from '../worker/env';

describe('dayKey', () => {
  it('formats as YYYY-MM-DD in the requested zone', () => {
    expect(dayKey(Date.UTC(2026, 8, 1, 12, 0), 'Asia/Tokyo')).toBe('2026-09-01');
  });

  it('puts a late-night Tokyo memo on the Tokyo day, not the UTC one', () => {
    // 2026-09-01 16:00 UTC is 2026-09-02 01:00 in Tokyo.
    const at = Date.UTC(2026, 8, 1, 16, 0);
    expect(dayKey(at, 'Asia/Tokyo')).toBe('2026-09-02');
    expect(dayKey(at, 'UTC')).toBe('2026-09-01');
  });

  it('handles a zone that is behind UTC', () => {
    // 2026-09-01 02:00 UTC is still 2026-08-31 in Los Angeles.
    expect(dayKey(Date.UTC(2026, 8, 1, 2, 0), 'America/Los_Angeles')).toBe('2026-08-31');
  });
});

describe('shiftDay', () => {
  it('steps backwards across a month boundary', () => {
    expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('steps forwards across a year boundary', () => {
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('handles a leap day', () => {
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('isDayKey', () => {
  it('accepts a well-formed key and rejects everything else', () => {
    expect(isDayKey('2026-09-01')).toBe(true);
    expect(isDayKey('2026-9-1')).toBe(false);
    expect(isDayKey('../../etc/passwd')).toBe(false);
    expect(isDayKey(undefined)).toBe(false);
  });
});

describe('extractJson', () => {
  it('parses a clean object', () => {
    expect(extractJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('unwraps a fenced block', () => {
    expect(extractJson<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('finds the object inside surrounding prose', () => {
    const raw = 'はい、まとめました:\n{"summary":"ok","sections":[]}\n以上です。';
    expect(extractJson<{ summary: string }>(raw)?.summary).toBe('ok');
  });

  it('stops at the matching brace, not at one inside a string', () => {
    const raw = 'note {"text":"} not the end {","n":2} trailing';
    expect(extractJson<{ text: string; n: number }>(raw)).toEqual({ text: '} not the end {', n: 2 });
  });

  it('survives escaped quotes inside strings', () => {
    expect(extractJson<{ t: string }>('{"t":"he said \\"hi\\""}')).toEqual({ t: 'he said "hi"' });
  });

  it('returns null rather than throwing on junk', () => {
    expect(extractJson('no json at all')).toBeNull();
    expect(extractJson('{"broken": ')).toBeNull();
    expect(extractJson('')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Workers AI response handling                                        */
/* ------------------------------------------------------------------ */

interface FakeCall {
  response_format?: { type: string; json_schema?: unknown };
  temperature?: number;
}

/** Minimal Env stand-in: chatJson only ever touches LLM_MODEL and AI.run. */
function fakeEnv(respond: (call: FakeCall, attempt: number) => unknown) {
  const calls: FakeCall[] = [];
  const env = {
    LLM_MODEL: 'test-model',
    AI: {
      run: async (_model: string, payload: FakeCall) => {
        calls.push(payload);
        return respond(payload, calls.length - 1);
      },
    },
  } as unknown as Env;
  return { env, calls };
}

describe('extractJson with non-string input', () => {
  it('passes a parsed object straight through (JSON mode)', () => {
    // Regression: Workers AI returns `response` as an object when
    // response_format is a json_schema. Calling .trim() on it threw
    // "raw.trim is not a function" and killed the whole daily digest.
    expect(extractJson<{ summary: string }>({ summary: 'ok' })).toEqual({ summary: 'ok' });
  });

  it('rejects an array — a digest is an object or it is nothing', () => {
    expect(extractJson([1, 2, 3])).toBeNull();
  });

  it('returns null for null, undefined and numbers instead of throwing', () => {
    expect(extractJson(null)).toBeNull();
    expect(extractJson(undefined)).toBeNull();
    expect(extractJson(42)).toBeNull();
  });
});

describe('chatJson', () => {
  it('survives a model that answers JSON mode with an object', async () => {
    const { env } = fakeEnv(() => ({ response: { summary: '今日は静かだった', sections: [] } }));
    const out = await chatJson<{ summary: string }>(env, [{ role: 'user', content: 'x' }], {
      jsonSchema: { name: 'd', schema: {} },
    });
    expect(out?.summary).toBe('今日は静かだった');
  });

  it('parses a string response wrapped in prose', async () => {
    const { env } = fakeEnv(() => ({ response: 'はい:\n```json\n{"summary":"ok"}\n```' }));
    expect((await chatJson<{ summary: string }>(env, [{ role: 'user', content: 'x' }]))?.summary).toBe('ok');
  });

  it('retries without the schema when the first attempt yields nothing usable', async () => {
    const { env, calls } = fakeEnv((_c, attempt) =>
      attempt === 0 ? { response: 'sorry, I cannot' } : { response: '{"summary":"second try"}' },
    );
    const out = await chatJson<{ summary: string }>(env, [{ role: 'user', content: 'x' }], {
      jsonSchema: { name: 'd', schema: {} },
    });

    expect(out?.summary).toBe('second try');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.response_format).toBeDefined();
    // A model that mishandles the schema keeps mishandling it; the retry has
    // to drop it, not just lower the temperature.
    expect(calls[1]?.response_format).toBeUndefined();
    expect(calls[1]?.temperature).toBe(0);
  });

  it('gives up with null rather than throwing when nothing parses', async () => {
    const { env, calls } = fakeEnv(() => ({ response: 'no json here' }));
    expect(await chatJson(env, [{ role: 'user', content: 'x' }])).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('tolerates a bare string response and a missing response field', async () => {
    const bare = fakeEnv(() => '{"summary":"bare"}');
    expect((await chatJson<{ summary: string }>(bare.env, [{ role: 'user', content: 'x' }]))?.summary).toBe(
      'bare',
    );

    const empty = fakeEnv(() => ({}));
    expect(await chatJson(empty.env, [{ role: 'user', content: 'x' }])).toBeNull();
  });
});

describe('chat', () => {
  it('stringifies an object response instead of losing it', async () => {
    const { env } = fakeEnv(() => ({ response: { notes: ['a', 'b'] } }));
    expect(await chat(env, [{ role: 'user', content: 'x' }])).toBe('{"notes":["a","b"]}');
  });
});

describe('chatJson error handling', () => {
  it('retries without the schema when the model rejects response_format', async () => {
    const { env, calls } = fakeEnv((call) => {
      if (call.response_format) throw new Error('400: response_format is not supported');
      return { response: '{"summary":"recovered"}' };
    });

    const out = await chatJson<{ summary: string }>(env, [{ role: 'user', content: 'x' }], {
      jsonSchema: { name: 'd', schema: {} },
    });

    expect(out?.summary).toBe('recovered');
    expect(calls).toHaveLength(2);
  });

  it('surfaces the error when every attempt throws', async () => {
    const { env } = fakeEnv(() => {
      throw new Error('AI is over quota');
    });
    await expect(chatJson(env, [{ role: 'user', content: 'x' }])).rejects.toThrow('over quota');
  });
});
