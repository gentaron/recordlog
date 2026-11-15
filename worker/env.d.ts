export interface Env {
  DB: D1Database;
  /** Optional: present only when the R2 bucket is bound. See wrangler.jsonc. */
  AUDIO?: R2Bucket;
  AI: Ai;
  ASSETS: Fetcher;

  /** IANA timezone that defines "a day" for this deployment. */
  APP_TIMEZONE: string;
  ASR_MODEL: string;
  LLM_MODEL: string;
  KEEP_AUDIO_DAYS: string;

  /** Required secret. Missing configuration denies access, including local development. */
  AUTH_PASSPHRASE?: string;
  /** Secret. Signs the session cookie. Falls back to AUTH_PASSPHRASE. */
  SESSION_SECRET?: string;
}
