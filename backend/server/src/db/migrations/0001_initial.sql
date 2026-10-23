-- Migration 0001: Initial schema

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name           TEXT    NOT NULL,
  username            TEXT    NOT NULL UNIQUE,
  password_hash       TEXT    NOT NULL,
  role                TEXT    NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff')),
  permissions         TEXT    NOT NULL DEFAULT '[]',
  active              INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL,
  last_login_at       TEXT
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  expires_at   TEXT    NOT NULL,
  last_seen_at TEXT    NOT NULL
);

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT    NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

-- Participants table
CREATE TABLE IF NOT EXISTS participants (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  bib_number     TEXT    NOT NULL UNIQUE,
  noc            TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  department     TEXT,
  gun_number     TEXT    NOT NULL UNIQUE,
  contact_number TEXT,
  category_id    INTEGER NOT NULL REFERENCES categories(id),
  pouch_status   TEXT    NOT NULL DEFAULT 'in' CHECK (pouch_status IN ('in','out')),
  label_printed  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);

-- Transactions table (append-only via triggers)
CREATE TABLE IF NOT EXISTS transactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  gun_number     TEXT    NOT NULL,
  type           TEXT    NOT NULL CHECK (type IN ('in','out')),
  created_at     TEXT    NOT NULL,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  manual_entry   INTEGER NOT NULL DEFAULT 0
);

-- Activity log (append-only via triggers)
CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id),
  action     TEXT    NOT NULL,
  entity     TEXT    NOT NULL,
  entity_id  TEXT,
  old_values TEXT,
  new_values TEXT,
  created_at TEXT    NOT NULL
);

-- Import batches table
CREATE TABLE IF NOT EXISTS import_batches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  file_name     TEXT    NOT NULL,
  rows_imported INTEGER NOT NULL DEFAULT 0,
  rows_updated  INTEGER NOT NULL DEFAULT 0,
  rows_rejected INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL
);

-- Settings table (key-value)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_participants_gun_number ON participants(gun_number);
CREATE INDEX IF NOT EXISTS idx_participants_bib_number ON participants(bib_number);
CREATE INDEX IF NOT EXISTS idx_participants_noc        ON participants(noc);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_gun_number ON transactions(gun_number);
CREATE INDEX IF NOT EXISTS idx_transactions_participant ON transactions(participant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id        ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at     ON sessions(expires_at);

-- Append-only triggers for transactions
CREATE TRIGGER IF NOT EXISTS trg_transactions_no_update
  BEFORE UPDATE ON transactions
  BEGIN SELECT RAISE(ABORT, 'transactions are append-only: UPDATE not allowed'); END;

CREATE TRIGGER IF NOT EXISTS trg_transactions_no_delete
  BEFORE DELETE ON transactions
  BEGIN SELECT RAISE(ABORT, 'transactions are append-only: DELETE not allowed'); END;

-- Append-only triggers for activity_log
CREATE TRIGGER IF NOT EXISTS trg_activity_log_no_update
  BEFORE UPDATE ON activity_log
  BEGIN SELECT RAISE(ABORT, 'activity_log is append-only: UPDATE not allowed'); END;

CREATE TRIGGER IF NOT EXISTS trg_activity_log_no_delete
  BEFORE DELETE ON activity_log
  BEGIN SELECT RAISE(ABORT, 'activity_log is append-only: DELETE not allowed'); END;

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('event_name', 'National Shooting Championship 2026');
INSERT OR IGNORE INTO settings (key, value) VALUES ('duplicate_scan_window_seconds', '5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('idle_timeout_minutes', '15');
INSERT OR IGNORE INTO settings (key, value) VALUES ('scan_sound', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('logo_text', 'NSC');
INSERT OR IGNORE INTO settings (key, value) VALUES ('label_size', 'medium');
