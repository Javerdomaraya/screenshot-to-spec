// @vitest-environment node
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { openSchoolDatabase, type SchoolDatabase } from "../../electron/db/database";
import { createAdminAuthService } from "../../electron/services/adminAuth";

const databases: SchoolDatabase[] = [];
const folders: string[] = [];
async function database() {
  const dir = mkdtempSync(join(tmpdir(), "eclass-admin-auth-"));
  folders.push(dir);
  const db = await openSchoolDatabase(dir);
  databases.push(db);
  return { db, dir };
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("requires first-run password setup and never stores a plaintext password", async () => {
  const { db } = await database();
  const auth = createAdminAuthService(db);
  expect(auth.status()).toEqual({ configured: false, authenticated: false, username: "admin" });
  await expect(auth.setup("short")).rejects.toThrow(/12 characters/);
  expect(auth.status().configured).toBe(false);
  await auth.setup("A-long-and-unique-secret-4387");
  expect(auth.status()).toEqual({ configured: true, authenticated: true, username: "admin" });
  const row = db.prepare("SELECT * FROM admin_credentials").get() as Record<string, string>;
  expect(row["password_hash"]).not.toContain("A-long-and-unique-secret-4387");
  expect(row["salt"]).not.toEqual(row["password_hash"]);
  await expect(auth.setup("Another-password-4387")).rejects.toThrow(/already configured/i);
});

it("requires sign-in after logout and application restart; failed logins do not unlock data", async () => {
  const { db } = await database();
  const auth = createAdminAuthService(db);
  await auth.setup("A-long-and-unique-secret-4387");
  auth.logout();
  expect(auth.authenticated()).toBe(false);
  await expect(auth.signIn("wrong-password")).rejects.toThrow(/invalid password/i);
  expect(auth.authenticated()).toBe(false);
  await auth.signIn("A-long-and-unique-secret-4387");
  expect(auth.authenticated()).toBe(true);
  const restarted = createAdminAuthService(db);
  expect(restarted.status()).toEqual({ configured: true, authenticated: false, username: "admin" });
  await restarted.signIn("A-long-and-unique-secret-4387");
  expect(restarted.authenticated()).toBe(true);
});

it("rate-limits repeated incorrect passwords without ever deleting existing school records", async () => {
  const { db } = await database();
  db.prepare("INSERT INTO teachers (name,name_key) VALUES('Protected Teacher','protected teacher')").run();
  const auth = createAdminAuthService(db);
  await auth.setup("A-long-and-unique-secret-4387");
  auth.logout();
  for (let i = 0; i < 5; i++) await expect(auth.signIn("bad-password")).rejects.toThrow();
  await expect(auth.signIn("A-long-and-unique-secret-4387")).rejects.toThrow(/too many/i);
  expect(db.prepare("SELECT COUNT(*) AS total FROM teachers").get()).toEqual({ total: 1 });
});

it("migrates an existing school database with a verified pre-migration backup", async () => {
  const { db, dir } = await database();
  const auth = createAdminAuthService(db);
  await auth.setup("A-long-and-unique-secret-4387");
  db.prepare("INSERT INTO teachers(name,name_key) VALUES('Saved Teacher','saved teacher')").run();
  db.close();
  databases.splice(databases.indexOf(db), 1);
  const restored = await openSchoolDatabase(dir);
  databases.push(restored);
  expect(restored.prepare("SELECT name FROM teachers").all()).toEqual([{ name: "Saved Teacher" }]);
  expect(createAdminAuthService(restored).status().configured).toBe(true);
  expect(existsSync(join(dir, "eclass.db"))).toBe(true);
  expect(readdirSync(dir).some((file) => file.includes("before-v3"))).toBe(false);
});

it("backs up existing school records before upgrading a v2 database to administrator login", async () => {
  const { db, dir } = await database();
  db.prepare("INSERT INTO teachers (name,name_key) VALUES('Existing Teacher','existing teacher')").run();
  // Recreate a v2 installation without changing its existing school records.
  db.exec("DROP TABLE admin_credentials; DELETE FROM schema_version WHERE version=3");
  db.close();
  databases.splice(databases.indexOf(db), 1);
  const upgraded = await openSchoolDatabase(dir);
  databases.push(upgraded);
  expect(upgraded.prepare("SELECT name FROM teachers").all()).toEqual([{ name: "Existing Teacher" }]);
  expect(createAdminAuthService(upgraded).status().configured).toBe(false);
  const backupName = readdirSync(dir).find((file) => file.startsWith("eclass.before-v3.") && file.endsWith(".bak"));
  expect(backupName).toBeDefined();
  const backup = new Database(join(dir, backupName!), { readonly: true });
  try {
    expect(backup.prepare("SELECT name FROM teachers").all()).toEqual([{ name: "Existing Teacher" }]);
    expect(backup.prepare("SELECT MAX(version) AS v FROM schema_version").get()).toEqual({ v: 2 });
  } finally {
    backup.close();
  }
});
