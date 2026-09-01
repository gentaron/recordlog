export interface Env {
  DB: D1Database;
  AUDIO: R2Bucket;
  AI: Ai;
  ASSETS: Fetcher;

  /** IANA timezone that defines "a day" for this deployment. */
  APP_TIMEZONE: string;
  ASR_MODEL: string;
  LLM_MODEL: string;
  KEEP_AUDIO_DAYS: string;

  /** Secret. When unset the app runs open — fine for local dev, not for the internet. */
  AUTH_PASSPHRASE?: string;
  /** Secret. Signs the session cookie. Falls back to AUTH_PASSPHRASE. */
  SESSION_SECRET?: string;
}
