PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,               -- OIDC subject, stable across renames
  email        TEXT NOT NULL DEFAULT '',
  name         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,                 -- SHA-256 of the cookie token
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS domains (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  host       TEXT NOT NULL UNIQUE,             -- lowercase, no scheme
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  dest          TEXT NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '',
  expires_at    TEXT,                          -- NULL means never
  disabled      INTEGER NOT NULL DEFAULT 0,
  owner_id      TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  last_click_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_links_owner ON links(owner_id, deleted_at);

-- One namespace for primary slugs and aliases alike. Rows are never removed,
-- so a slug that has been handed out is never pointed somewhere else later.
CREATE TABLE IF NOT EXISTS slugs (
  domain_id  INTEGER NOT NULL REFERENCES domains(id),
  slug       TEXT NOT NULL,                    -- stored lowercase
  link_id    INTEGER REFERENCES links(id),     -- NULL once retired
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (domain_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_slugs_link ON slugs(link_id);

CREATE TABLE IF NOT EXISTS clicks (
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,                       -- YYYY-MM-DD, UTC
  total   INTEGER NOT NULL DEFAULT 0,
  uniques INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, day)
);

-- Salted daily hashes only. The salt rotates every day and the old one is
-- discarded, so a visitor cannot be recomputed or followed across days.
CREATE TABLE IF NOT EXISTS click_seen (
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,
  visitor TEXT NOT NULL,
  PRIMARY KEY (link_id, day, visitor)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Preferences that belong to a person rather than to the instance, so a choice
-- made on a phone is already made on the desktop. Keyed like the global
-- settings table, one row per key so adding a preference needs no migration.
CREATE TABLE IF NOT EXISTS user_prefs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
