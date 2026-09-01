import { Hono } from 'hono';
import type { Env } from './env';
import { api } from './routes/api';
import { pruneAudio, runDailyStack } from './lib/digest';

/**
 * RecordLog Worker.
 *
 *   fetch()     — /api/* ; everything else is the PWA, served from static assets
 *   scheduled() — the once-a-day job that folds the previous day into a digest
 */

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  await next();
  // The app is same-origin and cookie-authenticated; lock the surface down.
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'same-origin');
  c.header('permissions-policy', 'microphone=(self), geolocation=(), camera=()');
});

app.route('/api', api);

app.onError((error, c) => {
  console.error('unhandled', error);
  return c.json({ error: 'サーバー側でエラーが発生しました', detail: error.message }, 500);
});

app.notFound((c) =>
  c.req.path.startsWith('/api/') ? c.json({ error: 'not found' }, 404) : c.env.ASSETS.fetch(c.req.raw),
);

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const started = Date.now();
        try {
          const outcomes = await runDailyStack(env);
          const pruned = await pruneAudio(env);
          console.log(
            JSON.stringify({
              job: 'daily-stack',
              cron: event.cron,
              days: outcomes,
              prunedAudio: pruned,
              ms: Date.now() - started,
            }),
          );
        } catch (error) {
          console.error('daily-stack failed', error);
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
