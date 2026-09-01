/**
 * End-to-end capture check.
 *
 * Drives a real Chromium with a synthetic microphone through the whole path —
 * AudioWorklet, VAD, resampler, WAV encoder, IndexedDB, sync — and asserts that
 * what lands on disk is genuine 16 kHz mono PCM of about the right length.
 *
 *   node scripts/make-speech.mjs tests/e2e/artifacts/speech.wav
 *   npm run build && npm run dev:worker        # in another shell
 *   npm run e2e
 *
 * Env:
 *   BASE        app origin                       (default http://127.0.0.1:8787)
 *   PASS        passphrase, if AUTH_PASSPHRASE is set
 *   AUDIO_FILE  WAV to feed the fake microphone  (default tests/e2e/artifacts/speech.wav)
 *   CHROMIUM    browser executable, when not using Playwright's own download
 *   SHOTS       screenshot output directory      (default tests/e2e/artifacts)
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';
const PASS = process.env.PASS ?? '';
const AUDIO_FILE = process.env.AUDIO_FILE ?? 'tests/e2e/artifacts/speech.wav';
const SHOTS = process.env.SHOTS ?? 'tests/e2e/artifacts';

mkdirSync(SHOTS, { recursive: true });

const failures = [];
const check = (name, ok, detail) => {
  if (ok) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
};

/** Reads a store out of the app's own IndexedDB, from inside the page. */
const readStore = (page, store) =>
  page.evaluate(
    (name) =>
      new Promise((resolve) => {
        const req = indexedDB.open('recordlog');
        req.onerror = () => resolve([]);
        req.onsuccess = () => {
          const tx = req.result.transaction(name).objectStore(name).getAll();
          tx.onerror = () => resolve([]);
          tx.onsuccess = async () => {
            const rows = tx.result;
            if (name !== 'audio') return resolve(rows);
            resolve(
              await Promise.all(
                rows.map(async (r) => {
                  const v = new DataView(await r.blob.arrayBuffer());
                  const tag = (o) =>
                    String.fromCharCode(
                      v.getUint8(o),
                      v.getUint8(o + 1),
                      v.getUint8(o + 2),
                      v.getUint8(o + 3),
                    );
                  return {
                    id: r.id,
                    riff: tag(0),
                    wave: tag(8),
                    format: v.getUint16(20, true),
                    channels: v.getUint16(22, true),
                    rate: v.getUint32(24, true),
                    bits: v.getUint16(34, true),
                    seconds: v.getUint32(40, true) / 2 / v.getUint32(24, true),
                  };
                }),
              ),
            );
          };
        };
      }),
    store,
  );

const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${AUDIO_FILE}%noloop`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const context = await browser.newContext({
  viewport: { width: 420, height: 900 },
  deviceScaleFactor: 2,
  permissions: ['microphone'],
});
const page = await context.newPage();

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });

  if (PASS) {
    await page.screenshot({ path: `${SHOTS}/01-login.png` });
    await page.fill('input[type=password]', PASS);
    await page.click('button[type=submit]');
  }

  await page.waitForSelector('text=RecordLog', { timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/02-idle.png` });

  const before = (await readStore(page, 'memos')).length;

  await page.click('button[aria-label="録音を開始"]');
  await page.waitForSelector('text=聞いています', { timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/03-recording.png` });
  await page.waitForTimeout(3200);

  await page.click('button[aria-label="録音を終了して保存"]');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${SHOTS}/04-saved.png`, fullPage: true });

  const memos = await readStore(page, 'memos');
  const audio = await readStore(page, 'audio');
  const fresh = memos.length - before;

  check('a memo was created', fresh === 1, `${fresh} new memos`);

  const memo = memos.sort((a, b) => b.createdAt - a.createdAt)[0];
  check(
    'the memo has a plausible duration',
    memo && memo.durationMs > 1500 && memo.durationMs < 8000,
    `${memo?.durationMs} ms`,
  );
  check('the memo is filed under a calendar day', /^\d{4}-\d{2}-\d{2}$/.test(memo?.day ?? ''), memo?.day);

  const wav = audio[0];
  check('audio was archived on the device', !!wav);
  if (wav) {
    check('the archive is a RIFF/WAVE file', wav.riff === 'RIFF' && wav.wave === 'WAVE');
    check(
      'it is 16-bit mono PCM at 16 kHz',
      wav.format === 1 && wav.channels === 1 && wav.bits === 16 && wav.rate === 16_000,
      JSON.stringify(wav),
    );
    check(
      'its length matches the take',
      Math.abs(wav.seconds - memo.durationMs / 1000) < 0.2,
      `${wav.seconds}s vs ${memo.durationMs / 1000}s`,
    );
  }

  await page.click('text=積層');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/05-digests.png`, fullPage: true });

  await page.click('button[aria-label="設定"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/06-settings.png` });

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
