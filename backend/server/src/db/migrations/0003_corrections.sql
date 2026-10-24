ALTER TABLE transactions ADD COLUMN source TEXT NOT NULL DEFAULT 'scan';

CREATE TABLE corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER REFERENCES transactions(id),
  action TEXT NOT NULL CHECK (action IN ('edit', 'void', 'add')),
  old_values TEXT,
  new_values TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_corrections_transaction_id ON corrections(transaction_id, id DESC);
CREATE INDEX idx_corrections_created_at ON corrections(created_at);

CREATE TRIGGER trg_corrections_no_update
  BEFORE UPDATE ON corrections
  BEGIN SELECT RAISE(ABORT, 'corrections are append-only: UPDATE not allowed'); END;

CREATE TRIGGER trg_corrections_no_delete
  BEFORE DELETE ON corrections
  BEGIN SELECT RAISE(ABORT, 'corrections are append-only: DELETE not allowed'); END;
