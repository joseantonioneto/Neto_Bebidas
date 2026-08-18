ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 1;
UPDATE users SET must_change_password = 1 WHERE must_change_password IS NULL;
