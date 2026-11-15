import type { SchoolDatabase } from "../db/database";
import { normalizeSchoolYear } from "../../shared/school-year";
import { normalizeNameKey } from "../db/name-normalization";
import {
  teachersRepository,
  subjectsRepository,
  roomsRepository,
} from "../db/repositories/catalog";
import { sectionsRepository } from "../db/repositories/sections";
import { bellSchedulesRepository } from "../db/repositories/bell-schedules";
import { settingsRepository } from "../db/repositories/settings";
import type {
  Teacher,
  Section,
  Subject,
  Room,
  NewTeacher,
  NewSection,
  NewSubject,
  NewRoom,
} from "../db/repositories/types";
import type {
  CatalogApplyResult,
  CatalogReplacement,
  CatalogSnapshot,
  SchoolSettingsUpdate,
  TeacherDraft,
  SectionDraft,
  SubjectDraft,
  RoomDraft,
} from "../../shared/electron-api";

export class CatalogError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CatalogError";
  }
}

function invalid(message: string): never {
  throw new CatalogError("INVALID_INPUT", message);
}

function requiredText(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength)
    return invalid(`${field} is required (maximum ${maxLength} characters).`);
  return value.trim();
}

function optionalText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 500) return invalid(`${field} must be text.`);
  return value.trim();
}

function integer(value: unknown, field: string, low: number, high: number): number {
  if (!Number.isInteger(value) || (value as number) < low || (value as number) > high)
    return invalid(`${field} must be between ${low} and ${high}.`);
  return value as number;
}

function hours(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 168)
    return invalid(`${field} must be between 0 and 168.`);
  return value;
}

function choice<T extends string>(value: unknown, field: string, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T))
    return invalid(`${field} must be ${values.join(", ")}.`);
  return value as T;
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return invalid("A record object is required.");
  return input as Record<string, unknown>;
}

function validId(value: unknown): number {
  return integer(value, "ID", 1, Number.MAX_SAFE_INTEGER);
}

function validTeacher(value: unknown): NewTeacher {
  const t = record(value);
  const min_hours = hours(t["min_hours"], "Minimum hours");
  const max_hours = hours(t["max_hours"], "Maximum hours");
  if (max_hours < min_hours) return invalid("Maximum hours must not be less than minimum hours.");
  return {
    name: requiredText(t["name"], "Teacher name"),
    specialization: optionalText(t["specialization"], "Specialization"),
    employment_type: choice(t["employment_type"], "Employment type", [
      "Permanent",
      "Contractual",
      "Part-time",
    ]),
    min_hours,
    max_hours,
  };
}

function validSubject(value: unknown): NewSubject {
  const s = record(value);
  return {
    name: requiredText(s["name"], "Subject name"),
    grade_level: integer(s["grade_level"], "Grade level", 7, 12),
    minutes_per_week: integer(s["minutes_per_week"], "Minutes per week", 1, 10080),
  };
}

function validRoom(value: unknown): NewRoom {
  const r = record(value);
  return {
    name: requiredText(r["name"], "Room name"),
    capacity: integer(r["capacity"], "Capacity", 1, 10000),
    type: choice(r["type"], "Room type", ["Classroom", "Laboratory", "ICT room"]),
  };
}

function validSection(value: unknown): NewSection {
  const s = record(value);
  return {
    name: requiredText(s["name"], "Section name"),
    grade_level: integer(s["grade_level"], "Grade level", 7, 12),
    school_level: choice(s["school_level"], "School level", ["JHS", "SHS"]),
    bell_schedule_id: validId(s["bell_schedule_id"]),
    adviser_teacher_id: s["adviser_teacher_id"] === null ? null : validId(s["adviser_teacher_id"]),
  };
}

/** Separate the user-facing error from sensitive SQLite internal details. */
function translateError(error: unknown): never {
  if (error instanceof CatalogError) throw error;
  if (error instanceof Error) {
    if (error.message.includes("FOREIGN KEY") || error.message.includes("is in use"))
      throw new CatalogError(
        "IN_USE",
        "Record is in use. Remove or reassign its dependencies first.",
      );
    if (error.message.includes("UNIQUE"))
      throw new CatalogError("DUPLICATE", "A record with this name or identifier already exists.");
    if (error.message.includes("CHECK") || error.message.includes("NOT NULL"))
      throw new CatalogError(
        "INVALID_INPUT",
        "The record violates a required school-data constraint.",
      );
  }
  throw error;
}

function revision(db: SchoolDatabase): number {
  const item = settingsRepository(db).get("__catalog_revision");
  return item === null ? 0 : Number(item);
}

function incrementRevision(db: SchoolDatabase): number {
  const next = revision(db) + 1;
  settingsRepository(db).set("__catalog_revision", String(next));
  return next;
}

function makeCrud<New, Row extends { id: number }>(
  db: SchoolDatabase,
  repo: {
    list(): Row[];
    get(id: number): Row | undefined;
    create(input: New): Row;
    update(id: number, input: New): Row;
    delete(id: number): number;
  },
  validate: (value: unknown) => New,
  beforeDelete?: (id: number) => void,
) {
  const get = (id: number): Row => {
    const item = repo.get(validId(id));
    if (!item) throw new CatalogError("NOT_FOUND", "Record not found.");
    return item;
  };
  const write = <T>(action: () => T): T => {
    try {
      return db
        .transaction(() => {
          const result = action();
          incrementRevision(db);
          return result;
        })
        .immediate();
    } catch (error) {
      return translateError(error);
    }
  };
  return {
    list: () => repo.list(),
    get,
    create: (input: New) => write(() => repo.create(validate(input))),
    update: (id: number, input: New) =>
      write(() => {
        get(id);
        return repo.update(id, validate(input));
      }),
    delete: (id: number): true =>
      write(() => {
        get(id);
        beforeDelete?.(id);
        repo.delete(id);
        return true;
      }),
  };
}

function drafts<T extends { id: string }>(value: unknown, name: string): T[] {
  if (!Array.isArray(value) || value.length > 10000) return invalid(`${name} must be a list.`);
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    const data = record(item);
    const id = requiredText(data["id"], `${name} record ID`, 128);
    if (ids.has(id)) invalid(`Duplicate ${name} record ID: ${id}`);
    ids.add(id);
    return item as T;
  });
}

function dbId(id: string): number | null {
  if (!/^[1-9]\d*$/.test(id)) return null;
  const num = Number(id);
  if (!Number.isSafeInteger(num)) return invalid("Record ID is too large.");
  return num;
}

function applyGeneric<T extends { id: number }, D extends { id: string }, N>(
  current: T[],
  desired: D[],
  existing: (id: number) => T | undefined,
  create: (data: N) => T,
  update: (id: number, data: N) => T,
  convert: (draft: D) => N,
  idMap: Record<string, string>,
): Set<number> {
  const existingIds = new Set(current.map((row) => row.id));
  const retained = new Set<number>();
  for (const draft of desired) {
    const id = dbId(draft.id);
    const data = convert(draft);
    if (id !== null) {
      if (!existingIds.has(id) || !existing(id))
        throw new CatalogError("NOT_FOUND", "An item no longer exists. Refresh your records.");
      update(id, data);
      retained.add(id);
    } else {
      const created = create(data);
      retained.add(created.id);
      idMap[draft.id] = String(created.id);
    }
  }
  return retained;
}

export function createCatalogService(db: SchoolDatabase) {
  const teacherRepo = teachersRepository(db);
  const subjectRepo = subjectsRepository(db);
  const roomRepo = roomsRepository(db);
  const sectionRepo = sectionsRepository(db);
  const bellRepo = bellSchedulesRepository(db);
  const teacherInUse = (id: number) => {
    if (db.prepare("SELECT id FROM sections WHERE adviser_teacher_id=? LIMIT 1").get(id))
      throw new CatalogError("IN_USE", "Teacher is in use as a class adviser.");
  };
  const validateSectionReferences = (value: unknown): NewSection => {
    const section = validSection(value);
    const bell = bellRepo.get(section.bell_schedule_id);
    if (!bell) invalid("Bell schedule does not exist.");
    if (bell.school_level !== section.school_level)
      invalid("Section must use a matching school-level bell schedule.");
    if (
      (section.grade_level <= 10 && section.school_level !== "JHS") ||
      (section.grade_level >= 11 && section.school_level !== "SHS")
    )
      invalid("Section school level must match its grade level.");
    if (section.adviser_teacher_id !== null && !teacherRepo.get(section.adviser_teacher_id))
      invalid("Adviser must refer to an existing teacher.");
    return section;
  };
  // A section's bell profile determines the real start/end times of its
  // assignments. Changing it after scheduling would invalidate those
  // persisted intervals even though the foreign keys still pass.
  const checkedSections = {
    ...sectionRepo,
    update: (id: number, section: NewSection): Section => {
      const previous = sectionRepo.get(id);
      if (
        previous &&
        (previous.bell_schedule_id !== section.bell_schedule_id ||
          previous.school_level !== section.school_level ||
          previous.grade_level !== section.grade_level)
      ) {
        const assigned = db
          .prepare("SELECT id FROM assignments WHERE section_id=? LIMIT 1")
          .get(id);
        const elective = db
          .prepare("SELECT section_id FROM elective_group_sections WHERE section_id=? LIMIT 1")
          .get(id);
        if (assigned || elective)
          throw new CatalogError(
            "IN_USE",
            "Section is in use by assignments or an elective group. Remove them before changing its bell profile or grade.",
          );
      }
      return sectionRepo.update(id, section);
    },
  };
  const teachers = makeCrud(db, teacherRepo, validTeacher, teacherInUse);
  const sections = makeCrud(db, checkedSections, validateSectionReferences);
  const subjects = makeCrud(db, subjectRepo, validSubject);
  const rooms = makeCrud(db, roomRepo, validRoom);

  const snapshot = (): CatalogSnapshot => ({
    revision: revision(db),
    teachers: teacherRepo.list(),
    sections: sectionRepo.list(),
    subjects: subjectRepo.list(),
    rooms: roomRepo.list(),
    bellSchedules: bellRepo.list(),
    timeSlots: bellRepo.list().flatMap((row) => bellRepo.listSlots(row.id)),
    settings: Object.fromEntries(
      settingsRepository(db)
        .list()
        .filter((row) => !row.key.startsWith("__"))
        .map((row) => [row.key, row.value]),
    ),
  });

  /** A one-time school identity default. Never replace a configured name or
   * change academic records while adopting an existing school's installation. */
  const ensureSchoolName = (schoolName: unknown): CatalogSnapshot => {
    const name = requiredText(schoolName, "School name", 250);
    return db.transaction(() => {
      const settings = settingsRepository(db);
      if (!settings.get("school_name")?.trim()) {
        settings.set("school_name", name);
        incrementRevision(db);
      }
      return snapshot();
    }).immediate();
  };

  const saveSettings = (input: SchoolSettingsUpdate): CatalogSnapshot => {
    const body = record(input);
    const expectedRevision = integer(body["expectedRevision"], "Revision", 0, Number.MAX_SAFE_INTEGER);
    const schoolName = requiredText(body["schoolName"], "School name", 250);
    const schoolYear = normalizeSchoolYear(requiredText(body["schoolYear"], "School year", 32));
    const yearMatch = /^(\d{4})[-–](\d{4})$/.exec(schoolYear);
    if (!yearMatch || Number(yearMatch[2]) !== Number(yearMatch[1]) + 1)
      invalid("School year must be two consecutive years (for example, 2026–2027).");
    const preparedBy = optionalText(body["preparedBy"], "Prepared by");
    const schoolHead = optionalText(body["schoolHead"], "School head");
    const thresholds = record(body["thresholds"]);
    const underload = integer(thresholds["underloadBelow"], "Underload threshold", 0, 168);
    const balanced = integer(thresholds["balancedMax"], "Balanced threshold", 0, 168);
    if (balanced <= underload) invalid("Balanced maximum must be greater than the underload threshold.");

    return db.transaction(() => {
      if (expectedRevision !== revision(db))
        throw new CatalogError("STALE_DATA", "School data changed elsewhere. Refresh before saving.");
      const settings = settingsRepository(db);
      settings.set("school_name", schoolName);
      settings.set("school_year", schoolYear);
      settings.set("prepared_by", preparedBy);
      settings.set("approved_by", schoolHead);
      settings.set("underload_below", String(underload));
      settings.set("balanced_max", String(balanced));
      incrementRevision(db);
      return snapshot();
    }).immediate();
  };

  const applySnapshot = (request: CatalogReplacement): CatalogApplyResult => {
    try {
      const source = record(request);
      const expectedRevision = integer(
        source["expectedRevision"],
        "Revision",
        0,
        Number.MAX_SAFE_INTEGER,
      );
      const requestedTeachers = drafts<TeacherDraft>(source["teachers"], "Teachers");
      const requestedSubjects = drafts<SubjectDraft>(source["subjects"], "Subjects");
      const requestedRooms = drafts<RoomDraft>(source["rooms"], "Rooms");
      const requestedSections = drafts<SectionDraft>(source["sections"], "Sections");

      return db
        .transaction(() => {
          if (expectedRevision !== revision(db))
            throw new CatalogError(
              "STALE_DATA",
              "School data changed elsewhere. Refresh before saving.",
            );

          const idMap: Record<string, string> = {};
          const beforeTeachers = teacherRepo.list();
          const keepTeachers = applyGeneric(
            teacherRepo.list(),
            requestedTeachers,
            teacherRepo.get,
            teacherRepo.create,
            teacherRepo.update,
            (t): NewTeacher =>
              validTeacher({
                name: t.name,
                specialization: t.specialization,
                employment_type: t.employmentType,
                min_hours: t.minHours,
                max_hours: t.maxHours,
              }),
            idMap,
          );
          const keepSubjects = applyGeneric(
            subjectRepo.list(),
            requestedSubjects,
            subjectRepo.get,
            subjectRepo.create,
            subjectRepo.update,
            (s): NewSubject =>
              validSubject({
                name: s.name,
                grade_level: s.gradeLevel,
                minutes_per_week: s.minutesPerWeek,
              }),
            idMap,
          );
          const keepRooms = applyGeneric(
            roomRepo.list(),
            requestedRooms,
            roomRepo.get,
            roomRepo.create,
            roomRepo.update,
            (r): NewRoom => validRoom(r),
            idMap,
          );

          const keptSections = applyGeneric(
            sectionRepo.list(),
            requestedSections,
            sectionRepo.get,
            sectionRepo.create,
            checkedSections.update,
            (s): NewSection => {
              const level = choice(s.schoolLevel, "School level", ["JHS", "SHS"]);
              const existingId = dbId(s.id);
              const original = existingId === null ? undefined : sectionRepo.get(existingId);
              const defaultBell = bellRepo.getByName(level === "JHS" ? "JHS-50-A" : "SHS-60");
              const selectedBellId = s.bellScheduleId
                ? (dbId(s.bellScheduleId) ?? invalid("Bell profile ID must be numeric."))
                : original && original.school_level === level
                  ? original.bell_schedule_id
                  : defaultBell?.id;
              const bell = selectedBellId ? bellRepo.get(selectedBellId) : undefined;
              if (!bell || bell.school_level !== level)
                return invalid("Select a matching school-level bell schedule.");

              const adviser = optionalText(s.adviser, "Adviser");
              let adviserId: number | null = null;
              if (adviser) {
                const wanted = normalizeNameKey(adviser);
                const candidates = teacherRepo.list().filter((t) => t.name_key === wanted);
                if (candidates.length === 1) adviserId = candidates[0]!.id;
                else if (
                  original?.adviser_teacher_id &&
                  beforeTeachers.some(
                    (t) => t.id === original.adviser_teacher_id && t.name_key === wanted,
                  )
                )
                  adviserId = original.adviser_teacher_id;
                else
                  return invalid(
                    "Adviser name is unknown or ambiguous. Select an existing teacher.",
                  );
              }
              return validateSectionReferences({
                name: s.name,
                grade_level: s.gradeLevel,
                school_level: level,
                bell_schedule_id: bell.id,
                adviser_teacher_id: adviserId,
              });
            },
            idMap,
          );

          // Dependents first, so foreign keys prevent accidental loss of
          // teachers and rooms currently used by a class or an elective group.
          for (const s of sectionRepo.list()) if (!keptSections.has(s.id)) sectionRepo.delete(s.id);
          for (const s of subjectRepo.list()) if (!keepSubjects.has(s.id)) subjectRepo.delete(s.id);
          for (const r of roomRepo.list()) if (!keepRooms.has(r.id)) roomRepo.delete(r.id);
          for (const t of teacherRepo.list())
            if (!keepTeachers.has(t.id)) {
              teacherInUse(t.id);
              teacherRepo.delete(t.id);
            }
          const committedRevision = incrementRevision(db);
          return { revision: committedRevision, idMap, snapshot: snapshot() };
        })
        .immediate();
    } catch (error) {
      return translateError(error);
    }
  };

  return { teachers, sections, subjects, rooms, bellSchedules: bellRepo, snapshot, applySnapshot, ensureSchoolName, saveSettings };
}
