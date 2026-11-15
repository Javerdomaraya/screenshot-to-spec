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
import { aliasesRepository } from "../../electron/db/repositories/aliases";
import { electivesRepository } from "../../electron/db/repositories/electives";
import { assignmentsRepository } from "../../electron/db/repositories/assignments";
import { settingsRepository } from "../../electron/db/repositories/settings";

let db: SchoolDatabase;
let dir: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "eclass-repo-"));
  db = await openSchoolDatabase(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("School repositories", () => {
  it("reads both school-year spellings without rewriting or deduplicating SQLite rows", () => {
    const teacher = teachersRepository(db).create({ name: "Alias Teacher", specialization: "Science", employment_type: "Permanent", min_hours: 18, max_hours: 30 });
    const subject = subjectsRepository(db).create({ name: "Science", grade_level: 7, minutes_per_week: 300 });
    const room = roomsRepository(db).create({ name: "Alias Room", capacity: 40, type: "Classroom" });
    const bells = bellSchedulesRepository(db);
    const bell = bells.getByName("JHS-50-A")!;
    const section = sectionsRepository(db).create({ name: "7 Alias", grade_level: 7, school_level: "JHS", bell_schedule_id: bell.id, adviser_teacher_id: null });
    const repo = assignmentsRepository(db);
    const ids = db.transaction(() => ["2026-2027", "2026–2027", "2027-2028"].map((school_year) => repo.insertWithinTransaction({
      school_year, term: 2, day: 1, start_time_slot_id: bells.listPeriods(bell.id)[0]!.id,
      start_minute: 450, end_minute: 500, duration_periods: 1, section_id: section.id,
      elective_group_id: null, teacher_id: teacher.id, subject_id: subject.id, room_id: room.id,
    }).id))();
    const before = db.prepare("SELECT * FROM assignments ORDER BY id").all();
    for (const schoolYear of ["2026-2027", "2026–2027"]) {
      expect(repo.list({ schoolYear, term: 2 }).map((row) => row.id)).toEqual(ids.slice(0, 2));
      expect(repo.findOverlaps({ schoolYear, term: 2, day: 1, startMinute: 460, endMinute: 480 }).map((row) => row.id)).toEqual(ids.slice(0, 2));
      expect(repo.findOverlaps({ schoolYear, term: 2, day: 1, startMinute: 460, endMinute: 480, excludeId: ids[0]! }).map((row) => row.id)).toEqual([ids[1]]);
    }
    expect(repo.list({ schoolYear: "2027–2028", term: 2 }).map((row) => row.id)).toEqual([ids[2]]);
    expect(repo.list({ schoolYear: "2026-2027", term: 1 })).toEqual([]);
    expect(db.prepare("SELECT * FROM assignments ORDER BY id").all()).toEqual(before);
  });
  it("updates and deletes user-created bell schedules and their time slots", () => {
    const bells = bellSchedulesRepository(db);
    const custom = bells.create("JHS test profile", "JHS");
    const slot = bells.createSlot({
      bell_schedule_id: custom.id,
      kind: "period",
      period_no: 1,
      start_time: "07:30",
      end_time: "08:20",
      minutes: 50,
    });
    expect(bells.getSlot(slot.id)?.period_no).toBe(1);
    expect(
      bells.updateSlot(slot.id, {
        bell_schedule_id: custom.id,
        kind: "period",
        period_no: 1,
        start_time: "07:40",
        end_time: "08:30",
        minutes: 50,
      }).start_time,
    ).toBe("07:40");
    expect(bells.update(custom.id, "JHS 50 test", "JHS").name).toBe("JHS 50 test");
    expect(bells.deleteSlot(slot.id)).toBe(1);
    expect(bells.delete(custom.id)).toBe(1);
  });
  it("creates, renames, lists and deletes teachers, subjects, and rooms", () => {
    const teachers = teachersRepository(db);
    const subjects = subjectsRepository(db);
    const rooms = roomsRepository(db);
    const teacher = teachers.create({
      name: "Ana Cruz",
      specialization: "English",
      employment_type: "Permanent",
      min_hours: 18,
      max_hours: 30,
    });
    expect(teachers.get(teacher.id)?.name).toBe("Ana Cruz");
    expect(
      teachers.update(teacher.id, {
        name: "Ana M. Cruz",
        specialization: "English",
        employment_type: "Permanent",
        min_hours: 18,
        max_hours: 30,
      }).name,
    ).toBe("Ana M. Cruz");
    expect(teachers.list().map((t) => t.name)).toEqual(["Ana M. Cruz"]);
    const namesake = teachers.create({
      name: "Ana-M Cruz",
      specialization: "English",
      employment_type: "Permanent",
      min_hours: 18,
      max_hours: 30,
    });
    expect(namesake.id).not.toBe(teacher.id);
    expect(aliasesRepository(db).resolveTeacher("ANA M CRUZ")).toBeNull();
    expect(
      subjects.create({ name: "CSS", grade_level: 11, minutes_per_week: 300 }).id,
    ).toBeGreaterThan(0);
    expect(rooms.create({ name: "Room 101", capacity: 40, type: "Classroom" }).id).toBeGreaterThan(
      0,
    );
    teachers.delete(teacher.id);
    expect(teachers.get(teacher.id)).toBeUndefined();
  });

  it("stores JHS/SHS section mappings and resolves punctuation-insensitive aliases", () => {
    const teachers = teachersRepository(db);
    const teacher = teachers.create({
      name: "Jose Dela Cruz",
      specialization: "Math",
      employment_type: "Permanent",
      min_hours: 18,
      max_hours: 30,
    });
    const subject = subjectsRepository(db).create({
      name: "Mathematics",
      grade_level: 7,
      minutes_per_week: 300,
    });
    const aliases = aliasesRepository(db);
    aliases.addTeacherAlias(teacher.id, "J. dela-cruz");
    aliases.addSubjectAlias(subject.id, "MATH!");
    expect(aliases.resolveTeacher(" j dela cruz ")).toBe(teacher.id);
    expect(aliases.resolveTeacher("JOSE. DELA CRUZ")).toBe(teacher.id);
    expect(aliases.resolveSubject("math")).toBe(subject.id);
    expect(aliases.resolveTeacher("unknown")).toBeNull();
    const bell = bellSchedulesRepository(db).getByName("JHS-50-B")!;
    const section = sectionsRepository(db).create({
      name: "Grade 7 - Edge",
      grade_level: 7,
      school_level: "JHS",
      bell_schedule_id: bell.id,
      adviser_teacher_id: teacher.id,
    });
    expect(section.bell_schedule_id).toBe(bell.id);
    expect(bellSchedulesRepository(db).listPeriods(bell.id)).toHaveLength(8);
  });

  it("stores multi-period time intervals and shared elective group sections without slot-based uniqueness", () => {
    const teachers = teachersRepository(db);
    const first = teachers.create({
      name: "Maria A",
      specialization: "Tech",
      employment_type: "Permanent",
      min_hours: 18,
      max_hours: 30,
    });
    const second = teachers.create({
      name: "Maria B",
      specialization: "Cookery",
      employment_type: "Permanent",
      min_hours: 18,
      max_hours: 30,
    });
    const subject = subjectsRepository(db).create({
      name: "CSS",
      grade_level: 11,
      minutes_per_week: 300,
    });
    const room = roomsRepository(db).create({ name: "Lab 1", capacity: 40, type: "Laboratory" });
    const otherRoom = roomsRepository(db).create({
      name: "Lab 2",
      capacity: 40,
      type: "Laboratory",
    });
    const bell = bellSchedulesRepository(db).getByName("SHS-60")!;
    const sections = sectionsRepository(db);
    const a = sections.create({
      name: "11 ICT A",
      grade_level: 11,
      school_level: "SHS",
      bell_schedule_id: bell.id,
      adviser_teacher_id: null,
    });
    const b = sections.create({
      name: "11 ICT B",
      grade_level: 11,
      school_level: "SHS",
      bell_schedule_id: bell.id,
      adviser_teacher_id: null,
    });
    const period = bellSchedulesRepository(db).listPeriods(bell.id)[0]!;
    const electives = electivesRepository(db);
    const group = electives.create({
      name: "TechPro",
      school_year: "2026-2027",
      term: 2,
      day: 1,
      start_minute: 450,
      end_minute: 570,
      duration_periods: 2,
      start_time_slot_id: period.id,
    });
    electives.addSection(group.id, a.id);
    electives.addSection(group.id, b.id);
    expect(electives.listSectionIds(group.id)).toEqual([a.id, b.id]);
    const assignments = assignmentsRepository(db);
    db.transaction(() => {
      assignments.insertWithinTransaction({
        school_year: "2026-2027",
        term: 2,
        day: 1,
        start_time_slot_id: period.id,
        start_minute: 450,
        end_minute: 570,
        duration_periods: 2,
        section_id: null,
        elective_group_id: group.id,
        teacher_id: first.id,
        subject_id: subject.id,
        room_id: room.id,
      });
      assignments.insertWithinTransaction({
        school_year: "2026-2027",
        term: 2,
        day: 1,
        start_time_slot_id: period.id,
        start_minute: 450,
        end_minute: 570,
        duration_periods: 2,
        section_id: null,
        elective_group_id: group.id,
        teacher_id: second.id,
        subject_id: subject.id,
        room_id: otherRoom.id,
      });
    })();
    expect(assignments.list({ schoolYear: "2026-2027", term: 2 })).toHaveLength(2);
    expect(
      assignments.findOverlaps({
        schoolYear: "2026-2027",
        term: 2,
        day: 1,
        startMinute: 560,
        endMinute: 620,
      }),
    ).toHaveLength(2);
    expect(
      assignments.findOverlaps({
        schoolYear: "2026-2027",
        term: 2,
        day: 1,
        startMinute: 570,
        endMinute: 630,
      }),
    ).toHaveLength(0);
    expect(
      assignments.findOverlaps({
        schoolYear: "2026-2027",
        term: 3,
        day: 1,
        startMinute: 560,
        endMinute: 620,
      }),
    ).toHaveLength(0);
    const fixed = bellSchedulesRepository(db)
      .listSlots(bell.id)
      .find((slot) => slot.kind === "health_break")!;
    expect(() =>
      electives.create({
        name: "Not during break",
        school_year: "2026-2027",
        term: 2,
        day: 1,
        start_time_slot_id: fixed.id,
        start_minute: 570,
        end_minute: 585,
        duration_periods: 1,
      }),
    ).toThrow(/Fixed events cannot contain classes/);
    expect(() =>
      db.transaction(() => {
        assignments.insertWithinTransaction({
          school_year: "2026-2027",
          term: 2,
          day: 1,
          start_time_slot_id: fixed.id,
          start_minute: 570,
          end_minute: 585,
          duration_periods: 1,
          section_id: a.id,
          elective_group_id: null,
          teacher_id: first.id,
          subject_id: subject.id,
          room_id: room.id,
        });
      })(),
    ).toThrow(/Fixed events cannot contain classes/);
    expect(() =>
      assignments.insertWithinTransaction({
        school_year: "2026-2027",
        term: 2,
        day: 1,
        start_time_slot_id: period.id,
        start_minute: 450,
        end_minute: 510,
        duration_periods: 1,
        section_id: a.id,
        elective_group_id: null,
        teacher_id: first.id,
        subject_id: subject.id,
        room_id: room.id,
      }),
    ).toThrow(/transaction/);
    expect(() => teachers.delete(first.id)).toThrow();
    expect(() => electives.delete(group.id)).toThrow();
  });

  it("finds overlapping real times across SHS-60 and JHS-50-B profiles", () => {
    const teacher = teachersRepository(db).create({
      name: "Teacher shared",
      specialization: "Science",
      employment_type: "Permanent",
      min_hours: 18,
      max_hours: 30,
    });
    const subject = subjectsRepository(db).create({
      name: "Science",
      grade_level: 11,
      minutes_per_week: 300,
    });
    const room = roomsRepository(db).create({
      name: "Shared Lab",
      capacity: 35,
      type: "Laboratory",
    });
    const bells = bellSchedulesRepository(db);
    const shs = bells.getByName("SHS-60")!;
    const jhs = bells.getByName("JHS-50-B")!;
    const shsSection = sectionsRepository(db).create({
      name: "Grade 11",
      grade_level: 11,
      school_level: "SHS",
      bell_schedule_id: shs.id,
      adviser_teacher_id: null,
    });
    const shsPeriod = bells.listPeriods(shs.id)[1]!; // 08:30–09:30
    const jhsPeriod = bells.listPeriods(jhs.id)[2]!; // 09:20–10:10
    const repo = assignmentsRepository(db);
    db.transaction(() =>
      repo.insertWithinTransaction({
        school_year: "2026-2027",
        term: 2,
        day: 1,
        start_time_slot_id: shsPeriod.id,
        start_minute: 510,
        end_minute: 570,
        duration_periods: 1,
        section_id: shsSection.id,
        elective_group_id: null,
        teacher_id: teacher.id,
        subject_id: subject.id,
        room_id: room.id,
      }),
    )();
    // Step 4 will reject this if teacher/room is in use; Step 2 must surface
    // the overlap even though the two records use different period IDs.
    expect(
      repo
        .findOverlaps({
          schoolYear: "2026-2027",
          term: 2,
          day: 1,
          startMinute: 560,
          endMinute: 610,
        })
        .map((a) => a.teacher_id),
    ).toEqual([teacher.id]);
    expect(
      repo.findOverlaps({
        schoolYear: "2026-2027",
        term: 2,
        day: 1,
        startMinute: 570,
        endMinute: 620,
      }),
    ).toHaveLength(0);
    expect(jhsPeriod.id).not.toBe(shsPeriod.id);
  });

  it("persists school header settings using parameterized updates", () => {
    const settings = settingsRepository(db);
    expect(settings.get("underload_below")).toBe("18");
    settings.set("region", "Region VII");
    expect(settings.get("region")).toBe("Region VII");
  });
});
