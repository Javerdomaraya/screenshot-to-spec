-- One local administrator account. Passwords are stored only as salted scrypt
-- hashes; no default password, secret, or login session is persisted.
CREATE TABLE admin_credentials (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  username TEXT NOT NULL DEFAULT 'admin' CHECK(username = 'admin'),
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
