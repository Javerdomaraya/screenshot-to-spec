import type { SchoolDatabase } from "../database";

export function settingsRepository(db: SchoolDatabase) {
  const get = (key: string) =>
    (db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined)
      ?.value ?? null;
  const list = () =>
    db.prepare("SELECT key,value FROM settings ORDER BY key").all() as {
      key: string;
      value: string;
    }[];
  const set = (key: string, value: string): void => {
    db.prepare(
      `INSERT INTO settings(key,value) VALUES(?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).run(key, value);
  };
  return { get, list, set };
}
