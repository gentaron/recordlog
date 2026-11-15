import test from 'node:test';
import assert from 'node:assert/strict';
import { authRequired, isAuthenticated, verifyPassphrase, sessionCookie } from '../worker/lib/auth.ts';

test('missing configuration denies anonymous access and login', async () => {
  assert.equal(authRequired({}), true);
  assert.equal(await isAuthenticated(new Request('https://example.test/api/sync'), {}), false);
  assert.equal(await verifyPassphrase({}, ''), false);
  await assert.rejects(sessionCookie({}));
});

test('configured sessions work; wrong passphrases and forged cookies fail', async () => {
  const env = { AUTH_PASSPHRASE: 'test-only-strong-passphrase', SESSION_SECRET: 'test-only-session-key' };
  assert.equal(await verifyPassphrase(env, 'wrong'), false);
  assert.equal(await verifyPassphrase(env, env.AUTH_PASSPHRASE), true);
  const cookie = (await sessionCookie(env)).split(';')[0];
  const req = c => new Request('https://example.test/api/sync', { headers: { cookie: c } });
  assert.equal(await isAuthenticated(req(cookie), env), true);
  assert.equal(await isAuthenticated(req(cookie + 'forged'), env), false);
  assert.equal(await isAuthenticated(req(cookie), { ...env, SESSION_SECRET: 'rotated-test-key' }), false);
});

test('malformed percent encoding in cookies is rejected without throwing', async () => {
  const request = new Request('https://example.test/api/sync', { headers: { cookie: 'rl_session=%ZZ' } });
  assert.equal(await isAuthenticated(request, { AUTH_PASSPHRASE: 'test-only-passphrase' }), false);
});
