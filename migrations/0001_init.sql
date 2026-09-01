-- RecordLog schema.
--   memos   : one row per spoken capture
--   digests : one row per day, written by the once-a-day stacking job
--   runs    : an audit trail so a missed or failed cron run is visible

CREATE TABLE IF NOT EXISTS memos (
  id           TEXT PRIMARY KEY,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  day          TEXT    NOT NULL,
  text         TEXT    NOT NULL DEFAULT '',
  raw_text     TEXT    NOT NULL DEFAULT '',
  title        TEXT,
  tags         TEXT    NOT NULL DEFAULT '[]',
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  lang         TEXT    NOT NULL DEFAULT 'ja-JP',
  engine       TEXT    NOT NULL DEFAULT 'cloud-whisper',
  audio_key    TEXT,
  status       TEXT    NOT NULL DEFAULT 'pending',
  stacked_into TEXT,
  deleted_at   INTEGER
);

CREATE INDEX IF NOT EXISTS memos_by_day     ON memos (day, created_at);
CREATE INDEX IF NOT EXISTS memos_by_updated ON memos (updated_at);
CREATE INDEX IF NOT EXISTS memos_pending    ON memos (status, day) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS digests (
  day         TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  summary     TEXT    NOT NULL DEFAULT '',
  sections    TEXT    NOT NULL DEFAULT '[]',
  actions     TEXT    NOT NULL DEFAULT '[]',
  threads     TEXT    NOT NULL DEFAULT '[]',
  highlights  TEXT    NOT NULL DEFAULT '[]',
  tags        TEXT    NOT NULL DEFAULT '[]',
  memo_count  INTEGER NOT NULL DEFAULT 0,
  model       TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS runs (
  id         TEXT PRIMARY KEY,
  ran_at     INTEGER NOT NULL,
  day        TEXT    NOT NULL,
  trigger    TEXT    NOT NULL,          -- 'cron' | 'manual'
  status     TEXT    NOT NULL,          -- 'ok' | 'empty' | 'error'
  memo_count INTEGER NOT NULL DEFAULT 0,
  detail     TEXT
);

CREATE INDEX IF NOT EXISTS runs_by_time ON runs (ran_at DESC);
