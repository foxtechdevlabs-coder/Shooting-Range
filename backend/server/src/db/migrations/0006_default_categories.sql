-- Default competition categories.
--
-- A packaged installation starts empty (no demo participants), but participants
-- require a category, and the UI offers this fixed list. Without these rows the
-- first admin could not add a single participant. INSERT OR IGNORE keeps any
-- categories an existing database already has, and is safe on every upgrade.

INSERT OR IGNORE INTO categories (name, active) VALUES ('Senior Men', 1);
INSERT OR IGNORE INTO categories (name, active) VALUES ('Senior Women', 1);
INSERT OR IGNORE INTO categories (name, active) VALUES ('Junior Men', 1);
INSERT OR IGNORE INTO categories (name, active) VALUES ('Junior Women', 1);
INSERT OR IGNORE INTO categories (name, active) VALUES ('Youth', 1);
