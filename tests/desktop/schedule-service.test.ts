// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSchoolDatabase, type SchoolDatabase } from "../../electron/db/database";
import {
  teachersRepository,
  subjectsRepository,
  roomsRepository,
} from "../../electron/db/repositories/catalog";
import { sectionsRepository } from "../../electron/db/repositories/sections";
import { bellSchedulesRepository } from "../../electron/db/repositories/bell-schedules";
import { assignmentsRepository } from "../../electron/db/repositories/assignments";
import { createScheduleService } from "../../electron/services/schedule";

let db: SchoolDatabase;
let folder: string;
beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), "eclass-schedule-"));
  db = await openSchoolDatabase(folder);
});
afterEach(() => {
  db.close();
  rmSync(folder, { force: true, recursive: true });
});

function fixture() {
  const teachers = teachersRepository(db);
  const sections = sectionsRepository(db);
  const rooms = roomsRepository(db);
  const subjects = subjectsRepository(db);
  const bells = bellSchedulesRepository(db);
  const a = teachers.create({
    name: "Ana Cruz",
    specialization: "Science",
    employment_type: "Permanent",
    min_hours: 18,
    max_hours: 30,
  });
  const b = teachers.create({
    name: "Ben Reyes",
    specialization: "Science",
    employment_type: "Permanent",
    min_hours: 18,
    max_hours: 30,
  });
  const c = teachers.create({
    name: "Cara Tan",
    specialization: "Science",
    employment_type: "Permanent",
    min_hours: 18,
    max_hours: 30,
  });
  const subject = subjects.create({ name: "Science", grade_level: 11, minutes_per_week: 300 });
  const shs = bells.getByName("SHS-60")!;
  const jhsA = bells.getByName("JHS-50-A")!;
  const jhsB = bells.getByName("JHS-50-B")!;
  const shsSection = sections.create({
    name: "11 ICT",
    grade_level: 11,
    school_level: "SHS",
    bell_schedule_id: shs.id,
    adviser_teacher_id: null,
  });
  const jhsSection = sections.create({
    name: "8 Edge",
    grade_level: 8,
    school_level: "JHS",
    bell_schedule_id: jhsA.id,
    adviser_teacher_id: null,
  });
  const jhsBSection = sections.create({
    name: "8 Chrome",
    grade_level: 8,
    school_level: "JHS",
    bell_schedule_id: jhsB.id,
    adviser_teacher_id: null,
  });
  const room1 = rooms.create({ name: "Room A", type: "Classroom", capacity: 40 });
  const room2 = rooms.create({ name: "Room B", type: "Classroom", capacity: 40 });
  const room3 = rooms.create({ name: "Room C", type: "Classroom", capacity: 40 });
  const slots = {
    shs: bells.listPeriods(shs.id),
    jhsA: bells.listPeriods(jhsA.id),
    jhsB: bells.listPeriods(jhsB.id),
    fixed: bells.listSlots(shs.id).find((s) => s.kind === "health_break")!,
  };
  const service = createScheduleService(db);
  const base = {
    schoolYear: "2026-2027",
    term: 2 as const,
    day: 1 as const,
    subjectId: subject.id,
    durationPeriods: 1,
  };
  return {
    a,
    b,
    c,
    room1,
    room2,
    room3,
    shsSection,
    jhsSection,
    jhsBSection,
    slots,
    service,
    base,
  };
}

describe("interval-based scheduling authority", () => {
  it("lists and diagnoses preexisting alias duplicates while blocking either spelling", () => {
    const f = fixture();
    const candidate = { ...f.base, sectionId: f.jhsSection.id, teacherId: f.a.id, roomId: f.room1.id, startTimeSlotId: f.slots.jhsA[0]!.id };
    const first = f.service.save(candidate);
    const legacy = db.transaction(() => assignmentsRepository(db).insertWithinTransaction({
      ...first, school_year: "2026–2027",
    }))();
    const before = db.prepare("SELECT * FROM assignments ORDER BY id").all();
    for (const schoolYear of ["2026-2027", "2026–2027"]) {
      expect(f.service.list({ schoolYear }).map((row) => row.id)).toEqual([first.id, legacy.id]);
      expect(f.service.validateAssignment({ ...candidate, schoolYear }).valid).toBe(false);
      expect(() => f.service.save({ ...candidate, schoolYear })).toThrow(/duplicate|already/i);
      expect(f.service.detectAllConflicts(2, schoolYear)).toContainEqual(expect.objectContaining({ type: "duplicate", assignmentId: first.id, conflictingAssignmentId: legacy.id }));
    }
    expect(f.service.list({ schoolYear: "2027-2028" })).toEqual([]);
    expect(f.service.validateAssignment({ ...candidate, schoolYear: "2027–2028" }).valid).toBe(true);
    expect(db.prepare("SELECT * FROM assignments ORDER BY id").all()).toEqual(before);
  });

  it("canonicalizes assignment writes while retaining schedule year validation and custom labels", () => {
    const f = fixture();
    const candidate = { ...f.base, sectionId: f.jhsSection.id, teacherId: f.a.id, roomId: f.room1.id, startTimeSlotId: f.slots.jhsA[0]!.id };
    const saved = f.service.save({ ...candidate, schoolYear: " 2026–2027 " });
    expect(saved.school_year).toBe("2026-2027");
    expect(f.service.update(saved.id, { ...candidate, schoolYear: "2027–2028" }).school_year).toBe("2027-2028");
    expect(f.service.save({ ...candidate, schoolYear: " Summer-term " }).school_year).toBe("Summer-term");
    for (const schoolYear of ["", "  ", "x".repeat(33)]) {
      expect(() => f.service.save({ ...candidate, schoolYear })).toThrow(/school year/i);
    }
  });
  it("derives actual clock minutes and rejects SHS/JHS overlaps even with distinct time-slot IDs", () => {
    const f = fixture();
    const shs = {
      ...f.base,
      sectionId: f.shsSection.id,
      teacherId: f.a.id,
      roomId: f.room1.id,
      startTimeSlotId: f.slots.shs[1]!.id,
    };
    const saved = f.service.save(shs);
    expect(saved).toMatchObject({ start_minute: 510, end_minute: 570, duration_periods: 1 });
    const jhs = {
      ...f.base,
      sectionId: f.jhsBSection.id,
      teacherId: f.a.id,
      roomId: f.room2.id,
      startTimeSlotId: f.slots.jhsB[2]!.id,
    };
    const validation = f.service.validateAssignment(jhs);
    expect(validation.valid).toBe(false);
    expect(validation.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "teacher",
          conflictingAssignmentId: saved.id,
        }),
      ]),
    );
    expect(validation.conflicts.find((c) => c.type === "teacher")?.message).toMatch(
      /11 ICT.*Monday.*Period 2/,
    );
    expect(() => f.service.save(jhs)).toThrow(/already assigned/i);
    expect(f.service.list({ schoolYear: "2026-2027", term: 2 })).toHaveLength(1);
    expect(f.service.validateAssignment({ ...jhs, term: 3 }).valid).toBe(true);
    expect(f.service.validateAssignment({ ...jhs, schoolYear: "2027-2028" }).valid).toBe(true);
    const adjacent = { ...jhs, startTimeSlotId: f.slots.jhsB[3]!.id };
    expect(f.service.validateAssignment(adjacent).valid).toBe(true); // 10:10, not overlap
    expect(f.service.save(adjacent).start_minute).toBe(610);
    expect(f.service.list({ schoolYear: "2026-2027", term: 3 })).toHaveLength(0);
  });

  it("reports section, room and duplicate conflicts with recognizable messages", () => {
    const f = fixture();
    const first = {
      ...f.base,
      sectionId: f.jhsSection.id,
      teacherId: f.a.id,
      roomId: f.room1.id,
      startTimeSlotId: f.slots.jhsA[0]!.id,
    };
    const saved = f.service.save(first);
    const duplicate = f.service.validateAssignment(first);
    expect(new Set(duplicate.conflicts.map((c) => c.type))).toEqual(
      new Set(["teacher", "section", "room", "duplicate"]),
    );
    expect(duplicate.conflicts[0]?.message).toMatch(/Monday|8 Edge/);
    const sameSection = { ...first, teacherId: f.b.id, roomId: f.room2.id };
    expect(f.service.validateAssignment(sameSection).conflicts.map((c) => c.type)).toContain(
      "section",
    );
    const sameRoom = {
      ...first,
      sectionId: f.jhsBSection.id,
      teacherId: f.b.id,
      startTimeSlotId: f.slots.jhsB[0]!.id,
    };
    expect(f.service.validateAssignment(sameRoom).conflicts.map((c) => c.type)).toContain("room");
    expect(f.service.detectAllConflicts(2, "2026-2027")).toEqual([]);
    // A pre-existing invalid record can still be diagnosed after migration/import.
    const invalid = db.transaction(() =>
      assignmentsRepository(db).insertWithinTransaction({
        school_year: "2026-2027",
        term: 2,
        day: 1,
        start_time_slot_id: f.slots.jhsA[0]!.id,
        start_minute: 450,
        end_minute: 500,
        duration_periods: 1,
        section_id: f.jhsSection.id,
        elective_group_id: null,
        subject_id: first.subjectId,
        teacher_id: f.b.id,
        room_id: f.room2.id,
      }),
    )();
    expect(f.service.detectAllConflicts(2, "2026-2027")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "section",
          assignmentId: saved.id,
          conflictingAssignmentId: invalid.id,
        }),
      ]),
    );
  });

  it("rejects break slots, forged time values, non-consecutive periods and invalid references", () => {
    const f = fixture();
    const base = { ...f.base, sectionId: f.shsSection.id, teacherId: f.a.id, roomId: f.room1.id };
    expect(() => f.service.save({ ...base, startTimeSlotId: f.slots.fixed.id })).toThrow(
      /teaching period|fixed event/i,
    );
    expect(() =>
      f.service.save({ ...base, startTimeSlotId: f.slots.shs[1]!.id, durationPeriods: 2 }),
    ).toThrow(/break|consecutive/i);
    const forged = { ...base, startTimeSlotId: f.slots.shs[0]!.id, startMinute: 1 };
    expect(() => f.service.save(forged)).toThrow(/unexpected|unsupported|field/i);
    expect(() => f.service.save({ ...base, startTimeSlotId: f.slots.jhsA[0]!.id })).toThrow(
      /bell schedule|profile/i,
    );
    expect(() =>
      f.service.save({ ...base, startTimeSlotId: f.slots.shs[0]!.id, teacherId: 999999 }),
    ).toThrow(/teacher/i);
    expect(() =>
      f.service.save({ ...base, startTimeSlotId: f.slots.shs[0]!.id, day: 6 as 1 }),
    ).toThrow(/day/i);
    expect(f.service.list({ schoolYear: "2026-2027" })).toHaveLength(0);
  });

  it("supports consecutive multi-period blocks and treats adjacent blocks as non-overlapping", () => {
    const f = fixture();
    const base = { ...f.base, sectionId: f.shsSection.id, teacherId: f.a.id, roomId: f.room1.id };
    const block = f.service.save({
      ...base,
      startTimeSlotId: f.slots.shs[0]!.id,
      durationPeriods: 2,
    });
    expect(block).toMatchObject({ start_minute: 450, end_minute: 570, duration_periods: 2 });
    expect(
      f.service.validateAssignment({ ...base, startTimeSlotId: f.slots.shs[2]!.id }).valid,
    ).toBe(true);
    expect(f.service.save({ ...base, startTimeSlotId: f.slots.shs[2]!.id }).start_minute).toBe(585);
    expect(f.service.detectAllConflicts(2, "2026-2027")).toEqual([]);
  });

  it("revalidates edits within transactions, excludes self, and rolls back failed batches", () => {
    const f = fixture();
    const base = {
      ...f.base,
      sectionId: f.jhsSection.id,
      teacherId: f.a.id,
      roomId: f.room1.id,
      startTimeSlotId: f.slots.jhsA[0]!.id,
    };
    const saved = f.service.save(base);
    expect(f.service.validateAssignment(base, saved.id).valid).toBe(true);
    const second = f.service.save({
      ...base,
      sectionId: f.jhsBSection.id,
      teacherId: f.b.id,
      roomId: f.room2.id,
      startTimeSlotId: f.slots.jhsB[1]!.id,
    });
    expect(() =>
      f.service.update(saved.id, {
        ...base,
        startTimeSlotId: f.slots.jhsA[1]!.id,
        teacherId: f.b.id,
      }),
    ).toThrow(/already assigned/i);
    expect(f.service.get(saved.id)?.start_minute).toBe(450);
    expect(
      f.service.applyChanges({
        creates: [
          { ...base, startTimeSlotId: f.slots.jhsA[2]!.id },
          {
            ...base,
            sectionId: f.jhsBSection.id,
            startTimeSlotId: f.slots.jhsB[2]!.id,
            teacherId: f.c.id,
            roomId: f.room3.id,
          },
        ],
        updates: [],
        deletes: [],
      }),
    ).toBeDefined(); // Different teachers and rooms despite overlapping 50-minute profiles.
    const prior = f.service.list({ schoolYear: "2026-2027", term: 2 }).length;
    expect(() =>
      f.service.applyChanges({
        creates: [
          { ...base, startTimeSlotId: f.slots.jhsA[3]!.id },
          { ...base, sectionId: f.jhsBSection.id, startTimeSlotId: f.slots.jhsB[3]!.id },
        ],
        updates: [],
        deletes: [],
      }),
    ).toThrow(/already assigned/i);
    expect(f.service.list({ schoolYear: "2026-2027", term: 2 })).toHaveLength(prior);
    expect(f.service.delete(second.id)).toBe(true);
    expect(f.service.get(second.id)).toBeUndefined();
  });
});

describe("elective blocks", () => {
  it("writes canonical elective-group years from legacy input", () => {
    const f = fixture();
    const group = f.service.createElectiveGroup({ name: "Canonical elective", schoolYear: " 2026–2027 ", term: 2, day: 1, startTimeSlotId: f.slots.jhsA[0]!.id, durationPeriods: 1, sectionIds: [f.jhsSection.id] });
    expect(group.schoolYear).toBe("2026-2027");
  });
  it.each(["2026-2027", "2026–2027"])("enforces membership and empty group reservations across aliases stored as %s", (storedYear) => {
    const f = fixture();
    const input = { name: "Alias electives", schoolYear: "2026-2027", term: 2 as const, day: 1 as const, startTimeSlotId: f.slots.jhsA[0]!.id, durationPeriods: 1, sectionIds: [f.jhsSection.id] };
    const group = f.service.createElectiveGroup(input);
    expect(group.schoolYear).toBe("2026-2027");
    db.prepare("UPDATE elective_groups SET school_year=? WHERE id=?").run(storedYear, group.id);
    const before = db.prepare("SELECT * FROM elective_groups ORDER BY id").all();
    for (const schoolYear of ["2026-2027", "2026–2027"]) {
      expect(f.service.listElectiveGroups({ schoolYear }).map((row) => row.id)).toEqual([group.id]);
      const ordinary = { ...f.base, schoolYear, sectionId: f.jhsSection.id, teacherId: f.a.id, roomId: f.room1.id, startTimeSlotId: f.slots.jhsA[0]!.id };
      expect(f.service.validateAssignment(ordinary).conflicts).toContainEqual(expect.objectContaining({ type: "section" }));
      expect(() => f.service.createElectiveGroup({ ...input, schoolYear, name: "Overlap" })).toThrow(/reserved|scheduled/i);
      expect(f.service.validateAssignment({ ...ordinary, schoolYear: "2027-2028" }).valid).toBe(true);
      expect(f.service.validateAssignment({ ...ordinary, sectionId: null, electiveGroupId: group.id }).valid).toBe(true);
    }
    expect(f.service.listElectiveGroups({ schoolYear: "2027-2028" })).toEqual([]);
    expect(db.prepare("SELECT * FROM elective_groups ORDER BY id").all()).toEqual(before);
    const assigned = f.service.save({ ...f.base, schoolYear: "2026–2027", sectionId: null, electiveGroupId: group.id, teacherId: f.a.id, roomId: f.room1.id, startTimeSlotId: f.slots.jhsA[0]!.id });
    expect(assigned.school_year).toBe("2026-2027");
    // Adding a member checks ordinary assignments in the other spelling too.
    const other = f.service.save({ ...f.base, sectionId: f.jhsBSection.id, teacherId: f.b.id, roomId: f.room2.id, startTimeSlotId: f.slots.jhsB[0]!.id });
    db.prepare("UPDATE assignments SET school_year=? WHERE id=?").run(storedYear === "2026-2027" ? "2026–2027" : "2026-2027", other.id);
    expect(() => f.service.addElectiveGroupSection(group.id, f.jhsBSection.id)).toThrow(/scheduled/i);
  });
  it("allows distinct teacher-subject pairs in a shared block across sections without false section conflicts", () => {
    const f = fixture();
    const group = f.service.createElectiveGroup({
      name: "TechPro Electives",
      schoolYear: "2026-2027",
      term: 2,
      day: 1,
      startTimeSlotId: f.slots.jhsA[0]!.id,
      durationPeriods: 2,
      sectionIds: [f.jhsSection.id, f.jhsBSection.id],
    });
    expect(group.sectionIds).toEqual([f.jhsSection.id, f.jhsBSection.id]);
    const a = {
      ...f.base,
      sectionId: null,
      electiveGroupId: group.id,
      teacherId: f.a.id,
      roomId: f.room1.id,
      startTimeSlotId: f.slots.jhsA[0]!.id,
      durationPeriods: 2,
    };
    const b = { ...a, teacherId: f.b.id, roomId: f.room2.id };
    expect(f.service.save(a)).toMatchObject({
      elective_group_id: group.id,
      start_minute: 450,
      end_minute: 550,
    });
    expect(f.service.validateAssignment(b).valid).toBe(true);
    f.service.save(b);
    expect(f.service.detectAllConflicts(2, "2026-2027")).toEqual([]);
    expect(
      f.service
        .validateAssignment({ ...a, teacherId: f.a.id, roomId: f.room3.id })
        .conflicts.map((c) => c.type),
    ).toContain("teacher");
    expect(
      f.service
        .validateAssignment({ ...a, teacherId: f.c.id, roomId: f.room1.id })
        .conflicts.map((c) => c.type),
    ).toContain("room");
    expect(
      f.service
        .validateAssignment({
          ...f.base,
          sectionId: f.jhsBSection.id,
          teacherId: f.c.id,
          roomId: f.room3.id,
          startTimeSlotId: f.slots.jhsB[0]!.id,
        })
        .conflicts.map((c) => c.type),
    ).toContain("section");
    expect(() => f.service.deleteElectiveGroup(group.id)).toThrow(/in use|assignments/i);
  });

  it("rejects shared groups whose bell profiles cannot cover the exact same interval", () => {
    const f = fixture();
    expect(() =>
      f.service.createElectiveGroup({
        name: "Invalid Mixed Profile",
        schoolYear: "2026-2027",
        term: 2,
        day: 1,
        startTimeSlotId: f.slots.shs[0]!.id,
        durationPeriods: 2,
        sectionIds: [f.shsSection.id, f.jhsSection.id],
      }),
    ).toThrow(/same clock|profile|period/i);
    expect(f.service.listElectiveGroups({ schoolYear: "2026-2027", term: 2 })).toHaveLength(0);
  });

  it("does not let one section reserve overlapping groups or permit group metadata mismatch", () => {
    const f = fixture();
    const first = f.service.createElectiveGroup({
      name: "Group A",
      schoolYear: "2026-2027",
      term: 2,
      day: 1,
      startTimeSlotId: f.slots.jhsA[0]!.id,
      durationPeriods: 1,
      sectionIds: [f.jhsSection.id],
    });
    expect(() =>
      f.service.createElectiveGroup({
        name: "Group B",
        schoolYear: "2026-2027",
        term: 2,
        day: 1,
        startTimeSlotId: f.slots.jhsA[0]!.id,
        durationPeriods: 1,
        sectionIds: [f.jhsSection.id],
      }),
    ).toThrow(/already reserved|already scheduled/i);
    expect(() =>
      f.service.save({
        ...f.base,
        sectionId: null,
        electiveGroupId: first.id,
        teacherId: f.a.id,
        roomId: f.room1.id,
        startTimeSlotId: f.slots.jhsA[1]!.id,
      }),
    ).toThrow(/elective group|match/i);
    expect(() => f.service.addElectiveGroupSection(first.id, f.shsSection.id)).toThrow(
      /same clock|profile/i,
    );
  });
});
