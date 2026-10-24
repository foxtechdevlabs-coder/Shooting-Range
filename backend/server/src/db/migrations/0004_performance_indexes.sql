CREATE INDEX IF NOT EXISTS idx_transactions_participant_created_id
  ON transactions(participant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_created_id
  ON transactions(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_gun_created
  ON transactions(gun_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corrections_transaction_id_id
  ON corrections(transaction_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_corrections_created_user
  ON corrections(created_at DESC, user_id);
CREATE INDEX IF NOT EXISTS idx_activity_created_user_action
  ON activity_log(created_at DESC, user_id, action);
CREATE INDEX IF NOT EXISTS idx_participants_category_status_bib
  ON participants(category_id, pouch_status, bib_number);
CREATE INDEX IF NOT EXISTS idx_participants_status_bib
  ON participants(pouch_status, bib_number);
