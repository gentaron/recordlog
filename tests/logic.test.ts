import { describe, expect, it } from 'vitest';
import { dayKey, shiftDay, isDayKey } from '@shared/day';
import { extractJson } from '../worker/lib/ai';

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
