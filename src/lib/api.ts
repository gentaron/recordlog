import type {
  ApiError,
  Digest,
  DigestRunResponse,
  Memo,
  RefineResponse,
  SessionInfo,
  SyncResponse,
} from '@shared/types';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
  get isAuth(): boolean {
    return this.status === 401;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (!res.ok) {
    let body: ApiError | null = null;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      /* non-JSON error body */
    }
    throw new HttpError(res.status, body?.error ?? `HTTP ${res.status}`, body?.detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  session: () => request<SessionInfo>('/api/session'),

  login: (passphrase: string) =>
    request<SessionInfo>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ passphrase }),
    }),

  logout: () => request<void>('/api/session', { method: 'DELETE' }),

  sync: (payload: { memos: Memo[]; deleted: string[]; since: number }) =>
    request<SyncResponse>('/api/sync', { method: 'POST', body: JSON.stringify(payload) }),

  refine: (payload: { text: string; context?: string }) =>
    request<RefineResponse>('/api/refine', { method: 'POST', body: JSON.stringify(payload) }),

  digests: (limit = 30) => request<{ digests: Digest[] }>(`/api/digests?limit=${limit}`),

  digest: (day: string) => request<{ digest: Digest | null }>(`/api/digests/${day}`),

  runDigest: (day?: string) =>
    request<DigestRunResponse>('/api/digests/run', {
      method: 'POST',
      body: JSON.stringify(day ? { day } : {}),
    }),
};
