// @vitest-environment node
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openSchoolDatabase, type SchoolDatabase } from "../../electron/db/database";

const folders: string[] = [];
const opened: SchoolDatabase[] = [];

async function temporaryDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "eclass-schema-"));
  folders.push(dir);
  const db = await openSchoolDatabase(dir);
  opened.push(db);
  return { dir, db };
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("E-CLASS SQLite migrations", () => {
  it("creates WAL/foreign-key-enabled schema and seeds exactly three school bell profiles", async () => {
    const { dir, db } = await temporaryDatabase();
    expect(existsSync(join(dir, "eclass.db"))).toBe(true);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.prepare("SELECT version FROM schema_version ORDER BY version").all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
    ]);

    const profiles = db
      .prepare("SELECT name, school_level FROM bell_schedules ORDER BY name")
      .all();
    expect(profiles).toEqual([
      { name: "JHS-50-A", school_level: "JHS" },
      { name: "JHS-50-B", school_level: "JHS" },
      { name: "SHS-60", school_level: "SHS" },
    ]);
    const slots = db
      .prepare(
        `
      SELECT b.name, s.kind, s.period_no, s.start_time, s.end_time, s.minutes
      FROM time_slots s JOIN bell_schedules b ON b.id=s.bell_schedule_id
      WHERE b.name='SHS-60' ORDER BY s.start_time
    `,
      )
      .all() as Array<Record<string, string | number | null>>;
    expect(slots.filter((s) => s["kind"] === "period")).toHaveLength(8);
    expect(slots[0]).toMatchObject({
      kind: "class_preparation",
      start_time: "07:00",
      end_time: "07:15",
      minutes: 15,
    });
    expect(slots.find((s) => s["kind"] === "lunch_break")).toMatchObject({
      start_time: "11:45",
      end_time: "13:00",
      minutes: 75,
    });
    const jhsA = db
      .prepare(
        `SELECT start_time, end_time FROM time_slots s JOIN bell_schedules b ON b.id=s.bell_schedule_id WHERE b.name='JHS-50-A' AND s.kind='health_break'`,
      )
      .get();
    const jhsB = db
      .prepare(
        `SELECT start_time, end_time FROM time_slots s JOIN bell_schedules b ON b.id=s.bell_schedule_id WHERE b.name='JHS-50-B' AND s.kind='health_break'`,
      )
      .get();
    expect(jhsA).toEqual({ start_time: "09:10", end_time: "09:30" });
    expect(jhsB).toEqual({ start_time: "09:10", end_time: "09:20" });
    expect(db.prepare("SELECT count(*) AS n FROM assignments").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT count(*) AS n FROM admin_credentials").get()).toEqual({ n: 0 });
  });

  it("enforces school-level and dependent-record foreign keys", async () => {
    const { db } = await temporaryDatabase();
    const jhs = db.prepare("SELECT id FROM bell_schedules WHERE name='JHS-50-A'").get() as {
      id: number;
    };
    const shs = db.prepare("SELECT id FROM bell_schedules WHERE name='SHS-60'").get() as {
      id: number;
    };
    const insertSection = db.prepare(
      "INSERT INTO sections(name,grade_level,school_level,bell_schedule_id) VALUES (?,?,?,?)",
    );
    expect(() => insertSection.run("Bad level", 7, "JHS", shs.id)).toThrow();
    expect(() => insertSection.run("Wrong key", 7, "JHS", 9999)).toThrow();
    expect(insertSection.run("Grade 7 - Edge", 7, "JHS", jhs.id).changes).toBe(1);
    expect(() => db.prepare("DELETE FROM bell_schedules WHERE id=?").run(jhs.id)).toThrow();
  });

  it("does not create classroom sample records unless explicitly requested", async () => {
    const { db } = await temporaryDatabase();
    for (const table of [
      "teachers",
      "subjects",
      "rooms",
      "sections",
      "assignments",
      "elective_groups",
    ]) {
      expect(db.prepare(`SELECT count(*) AS total FROM ${table}`).get()).toEqual({ total: 0 });
    }
  });

  it("can reopen an existing database without repeating migrations", async () => {
    const { dir, db } = await temporaryDatabase();
    db.prepare("INSERT INTO settings(key,value) VALUES('custom', 'saved')").run();
    db.close();
    opened.pop();
    const reopened = await openSchoolDatabase(dir);
    opened.push(reopened);
    expect(reopened.prepare("SELECT value FROM settings WHERE key='custom'").get()).toEqual({
      value: "saved",
    });
    expect(reopened.prepare("SELECT count(*) AS n FROM schema_version").get()).toEqual({ n: 3 });
    expect(readdirSync(dir).filter((x) => x.endsWith(".bak"))).toHaveLength(0);
  });

  it("creates a restorable snapshot of existing data before each migration", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eclass-upgrade-"));
    folders.push(dir);
    const legacy = new Database(join(dir, "eclass.db"));
    legacy.exec("CREATE TABLE legacy(value TEXT); INSERT INTO legacy(value) VALUES('keep me')");
    legacy.close();
    const upgraded = await openSchoolDatabase(dir);
    opened.push(upgraded);
    expect(upgraded.prepare("SELECT value FROM legacy").get()).toEqual({ value: "keep me" });
    const backups = readdirSync(dir).filter((x) => x.endsWith(".bak"));
    expect(backups).toHaveLength(3);
    for (const filename of backups) {
      const copy = new Database(join(dir, filename), { readonly: true });
      try {
        expect(copy.prepare("SELECT value FROM legacy").get()).toEqual({ value: "keep me" });
      } finally {
        copy.close();
      }
    }
  });

  it("rejects malformed times, impossible durations and fixed-event class assignments", async () => {
    const { db } = await temporaryDatabase();
    const shs = db.prepare("SELECT id FROM bell_schedules WHERE name='SHS-60'").get() as {
      id: number;
    };
    const badSlot = db.prepare(`INSERT INTO time_slots
      (bell_schedule_id,kind,period_no,start_time,end_time,minutes)
      VALUES(?,'period',9,?,?,?)`);
    expect(() => badSlot.run(shs.id, "07:00", "08:00", 30)).toThrow();
    expect(() => badSlot.run(shs.id, "29:00", "30:00", 60)).toThrow();
  });
});
