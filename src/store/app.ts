import { create } from 'zustand';
import type { Digest, SessionInfo } from '@shared/types';
import { api, HttpError } from '@/lib/api';
import {
  allDigests,
  allMemos,
  deleteMemo as dbDeleteMemo,
  getMemo,
  putDigest,
  putMemo,
  pruneAudio,
  type LocalMemo,
} from '@/lib/db/local';
import { syncNow } from '@/lib/sync';
import { dayKey, DEFAULT_TZ } from '@/lib/time';

export type Toast = { id: number; kind: 'info' | 'error' | 'ok'; text: string };

interface AppState {
  ready: boolean;
  memos: LocalMemo[];
  digests: Digest[];
  session: SessionInfo | null;
  /** Set when the deployment wants a passphrase and we don't have a session. */
  locked: boolean;
  syncing: boolean;
  lastSyncAt: number | null;
  online: boolean;
  toasts: Toast[];

  hydrate(): Promise<void>;
  refreshSession(): Promise<void>;
  login(passphrase: string): Promise<boolean>;
  logout(): Promise<void>;

  saveMemo(memo: LocalMemo): Promise<void>;
  patchMemo(id: string, patch: Partial<LocalMemo>): Promise<void>;
  removeMemo(id: string): Promise<void>;
  refineMemo(id: string): Promise<void>;

  sync(quiet?: boolean): Promise<void>;
  loadDigests(): Promise<void>;
  runDigest(day: string): Promise<Digest | null>;

  toast(text: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
}

let toastSeq = 0;

export const timezone = (): string => useApp.getState().session?.timezone ?? DEFAULT_TZ;
export const today = (): string => dayKey(Date.now(), timezone());

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  memos: [],
  digests: [],
  session: null,
  locked: false,
  syncing: false,
  lastSyncAt: null,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  toasts: [],

  async hydrate() {
    const [memos, digests] = await Promise.all([allMemos(), allDigests()]);
    set({ memos, digests, ready: true });
    await get().refreshSession();
    if (!get().locked) {
      void get().sync(true);
      void get().loadDigests();
    }
    void pruneAudio(7);
  },

  async refreshSession() {
    try {
      const session = await api.session();
      set({ session, locked: session.authRequired && !session.authenticated });
    } catch (error) {
      if (error instanceof HttpError && error.isAuth) set({ locked: true });
      // Offline: keep whatever we knew, the local data still works.
    }
  },

  async login(passphrase) {
    try {
      const session = await api.login(passphrase);
      set({ session, locked: false });
      void get().sync(true);
      void get().loadDigests();
      return true;
    } catch {
      return false;
    }
  },

  async logout() {
    await api.logout().catch(() => undefined);
    set({ locked: true, session: null });
  },

  async saveMemo(memo) {
    await putMemo(memo);
    set((s) => {
      const rest = s.memos.filter((m) => m.id !== memo.id);
      return { memos: [memo, ...rest].sort((a, b) => b.createdAt - a.createdAt) };
    });
  },

  async patchMemo(id, patch) {
    const current = get().memos.find((m) => m.id === id) ?? (await getMemo(id));
    if (!current) return;
    const next: LocalMemo = {
      ...current,
      ...patch,
      updatedAt: patch.updatedAt ?? Date.now(),
      dirty: patch.dirty ?? true,
    };
    await get().saveMemo(next);
  },

  async removeMemo(id) {
    await dbDeleteMemo(id);
    set((s) => ({ memos: s.memos.filter((m) => m.id !== id) }));
    void get().sync(true);
  },

  async refineMemo(id) {
    const memo = get().memos.find((m) => m.id === id);
    if (!memo || !memo.text.trim()) return;
    try {
      const out = await api.refine({ text: memo.rawText || memo.text });
      await get().patchMemo(id, {
        text: out.text || memo.text,
        title: out.title || memo.title,
        tags: out.tags.length ? out.tags : memo.tags,
      });
      void get().sync(true);
    } catch {
      get().toast('整形に失敗しました', 'error');
    }
  },

  async sync(quiet = false) {
    if (get().syncing || get().locked) return;
    set({ syncing: true });
    try {
      await syncNow();
      const memos = await allMemos();
      set({ memos, lastSyncAt: Date.now() });
      if (!quiet) get().toast('同期しました', 'ok');
    } catch (error) {
      if (error instanceof HttpError && error.isAuth) set({ locked: true });
      else if (!quiet) get().toast('同期できませんでした', 'error');
    } finally {
      set({ syncing: false });
    }
  },

  async loadDigests() {
    try {
      const { digests } = await api.digests(60);
      await Promise.all(digests.map(putDigest));
      set({ digests });
    } catch {
      set({ digests: await allDigests() });
    }
  },

  async runDigest(day) {
    try {
      const res = await api.runDigest(day);
      if (res.digest) {
        await putDigest(res.digest);
        set((s) => ({
          digests: [res.digest!, ...s.digests.filter((d) => d.day !== day)].sort((a, b) =>
            b.day.localeCompare(a.day),
          ),
        }));
        get().toast('その日ぶんを積みました', 'ok');
        void get().sync(true);
        return res.digest;
      }
      get().toast(res.reason ?? 'まとめるものがありませんでした', 'info');
      return null;
    } catch (error) {
      get().toast(error instanceof HttpError ? error.message : 'まとめに失敗しました', 'error');
      return null;
    }
  },

  toast(text, kind = 'info') {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), 4200);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/* Keep the store honest about connectivity, and catch up the moment we're back. */
if (typeof window !== 'undefined') {
  const update = (online: boolean) => {
    useApp.setState({ online });
    if (online) void useApp.getState().sync(true);
  };
  window.addEventListener('online', () => update(true));
  window.addEventListener('offline', () => update(false));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) void useApp.getState().sync(true);
  });
}
