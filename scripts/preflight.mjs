/**
 * Catches the two setup mistakes that otherwise surface as confusing errors
 * halfway through a deploy: a D1 database id that was never filled in, and a
 * cron schedule that no longer matches the app's timezone.
 *
 * Everywhere except a Cloudflare build this only warns — you should be able to
 * develop the UI, and run the repo's own CI, before any Cloudflare resources
 * exist. On a Cloudflare build it fails immediately, because a deploy that gets
 * further will fail anyway with a much worse message.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CONFIG = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));
const PLACEHOLDER = 'REPLACE_WITH_YOUR_D1_DATABASE_ID';
// Cloudflare Workers Builds / Pages. The path check is the reliable signal:
// Cloudflare's build image always checks the repo out under /opt/buildhome.
const isCloudflareBuild = !!(
  process.env.WORKERS_CI ||
  process.env.CF_PAGES ||
  process.cwd().startsWith('/opt/buildhome')
);

/** Minimal JSONC reader: strips comments and trailing commas, respecting strings. */
function parseJsonc(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const problems = [];
const notes = [];

let config;
try {
  config = parseJsonc(readFileSync(CONFIG, 'utf8'));
} catch (error) {
  console.error(`preflight: could not read wrangler.jsonc — ${error.message}`);
  process.exit(1);
}

for (const db of config.d1_databases ?? []) {
  if (!db.database_id || db.database_id === PLACEHOLDER) {
    problems.push(
      [
        `D1 database id は未設定です (binding ${db.binding}).`,
        '',
        '    npx wrangler d1 create ' + db.database_name,
        '',
        `  出力された database_id を wrangler.jsonc の "${PLACEHOLDER}" に貼り替えてから、`,
        '  スキーマを流してください:',
        '',
        '    npm run db:migrate',
      ].join('\n'),
    );
  }
}

/* The cron is UTC; the app's "day" is APP_TIMEZONE. If they drift apart the
   daily stack starts running in the middle of the user's day. */
const cron = config.triggers?.crons?.[0];
const tz = config.vars?.APP_TIMEZONE;
if (cron && tz) {
  const [minute, hour] = cron.split(' ');
  if (/^\d+$/.test(hour ?? '')) {
    // What local hour does this UTC hour land on today?
    const probe = new Date(Date.UTC(2026, 0, 15, Number(hour), Number(minute) || 0));
    const localHour = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      hour12: false,
    }).format(probe);
    notes.push(`daily stack: ${cron} UTC → ${localHour}:${String(minute).padStart(2, '0')} ${tz}`);
  }
}

for (const note of notes) console.log(`preflight: ${note}`);

if (problems.length) {
  const body = problems.map((p) => `  ${p}`).join('\n\n');
  if (isCloudflareBuild) {
    console.error(`\npreflight: Cloudflare 側のセットアップが未完了です\n\n${body}\n`);
    process.exit(1);
  }
  console.warn(`\npreflight: セットアップ未完了（ビルドは続行します）\n\n${body}\n`);
}
