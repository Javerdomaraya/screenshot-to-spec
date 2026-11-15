// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSchoolDatabase, type SchoolDatabase } from "../../electron/db/database";
import { createCatalogService } from "../../electron/services/catalog";
import { createScheduleService } from "../../electron/services/schedule";

let db: SchoolDatabase;
let dir: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "eclass-catalog-"));
  db = await openSchoolDatabase(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const teacher = {
  name: "Ana Cruz",
  specialization: "Math",
  employment_type: "Permanent" as const,
  min_hours: 18,
  max_hours: 30,
};
const subject = { name: "Math", grade_level: 7, minutes_per_week: 300 };
const room = { name: "Room 101", capacity: 40, type: "Classroom" as const };

describe("main-process catalog service", () => {
  it("writes the canonical school year when settings use the legacy separator", () => {
    const catalog = createCatalogService(db);
    const saved = catalog.saveSettings({
      expectedRevision: 0, schoolName: "Fictional School", schoolYear: " 2026–2027 ",
      preparedBy: "", schoolHead: "", thresholds: { underloadBelow: 18, balancedMax: 30 },
    });
    expect(saved.settings["school_year"]).toBe("2026-2027");
    for (const schoolYear of ["", "Summer term", "2026-2029", "x".repeat(33)]) {
      expect(() => catalog.saveSettings({
        expectedRevision: saved.revision, schoolName: "Fictional School", schoolYear,
        preparedBy: "", schoolHead: "", thresholds: { underloadBelow: 18, balancedMax: 30 },
      })).toThrow(/school year/i);
    }
  });
  it("updates school profile and workload thresholds transactionally without changing school records", () => {
    const catalog = createCatalogService(db);
    const savedTeacher = catalog.teachers.create(teacher);
    const before = catalog.snapshot();
    const updated = catalog.saveSettings({
      expectedRevision: before.revision,
      schoolName: "ICT High School of Eastern Biliran",
      schoolYear: "2026-2027", preparedBy: "Ms. Reyes", schoolHead: "Dr. Cruz",
      thresholds: { underloadBelow: 18, balancedMax: 30 },
    });
    expect(updated.revision).toBe(before.revision + 1);
    expect(updated.settings).toMatchObject({
      school_name: "ICT High School of Eastern Biliran",
      school_year: "2026-2027", prepared_by: "Ms. Reyes", approved_by: "Dr. Cruz",
      underload_below: "18", balanced_max: "30",
    });
    expect(updated.teachers).toEqual(before.teachers);
    expect(catalog.teachers.get(savedTeacher.id).name).toBe(teacher.name);
    expect(() => catalog.saveSettings({
      expectedRevision: before.revision, schoolName: "Changed", schoolYear: "2026-2027",
      preparedBy: "", schoolHead: "", thresholds: { underloadBelow: 10, balancedMax: 20 },
    })).toThrow(/changed elsewhere/i);
    expect(catalog.snapshot().settings["school_name"]).toBe(updated.settings["school_name"]);
  });
  it("rejects invalid thresholds and years without partially changing SQLite settings", () => {
    const catalog = createCatalogService(db);
    const before = catalog.snapshot();
    const request = {
      expectedRevision: before.revision, schoolName: "School", schoolYear: "2026-2027",
      preparedBy: "", schoolHead: "", thresholds: { underloadBelow: 18, balancedMax: 30 },
    };
    expect(() => catalog.saveSettings({ ...request, thresholds: { underloadBelow: 40, balancedMax: 20 } })).toThrow(/greater/i);
    expect(() => catalog.saveSettings({ ...request, schoolYear: "2026-2029" })).toThrow(/school year/i);
    expect(catalog.snapshot()).toEqual(before);
  });
  it("sets an initially blank school name once, preserving all existing school records", () => {
    const catalog = createCatalogService(db);
    const t = catalog.teachers.create(teacher);
    const before = catalog.snapshot();
    const first = catalog.ensureSchoolName("ICT High School of Eastern Biliran");
    expect(first.settings["school_name"]).toBe("ICT High School of Eastern Biliran");
    expect(first.revision).toBe(before.revision + 1);
    expect(first.teachers).toEqual(before.teachers);
    const second = catalog.ensureSchoolName("Different School");
    expect(second.settings["school_name"]).toBe(first.settings["school_name"]);
    expect(second.revision).toBe(first.revision);
    expect(catalog.teachers.get(t.id).name).toBe(teacher.name);
  });
  it("does not silently change an assigned section's bell schedule", () => {
    const catalog = createCatalogService(db);
    const teacher = catalog.teachers.create({
      name: "Teacher One",
      specialization: "Science",
      employment_type: "Permanent",
      min_hours: 18,
      max_hours: 30,
    });
    const subject = catalog.subjects.create({
      name: "Science",
      grade_level: 8,
      minutes_per_week: 300,
    });
    const room = catalog.rooms.create({ name: "Test Room", capacity: 40, type: "Classroom" });
    const profiles = catalog.bellSchedules.list();
    const first = profiles.find((p) => p.name === "JHS-50-A")!;
    const other = profiles.find((p) => p.name === "JHS-50-B")!;
    const section = catalog.sections.create({
      name: "Grade 8 Edge",
      grade_level: 8,
      school_level: "JHS",
      adviser_teacher_id: null,
      bell_schedule_id: first.id,
    });
    const slot = catalog.bellSchedules.listPeriods(first.id)[2]!;
    createScheduleService(db).save({
      schoolYear: "2026-2027",
      term: 2,
      day: 1,
      sectionId: section.id,
      subjectId: subject.id,
      teacherId: teacher.id,
      roomId: room.id,
      startTimeSlotId: slot.id,
      durationPeriods: 1,
    });
    const changed = { ...section, bell_schedule_id: other.id };
    expect(() => catalog.sections.update(section.id, changed)).toThrow(/in use/i);
    expect(catalog.sections.get(section.id).bell_schedule_id).toBe(first.id);
    const before = catalog.snapshot();
    expect(() =>
      catalog.applySnapshot({
        expectedRevision: before.revision,
        teachers: [
          {
            id: String(teacher.id),
            name: teacher.name,
            specialization: teacher.specialization,
            employmentType: teacher.employment_type,
            minHours: 18,
            maxHours: 30,
          },
        ],
        subjects: [
          { id: String(subject.id), name: subject.name, gradeLevel: 8, minutesPerWeek: 300 },
        ],
        rooms: [{ id: String(room.id), name: room.name, capacity: 40, type: "Classroom" }],
        sections: [
          {
            id: String(section.id),
            name: section.name,
            gradeLevel: 8,
            schoolLevel: "JHS",
            bellScheduleId: String(other.id),
            adviser: "",
          },
        ],
      }),
    ).toThrow(/in use/i);
    expect(catalog.snapshot().revision).toBe(before.revision);
  });
  it("creates, lists, edits, and deletes each school entity with numeric SQLite IDs", () => {
    const svc = createCatalogService(db);
    const t = svc.teachers.create(teacher);
    const s = svc.subjects.create(subject);
    const r = svc.rooms.create(room);
    const bell = svc.bellSchedules.list().find((b) => b.name === "JHS-50-A")!;
    const section = svc.sections.create({
      name: "Grade 7 Edge",
      grade_level: 7,
      school_level: "JHS",
      bell_schedule_id: bell.id,
      adviser_teacher_id: t.id,
    });
    expect(svc.teachers.get(t.id).name).toBe("Ana Cruz");
    expect(svc.subjects.list().map((x) => x.id)).toEqual([s.id]);
    expect(svc.rooms.update(r.id, { ...room, name: "Room 102" }).name).toBe("Room 102");
    expect(svc.sections.list()[0]?.adviser_teacher_id).toBe(t.id);
    expect(svc.teachers.list()).toHaveLength(1);
    expect(() => svc.teachers.delete(t.id)).toThrow(/in use/i);
    expect(svc.sections.delete(section.id)).toBe(true);
    expect(svc.teachers.delete(t.id)).toBe(true);
    expect(svc.subjects.delete(s.id)).toBe(true);
    expect(svc.rooms.delete(r.id)).toBe(true);
  });

  it("validates payloads and rejects missing or invalid records", () => {
    const svc = createCatalogService(db);
    expect(() => svc.teachers.create({ ...teacher, name: " " })).toThrow(/required/i);
    expect(() => svc.teachers.create({ ...teacher, max_hours: 10 })).toThrow(/max/i);
    expect(() => svc.subjects.create({ ...subject, grade_level: 15 })).toThrow(/grade/i);
    expect(() => svc.rooms.create({ ...room, capacity: -1 })).toThrow(/capacity/i);
    expect(() => svc.teachers.get(-1)).toThrow(/id/i);
    expect(() => svc.teachers.delete(900)).toThrow(/not found/i);
    const bell = svc.bellSchedules.list().find((x) => x.name === "SHS-60")!;
    expect(() =>
      svc.sections.create({
        name: "Grade 7 Invalid",
        grade_level: 7,
        school_level: "JHS",
        bell_schedule_id: bell.id,
        adviser_teacher_id: null,
      }),
    ).toThrow(/matching/i);
    expect(() =>
      svc.sections.create({
        name: "Grade 7 No Adviser",
        grade_level: 7,
        school_level: "JHS",
        bell_schedule_id: 999999,
        adviser_teacher_id: null,
      }),
    ).toThrow(/bell schedule/i);
    const literalName = "Room'); DROP TABLE teachers;--";
    expect(svc.rooms.create({ ...room, name: literalName }).name).toBe(literalName);
    expect(svc.snapshot().teachers).toEqual([]);
  });

  it("applies a whole-page catalog snapshot transactionally with ID mappings and optimistic revision", () => {
    const svc = createCatalogService(db);
    const initial = svc.snapshot();
    expect(initial.revision).toBe(0);
    const changed = svc.applySnapshot({
      expectedRevision: initial.revision,
      teachers: [
        {
          id: "te-temporary",
          name: "Maria Santos",
          specialization: "English",
          employmentType: "Permanent",
          minHours: 18,
          maxHours: 30,
        },
      ],
      subjects: [{ id: "sub-new", ...{ name: "English", gradeLevel: 7, minutesPerWeek: 300 } }],
      rooms: [{ id: "ro-new", ...{ name: "Room 101", capacity: 40, type: "Classroom" as const } }],
      sections: [
        {
          id: "se-new",
          name: "Grade 7 Edge",
          gradeLevel: 7,
          schoolLevel: "JHS" as const,
          adviser: "Maria Santos",
        },
      ],
    });
    expect(changed.revision).toBe(1);
    expect(changed.snapshot).toMatchObject({
      revision: 1,
      teachers: [expect.objectContaining({ name: "Maria Santos" })],
      sections: [expect.objectContaining({ name: "Grade 7 Edge" })],
    });
    expect(changed.snapshot?.sections[0]?.bell_schedule_id).toBe(
      initial.bellSchedules.find((schedule) => schedule.name === "JHS-50-A")?.id,
    );
    expect(changed.snapshot?.sections[0]?.adviser_teacher_id).toBe(
      Number(changed.idMap["te-temporary"]),
    );
    expect(changed.idMap["te-temporary"]).toMatch(/^\d+$/);
    expect(changed.idMap["se-new"]).toMatch(/^\d+$/);
    expect(svc.snapshot().sections[0]?.adviser_teacher_id).toBe(
      Number(changed.idMap["te-temporary"]),
    );
    expect(() =>
      svc.applySnapshot({
        expectedRevision: 0,
        teachers: [],
        subjects: [],
        rooms: [],
        sections: [],
      }),
    ).toThrow(/changed elsewhere/i);
    expect(svc.snapshot().teachers).toHaveLength(1);
  });

  it("rolls back all catalog edits when one record fails and does not delete referenced records", () => {
    const svc = createCatalogService(db);
    const t = svc.teachers.create(teacher);
    const r = svc.rooms.create(room);
    const baseline = svc.snapshot();
    expect(() =>
      svc.applySnapshot({
        expectedRevision: baseline.revision,
        teachers: [
          {
            id: String(t.id),
            name: "Renamed",
            specialization: teacher.specialization,
            employmentType: teacher.employment_type,
            minHours: teacher.min_hours,
            maxHours: teacher.max_hours,
          },
        ],
        subjects: [],
        rooms: [{ id: String(r.id), ...room, capacity: 0 }],
        sections: [],
      }),
    ).toThrow(/capacity/i);
    expect(svc.teachers.get(t.id).name).toBe("Ana Cruz");
    expect(svc.snapshot().revision).toBe(baseline.revision);
    const bell = svc.bellSchedules.list().find((x) => x.name === "JHS-50-A")!;
    const section = svc.sections.create({
      name: "Grade 7",
      grade_level: 7,
      school_level: "JHS",
      bell_schedule_id: bell.id,
      adviser_teacher_id: t.id,
    });
    expect(() =>
      svc.applySnapshot({
        expectedRevision: svc.snapshot().revision,
        teachers: [],
        subjects: [],
        rooms: [{ id: String(r.id), ...room }],
        sections: [
          {
            id: String(section.id),
            name: section.name,
            gradeLevel: 7,
            schoolLevel: "JHS",
            adviser: t.name,
            bellScheduleId: String(bell.id),
          },
        ],
      }),
    ).toThrow(/in use/i);
    expect(svc.teachers.get(t.id)).toBeTruthy();
  });
});
