import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import initialSchema from "./migrations/001_initial.sql?raw";
import bellProfiles from "./migrations/002_profiles.sql?raw";
import administrator from "./migrations/003_admin_auth.sql?raw";

export type SchoolDatabase = Database.Database;

const migrations = [
  { version: 1, name: "initial", sql: initialSchema },
  { version: 2, name: "bell_profiles", sql: bellProfiles },
  { version: 3, name: "admin_auth", sql: administrator },
] as const;

/**
 * Call from the Electron main process with app.getPath("userData").
 * The renderer must never import this module or open the SQLite file.
 * Callers must close the returned database at app shutdown.
 */
export async function openSchoolDatabase(userDataDirectory: string): Promise<SchoolDatabase> {
  mkdirSync(userDataDirectory, { recursive: true });
  const path = join(userDataDirectory, "eclass.db");
  const preexisting = existsSync(path);
  const db = new Database(path, { timeout: 5000 });

  try {
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");

    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `);

    const current = db
      .prepare("SELECT COALESCE(MAX(version),0) AS version FROM schema_version")
      .get() as { version: number };
    if (current.version > migrations[migrations.length - 1]!.version) {
      throw new Error("This database was created by a newer version of E-CLASS.");
    }

    for (const migration of migrations) {
      if (migration.version <= current.version) continue;

      // The initial empty database has nothing to preserve. Existing school
      // records are backed up via SQLite's online backup API (WAL-safe) before
      // EACH migration, and backups are never automatically deleted.
      if (preexisting) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath = join(
          userDataDirectory,
          `eclass.before-v${migration.version}.${stamp}.bak`,
        );
        await db.backup(backupPath);
      }

      db.transaction(() => {
        db.exec(migration.sql);
        db.prepare("INSERT INTO schema_version(version,name) VALUES(?,?)").run(
          migration.version,
          migration.name,
        );
      }).immediate();
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
