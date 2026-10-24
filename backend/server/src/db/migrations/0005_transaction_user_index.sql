CREATE INDEX IF NOT EXISTS idx_transactions_user_created
  ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_participants_name_id
  ON participants(name, id);
CREATE INDEX IF NOT EXISTS idx_participants_department_bib
  ON participants(department, bib_number, id);
