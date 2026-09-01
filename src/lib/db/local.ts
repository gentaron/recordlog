import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Digest, Memo } from '@shared/types';

/**
 * The local database is the source of truth while you are talking.
 *
 * Nothing is ever lost to a dead network: a memo is written here the instant
 * the transcript exists, marked dirty, and pushed to D1 whenever the app next
 * reaches the Worker.
 */

export interface LocalMemo extends Memo {
  /** Not yet confirmed by the server. */
  dirty: boolean;
  /** Set while a transcript is still being produced. */
  transcribing?: boolean;
  /** Last failure, shown inline so a memo never fails silently. */
  error?: string | null;
}

interface RecordLogDB extends DBSchema {
  memos: {
    key: string;
    value: LocalMemo;
    indexes: { 'by-day': string; 'by-updated': number; 'by-created': number };
  };
  audio: { key: string; value: { id: string; blob: Blob; savedAt: number } };
  digests: { key: string; value: Digest };
  meta: { key: string; value: unknown };
  tombstones: { key: string; value: { id: string; deletedAt: number } };
}

const DB_NAME = 'recordlog';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<RecordLogDB>> | null = null;

function db(): Promise<IDBPDatabase<RecordLogDB>> {
  dbPromise ??= openDB<RecordLogDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      const memos = database.createObjectStore('memos', { keyPath: 'id' });
      memos.createIndex('by-day', 'day');
      memos.createIndex('by-updated', 'updatedAt');
      memos.createIndex('by-created', 'createdAt');
      database.createObjectStore('audio', { keyPath: 'id' });
      database.createObjectStore('digests', { keyPath: 'day' });
      database.createObjectStore('meta');
      database.createObjectStore('tombstones', { keyPath: 'id' });
    },
  });
  return dbPromise;
}

/* ---------------- memos ---------------- */

export async function putMemo(memo: LocalMemo): Promise<void> {
  await (await db()).put('memos', memo);
}

export async function putMemos(memos: LocalMemo[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('memos', 'readwrite');
  await Promise.all([...memos.map((m) => tx.store.put(m)), tx.done]);
}

export async function getMemo(id: string): Promise<LocalMemo | undefined> {
  return (await db()).get('memos', id);
}

export async function allMemos(): Promise<LocalMemo[]> {
  const rows = await (await db()).getAllFromIndex('memos', 'by-created');
  return rows.reverse();
}

export async function memosForDay(day: string): Promise<LocalMemo[]> {
  const rows = await (await db()).getAllFromIndex('memos', 'by-day', day);
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function dirtyMemos(): Promise<LocalMemo[]> {
  return (await allMemos()).filter((m) => m.dirty);
}

export async function deleteMemo(id: string): Promise<void> {
  const d = await db();
  await Promise.all([
    d.delete('memos', id),
    d.delete('audio', id),
    d.put('tombstones', { id, deletedAt: Date.now() }),
  ]);
}

/* ---------------- tombstones ---------------- */

export async function pendingDeletions(): Promise<string[]> {
  return (await (await db()).getAll('tombstones')).map((t) => t.id);
}

export async function clearDeletions(ids: string[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('tombstones', 'readwrite');
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

/* ---------------- audio ---------------- */

export async function putAudio(id: string, blob: Blob): Promise<void> {
  await (await db()).put('audio', { id, blob, savedAt: Date.now() });
}

export async function getAudio(id: string): Promise<Blob | undefined> {
  return (await (await db()).get('audio', id))?.blob;
}

/** Drops local audio older than `days` — transcripts are what matter long term. */
export async function pruneAudio(days = 7): Promise<number> {
  const cutoff = Date.now() - days * 86_400_000;
  const d = await db();
  const tx = d.transaction('audio', 'readwrite');
  let removed = 0;
  for (const row of await tx.store.getAll()) {
    if (row.savedAt < cutoff) {
      await tx.store.delete(row.id);
      removed++;
    }
  }
  await tx.done;
  return removed;
}

/* ---------------- digests ---------------- */

export async function putDigest(digest: Digest): Promise<void> {
  await (await db()).put('digests', digest);
}

export async function getDigest(day: string): Promise<Digest | undefined> {
  return (await db()).get('digests', day);
}

export async function allDigests(): Promise<Digest[]> {
  return (await (await db()).getAll('digests')).sort((a, b) => b.day.localeCompare(a.day));
}

/* ---------------- meta ---------------- */

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const value = await (await db()).get('meta', key);
  return (value as T) ?? fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', value, key);
}

export async function estimateUsage(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}
