import type { Memo } from '@shared/types';
import { api, HttpError } from './api';
import {
  clearDeletions,
  deleteMemo,
  dirtyMemos,
  getMeta,
  pendingDeletions,
  putMemos,
  setMeta,
  type LocalMemo,
} from './db/local';

const SINCE_KEY = 'sync:since';

export interface SyncOutcome {
  pushed: number;
  pulled: number;
  removed: number;
  at: number;
}

const stripLocal = (m: LocalMemo): Memo => {
  const { dirty: _dirty, transcribing: _transcribing, error: _error, ...rest } = m;
  return rest;
};

/**
 * One round trip: push everything the server hasn't confirmed, pull everything
 * that changed elsewhere. Last-write-wins on `updatedAt`, which is the right
 * trade for a single-person notebook.
 */
export async function syncNow(): Promise<SyncOutcome> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new HttpError(0, 'オフラインです');
  }

  const [pending, deleted, since] = await Promise.all([
    dirtyMemos(),
    pendingDeletions(),
    getMeta<number>(SINCE_KEY, 0),
  ]);

  // Memos still being transcribed aren't ready to leave the device.
  const outgoing = pending.filter((m) => !m.transcribing && m.text.trim().length > 0);

  const res = await api.sync({
    memos: outgoing.map(stripLocal),
    deleted,
    since,
  });

  if (deleted.length) await clearDeletions(deleted);

  // Mark what we pushed as clean, then apply what came back.
  const pushedClean: LocalMemo[] = outgoing.map((m) => ({ ...m, dirty: false, error: null }));
  const incoming: LocalMemo[] = res.memos.map((m) => ({ ...m, dirty: false, error: null }));
  await putMemos([...pushedClean, ...incoming]);

  for (const id of res.deleted) await deleteMemo(id);
  if (res.deleted.length) await clearDeletions(res.deleted);

  await setMeta(SINCE_KEY, res.now);

  return { pushed: outgoing.length, pulled: incoming.length, removed: res.deleted.length, at: res.now };
}

/** Retries with backoff; used by the background "we're online again" path. */
export async function syncWithRetry(attempts = 3): Promise<SyncOutcome | null> {
  let wait = 1500;
  for (let i = 0; i < attempts; i++) {
    try {
      return await syncNow();
    } catch (error) {
      if (error instanceof HttpError && error.isAuth) throw error;
      if (i === attempts - 1) return null;
      await new Promise((r) => setTimeout(r, wait));
      wait *= 2;
    }
  }
  return null;
}
