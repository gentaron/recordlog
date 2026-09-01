import type { Env } from '../env';

/**
 * Single-user auth: one passphrase in, one signed cookie out.
 *
 * No user table, no OAuth, no third party — this is a personal notebook, and
 * the smallest thing that actually keeps strangers out is the right thing.
 * Deployments with no `AUTH_PASSPHRASE` set run open, which is what you want
 * on `wrangler dev` and never what you want on a public hostname.
 */

const COOKIE = 'rl_session';
const TTL_SECONDS = 60 * 60 * 24 * 90;

const enc = new TextEncoder();

const b64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function key(env: Env): Promise<CryptoKey> {
  const secret = env.SESSION_SECRET || env.AUTH_PASSPHRASE || 'recordlog-dev-secret';
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

async function sign(env: Env, payload: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await key(env), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

/** Constant-time comparison; a passphrase check should not leak timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const authRequired = (env: Env): boolean => !!env.AUTH_PASSPHRASE;

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  if (!authRequired(env)) return true;
  const token = readCookie(request, COOKIE);
  if (!token) return false;

  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const expected = await sign(env, payload);
  if (!timingSafeEqual(token, expected)) return false;

  const expires = Number(payload.split(':')[1]);
  return Number.isFinite(expires) && expires > Date.now();
}

export async function verifyPassphrase(env: Env, passphrase: string): Promise<boolean> {
  if (!env.AUTH_PASSPHRASE) return true;
  // Hash both sides first so the comparison length never reveals the secret's.
  const digest = async (s: string) => b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return timingSafeEqual(await digest(passphrase), await digest(env.AUTH_PASSPHRASE));
}

export async function sessionCookie(env: Env): Promise<string> {
  const payload = `v1:${Date.now() + TTL_SECONDS * 1000}`;
  const token = await sign(env, payload);
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export const clearCookie = (): string => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
