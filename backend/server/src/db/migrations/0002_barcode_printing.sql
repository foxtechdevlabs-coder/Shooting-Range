-- Migration 0002: Barcode label printing schema

PRAGMA foreign_keys = ON;

-- Add label_stale and label_printed_at to participants
ALTER TABLE participants ADD COLUMN label_stale INTEGER NOT NULL DEFAULT 0;
ALTER TABLE participants ADD COLUMN label_printed_at TEXT;

-- Print jobs table (append-only via triggers)
CREATE TABLE IF NOT EXISTS print_jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES users(id),
  created_at   TEXT    NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('print', 'reprint', 'test')),
  label_count  INTEGER NOT NULL,
  reason       TEXT,
  status       TEXT    NOT NULL CHECK (status IN ('sent', 'failed')),
  error        TEXT,
  printer_name TEXT    NOT NULL
);

-- Print job items table (append-only via triggers)
CREATE TABLE IF NOT EXISTS print_job_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         INTEGER NOT NULL REFERENCES print_jobs(id),
  participant_id INTEGER REFERENCES participants(id),
  gun_number     TEXT    NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_print_jobs_created_at ON print_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_print_job_items_job_id ON print_job_items(job_id);

-- Append-only triggers for print_jobs
CREATE TRIGGER IF NOT EXISTS trg_print_jobs_no_update
  BEFORE UPDATE ON print_jobs
  BEGIN SELECT RAISE(ABORT, 'print_jobs is append-only: UPDATE not allowed'); END;

CREATE TRIGGER IF NOT EXISTS trg_print_jobs_no_delete
  BEFORE DELETE ON print_jobs
  BEGIN SELECT RAISE(ABORT, 'print_jobs is append-only: DELETE not allowed'); END;

-- Append-only triggers for print_job_items
CREATE TRIGGER IF NOT EXISTS trg_print_job_items_no_update
  BEFORE UPDATE ON print_job_items
  BEGIN SELECT RAISE(ABORT, 'print_job_items is append-only: UPDATE not allowed'); END;

CREATE TRIGGER IF NOT EXISTS trg_print_job_items_no_delete
  BEFORE DELETE ON print_job_items
  BEGIN SELECT RAISE(ABORT, 'print_job_items is append-only: DELETE not allowed'); END;

-- Default label settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('printer_name', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('label_width_mm', '50');
INSERT OR IGNORE INTO settings (key, value) VALUES ('label_height_mm', '25');
INSERT OR IGNORE INTO settings (key, value) VALUES ('label_dpi', '203');
INSERT OR IGNORE INTO settings (key, value) VALUES ('label_darkness', '20');
INSERT OR IGNORE INTO settings (key, value) VALUES ('label_speed', '3');
INSERT OR IGNORE INTO settings (key, value) VALUES ('label_offset_x', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('label_offset_y', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('label_show_event_name', 'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('label_media_tracking', 'gap');
INSERT OR IGNORE INTO settings (key, value) VALUES ('print_driver', '');
