# E-CLASS — Step 4 Complete Source

Exact source snapshot of all files created or modified in Step 4, including test code and the isolated Electron IPC verifier. The full list appears below. Existing React page components were not edited. Generated build outputs are excluded.

## shared/schedule-types.ts

````typescript
import type { Assignment } from "../electron/db/repositories/types";

export type SchoolTerm = 1 | 2 | 3;
export type SchoolDay = 1 | 2 | 3 | 4 | 5;

/**
 * The renderer chooses a STARTING teaching period and a number of periods.
 * Actual start and end minutes are always calculated by the main process.
 */
export interface ScheduleCandidate {
  schoolYear: string;
  term: SchoolTerm;
  day: SchoolDay;
  sectionId?: number | null;
  electiveGroupId?: number | null;
  subjectId: number;
  teacherId: number;
  roomId: number;
  startTimeSlotId: number;
  durationPeriods: number;
}

export interface ScheduleFilter {
  schoolYear: string;
  term?: SchoolTerm;
}

export type ScheduleConflictType = "teacher" | "section" | "room" | "duplicate";

export interface ScheduleConflict {
  type: ScheduleConflictType;
  message: string;
  conflictingAssignmentId: number | null;
}

export interface ScheduleConflictRecord extends ScheduleConflict {
  assignmentId: number;
}

export interface ScheduleValidation {
  valid: boolean;
  conflicts: ScheduleConflict[];
}

export type SavedScheduleAssignment = Assignment;
export interface ScheduleChangeSet {
  creates: ScheduleCandidate[];
  updates: { id: number; candidate: ScheduleCandidate }[];
  deletes: number[];
}

export interface ScheduleChangeResult {
  created: SavedScheduleAssignment[];
  updated: SavedScheduleAssignment[];
  deleted: number[];
}

export interface ElectiveGroupCandidate {
  name: string;
  schoolYear: string;
  term: SchoolTerm;
  day: SchoolDay;
  startTimeSlotId: number;
  durationPeriods: number;
  sectionIds: number[];
}

export interface ElectiveGroupDetails {
  id: number;
  name: string;
  schoolYear: string;
  term: SchoolTerm;
  day: SchoolDay;
  startTimeSlotId: number;
  startMinute: number;
  endMinute: number;
  durationPeriods: number;
  sectionIds: number[];
}

````

## electron/services/conflicts.ts

````typescript
import type { SchoolDatabase } from "../db/database";
import type { Assignment, NewAssignment } from "../db/repositories/types";
import { assignmentsRepository } from "../db/repositories/assignments";
import type {
  ScheduleConflict,
  ScheduleConflictRecord,
  ScheduleValidation,
  SchoolTerm,
} from "../../shared/schedule-types";

const weekdays = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function memberSections(db: SchoolDatabase, a: Assignment | NewAssignment): number[] {
  if (a.section_id !== null) return [a.section_id];
  if (a.elective_group_id === null) return [];
  return (
    db
      .prepare(
        "SELECT section_id FROM elective_group_sections WHERE elective_group_id=? ORDER BY section_id",
      )
      .all(a.elective_group_id) as { section_id: number }[]
  ).map((x) => x.section_id);
}

function sharedSections(a: number[], b: number[]): number[] {
  const other = new Set(b);
  return a.filter((id) => other.has(id));
}

function recordName(
  db: SchoolDatabase,
  table: "teachers" | "rooms" | "sections",
  id: number,
): string {
  const sql =
    table === "teachers"
      ? "SELECT name FROM teachers WHERE id=?"
      : table === "rooms"
        ? "SELECT name FROM rooms WHERE id=?"
        : "SELECT name FROM sections WHERE id=?";
  const found = db.prepare(sql).get(id) as { name: string } | undefined;
  return found?.name ?? `#${id}`;
}

function addConflict(
  matches: ScheduleConflict[],
  type: ScheduleConflict["type"],
  id: number | null,
  message: string,
): void {
  if (
    !matches.some(
      (c) => c.type === type && c.conflictingAssignmentId === id && c.message === message,
    )
  ) {
    matches.push({ type, message, conflictingAssignmentId: id });
  }
}

function existingClassLabel(db: SchoolDatabase, existing: Assignment): string {
  if (existing.section_id !== null) return recordName(db, "sections", existing.section_id);
  const group = db
    .prepare("SELECT name FROM elective_groups WHERE id=?")
    .get(existing.elective_group_id) as { name: string } | undefined;
  return group ? `elective group ${group.name}` : "an elective block";
}

function existingPeriodLabel(db: SchoolDatabase, existing: Assignment): string {
  const slot = db
    .prepare("SELECT period_no FROM time_slots WHERE id=?")
    .get(existing.start_time_slot_id) as { period_no: number | null } | undefined;
  return slot?.period_no ? `Period ${slot.period_no}` : "scheduled class block";
}

function compareAssignments(
  db: SchoolDatabase,
  proposed: NewAssignment | Assignment,
  existing: Assignment,
): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  const day = weekdays[proposed.day] ?? "school day";
  const proposedMembers = memberSections(db, proposed);
  const existingMembers = memberSections(db, existing);
  const common = sharedSections(proposedMembers, existingMembers);
  const sameGroup =
    proposed.elective_group_id !== null &&
    proposed.elective_group_id === existing.elective_group_id;
  const exact =
    proposed.start_minute === existing.start_minute &&
    proposed.end_minute === existing.end_minute &&
    proposed.subject_id === existing.subject_id &&
    proposed.teacher_id === existing.teacher_id &&
    proposed.room_id === existing.room_id &&
    (sameGroup || (proposed.section_id !== null && proposed.section_id === existing.section_id));
  if (exact) {
    addConflict(
      conflicts,
      "duplicate",
      existing.id,
      `Duplicate class entry on ${day} (assignment #${existing.id}).`,
    );
  }
  if (proposed.teacher_id === existing.teacher_id) {
    addConflict(
      conflicts,
      "teacher",
      existing.id,
      `Teacher ${recordName(db, "teachers", proposed.teacher_id)} is already assigned to ${existingClassLabel(db, existing)} on ${day}, ${existingPeriodLabel(db, existing)} (assignment #${existing.id}).`,
    );
  }
  if (proposed.room_id === existing.room_id) {
    addConflict(
      conflicts,
      "room",
      existing.id,
      `Room ${recordName(db, "rooms", proposed.room_id)} is already occupied on ${day} (assignment #${existing.id}).`,
    );
  }
  if (!sameGroup && common.length) {
    addConflict(
      conflicts,
      "section",
      existing.id,
      `Section ${recordName(db, "sections", common[0]!)} is already scheduled on ${day} (assignment #${existing.id}).`,
    );
  }
  return conflicts;
}

/** Checks a normalized, time-derived record. This also checks group
 * reservations that may exist before the group has any teacher pairs.
 */
export function checkAssignmentConflicts(
  db: SchoolDatabase,
  candidate: NewAssignment,
  excludeId?: number,
): ScheduleValidation {
  const conflicts: ScheduleConflict[] = [];
  const overlapping = assignmentsRepository(db).findOverlaps({
    schoolYear: candidate.school_year,
    term: candidate.term,
    day: candidate.day,
    startMinute: candidate.start_minute,
    endMinute: candidate.end_minute,
    ...(excludeId === undefined ? {} : { excludeId }),
  });
  for (const existing of overlapping)
    conflicts.push(...compareAssignments(db, candidate, existing));

  const members = memberSections(db, candidate);
  if (members.length) {
    const groups = db
      .prepare(
        `
      SELECT DISTINCT g.id,g.name,egs.section_id
      FROM elective_groups g JOIN elective_group_sections egs ON egs.elective_group_id=g.id
      WHERE g.school_year=? AND g.term=? AND g.day=?
        AND g.start_minute < ? AND g.end_minute > ?
      ORDER BY g.id,egs.section_id
    `,
      )
      .all(
        candidate.school_year,
        candidate.term,
        candidate.day,
        candidate.end_minute,
        candidate.start_minute,
      ) as Array<{ id: number; name: string; section_id: number }>;
    for (const group of groups) {
      if (group.id === candidate.elective_group_id || !members.includes(group.section_id)) continue;
      addConflict(
        conflicts,
        "section",
        null,
        `Section ${recordName(db, "sections", group.section_id)} is already reserved for elective group ${group.name} on ${weekdays[candidate.day]}.`,
      );
    }
  }
  return { valid: conflicts.length === 0, conflicts };
}

/** Review even legacy/invalid rows that bypassed the normal schedule handler. */
export function detectAllConflicts(
  db: SchoolDatabase,
  term: SchoolTerm,
  schoolYear: string,
): ScheduleConflictRecord[] {
  const rows = assignmentsRepository(db).list({ term, schoolYear });
  const result: ScheduleConflictRecord[] = [];
  for (let i = 0; i < rows.length; i++) {
    const first = rows[i]!;
    for (let j = i + 1; j < rows.length; j++) {
      const second = rows[j]!;
      if (first.day !== second.day) continue;
      if (!(first.start_minute < second.end_minute && second.start_minute < first.end_minute))
        continue;
      const matches = compareAssignments(db, first, second);
      for (const match of matches)
        result.push({
          ...match,
          assignmentId: first.id,
          conflictingAssignmentId: second.id,
        });
    }
  }
  return result;
}

/** A new elective group reserves every participating section's time,
 * even when the group has not yet been assigned any teaching pairs.
 */
export function checkSectionReservations(
  db: SchoolDatabase,
  sections: number[],
  year: string,
  term: SchoolTerm,
  day: number,
  start: number,
  end: number,
  excludeGroupId?: number,
): void {
  if (!sections.length) throw new Error("Elective groups require a section.");
  const others = assignmentsRepository(db).findOverlaps({
    schoolYear: year,
    term,
    day: day as 1 | 2 | 3 | 4 | 5,
    startMinute: start,
    endMinute: end,
  });
  for (const other of others) {
    const common = sharedSections(sections, memberSections(db, other));
    if (common.length && other.elective_group_id !== excludeGroupId)
      throw new Error(
        `Section ${recordName(db, "sections", common[0]!)} is already scheduled during this elective block.`,
      );
  }
  const rows = db
    .prepare(
      `
    SELECT DISTINCT g.id, s.section_id
    FROM elective_groups g JOIN elective_group_sections s ON s.elective_group_id=g.id
    WHERE g.school_year=? AND g.term=? AND g.day=?
      AND g.start_minute < ? AND g.end_minute > ?
  `,
    )
    .all(year, term, day, end, start) as Array<{ id: number; section_id: number }>;
  for (const row of rows) {
    if (row.id !== excludeGroupId && sections.includes(row.section_id)) {
      throw new Error("Section is already reserved for another elective group.");
    }
  }
}

````

## electron/services/schedule.ts

````typescript
import type { SchoolDatabase } from "../db/database";
import type { TimeSlot, NewAssignment, Assignment, ElectiveGroup } from "../db/repositories/types";
import { assignmentsRepository } from "../db/repositories/assignments";
import { electivesRepository } from "../db/repositories/electives";
import { bellSchedulesRepository } from "../db/repositories/bell-schedules";
import {
  teachersRepository,
  subjectsRepository,
  roomsRepository,
} from "../db/repositories/catalog";
import { sectionsRepository } from "../db/repositories/sections";
import { CatalogError } from "./catalog";
import {
  checkAssignmentConflicts,
  checkSectionReservations,
  detectAllConflicts,
} from "./conflicts";
import type {
  SchoolTerm,
  SchoolDay,
  ScheduleCandidate,
  ScheduleFilter,
  ScheduleValidation,
  ScheduleChangeSet,
  ScheduleChangeResult,
  ElectiveGroupCandidate,
  ElectiveGroupDetails,
} from "../../shared/schedule-types";

function fail(message: string, code = "INVALID_INPUT"): never {
  throw new CatalogError(code, message);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("A schedule object is required.");
  return value as Record<string, unknown>;
}

function number(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    return fail(`${name} must be between ${min} and ${max}.`);
  return value as number;
}

function year(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 32)
    return fail("A valid school year is required.");
  return value.trim();
}

function parseTerm(term: unknown): SchoolTerm {
  return number(term, "Term", 1, 3) as SchoolTerm;
}
function parseDay(day: unknown): SchoolDay {
  return number(day, "Day", 1, 5) as SchoolDay;
}

function parseCandidate(value: unknown): ScheduleCandidate {
  const v = object(value);
  const allowed = new Set([
    "schoolYear",
    "term",
    "day",
    "sectionId",
    "electiveGroupId",
    "subjectId",
    "teacherId",
    "roomId",
    "startTimeSlotId",
    "durationPeriods",
  ]);
  for (const key of Object.keys(v))
    if (!allowed.has(key))
      fail(
        `Unexpected or unsupported assignment field: ${key}. Times are derived from bell schedules.`,
      );
  const sectionId =
    v["sectionId"] == null
      ? null
      : number(v["sectionId"], "Section ID", 1, Number.MAX_SAFE_INTEGER);
  const electiveGroupId =
    v["electiveGroupId"] == null
      ? null
      : number(v["electiveGroupId"], "Elective group ID", 1, Number.MAX_SAFE_INTEGER);
  if ((sectionId === null) === (electiveGroupId === null))
    fail("Choose exactly one section or elective group.");
  return {
    schoolYear: year(v["schoolYear"]),
    term: parseTerm(v["term"]),
    day: parseDay(v["day"]),
    sectionId,
    electiveGroupId,
    subjectId: number(v["subjectId"], "Subject ID", 1, Number.MAX_SAFE_INTEGER),
    teacherId: number(v["teacherId"], "Teacher ID", 1, Number.MAX_SAFE_INTEGER),
    roomId: number(v["roomId"], "Room ID", 1, Number.MAX_SAFE_INTEGER),
    startTimeSlotId: number(v["startTimeSlotId"], "Start time slot ID", 1, Number.MAX_SAFE_INTEGER),
    durationPeriods: number(v["durationPeriods"], "Duration (periods)", 1, 20),
  };
}

export function minuteOfDay(value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    return fail("Bell schedule time must be in 24-hour HH:mm format.");
  const [h, m] = value.split(":").map(Number);
  return h! * 60 + m!;
}

function periodRange(
  slots: TimeSlot[],
  startId: number,
  duration: number,
): {
  startMinute: number;
  endMinute: number;
  bellScheduleId: number;
} {
  const start = slots.findIndex((s) => s.id === startId);
  if (start < 0) fail("Start slot does not belong to this section's bell schedule/profile.");
  const first = slots[start]!;
  if (first.kind !== "period") fail("A class must start in a teaching period, not a fixed event.");
  let end = first;
  for (let n = 1; n < duration; n++) {
    const following = slots[start + n];
    if (
      !following ||
      following.kind !== "period" ||
      following.period_no !== (end.period_no ?? 0) + 1 ||
      following.start_time !== end.end_time
    ) {
      fail("Multi-period blocks require consecutive teaching periods without a break.");
    }
    end = following;
  }
  return {
    startMinute: minuteOfDay(first.start_time),
    endMinute: minuteOfDay(end.end_time),
    bellScheduleId: first.bell_schedule_id,
  };
}

function ensureCoveredInterval(slots: TimeSlot[], startMinute: number, endMinute: number): void {
  const periods = slots
    .filter((slot) => slot.kind === "period")
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const matching = periods.findIndex((slot) => minuteOfDay(slot.start_time) === startMinute);
  if (matching < 0) fail("Section bell profile cannot cover the same clock-time elective block.");
  let cursor = startMinute;
  for (let i = matching; i < periods.length && cursor < endMinute; i++) {
    const slot = periods[i]!;
    if (minuteOfDay(slot.start_time) !== cursor)
      fail("Section bell profile cannot cover the same clock-time block without a break.");
    cursor = minuteOfDay(slot.end_time);
  }
  if (cursor !== endMinute)
    fail("Section bell profile cannot cover the same clock-time elective block.");
}

/** The only public scheduling writer. All mutation methods validate again
 * INSIDE an IMMEDIATE transaction. No renderer receives a raw SQL bridge.
 */
export function createScheduleService(db: SchoolDatabase) {
  const repo = assignmentsRepository(db);
  const electiveRepo = electivesRepository(db);
  const bellRepo = bellSchedulesRepository(db);
  const sections = sectionsRepository(db);
  const teachers = teachersRepository(db);
  const subjects = subjectsRepository(db);
  const rooms = roomsRepository(db);

  function slotsForSection(sectionId: number): TimeSlot[] {
    const section = sections.get(sectionId);
    if (!section) return fail("Section does not exist.");
    return bellRepo.listSlots(section.bell_schedule_id);
  }

  function normalize(value: unknown): NewAssignment {
    const candidate = parseCandidate(value);
    if (!teachers.get(candidate.teacherId)) fail("Teacher does not exist.");
    if (!subjects.get(candidate.subjectId)) fail("Subject does not exist.");
    if (!rooms.get(candidate.roomId)) fail("Room does not exist.");
    let startMinute: number;
    let endMinute: number;
    if (candidate.sectionId !== null && candidate.sectionId !== undefined) {
      const range = periodRange(
        slotsForSection(candidate.sectionId),
        candidate.startTimeSlotId,
        candidate.durationPeriods,
      );
      startMinute = range.startMinute;
      endMinute = range.endMinute;
    } else {
      const group = electiveRepo.get(candidate.electiveGroupId!);
      if (!group) fail("Elective group does not exist.");
      if (
        group.school_year !== candidate.schoolYear ||
        group.term !== candidate.term ||
        group.day !== candidate.day ||
        group.start_time_slot_id !== candidate.startTimeSlotId ||
        group.duration_periods !== candidate.durationPeriods
      )
        fail("Assignment must match its elective group calendar and time block.");
      const groupMemberIds = electiveRepo.listSectionIds(group.id);
      if (!groupMemberIds.length) fail("Elective group requires at least one section.");
      // Read and verify the group's stored interval, not any renderer minute values.
      const slot = bellRepo.getSlot(group.start_time_slot_id);
      if (!slot) fail("Elective group time slot no longer exists.");
      const range = periodRange(
        bellRepo.listSlots(slot.bell_schedule_id),
        group.start_time_slot_id,
        group.duration_periods,
      );
      if (group.start_minute !== range.startMinute || group.end_minute !== range.endMinute)
        fail("Elective group time interval is inconsistent with its bell profile.");
      for (const id of groupMemberIds)
        ensureCoveredInterval(slotsForSection(id), range.startMinute, range.endMinute);
      startMinute = range.startMinute;
      endMinute = range.endMinute;
    }
    return {
      school_year: candidate.schoolYear,
      term: candidate.term,
      day: candidate.day,
      start_time_slot_id: candidate.startTimeSlotId,
      start_minute: startMinute,
      end_minute: endMinute,
      duration_periods: candidate.durationPeriods,
      section_id: candidate.sectionId ?? null,
      elective_group_id: candidate.electiveGroupId ?? null,
      subject_id: candidate.subjectId,
      teacher_id: candidate.teacherId,
      room_id: candidate.roomId,
    };
  }

  function get(id: number): Assignment | undefined {
    number(id, "Assignment ID", 1, Number.MAX_SAFE_INTEGER);
    return repo.get(id);
  }

  function ensureValid(proposed: NewAssignment, excludeId?: number): void {
    const check = checkAssignmentConflicts(db, proposed, excludeId);
    if (!check.valid) fail(check.conflicts.map((c) => c.message).join(" "), "CONFLICT");
  }

  function insideSave(candidate: unknown): Assignment {
    const proposed = normalize(candidate);
    ensureValid(proposed);
    return repo.insertWithinTransaction(proposed);
  }
  function insideUpdate(id: number, candidate: unknown): Assignment {
    if (!get(id)) fail("Assignment not found.", "NOT_FOUND");
    const proposed = normalize(candidate);
    ensureValid(proposed, id);
    return repo.updateWithinTransaction(id, proposed);
  }
  function insideDelete(id: number): void {
    if (!get(id)) fail("Assignment not found.", "NOT_FOUND");
    repo.deleteWithinTransaction(id);
  }

  function transact<T>(run: () => T): T {
    return db.transaction(run).immediate();
  }
  const validateAssignment = (
    candidate: ScheduleCandidate,
    excludeId?: number,
  ): ScheduleValidation => {
    if (excludeId !== undefined) {
      number(excludeId, "Excluded assignment ID", 1, Number.MAX_SAFE_INTEGER);
      if (!get(excludeId)) fail("Assignment not found.", "NOT_FOUND");
    }
    return checkAssignmentConflicts(db, normalize(candidate), excludeId);
  };
  const save = (candidate: ScheduleCandidate) => transact(() => insideSave(candidate));
  const update = (id: number, candidate: ScheduleCandidate) =>
    transact(() => insideUpdate(id, candidate));
  const remove = (id: number) =>
    transact(() => {
      insideDelete(id);
      return true as const;
    });

  const applyChanges = (changes: ScheduleChangeSet): ScheduleChangeResult =>
    transact(() => {
      const request = object(changes);
      if (
        !Array.isArray(request["creates"]) ||
        !Array.isArray(request["updates"]) ||
        !Array.isArray(request["deletes"])
      )
        fail("Schedule changes require create/update/delete arrays.");
      const creates = request["creates"] as unknown[];
      const updates = request["updates"] as Array<{ id: number; candidate: ScheduleCandidate }>;
      const deletes = request["deletes"] as unknown[];
      if (creates.length + updates.length + deletes.length > 2000)
        fail("Batch exceeds the 2000-change limit.");
      const ids = new Set<number>();
      for (const entry of [...updates.map((u) => u?.id), ...deletes]) {
        const id = number(entry, "Assignment ID", 1, Number.MAX_SAFE_INTEGER);
        if (ids.has(id)) fail("An assignment cannot appear twice in one batch.");
        ids.add(id);
      }
      for (const id of deletes) insideDelete(id as number);
      const updated = updates.map((u) => insideUpdate(u.id, u.candidate));
      const created = creates.map((c) => insideSave(c));
      return { created, updated, deleted: deletes as number[] };
    });

  function groupDetails(group: ElectiveGroup): ElectiveGroupDetails {
    return {
      id: group.id,
      name: group.name,
      schoolYear: group.school_year,
      term: group.term,
      day: group.day,
      startTimeSlotId: group.start_time_slot_id,
      startMinute: group.start_minute,
      endMinute: group.end_minute,
      durationPeriods: group.duration_periods,
      sectionIds: electiveRepo.listSectionIds(group.id),
    };
  }
  const getElectiveGroup = (id: number): ElectiveGroupDetails | undefined => {
    const group = electiveRepo.get(number(id, "Elective group ID", 1, Number.MAX_SAFE_INTEGER));
    return group ? groupDetails(group) : undefined;
  };
  const listElectiveGroups = (filter: ScheduleFilter): ElectiveGroupDetails[] => {
    const y = year(filter?.schoolYear);
    const t = filter.term === undefined ? null : parseTerm(filter.term);
    return (
      db
        .prepare(
          `
      SELECT * FROM elective_groups
      WHERE school_year=? AND (? IS NULL OR term=?)
      ORDER BY term,day,start_minute,id
    `,
        )
        .all(y, t, t) as ElectiveGroup[]
    ).map(groupDetails);
  };
  const createElectiveGroup = (value: ElectiveGroupCandidate): ElectiveGroupDetails =>
    transact(() => {
      const input = object(value);
      const name = input["name"];
      if (typeof name !== "string" || !name.trim() || name.trim().length > 200)
        fail("Elective group name is required.");
      const schoolYear = year(input["schoolYear"]);
      const term = parseTerm(input["term"]);
      const day = parseDay(input["day"]);
      const startTimeSlotId = number(
        input["startTimeSlotId"],
        "Start slot ID",
        1,
        Number.MAX_SAFE_INTEGER,
      );
      const durationPeriods = number(input["durationPeriods"], "Duration periods", 1, 20);
      const sectionIds = input["sectionIds"];
      if (!Array.isArray(sectionIds) || !sectionIds.length || sectionIds.length > 50)
        fail("Elective group must list 1–50 sections.");
      const ids = sectionIds.map((id) => number(id, "Section ID", 1, Number.MAX_SAFE_INTEGER));
      if (new Set(ids).size !== ids.length) fail("Elective group cannot repeat a section.");
      const firstSlot = bellRepo.getSlot(startTimeSlotId);
      if (!firstSlot) fail("Elective group start slot does not exist.");
      if (!ids.some((id) => sections.get(id)?.bell_schedule_id === firstSlot.bell_schedule_id))
        fail("Elective group start slot must belong to one of its sections' bell profiles.");
      const interval = periodRange(
        bellRepo.listSlots(firstSlot.bell_schedule_id),
        startTimeSlotId,
        durationPeriods,
      );
      for (const id of ids)
        ensureCoveredInterval(slotsForSection(id), interval.startMinute, interval.endMinute);
      try {
        checkSectionReservations(
          db,
          ids,
          schoolYear,
          term,
          day,
          interval.startMinute,
          interval.endMinute,
        );
      } catch (error) {
        fail(error instanceof Error ? error.message : "Section is already scheduled.", "CONFLICT");
      }
      const group = electiveRepo.create({
        name: name.trim(),
        school_year: schoolYear,
        term,
        day,
        start_time_slot_id: startTimeSlotId,
        start_minute: interval.startMinute,
        end_minute: interval.endMinute,
        duration_periods: durationPeriods,
      });
      for (const id of ids) electiveRepo.addSection(group.id, id);
      return groupDetails(group);
    });

  const addElectiveGroupSection = (groupId: number, sectionId: number): ElectiveGroupDetails =>
    transact(() => {
      const group = electiveRepo.get(
        number(groupId, "Elective group ID", 1, Number.MAX_SAFE_INTEGER),
      );
      if (!group) fail("Elective group not found.", "NOT_FOUND");
      const section = number(sectionId, "Section ID", 1, Number.MAX_SAFE_INTEGER);
      if (electiveRepo.listSectionIds(groupId).includes(section))
        fail("Section already belongs to the elective group.");
      ensureCoveredInterval(slotsForSection(section), group.start_minute, group.end_minute);
      try {
        checkSectionReservations(
          db,
          [section],
          group.school_year,
          group.term,
          group.day,
          group.start_minute,
          group.end_minute,
          group.id,
        );
      } catch (error) {
        fail(error instanceof Error ? error.message : "Section already scheduled.", "CONFLICT");
      }
      electiveRepo.addSection(groupId, section);
      return groupDetails(group);
    });

  const deleteElectiveGroup = (id: number): true =>
    transact(() => {
      const groupId = number(id, "Elective group ID", 1, Number.MAX_SAFE_INTEGER);
      if (!electiveRepo.get(groupId)) fail("Elective group not found.", "NOT_FOUND");
      if (db.prepare("SELECT id FROM assignments WHERE elective_group_id=? LIMIT 1").get(groupId))
        fail("Elective group is in use by assignments.", "IN_USE");
      db.prepare("DELETE FROM elective_group_sections WHERE elective_group_id=?").run(groupId);
      electiveRepo.delete(groupId);
      return true;
    });

  const list = (filter: ScheduleFilter): Assignment[] => {
    const schoolYear = year(filter?.schoolYear);
    const term = filter.term === undefined ? null : parseTerm(filter.term);
    return db
      .prepare(
        `
      SELECT * FROM assignments WHERE school_year=?
        AND (? IS NULL OR term=?)
      ORDER BY term,day,start_minute,id
    `,
      )
      .all(schoolYear, term, term) as Assignment[];
  };
  const detectConflicts = (term: SchoolTerm, schoolYear: string) =>
    detectAllConflicts(db, parseTerm(term), year(schoolYear));

  return {
    get,
    list,
    validateAssignment,
    save,
    update,
    delete: remove,
    applyChanges,
    detectAllConflicts: detectConflicts,
    createElectiveGroup,
    getElectiveGroup,
    listElectiveGroups,
    addElectiveGroupSection,
    deleteElectiveGroup,
  };
}

````

## electron/services/catalog.ts

````typescript
import type { SchoolDatabase } from "../db/database";
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
          return { revision: incrementRevision(db), idMap };
        })
        .immediate();
    } catch (error) {
      return translateError(error);
    }
  };

  return { teachers, sections, subjects, rooms, bellSchedules: bellRepo, snapshot, applySnapshot };
}

````

## electron/db/repositories/assignments.ts

````typescript
import type { SchoolDatabase } from "../database";
import type { Assignment, NewAssignment } from "./types";

interface AssignmentFilter {
  schoolYear: string;
  term: 1 | 2 | 3;
}
interface OverlapFilter extends AssignmentFilter {
  day: 1 | 2 | 3 | 4 | 5;
  startMinute: number;
  endMinute: number;
  excludeId?: number;
}

export function assignmentsRepository(db: SchoolDatabase) {
  const get = (id: number) =>
    db.prepare("SELECT * FROM assignments WHERE id=?").get(id) as Assignment | undefined;
  const list = ({ schoolYear, term }: AssignmentFilter) =>
    db
      .prepare(
        `SELECT * FROM assignments WHERE school_year=? AND term=?
      ORDER BY day,start_minute,id`,
      )
      .all(schoolYear, term) as Assignment[];
  const findOverlaps = ({
    schoolYear,
    term,
    day,
    startMinute,
    endMinute,
    excludeId,
  }: OverlapFilter) =>
    db
      .prepare(
        `SELECT * FROM assignments WHERE school_year=@schoolYear
      AND term=@term AND day=@day
      AND start_minute < @endMinute AND end_minute > @startMinute
      AND (@excludeId IS NULL OR id<>@excludeId) ORDER BY start_minute,id`,
      )
      .all({
        schoolYear,
        term,
        day,
        startMinute,
        endMinute,
        excludeId: excludeId ?? null,
      }) as Assignment[];

  // Internal write primitive, intentionally unvalidated: Step 4 will call
  // this only inside an IMMEDIATE transaction after checking ALL interval
  // overlaps. No IPC handler should ever call this directly.
  const insertWithinTransaction = (assignment: NewAssignment): Assignment => {
    if (!db.inTransaction) throw new Error("Assignment insertion requires a database transaction.");
    const row = db
      .prepare(
        `
      INSERT INTO assignments(school_year,term,day,start_time_slot_id,start_minute,
        end_minute,duration_periods,section_id,elective_group_id,subject_id,teacher_id,room_id)
      VALUES(@school_year,@term,@day,@start_time_slot_id,@start_minute,
        @end_minute,@duration_periods,@section_id,@elective_group_id,@subject_id,@teacher_id,@room_id)`,
      )
      .run(assignment);
    return get(Number(row.lastInsertRowid))!;
  };
  const updateWithinTransaction = (id: number, assignment: NewAssignment): Assignment => {
    if (!db.inTransaction) throw new Error("Assignment update requires a database transaction.");
    const result = db
      .prepare(
        `
      UPDATE assignments SET school_year=@school_year,term=@term,day=@day,
        start_time_slot_id=@start_time_slot_id,start_minute=@start_minute,
        end_minute=@end_minute,duration_periods=@duration_periods,
        section_id=@section_id,elective_group_id=@elective_group_id,
        subject_id=@subject_id,teacher_id=@teacher_id,room_id=@room_id,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=@id
    `,
      )
      .run({ ...assignment, id });
    if (result.changes !== 1) throw new Error("Assignment not found.");
    return get(id)!;
  };
  const deleteWithinTransaction = (id: number): boolean => {
    if (!db.inTransaction) throw new Error("Assignment deletion requires a database transaction.");
    return db.prepare("DELETE FROM assignments WHERE id=?").run(id).changes === 1;
  };
  return {
    get,
    list,
    findOverlaps,
    insertWithinTransaction,
    updateWithinTransaction,
    deleteWithinTransaction,
  };
}

````

## electron/ipc/schedule.ts

````typescript
import type { WindowProvider } from "./handler";
import { registerHandler } from "./handler";
import type { createScheduleService } from "../services/schedule";
import type {
  ScheduleCandidate,
  ScheduleChangeSet,
  ScheduleFilter,
  SchoolTerm,
} from "../../shared/schedule-types";
import { CatalogError } from "../services/catalog";

export function registerScheduleHandlers(
  getWindow: WindowProvider,
  service: ReturnType<typeof createScheduleService>,
): void {
  registerHandler("schedule:list", getWindow, (filter) => service.list(filter as ScheduleFilter));
  registerHandler("schedule:get", getWindow, (id) => {
    const found = service.get(id as number);
    if (!found) throw new CatalogError("NOT_FOUND", "Assignment not found.");
    return found;
  });
  registerHandler("schedule:validate", getWindow, (candidate, excludeId) =>
    service.validateAssignment(candidate as ScheduleCandidate, excludeId as number | undefined),
  );
  registerHandler("schedule:save", getWindow, (candidate) =>
    service.save(candidate as ScheduleCandidate),
  );
  registerHandler("schedule:update", getWindow, (id, candidate) =>
    service.update(id as number, candidate as ScheduleCandidate),
  );
  registerHandler("schedule:delete", getWindow, (id) => {
    service.delete(id as number);
    return { deleted: true as const };
  });
  registerHandler("schedule:applyChanges", getWindow, (changes) =>
    service.applyChanges(changes as ScheduleChangeSet),
  );
  registerHandler("schedule:detectConflicts", getWindow, (term, schoolYear) =>
    service.detectAllConflicts(term as SchoolTerm, schoolYear as string),
  );
}

````

## electron/ipc/electives.ts

````typescript
import type { WindowProvider } from "./handler";
import { registerHandler } from "./handler";
import type { createScheduleService } from "../services/schedule";
import { CatalogError } from "../services/catalog";
import type { ElectiveGroupCandidate, ScheduleFilter } from "../../shared/schedule-types";

export function registerElectiveHandlers(
  getWindow: WindowProvider,
  service: ReturnType<typeof createScheduleService>,
): void {
  registerHandler("electives:create", getWindow, (candidate) =>
    service.createElectiveGroup(candidate as ElectiveGroupCandidate),
  );
  registerHandler("electives:get", getWindow, (id) => {
    const group = service.getElectiveGroup(id as number);
    if (!group) throw new CatalogError("NOT_FOUND", "Elective group not found.");
    return group;
  });
  registerHandler("electives:list", getWindow, (filter) =>
    service.listElectiveGroups(filter as ScheduleFilter),
  );
  registerHandler("electives:addSection", getWindow, (groupId, sectionId) =>
    service.addElectiveGroupSection(groupId as number, sectionId as number),
  );
  registerHandler("electives:delete", getWindow, (id) => {
    service.deleteElectiveGroup(id as number);
    return { deleted: true as const };
  });
}

````

## electron/main.ts

````typescript
import { app, BrowserWindow, dialog } from "electron";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { registerSystemHandlers } from "./ipc/system";
import { logError } from "./services/logger";
import { getWindowOptions, isAllowedNavigation } from "./security";
import { openSchoolDatabase, type SchoolDatabase } from "./db/database";
import { createCatalogService } from "./services/catalog";
import { registerTeachersHandlers } from "./ipc/teachers";
import { registerSectionsHandlers } from "./ipc/sections";
import { registerSubjectsHandlers } from "./ipc/subjects";
import { registerRoomsHandlers } from "./ipc/rooms";
import { registerCatalogHandlers } from "./ipc/catalog";
import { createScheduleService } from "./services/schedule";
import { registerScheduleHandlers } from "./ipc/schedule";
import { registerElectiveHandlers } from "./ipc/electives";

const DEV_URL = "http://127.0.0.1:8080/";
let mainWindow: BrowserWindow | null = null;
let schoolDatabase: SchoolDatabase | null = null;

function createWindow(): void {
  const preload = join(__dirname, "preload.cjs");
  const index = join(__dirname, "renderer", "index.html");
  const useDevServer = !app.isPackaged && process.env.ECLASS_STATIC !== "1";
  const initialUrl = useDevServer ? DEV_URL : pathToFileURL(index).href;
  const window = new BrowserWindow(getWindowOptions(preload));
  mainWindow = window;

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, destination) => {
    if (!isAllowedNavigation(destination, initialUrl)) event.preventDefault();
  });
  window.webContents.on("did-fail-load", (_event, errorCode, description, url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) {
      logError("window:load", new Error(`${errorCode}: ${description} (${url})`));
      window.show();
    }
  });

  const loading = useDevServer ? window.loadURL(DEV_URL) : window.loadFile(index);
  void loading.catch((error: unknown) => logError("window:load", error));
}

app.setName("E-CLASS");
// Explicitly opt into a disposable database location during local test runs.
// Packaged applications always use Electron's standard per-user data path.
if (!app.isPackaged && process.env.ECLASS_TEST_USER_DATA) {
  const target = process.env.ECLASS_TEST_USER_DATA;
  if (!isAbsolute(target)) {
    throw new Error("ECLASS_TEST_USER_DATA must be an absolute path.");
  }
  mkdirSync(target, { recursive: true });
  app.setPath("userData", target);
}
void app
  .whenReady()
  .then(async () => {
    // Always use Electron's per-user data directory, never the project folder.
    // No sample teachers, classes, or rooms are inserted on first launch.
    schoolDatabase = await openSchoolDatabase(app.getPath("userData"));
    const catalog = createCatalogService(schoolDatabase);
    const getWindow = () => mainWindow;
    registerTeachersHandlers(getWindow, catalog);
    registerSectionsHandlers(getWindow, catalog);
    registerSubjectsHandlers(getWindow, catalog);
    registerRoomsHandlers(getWindow, catalog);
    registerCatalogHandlers(getWindow, catalog);
    const scheduling = createScheduleService(schoolDatabase);
    registerScheduleHandlers(getWindow, scheduling);
    registerElectiveHandlers(getWindow, scheduling);
    registerSystemHandlers(() => mainWindow);
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error: unknown) => {
    logError("app:ready", error);
    dialog.showErrorBox(
      "E-CLASS cannot open its database",
      "Your school data has not been changed. Check the log in the E-CLASS data folder.",
    );
    app.quit();
  });

app.on("before-quit", () => {
  if (schoolDatabase?.open) schoolDatabase.close();
  schoolDatabase = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

````

## electron/preload.ts

````typescript
import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopApi,
  AppInfo,
  IpcResult,
  CrudApi,
  Teacher,
  Section,
  Subject,
  Room,
  CatalogSnapshot,
  CatalogReplacement,
  CatalogApplyResult,
  ScheduleCandidate,
  ScheduleFilter,
  ScheduleValidation,
  SavedScheduleAssignment,
  ScheduleChangeSet,
  ScheduleChangeResult,
  SchoolTerm,
  ScheduleConflictRecord,
  ElectiveGroupCandidate,
  ElectiveGroupDetails,
} from "../shared/electron-api";
import type { NewTeacher, NewSection, NewSubject, NewRoom } from "./db/repositories/types";

function crud<New, Row>(domain: string): CrudApi<New, Row> {
  return Object.freeze({
    list: () => ipcRenderer.invoke(`${domain}:list`) as Promise<IpcResult<Row[]>>,
    get: (id: number) => ipcRenderer.invoke(`${domain}:get`, id) as Promise<IpcResult<Row>>,
    create: (input: New) =>
      ipcRenderer.invoke(`${domain}:create`, input) as Promise<IpcResult<Row>>,
    update: (id: number, input: New) =>
      ipcRenderer.invoke(`${domain}:update`, id, input) as Promise<IpcResult<Row>>,
    delete: (id: number) =>
      ipcRenderer.invoke(`${domain}:delete`, id) as Promise<IpcResult<{ deleted: true }>>,
  });
}

// Expose typed, named operations only. Never publish ipcRenderer or a
// general-purpose invoke method to renderer code.
const api: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke("system:getAppInfo") as Promise<IpcResult<AppInfo>>,
  teachers: crud<NewTeacher, Teacher>("teachers"),
  sections: crud<NewSection, Section>("sections"),
  subjects: crud<NewSubject, Subject>("subjects"),
  rooms: crud<NewRoom, Room>("rooms"),
  catalog: Object.freeze({
    snapshot: () => ipcRenderer.invoke("catalog:snapshot") as Promise<IpcResult<CatalogSnapshot>>,
    applySnapshot: (request: CatalogReplacement) =>
      ipcRenderer.invoke("catalog:applySnapshot", request) as Promise<
        IpcResult<CatalogApplyResult>
      >,
  }),
  schedule: Object.freeze({
    list: (filter: ScheduleFilter) =>
      ipcRenderer.invoke("schedule:list", filter) as Promise<IpcResult<SavedScheduleAssignment[]>>,
    get: (id: number) =>
      ipcRenderer.invoke("schedule:get", id) as Promise<IpcResult<SavedScheduleAssignment>>,
    validate: (candidate: ScheduleCandidate, excludeId?: number) =>
      ipcRenderer.invoke("schedule:validate", candidate, excludeId) as Promise<
        IpcResult<ScheduleValidation>
      >,
    save: (candidate: ScheduleCandidate) =>
      ipcRenderer.invoke("schedule:save", candidate) as Promise<IpcResult<SavedScheduleAssignment>>,
    update: (id: number, candidate: ScheduleCandidate) =>
      ipcRenderer.invoke("schedule:update", id, candidate) as Promise<
        IpcResult<SavedScheduleAssignment>
      >,
    delete: (id: number) =>
      ipcRenderer.invoke("schedule:delete", id) as Promise<IpcResult<{ deleted: true }>>,
    applyChanges: (changes: ScheduleChangeSet) =>
      ipcRenderer.invoke("schedule:applyChanges", changes) as Promise<
        IpcResult<ScheduleChangeResult>
      >,
    detectConflicts: (term: SchoolTerm, schoolYear: string) =>
      ipcRenderer.invoke("schedule:detectConflicts", term, schoolYear) as Promise<
        IpcResult<ScheduleConflictRecord[]>
      >,
  }),
  electives: Object.freeze({
    create: (candidate: ElectiveGroupCandidate) =>
      ipcRenderer.invoke("electives:create", candidate) as Promise<IpcResult<ElectiveGroupDetails>>,
    get: (id: number) =>
      ipcRenderer.invoke("electives:get", id) as Promise<IpcResult<ElectiveGroupDetails>>,
    list: (filter: ScheduleFilter) =>
      ipcRenderer.invoke("electives:list", filter) as Promise<IpcResult<ElectiveGroupDetails[]>>,
    addSection: (groupId: number, sectionId: number) =>
      ipcRenderer.invoke("electives:addSection", groupId, sectionId) as Promise<
        IpcResult<ElectiveGroupDetails>
      >,
    delete: (id: number) =>
      ipcRenderer.invoke("electives:delete", id) as Promise<IpcResult<{ deleted: true }>>,
  }),
};

contextBridge.exposeInMainWorld("api", Object.freeze(api));

````

## shared/electron-api.ts

````typescript
export type IpcResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export interface AppInfo {
  appName: string;
  version: string;
  platform: string;
}

/** Public and deliberately minimal until the domain handlers are implemented. */
export interface DesktopApi {
  getAppInfo(): Promise<IpcResult<AppInfo>>;
  teachers: CrudApi<NewTeacher, Teacher>;
  sections: CrudApi<NewSection, Section>;
  subjects: CrudApi<NewSubject, Subject>;
  rooms: CrudApi<NewRoom, Room>;
  catalog: {
    snapshot(): Promise<IpcResult<CatalogSnapshot>>;
    applySnapshot(request: CatalogReplacement): Promise<IpcResult<CatalogApplyResult>>;
  };
  schedule: {
    list(filter: ScheduleFilter): Promise<IpcResult<SavedScheduleAssignment[]>>;
    get(id: number): Promise<IpcResult<SavedScheduleAssignment>>;
    validate(
      candidate: ScheduleCandidate,
      excludeId?: number,
    ): Promise<IpcResult<ScheduleValidation>>;
    save(candidate: ScheduleCandidate): Promise<IpcResult<SavedScheduleAssignment>>;
    update(id: number, candidate: ScheduleCandidate): Promise<IpcResult<SavedScheduleAssignment>>;
    delete(id: number): Promise<IpcResult<{ deleted: true }>>;
    applyChanges(changes: ScheduleChangeSet): Promise<IpcResult<ScheduleChangeResult>>;
    detectConflicts(
      term: SchoolTerm,
      schoolYear: string,
    ): Promise<IpcResult<ScheduleConflictRecord[]>>;
  };
  electives: {
    create(candidate: ElectiveGroupCandidate): Promise<IpcResult<ElectiveGroupDetails>>;
    get(id: number): Promise<IpcResult<ElectiveGroupDetails>>;
    list(filter: ScheduleFilter): Promise<IpcResult<ElectiveGroupDetails[]>>;
    addSection(groupId: number, sectionId: number): Promise<IpcResult<ElectiveGroupDetails>>;
    delete(id: number): Promise<IpcResult<{ deleted: true }>>;
  };
}

import type {
  ScheduleFilter,
  ScheduleCandidate,
  ScheduleValidation,
  SavedScheduleAssignment,
  ScheduleChangeSet,
  ScheduleChangeResult,
  SchoolTerm,
  ScheduleConflictRecord,
  ElectiveGroupCandidate,
  ElectiveGroupDetails,
} from "./schedule-types";
export type {
  ScheduleFilter,
  ScheduleCandidate,
  ScheduleValidation,
  SavedScheduleAssignment,
  ScheduleChangeSet,
  ScheduleChangeResult,
  SchoolTerm,
  ScheduleConflictRecord,
  ElectiveGroupCandidate,
  ElectiveGroupDetails,
};

import type {
  Teacher,
  Section,
  Subject,
  Room,
  BellSchedule,
  TimeSlot,
  NewTeacher,
  NewSection,
  NewSubject,
  NewRoom,
} from "../electron/db/repositories/types";
export type { Teacher, Section, Subject, Room, BellSchedule, TimeSlot };

export interface CrudApi<New, Row> {
  list(): Promise<IpcResult<Row[]>>;
  get(id: number): Promise<IpcResult<Row>>;
  create(input: New): Promise<IpcResult<Row>>;
  update(id: number, input: New): Promise<IpcResult<Row>>;
  delete(id: number): Promise<IpcResult<{ deleted: true }>>;
}

export interface CatalogSnapshot {
  revision: number;
  teachers: Teacher[];
  sections: Section[];
  subjects: Subject[];
  rooms: Room[];
  bellSchedules: BellSchedule[];
  timeSlots: TimeSlot[];
  settings: Record<string, string>;
}

export interface TeacherDraft {
  id: string;
  name: string;
  specialization: string;
  employmentType: NewTeacher["employment_type"];
  minHours: number;
  maxHours: number;
}
export interface SectionDraft {
  id: string;
  name: string;
  gradeLevel: number;
  schoolLevel: "JHS" | "SHS";
  adviser: string;
  bellScheduleId?: string;
}
export interface SubjectDraft {
  id: string;
  name: string;
  gradeLevel: number;
  minutesPerWeek: number;
}
export interface RoomDraft {
  id: string;
  name: string;
  capacity: number;
  type: NewRoom["type"];
}
export interface CatalogReplacement {
  expectedRevision: number;
  teachers: TeacherDraft[];
  sections: SectionDraft[];
  subjects: SubjectDraft[];
  rooms: RoomDraft[];
}
export interface CatalogApplyResult {
  revision: number;
  idMap: Record<string, string>;
}

````

## src/services/scheduleAdapter.ts

````typescript
import type { CatalogSnapshot } from "../../shared/electron-api";
import type {
  ScheduleCandidate,
  SavedScheduleAssignment,
  ScheduleChangeSet,
  ScheduleChangeResult,
  SchoolDay,
} from "../../shared/schedule-types";
import type { Assignment as LegacyAssignment, SchoolData } from "./dataService";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
const resolveNumber = (value: string, resolveId: (id: string) => string, field: string): number => {
  const id = resolveId(value);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
    throw new Error(`${field} must refer to a saved school record. Refresh after creating it.`);
  return Number(id);
};

/** The existing single-period React controls cannot display elective-group
 * membership or render merged multi-period cells yet. Electives remain
 * available through the typed IPC API and must NOT be converted to fake
 * section assignments (which would create false UI conflicts).
 */
export function fromDatabaseAssignments(
  rows: SavedScheduleAssignment[],
  snapshot: CatalogSnapshot,
): LegacyAssignment[] {
  const slots = new Map(snapshot.timeSlots.map((s) => [s.id, s]));
  return rows
    .filter((row) => row.section_id !== null)
    .map((row) => {
      const slot = slots.get(row.start_time_slot_id);
      if (!slot || slot.kind !== "period" || slot.period_no === null)
        throw new Error("Saved assignment refers to an invalid bell period.");
      return {
        id: String(row.id),
        term: row.term,
        sectionId: String(row.section_id),
        subjectId: String(row.subject_id),
        teacherId: String(row.teacher_id),
        roomId: String(row.room_id),
        day: days[row.day - 1]!,
        period: slot.period_no,
        durationPeriods: row.duration_periods,
        startTimeSlotId: String(slot.id),
        startMinute: row.start_minute,
        endMinute: row.end_minute,
      };
    });
}

export function toDatabaseCandidate(
  row: LegacyAssignment,
  current: SchoolData,
  snapshot: CatalogSnapshot,
  resolveId: (id: string) => string,
): ScheduleCandidate {
  const sectionId = resolveNumber(row.sectionId, resolveId, "Section ID");
  const section = snapshot.sections.find((s) => s.id === sectionId);
  if (!section)
    throw new Error("Section not found in the selected bell profile. Refresh school data.");
  const day = days.indexOf(row.day);
  if (day < 0) throw new Error("A valid Monday–Friday school day is required.");
  if (!Number.isSafeInteger(row.period) || row.period < 1)
    throw new Error("The starting teaching period must be valid.");
  const slot = snapshot.timeSlots.find(
    (s) =>
      s.bell_schedule_id === section.bell_schedule_id &&
      s.kind === "period" &&
      s.period_no === row.period,
  );
  if (!slot) throw new Error(`Period ${row.period} is not present in this section's bell profile.`);
  const durationPeriods = row.durationPeriods ?? 1;
  if (!Number.isSafeInteger(durationPeriods) || durationPeriods < 1)
    throw new Error("Duration must be at least one teaching period.");
  return {
    schoolYear: current.settings.schoolYear,
    term: row.term,
    day: (day + 1) as SchoolDay,
    sectionId,
    electiveGroupId: null,
    subjectId: resolveNumber(row.subjectId, resolveId, "Subject ID"),
    teacherId: resolveNumber(row.teacherId, resolveId, "Teacher ID"),
    roomId: resolveNumber(row.roomId, resolveId, "Room ID"),
    startTimeSlotId: slot.id,
    durationPeriods,
  };
}

function semantic(row: LegacyAssignment): string {
  return JSON.stringify({
    term: row.term,
    sectionId: row.sectionId,
    subjectId: row.subjectId,
    teacherId: row.teacherId,
    roomId: row.roomId,
    day: row.day,
    period: row.period,
    durationPeriods: row.durationPeriods ?? 1,
  });
}

export function scheduleDelta(
  previous: LegacyAssignment[],
  next: LegacyAssignment[],
  current: SchoolData,
  snapshot: CatalogSnapshot,
  resolveId: (id: string) => string,
): { changes: ScheduleChangeSet; createdIds: string[] } {
  const existing = new Map(previous.map((row) => [resolveId(row.id), row]));
  const intended = new Set(next.map((row) => resolveId(row.id)));
  if (intended.size !== next.length) throw new Error("Duplicate schedule entry IDs were supplied.");
  const creates: ScheduleCandidate[] = [];
  const createdIds: string[] = [];
  const updates: ScheduleChangeSet["updates"] = [];
  const deletes = previous
    .filter((row) => !intended.has(resolveId(row.id)))
    .map((row) => resolveNumber(row.id, resolveId, "Assignment ID"));
  for (const row of next) {
    const resolvedId = resolveId(row.id);
    const old = existing.get(resolvedId);
    if (!old) {
      if (/^\d+$/.test(resolvedId))
        throw new Error("Cannot create an assignment using an existing database ID.");
      creates.push(toDatabaseCandidate(row, current, snapshot, resolveId));
      createdIds.push(row.id);
    } else if (
      semantic({
        ...old,
        sectionId: resolveId(old.sectionId),
        subjectId: resolveId(old.subjectId),
        teacherId: resolveId(old.teacherId),
        roomId: resolveId(old.roomId),
      }) !==
      semantic({
        ...row,
        sectionId: resolveId(row.sectionId),
        subjectId: resolveId(row.subjectId),
        teacherId: resolveId(row.teacherId),
        roomId: resolveId(row.roomId),
      })
    ) {
      updates.push({
        id: resolveNumber(resolvedId, resolveId, "Assignment ID"),
        candidate: toDatabaseCandidate(row, current, snapshot, resolveId),
      });
    }
  }
  return { changes: { creates, updates, deletes }, createdIds };
}

export function mapScheduleResultIds(
  createdIds: string[],
  result: ScheduleChangeResult,
  temporaryIds: Map<string, string>,
): void {
  if (createdIds.length !== result.created.length)
    throw new Error("Schedule IPC returned an incomplete ID mapping.");
  for (let i = 0; i < createdIds.length; i++)
    temporaryIds.set(createdIds[i]!, String(result.created[i]!.id));
}

````

## src/services/dataService.ts

````typescript
import { validateAssignmentConflicts } from "@/lib/conflicts";
import { toast } from "sonner";
import { schoolDataFromCatalog, catalogReplacementFromSchoolData } from "./catalogAdapter";
import {
  fromDatabaseAssignments,
  toDatabaseCandidate,
  scheduleDelta,
  mapScheduleResultIds,
} from "./scheduleAdapter";
import type { IpcResult, CatalogSnapshot } from "../../shared/electron-api";

export type Term = 1 | 2 | 3;
export type Day = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday";
export type EmploymentType = "Permanent" | "Contractual" | "Part-time";
export type RoomType = "Classroom" | "Laboratory" | "ICT room";

export interface Teacher {
  id: string;
  name: string;
  specialization: string;
  employmentType: EmploymentType;
  minHours: number;
  maxHours: number;
}

export interface Section {
  id: string;
  name: string;
  gradeLevel: number;
  adviser: string;
  schoolLevel: "JHS" | "SHS";
  /** The renderer's optional bell-profile selector; defaults from school level. */
  bellScheduleId?: string;
}

export interface Subject {
  id: string;
  name: string;
  gradeLevel: number;
  minutesPerWeek: number;
}

export interface Room {
  id: string;
  name: string;
  capacity: number;
  type: RoomType;
}

export interface TimeSlot {
  id: string;
  period: number;
  startTime: string;
  endTime: string;
  isBreak: boolean;
}

export interface Assignment {
  id: string;
  term: Term;
  sectionId: string;
  subjectId: string;
  teacherId: string;
  roomId: string;
  day: Day;
  period: number;
  durationPeriods?: number;
  startTimeSlotId?: string;
  startMinute?: number;
  endMinute?: number;
}

export interface LoadThresholds {
  underloadBelow: number;
  balancedMax: number;
}

export interface SchoolSettings {
  schoolName: string;
  schoolYear: string;
  preparedBy: string;
  schoolHead: string;
  thresholds: LoadThresholds;
}

export interface SchoolData {
  teachers: Teacher[];
  sections: Section[];
  subjects: Subject[];
  rooms: Room[];
  timeSlots: TimeSlot[];
  assignments: Assignment[];
  settings: SchoolSettings;
}

// Non-Electron browser preview remains a disposable in-memory demo. The
// installed desktop application NEVER writes school records to localStorage.

export const makeSampleData = (): SchoolData => ({
  teachers: [
    ["t1", "Maria Santos", "Mathematics", "Permanent", 18, 30],
    ["t2", "Jose Reyes", "Science", "Permanent", 18, 30],
    ["t3", "Ana Cruz", "English", "Permanent", 18, 30],
    ["t4", "Mark Dela Rosa", "Filipino", "Permanent", 18, 30],
    ["t5", "Liza Mendoza", "Araling Panlipunan", "Permanent", 18, 30],
    ["t6", "Carlo Garcia", "MAPEH", "Contractual", 18, 30],
    ["t7", "Joyce Ramos", "Mathematics", "Permanent", 18, 30],
    ["t8", "Paolo Flores", "Science", "Permanent", 18, 30],
    ["t9", "Rina Torres", "English", "Part-time", 12, 24],
    ["t10", "Nico Villanueva", "TLE", "Permanent", 18, 30],
    ["t11", "Cynthia Bautista", "Filipino", "Contractual", 18, 30],
    ["t12", "Ramon Navarro", "EsP", "Permanent", 18, 30],
  ].map(([id, name, specialization, employmentType, minHours, maxHours]) => ({
    id: String(id ?? ""),
    name: String(name ?? ""),
    specialization: String(specialization ?? ""),
    employmentType: (employmentType ?? "Permanent") as EmploymentType,
    minHours: Number(minHours),
    maxHours: Number(maxHours),
  })),
  sections: [
    ["s7-edge", "Grade 7 – Edge", 7, "Maria Santos"],
    ["s7-chrome", "Grade 7 – Chrome", 7, "Jose Reyes"],
    ["s8-edge", "Grade 8 – Edge", 8, "Ana Cruz"],
    ["s8-chrome", "Grade 8 – Chrome", 8, "Mark Dela Rosa"],
    ["s8-firefox", "Grade 8 – Firefox", 8, "Liza Mendoza"],
    ["s9-opera", "Grade 9 – Opera", 9, "Carlo Garcia"],
    ["s9-safari", "Grade 9 – Safari", 9, "Joyce Ramos"],
    ["s9-edge", "Grade 9 – Edge", 9, "Paolo Flores"],
    ["s10-chrome", "Grade 10 – Chrome", 10, "Rina Torres"],
    ["s10-firefox", "Grade 10 – Firefox", 10, "Nico Villanueva"],
  ].map(([id, name, gradeLevel, adviser]) => ({
    id: String(id ?? ""),
    name: String(name ?? ""),
    gradeLevel: Number(gradeLevel),
    adviser: String(adviser ?? ""),
    schoolLevel: "JHS" as const,
  })),
  subjects: [
    ["sub-math", "Mathematics", 7, 300],
    ["sub-sci", "Science", 7, 300],
    ["sub-eng", "English", 7, 300],
    ["sub-fil", "Filipino", 7, 240],
    ["sub-ap", "Araling Panlipunan", 7, 240],
    ["sub-mapeh", "MAPEH", 7, 240],
    ["sub-tle", "TLE", 7, 240],
    ["sub-esp", "Edukasyon sa Pagpapakatao", 7, 120],
    ["sub-research", "Research", 10, 180],
    ["sub-reading", "Reading and Literacy", 8, 180],
  ].map(([id, name, gradeLevel, minutesPerWeek]) => ({
    id: String(id ?? ""),
    name: String(name ?? ""),
    gradeLevel: Number(gradeLevel),
    minutesPerWeek: Number(minutesPerWeek),
  })),
  rooms: [
    ["r101", "Room 101", 40, "Classroom"],
    ["r102", "Room 102", 40, "Classroom"],
    ["r103", "Room 103", 40, "Classroom"],
    ["r104", "Room 104", 40, "Classroom"],
    ["r201", "Science Lab", 32, "Laboratory"],
    ["r202", "Computer Lab", 36, "ICT room"],
    ["r203", "TLE Workshop", 32, "Laboratory"],
    ["r105", "Room 105", 40, "Classroom"],
  ].map(([id, name, capacity, type]) => ({
    id: String(id ?? ""),
    name: String(name ?? ""),
    capacity: Number(capacity),
    type: (type ?? "Classroom") as RoomType,
  })),
  timeSlots: [
    [1, "07:30", "08:20", false],
    [2, "08:20", "09:10", false],
    [3, "09:10", "10:00", false],
    [4, "10:00", "10:50", false],
    [5, "10:50", "11:40", false],
    [6, "12:40", "13:30", false],
    [7, "13:30", "14:20", false],
    [8, "14:20", "15:10", false],
  ].map(([period, startTime, endTime, isBreak]) => ({
    id: `p${period}`,
    period: Number(period),
    startTime: String(startTime),
    endTime: String(endTime),
    isBreak: Boolean(isBreak),
  })),
  assignments: [
    {
      id: "a1",
      term: 1,
      sectionId: "s8-edge",
      subjectId: "sub-math",
      teacherId: "t1",
      roomId: "r101",
      day: "Monday",
      period: 1,
    },
    {
      id: "a2",
      term: 1,
      sectionId: "s8-chrome",
      subjectId: "sub-sci",
      teacherId: "t2",
      roomId: "r201",
      day: "Monday",
      period: 1,
    },
    {
      id: "a3",
      term: 1,
      sectionId: "s8-firefox",
      subjectId: "sub-eng",
      teacherId: "t3",
      roomId: "r102",
      day: "Monday",
      period: 1,
    },
    {
      id: "a4",
      term: 1,
      sectionId: "s9-opera",
      subjectId: "sub-fil",
      teacherId: "t4",
      roomId: "r103",
      day: "Monday",
      period: 1,
    },
    {
      id: "a5",
      term: 1,
      sectionId: "s9-safari",
      subjectId: "sub-math",
      teacherId: "t7",
      roomId: "r101",
      day: "Monday",
      period: 1,
    },
    {
      id: "a6",
      term: 1,
      sectionId: "s8-edge",
      subjectId: "sub-sci",
      teacherId: "t2",
      roomId: "r201",
      day: "Monday",
      period: 2,
    },
    {
      id: "a7",
      term: 1,
      sectionId: "s8-chrome",
      subjectId: "sub-eng",
      teacherId: "t3",
      roomId: "r102",
      day: "Monday",
      period: 2,
    },
    {
      id: "a8",
      term: 1,
      sectionId: "s8-edge",
      subjectId: "sub-math",
      teacherId: "t1",
      roomId: "r101",
      day: "Monday",
      period: 1,
    },
    {
      id: "a9",
      term: 1,
      sectionId: "s7-edge",
      subjectId: "sub-math",
      teacherId: "t1",
      roomId: "r104",
      day: "Tuesday",
      period: 1,
    },
    {
      id: "a10",
      term: 1,
      sectionId: "s7-chrome",
      subjectId: "sub-sci",
      teacherId: "t8",
      roomId: "r201",
      day: "Tuesday",
      period: 1,
    },
    {
      id: "a11",
      term: 1,
      sectionId: "s9-opera",
      subjectId: "sub-eng",
      teacherId: "t3",
      roomId: "r103",
      day: "Tuesday",
      period: 2,
    },
    {
      id: "a12",
      term: 1,
      sectionId: "s9-safari",
      subjectId: "sub-fil",
      teacherId: "t11",
      roomId: "r105",
      day: "Tuesday",
      period: 2,
    },
    {
      id: "a13",
      term: 1,
      sectionId: "s10-chrome",
      subjectId: "sub-research",
      teacherId: "t9",
      roomId: "r202",
      day: "Wednesday",
      period: 3,
    },
    {
      id: "a14",
      term: 1,
      sectionId: "s10-firefox",
      subjectId: "sub-tle",
      teacherId: "t10",
      roomId: "r203",
      day: "Wednesday",
      period: 3,
    },
    {
      id: "a15",
      term: 1,
      sectionId: "s8-firefox",
      subjectId: "sub-mapeh",
      teacherId: "t6",
      roomId: "r102",
      day: "Thursday",
      period: 2,
    },
    {
      id: "a16",
      term: 1,
      sectionId: "s9-edge",
      subjectId: "sub-esp",
      teacherId: "t12",
      roomId: "r104",
      day: "Thursday",
      period: 3,
    },
    {
      id: "a17",
      term: 2,
      sectionId: "s8-edge",
      subjectId: "sub-math",
      teacherId: "t1",
      roomId: "r101",
      day: "Monday",
      period: 1,
    },
    {
      id: "a18",
      term: 3,
      sectionId: "s8-edge",
      subjectId: "sub-sci",
      teacherId: "t2",
      roomId: "r201",
      day: "Monday",
      period: 1,
    },
  ],
  settings: {
    schoolName: "San Isidro National High School",
    schoolYear: "2025–2026",
    preparedBy: "",
    schoolHead: "",
    thresholds: { underloadBelow: 18, balancedMax: 30 },
  },
});

let browserPreview = makeSampleData();
let loadedDesktopData: SchoolData | null = null;
let loadedCatalogSnapshot: CatalogSnapshot | null = null;
let revision: number | null = null;
const temporaryIds = new Map<string, string>();
let pendingCatalogWrite: Promise<void> = Promise.resolve();

function desktopApi() {
  return typeof window !== "undefined" ? window.api : undefined;
}

function take<T>(reply: IpcResult<T>): T {
  if (!reply.ok) throw new Error(`${reply.error.code}: ${reply.error.message}`);
  return reply.data;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function reportReadError(error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown database error";
  console.error("E-CLASS database error:", error);
  toast.error(`Unable to load school records: ${message}`);
}

function reportWriteError(error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown database error";
  console.error("E-CLASS database write error:", error);
  toast.error(`School records were not saved: ${message}`);
}

/** Explicitly blank data if the SQLite database cannot be opened. Never
 * display 12 fictional teachers as if they came from a real school database.
 */
function blankSchoolData(): SchoolData {
  return {
    teachers: [],
    sections: [],
    subjects: [],
    rooms: [],
    timeSlots: [],
    assignments: [],
    settings: {
      schoolName: "",
      schoolYear: "2026-2027",
      preparedBy: "",
      schoolHead: "",
      thresholds: { underloadBelow: 18, balancedMax: 30 },
    },
  };
}

export const dataService = {
  async getAll(): Promise<SchoolData> {
    if (!desktopApi()) return structuredClone(browserPreview);
    try {
      // A read after a page-level write must not race the queued transaction.
      await pendingCatalogWrite;
      const snapshot = take(await desktopApi()!.catalog.snapshot());
      const rows = take(
        await desktopApi()!.schedule.list({
          schoolYear: snapshot.settings["school_year"] ?? "2026-2027",
        }),
      );
      loadedCatalogSnapshot = snapshot;
      loadedDesktopData = {
        ...schoolDataFromCatalog(snapshot),
        assignments: fromDatabaseAssignments(rows, snapshot),
      };
      revision = snapshot.revision;
      return structuredClone(loadedDesktopData);
    } catch (error) {
      revision = null;
      loadedDesktopData = null;
      loadedCatalogSnapshot = null;
      reportReadError(error);
      return blankSchoolData();
    }
  },

  async saveAll(next: SchoolData): Promise<void> {
    if (!desktopApi()) {
      browserPreview = structuredClone(next);
      return;
    }
    // The existing screens call saveAll without awaiting it. Queue the
    // snapshots so a create followed by an edit cannot race and duplicate
    // a record. Errors are shown to the user instead of becoming unhandled.
    const submitted = structuredClone(next);
    const operation = pendingCatalogWrite.then(async () => {
      if (revision === null || !loadedDesktopData || !loadedCatalogSnapshot)
        throw new Error("School data has not loaded. Refresh before editing.");
      if (
        !same(submitted.timeSlots, loadedDesktopData.timeSlots) ||
        !same(submitted.settings, loadedDesktopData.settings)
      ) {
        throw new Error(
          "Bell slots and school settings are not writable until their later implementation steps.",
        );
      }
      const payload = catalogReplacementFromSchoolData(
        submitted,
        revision,
        (id) => temporaryIds.get(id) ?? id,
      );
      const oldPayload = catalogReplacementFromSchoolData(
        loadedDesktopData,
        revision,
        (id) => temporaryIds.get(id) ?? id,
      );
      const catalogChanged = !same(
        [payload.teachers, payload.sections, payload.subjects, payload.rooms],
        [oldPayload.teachers, oldPayload.sections, oldPayload.subjects, oldPayload.rooms],
      );
      const { changes, createdIds } = scheduleDelta(
        loadedDesktopData.assignments,
        submitted.assignments,
        loadedDesktopData,
        loadedCatalogSnapshot,
        (id) => temporaryIds.get(id) ?? id,
      );
      const scheduleChanged =
        changes.creates.length > 0 || changes.updates.length > 0 || changes.deletes.length > 0;
      if (catalogChanged && scheduleChanged)
        throw new Error(
          "Save catalog changes and schedule changes separately to avoid partial updates.",
        );
      if (catalogChanged) {
        const changed = take(await desktopApi()!.catalog.applySnapshot(payload));
        for (const [temporary, saved] of Object.entries(changed.idMap))
          temporaryIds.set(temporary, saved);
        revision = changed.revision;
        // The next manual schedule save uses the newly persisted section
        // profile IDs from the main process, never a stale fake slot.
        loadedCatalogSnapshot = take(await desktopApi()!.catalog.snapshot());
      }
      if (scheduleChanged) {
        const result = take(await desktopApi()!.schedule.applyChanges(changes));
        mapScheduleResultIds(createdIds, result, temporaryIds);
      }
      loadedDesktopData = {
        ...submitted,
        teachers: submitted.teachers.map((t) => ({ ...t, id: temporaryIds.get(t.id) ?? t.id })),
        subjects: submitted.subjects.map((s) => ({ ...s, id: temporaryIds.get(s.id) ?? s.id })),
        rooms: submitted.rooms.map((r) => ({ ...r, id: temporaryIds.get(r.id) ?? r.id })),
        sections: submitted.sections.map((s) => ({ ...s, id: temporaryIds.get(s.id) ?? s.id })),
        assignments: submitted.assignments.map((a) => ({
          ...a,
          id: temporaryIds.get(a.id) ?? a.id,
        })),
      };
    });
    pendingCatalogWrite = operation.catch(reportWriteError);
    return pendingCatalogWrite;
  },

  async getTeachers(): Promise<Teacher[]> {
    return (await dataService.getAll()).teachers;
  },
  async getSections(): Promise<Section[]> {
    return (await dataService.getAll()).sections;
  },
  async getSubjects(): Promise<Subject[]> {
    return (await dataService.getAll()).subjects;
  },
  async getRooms(): Promise<Room[]> {
    return (await dataService.getAll()).rooms;
  },
  async getTimeSlots(): Promise<TimeSlot[]> {
    return (await dataService.getAll()).timeSlots;
  },
  async getSchedule(term?: Term): Promise<Assignment[]> {
    const assignments = (await dataService.getAll()).assignments;
    return term ? assignments.filter((a) => a.term === term) : assignments;
  },

  async saveAssignment(assignment: Assignment): Promise<void> {
    const next = await dataService.getAll();
    const index = next.assignments.findIndex((a) => a.id === assignment.id);
    if (index < 0) next.assignments.push(assignment);
    else next.assignments[index] = assignment;
    await dataService.saveAll(next);
  },
  async deleteAssignment(id: string): Promise<void> {
    const next = await dataService.getAll();
    next.assignments = next.assignments.filter((a) => a.id !== id);
    await dataService.saveAll(next);
  },
  async validateAssignment(assignment: Assignment): Promise<string[]> {
    if (desktopApi()) {
      try {
        if (!loadedDesktopData || !loadedCatalogSnapshot) await dataService.getAll();
        if (!loadedDesktopData || !loadedCatalogSnapshot)
          throw new Error("School data must load before scheduling.");
        const candidate = toDatabaseCandidate(
          assignment,
          loadedDesktopData,
          loadedCatalogSnapshot,
          (id) => temporaryIds.get(id) ?? id,
        );
        const excludeId = /^[1-9]\d*$/.test(temporaryIds.get(assignment.id) ?? assignment.id)
          ? Number(temporaryIds.get(assignment.id) ?? assignment.id)
          : undefined;
        const result = take(await desktopApi()!.schedule.validate(candidate, excludeId));
        return result.conflicts.map((conflict) => conflict.message);
      } catch (error) {
        return [error instanceof Error ? error.message : "Schedule validation failed."];
      }
    }
    const data = await dataService.getAll();
    return validateAssignmentConflicts(assignment, data.assignments, data);
  },
  async saveSettings(settings: SchoolSettings): Promise<void> {
    if (desktopApi()) {
      throw new Error("School settings will be writable in Step 7.");
    }
    const next = await dataService.getAll();
    next.settings = settings;
    await dataService.saveAll(next);
  },
  async reset(): Promise<SchoolData> {
    if (desktopApi()) throw new Error("Sample-data reset will be implemented in Step 8.");
    browserPreview = makeSampleData();
    return structuredClone(browserPreview);
  },
};

````

## src/lib/conflicts.ts

````typescript
import type { Assignment, LoadThresholds, SchoolData } from "@/services/dataService";

export type ConflictType = "Teacher" | "Section" | "Room" | "Duplicate";

export interface ScheduleConflict {
  type: ConflictType;
  assignment: Assignment;
  other: Assignment;
  message: string;
}

/** Renderer-only visualization fallback. SQLite's main-process conflict
 * service is always authoritative for validation and writes.
 */
function overlaps(a: Assignment, b: Assignment): boolean {
  if (
    a.startMinute !== undefined &&
    a.endMinute !== undefined &&
    b.startMinute !== undefined &&
    b.endMinute !== undefined
  ) {
    return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
  }
  return a.period === b.period;
}

export function validateAssignmentConflicts(
  assignment: Assignment,
  assignments: Assignment[],
  data: Pick<SchoolData, "teachers" | "sections" | "rooms">,
): string[] {
  const conflicts: string[] = [];
  const sameSlot = assignments.filter(
    (other) =>
      other.id !== assignment.id &&
      other.term === assignment.term &&
      other.day === assignment.day &&
      overlaps(assignment, other),
  );
  const teacher = data.teachers.find((item) => item.id === assignment.teacherId)?.name ?? "Teacher";
  const section = data.sections.find((item) => item.id === assignment.sectionId)?.name ?? "Section";
  const room = data.rooms.find((item) => item.id === assignment.roomId)?.name ?? "Room";

  if (sameSlot.some((other) => other.teacherId === assignment.teacherId))
    conflicts.push(`${teacher} is already assigned at this time.`);
  if (sameSlot.some((other) => other.sectionId === assignment.sectionId))
    conflicts.push(`${section} already has a class at this time.`);
  if (sameSlot.some((other) => other.roomId === assignment.roomId))
    conflicts.push(`${room} is already in use at this time.`);
  if (
    sameSlot.some(
      (other) =>
        other.teacherId === assignment.teacherId &&
        other.sectionId === assignment.sectionId &&
        other.subjectId === assignment.subjectId &&
        other.roomId === assignment.roomId,
    )
  )
    conflicts.push("This is a duplicate assignment.");
  return conflicts;
}

export function collectScheduleConflicts(assignments: Assignment[]): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  assignments.forEach((assignment, index) => {
    assignments.slice(index + 1).forEach((other) => {
      if (
        assignment.term !== other.term ||
        assignment.day !== other.day ||
        !overlaps(assignment, other)
      )
        return;
      const add = (type: ConflictType, message: string) =>
        conflicts.push({ type, assignment, other, message });
      if (assignment.teacherId === other.teacherId)
        add("Teacher", "Teacher scheduled more than once in the same period.");
      if (assignment.sectionId === other.sectionId)
        add("Section", "Section has more than one class in the same period.");
      if (assignment.roomId === other.roomId)
        add("Room", "Room is booked for more than one class.");
      if (
        assignment.teacherId === other.teacherId &&
        assignment.sectionId === other.sectionId &&
        assignment.subjectId === other.subjectId &&
        assignment.roomId === other.roomId
      )
        add("Duplicate", "Identical class assignment appears more than once.");
    });
  });
  return conflicts;
}

export function getLoadStatus(
  hours: number,
  thresholds: LoadThresholds,
): "Underload" | "Balanced" | "Overload" {
  if (hours < thresholds.underloadBelow) return "Underload";
  if (hours > thresholds.balancedMax) return "Overload";
  return "Balanced";
}

````

## src/test/schedule-service.test.ts

````typescript
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

````

## src/test/schedule-data-service.test.ts

````typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, CatalogSnapshot } from "../../shared/electron-api";
import type { SavedScheduleAssignment } from "../../shared/schedule-types";

const snapshot: CatalogSnapshot = {
  revision: 0,
  teachers: [
    {
      id: 1,
      name: "Ana Cruz",
      name_key: "anacruz",
      specialization: "Science",
      employment_type: "Permanent",
      min_hours: 18,
      max_hours: 30,
    },
  ],
  sections: [
    {
      id: 2,
      name: "8 Edge",
      grade_level: 8,
      school_level: "JHS",
      bell_schedule_id: 3,
      adviser_teacher_id: null,
    },
  ],
  subjects: [
    { id: 3, name: "Science", name_key: "science", grade_level: 8, minutes_per_week: 300 },
  ],
  rooms: [{ id: 4, name: "Room A", capacity: 40, type: "Classroom" }],
  bellSchedules: [{ id: 3, name: "JHS-50-B", school_level: "JHS" }],
  timeSlots: [
    {
      id: 21,
      bell_schedule_id: 3,
      kind: "period",
      period_no: 1,
      start_time: "07:30",
      end_time: "08:20",
      minutes: 50,
    },
    {
      id: 22,
      bell_schedule_id: 3,
      kind: "period",
      period_no: 2,
      start_time: "08:20",
      end_time: "09:10",
      minutes: 50,
    },
    {
      id: 23,
      bell_schedule_id: 3,
      kind: "health_break",
      period_no: null,
      start_time: "09:10",
      end_time: "09:20",
      minutes: 10,
    },
    {
      id: 24,
      bell_schedule_id: 3,
      kind: "period",
      period_no: 3,
      start_time: "09:20",
      end_time: "10:10",
      minutes: 50,
    },
  ],
  settings: {
    school_name: "School",
    school_year: "2026-2027",
    underload_below: "18",
    balanced_max: "30",
  },
};
const saved: SavedScheduleAssignment = {
  id: 9,
  school_year: "2026-2027",
  term: 2,
  day: 1,
  section_id: 2,
  elective_group_id: null,
  subject_id: 3,
  teacher_id: 1,
  room_id: 4,
  start_time_slot_id: 21,
  start_minute: 450,
  end_minute: 500,
  duration_periods: 1,
};
const second: SavedScheduleAssignment = {
  ...saved,
  id: 10,
  start_time_slot_id: 22,
  start_minute: 500,
  end_minute: 550,
};

function fakeApi() {
  const catalog = {
    snapshot: vi.fn().mockResolvedValue({ ok: true, data: snapshot }),
    applySnapshot: vi.fn().mockResolvedValue({ ok: true, data: { revision: 1, idMap: {} } }),
  };
  const schedule = {
    list: vi.fn().mockResolvedValue({ ok: true, data: [saved] }),
    validate: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        valid: false,
        conflicts: [
          {
            type: "teacher",
            conflictingAssignmentId: 9,
            message: "Teacher is already assigned Monday",
          },
        ],
      },
    }),
    applyChanges: vi
      .fn()
      .mockResolvedValue({ ok: true, data: { created: [second], updated: [], deleted: [] } }),
    save: vi.fn().mockResolvedValue({ ok: true, data: second }),
    update: vi.fn().mockResolvedValue({ ok: true, data: second }),
    delete: vi.fn().mockResolvedValue({ ok: true, data: { deleted: true } }),
    detectConflicts: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  };
  window.api = { catalog, schedule } as unknown as DesktopApi;
  return { schedule, catalog };
}
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => {
  delete window.api;
  vi.restoreAllMocks();
});

describe("existing React page schedule adapter", () => {
  it("projects real SQLite assignments and JHS-50-B period numbers without mock data", async () => {
    const { schedule } = fakeApi();
    const { dataService } = await import("../services/dataService");
    const data = await dataService.getAll();
    expect(schedule.list).toHaveBeenCalledWith({ schoolYear: "2026-2027" });
    expect(data.assignments).toEqual([
      expect.objectContaining({
        id: "9",
        term: 2,
        day: "Monday",
        period: 1,
        sectionId: "2",
        teacherId: "1",
        roomId: "4",
      }),
    ]);
    expect(data.sections[0]?.bellScheduleId).toBe("3");
    expect(localStorage.length).toBe(0);
  });

  it("sends manual assignment validation to SQLite and displays authoritative conflicts", async () => {
    const { schedule } = fakeApi();
    const { dataService } = await import("../services/dataService");
    await dataService.getAll();
    const messages = await dataService.validateAssignment({
      id: "draft",
      term: 2,
      day: "Monday",
      period: 2,
      sectionId: "2",
      subjectId: "3",
      teacherId: "1",
      roomId: "4",
    });
    expect(schedule.validate).toHaveBeenCalledWith(
      expect.objectContaining({
        schoolYear: "2026-2027",
        term: 2,
        day: 1,
        startTimeSlotId: 22,
        sectionId: 2,
        teacherId: 1,
        roomId: 4,
        durationPeriods: 1,
      }),
      undefined,
    );
    expect(messages).toEqual(["Teacher is already assigned Monday"]);
  });

  it("persists page-level schedule additions in an atomic batch and maps returned SQLite IDs", async () => {
    const { schedule, catalog } = fakeApi();
    const { dataService } = await import("../services/dataService");
    const previous = await dataService.getAll();
    await dataService.saveAll({
      ...previous,
      assignments: [
        ...previous.assignments,
        {
          id: "a-temp",
          term: 2,
          day: "Monday",
          period: 2,
          sectionId: "2",
          subjectId: "3",
          teacherId: "1",
          roomId: "4",
        },
      ],
    });
    expect(schedule.applyChanges).toHaveBeenCalledTimes(1);
    expect(schedule.applyChanges).toHaveBeenCalledWith({
      creates: [
        expect.objectContaining({ schoolYear: "2026-2027", term: 2, day: 1, startTimeSlotId: 22 }),
      ],
      updates: [],
      deletes: [],
    });
    expect(catalog.applySnapshot).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it("rejects unsupported cross-profile or missing section periods before invoking IPC", async () => {
    const { schedule } = fakeApi();
    const { dataService } = await import("../services/dataService");
    await dataService.getAll();
    const errors = await dataService.validateAssignment({
      id: "draft",
      term: 2,
      day: "Friday",
      period: 8,
      sectionId: "2",
      subjectId: "3",
      teacherId: "1",
      roomId: "4",
    });
    expect(errors[0]).toMatch(/period|profile|slot/i);
    expect(schedule.validate).not.toHaveBeenCalled();
  });
});

````

## src/test/data-service-ipc.test.ts

````typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogSnapshot, DesktopApi } from "../../shared/electron-api";

const snapshot: CatalogSnapshot = {
  revision: 0,
  teachers: [],
  sections: [],
  subjects: [],
  rooms: [],
  bellSchedules: [
    { id: 1, name: "SHS-60", school_level: "SHS" },
    { id: 2, name: "JHS-50-A", school_level: "JHS" },
  ],
  timeSlots: [
    {
      id: 14,
      bell_schedule_id: 2,
      kind: "period",
      period_no: 1,
      start_time: "07:30",
      end_time: "08:20",
      minutes: 50,
    },
  ],
  settings: {
    school_name: "Test School",
    school_year: "2026-2027",
    underload_below: "18",
    balanced_max: "30",
  },
};

function fakeApi() {
  const applySnapshot = vi.fn().mockResolvedValue({
    ok: true,
    data: { revision: 1, idMap: { "te-temp": "91" } },
  });
  const catalog = {
    snapshot: vi.fn().mockResolvedValue({ ok: true, data: snapshot }),
    applySnapshot,
  };
  const schedule = {
    list: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    validate: vi.fn().mockResolvedValue({ ok: true, data: { valid: true, conflicts: [] } }),
    applyChanges: vi
      .fn()
      .mockResolvedValue({ ok: true, data: { created: [], updated: [], deleted: [] } }),
  };
  window.api = { catalog, schedule } as unknown as DesktopApi;
  return catalog;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => {
  delete window.api;
  vi.restoreAllMocks();
});

describe("dataService Electron bridge", () => {
  it("loads actual empty SQLite catalog data instead of seeding the browser mock", async () => {
    const catalog = fakeApi();
    const { dataService } = await import("../services/dataService");
    const school = await dataService.getAll();
    expect(school.teachers).toHaveLength(0);
    expect(school.sections).toHaveLength(0);
    expect(school.settings.schoolName).toBe("Test School");
    expect(school.timeSlots[0]?.period).toBe(1);
    expect(catalog.snapshot).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });

  it("sends page-level catalog edits through one atomic IPC operation", async () => {
    const catalog = fakeApi();
    const { dataService } = await import("../services/dataService");
    const data = await dataService.getAll();
    await dataService.saveAll({
      ...data,
      teachers: [
        {
          id: "te-temp",
          name: "Maria Santos",
          specialization: "English",
          employmentType: "Permanent",
          minHours: 18,
          maxHours: 30,
        },
      ],
    });
    expect(catalog.applySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 0,
        teachers: [expect.objectContaining({ id: "te-temp", name: "Maria Santos" })],
      }),
    );
    // Next save must use the returned SQLite ID, not create the same teacher twice.
    await dataService.saveAll({
      ...data,
      teachers: [
        {
          id: "te-temp",
          name: "Maria Updated",
          specialization: "English",
          employmentType: "Permanent",
          minHours: 18,
          maxHours: 30,
        },
      ],
    });
    expect(catalog.applySnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedRevision: 1,
        teachers: [expect.objectContaining({ id: "91", name: "Maria Updated" })],
      }),
    );
    expect(localStorage.length).toBe(0);
  });

  it("rejects an assignment for a nonexistent section before invoking scheduling IPC", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const catalog = fakeApi();
    const { dataService } = await import("../services/dataService");
    const data = await dataService.getAll();
    await dataService.saveAll({
      ...data,
      assignments: [
        {
          id: "pending",
          term: 1,
          sectionId: "1",
          subjectId: "1",
          teacherId: "1",
          roomId: "1",
          day: "Monday",
          period: 1,
        },
      ],
    });
    expect(catalog.applySnapshot).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
    expect(
      await dataService.validateAssignment({
        id: "pending",
        term: 1,
        sectionId: "1",
        subjectId: "1",
        teacherId: "1",
        roomId: "1",
        day: "Monday",
        period: 1,
      }),
    ).toEqual([expect.stringContaining("Section not found")]);
  });
});

````

## src/test/conflicts.test.ts

````typescript
import { describe, expect, it } from "vitest";

import {
  collectScheduleConflicts,
  getLoadStatus,
  validateAssignmentConflicts,
} from "@/lib/conflicts";
import { makeSampleData, type Assignment } from "@/services/dataService";

describe("schedule conflict rules", () => {
  it("shows actual-time overlaps between different JHS and SHS period numbers", () => {
    const first: Assignment = {
      id: "1",
      term: 2,
      sectionId: "11",
      subjectId: "1",
      teacherId: "1",
      roomId: "5",
      day: "Monday",
      period: 2,
      startMinute: 510,
      endMinute: 570,
    };
    const second: Assignment = {
      ...first,
      id: "2",
      sectionId: "12",
      roomId: "6",
      period: 3,
      startMinute: 560,
      endMinute: 610,
    };
    expect(collectScheduleConflicts([first, second]).map((c) => c.type)).toContain("Teacher");
    const adjacent = { ...second, startMinute: 570, endMinute: 620 };
    expect(collectScheduleConflicts([first, adjacent])).toHaveLength(0);
  });
  it("detects teacher, section, room, and duplicate clashes in the same term and period", () => {
    const data = makeSampleData();
    const conflicts = collectScheduleConflicts(data.assignments);
    expect(conflicts.map((conflict) => conflict.type)).toContain("Teacher");
    expect(conflicts.map((conflict) => conflict.type)).toContain("Section");
    expect(conflicts.map((conflict) => conflict.type)).toContain("Room");
    expect(conflicts.map((conflict) => conflict.type)).toContain("Duplicate");
  });

  it("does not flag matching times in another term", () => {
    const data = makeSampleData();
    const first = data.assignments[0];
    const otherTerm = data.assignments.find((assignment) => assignment.term === 2);
    expect(
      first && otherTerm && first.day === otherTerm.day && first.period === otherTerm.period,
    ).toBe(true);
    expect(collectScheduleConflicts([first as Assignment, otherTerm as Assignment])).toHaveLength(
      0,
    );
  });

  it("returns teacher and room messages when validating a conflicting assignment", () => {
    const data = makeSampleData();
    const candidate: Assignment = {
      id: "new",
      term: 1,
      sectionId: "s8-edge",
      subjectId: "sub-math",
      teacherId: "t1",
      roomId: "r101",
      day: "Monday",
      period: 1,
    };
    const messages = validateAssignmentConflicts(candidate, data.assignments, data);
    expect(messages).toContain("Maria Santos is already assigned at this time.");
    expect(messages).toContain("Room 101 is already in use at this time.");
    expect(messages).toContain("Grade 8 – Edge already has a class at this time.");
  });
});

describe("teacher workload thresholds", () => {
  const thresholds = { underloadBelow: 18, balancedMax: 30 };

  it("uses the stated boundaries of 18 and 30 weekly hours", () => {
    expect(getLoadStatus(17, thresholds)).toBe("Underload");
    expect(getLoadStatus(18, thresholds)).toBe("Balanced");
    expect(getLoadStatus(30, thresholds)).toBe("Balanced");
    expect(getLoadStatus(31, thresholds)).toBe("Overload");
  });
});

````

## src/test/catalog-service.test.ts

````typescript
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

````

## scripts/verify-step4-electron.cjs

````javascript
// Run only against the isolated Step 4 test instance:
// ECLASS_TEST_USER_DATA=<fresh temp directory>, ECLASS_STATIC=1,
// electron . --remote-debugging-port=9244
const assert = require("node:assert/strict");

async function evaluate(expression) {
  const pages = await (await fetch("http://127.0.0.1:9244/json/list")).json();
  assert.ok(
    pages[0]?.url.includes("dist-electron/renderer/index.html"),
    "Refusing to test a non-E-CLASS renderer.",
  );
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      ws.close();
      reject(new Error("Electron IPC verification timed out."));
    }, 20000);
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    ws.onmessage = (event) => {
      clearTimeout(deadline);
      ws.close();
      const result = JSON.parse(event.data);
      if (result.error || result.result?.exceptionDetails)
        return reject(new Error(JSON.stringify(result)));
      resolve(result.result?.result?.value);
    };
    ws.onerror = reject;
  });
}

const expression = `(async () => {
  const api = window.api;
  const before = await api.catalog.snapshot();
  if (!before.ok || before.data.teachers.length || before.data.sections.length ||
      before.data.rooms.length || before.data.subjects.length) {
    throw new Error("Refusing to write: this is not an empty isolated test database.");
  }
  const names = "Step4-" + Date.now();
  const created = { assignments:[], groups:[],sections:[],teachers:[],subjects:[],rooms:[] };
  async function must(reply,label) {
    if(!reply.ok) throw new Error(label+": "+JSON.stringify(reply.error));
    return reply.data;
  }
  try {
    const shs = before.data.bellSchedules.find(x=>x.name==="SHS-60");
    const jhsA = before.data.bellSchedules.find(x=>x.name==="JHS-50-A");
    const jhsB = before.data.bellSchedules.find(x=>x.name==="JHS-50-B");
    const slot=(profile,period)=>before.data.timeSlots.find(x=>
      x.bell_schedule_id===profile.id && x.kind==="period" && x.period_no===period);
    for(const n of ["A","B"]) {
      const teacher = await must(await api.teachers.create({
        name:names+" Teacher "+n,specialization:"Science",
        employment_type:"Permanent",min_hours:18,max_hours:30,
      }),"create teacher");
      created.teachers.push(teacher.id);
      const room = await must(await api.rooms.create({
        name:names+" Room "+n,capacity:40,type:"Classroom",
      }),"create room");
      created.rooms.push(room.id);
    }
    const subject = await must(await api.subjects.create({
      name:names+" Science",grade_level:11,minutes_per_week:300,
    }),"create subject");
    created.subjects.push(subject.id);
    for(const [n,grade,profile] of [["SHS",11,shs],["JHS-B",8,jhsB],["JHS-A",8,jhsA]]) {
      const section = await must(await api.sections.create({
        name:names+" "+n,grade_level:grade,
        school_level:grade>=11?"SHS":"JHS",
        bell_schedule_id:profile.id,adviser_teacher_id:null,
      }),"create section");
      created.sections.push(section.id);
    }
    const base = {
      schoolYear:"2026-2027",term:2,day:1,
      teacherId:created.teachers[0],subjectId:subject.id,
      roomId:created.rooms[0],durationPeriods:1,
    };
    const first = await must(await api.schedule.save({
      ...base,sectionId:created.sections[0],
      startTimeSlotId:slot(shs,2).id,
    }),"save SHS");
    created.assignments.push(first.id);
    const overlapping = {
      ...base,sectionId:created.sections[1],roomId:created.rooms[1],
      startTimeSlotId:slot(jhsB,3).id,
    };
    const preview=await must(await api.schedule.validate(overlapping),"validate overlap");
    const rejected=await api.schedule.save(overlapping);
    const sameTimeDifferentTeacher=await must(await api.schedule.save({
      ...overlapping,teacherId:created.teachers[1],
    }),"save JHS with different teacher and room");
    created.assignments.push(sameTimeDifferentTeacher.id);
    const group=await must(await api.electives.create({
      name:names+" Electives",schoolYear:"2026-2027",term:2,day:2,
      startTimeSlotId:slot(jhsA,1).id,durationPeriods:2,
      sectionIds:[created.sections[1],created.sections[2]],
    }),"create elective group");
    created.groups.push(group.id);
    for(let n=0;n<2;n++) {
      const assignment=await must(await api.schedule.save({
        schoolYear:"2026-2027",term:2,day:2,
        sectionId:null,electiveGroupId:group.id,
        teacherId:created.teachers[n],subjectId:subject.id,
        roomId:created.rooms[n],startTimeSlotId:slot(jhsA,1).id,durationPeriods:2,
      }),"save elective teacher");
      created.assignments.push(assignment.id);
    }
    const review=await must(await api.schedule.detectConflicts(2,"2026-2027"),
      "review all conflicts");
    const records=await must(await api.schedule.list({schoolYear:"2026-2027",term:2}),
      "list saved schedule");
    return {
      teacherConflict:preview.valid===false && preview.conflicts.some(x=>x.type==="teacher"),
      serverRejected:rejected.ok===false && rejected.error.code==="CONFLICT",
      crossProfile: first.start_minute===510 && first.end_minute===570 &&
        sameTimeDifferentTeacher.start_minute===560,
      electiveGroup:group.sectionIds.length===2 && records.length===4,
      electiveMinutes:records.filter(x=>x.elective_group_id===group.id)
        .every(x=>x.start_minute===450 && x.end_minute===550),
      cleanReview:review.length===0,
    };
  } finally {
    for(const id of created.assignments) await api.schedule.delete(id);
    for(const id of created.groups) await api.electives.delete(id);
    for(const id of created.sections) await api.sections.delete(id);
    for(const id of created.teachers) await api.teachers.delete(id);
    for(const id of created.subjects) await api.subjects.delete(id);
    for(const id of created.rooms) await api.rooms.delete(id);
  }
})()`;

(async () => {
  const result = await evaluate(expression);
  for (const [label, success] of Object.entries(result))
    assert.equal(success, true, `${label} verification failed`);
  console.log("Step 4 real Electron IPC checks passed:", result);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

````

## docs/step4-notes.md

````markdown
# E-CLASS — Step 4: Time-based schedule authority

## What is implemented

- `electron/services/schedule.ts` is the **only public writer** for schedule assignments.
- `electron/services/conflicts.ts` is the main-process conflict source of truth.
- Typed `window.api.schedule` and `window.api.electives` endpoints use
  `ipcMain.handle`, with the same main-frame verification and safe
  `{ok,data}`/`{ok:false,error}` result contract as the catalog APIs.
- Every save, update, delete, bulk change, elective creation, and elective
  section addition uses an SQLite `IMMEDIATE` transaction.
- The backend **derives** assignment `start_minute`/`end_minute` from
  the chosen section's bell schedule. Renderer-supplied minute fields are
  explicitly rejected.
- The interval overlap rule is
  `existing.start_minute < proposed.end_minute && proposed.start_minute < existing.end_minute`
  on matching school year, term, and weekday. Equal boundaries are
  **not** conflicts.
- Teacher, room, section, and identical assignment conflicts produce
  human-readable messages, including referenced assignment IDs.
- Validation cannot treat two teachers teaching distinct electives within
  the same authorized elective group as a false _section_ conflict. Each
  teacher and room is nevertheless checked separately.
- A shared elective block can reserve multiple sections at once. Every
  member section must have teaching periods covering precisely the same
  clock-time interval without crossing fixed events.
- Multi-period classes are allowed only where teaching periods are
  consecutive and contiguous. They cannot cross health/lunch breaks,
  class preparation, flag events, or unscheduled timetable gaps.
- Existing data whose rows were inserted before the scheduling validator
  existed can be audited with `schedule:detectConflicts`.
- `catalog.sections.update` and the legacy catalog snapshot API now
  refuse to change the bell schedule, grade, or school level of a section
  that already has assignments or an elective reservation.

## Existing React frontend compatibility

- `src/services/dataService.ts` now reads SQLite schedule assignments
  through `schedule:list` and uses `schedule:validate` before manual
  saves.
- The existing pages continue to call `saveAll()`. The adapter turns
  assignment additions, edits, and deletions into one
  `schedule:applyChanges` transaction and maps temporary IDs to SQLite
  IDs. Any rejection produces a visible error toast.
- Only _regular section assignments_ are projected into the unchanged
  legacy schedule UI. Elective-group assignments are not represented as
  fake one-section classes; doing so would create misleading conflicts.
  Electives are available through the typed IPC API for a future
  group-aware scheduling/review UI.
- `src/lib/conflicts.ts` uses real clock-minute intervals when present
  for _display_ and retains the period-number fallback for the disposable
  browser demo. It is **not** an authority for saving; the backend
  always validates again within its own transaction.
- The unchanged UI displays the start period for a multi-period
  assignment. Merged multi-period cells and all elective group members
  require a later UI/reporting update.
- The original page still uses optimistic local state. If a write is
  rejected, the toast identifies the issue; refresh to restore the
  authoritative SQLite data.
- The original page has sample-based initial picker IDs. On a new
  database, select the actual teacher/section/subject/room before
  scheduling.
- Import, auto-generation, workload, PDF/CSV printouts, settings and
  sample-data seeding remain in their later steps.

## Safety and verification

All tests open disposable `eclass.db` files in the system temporary
directory. The live Electron IPC exercise also uses an explicitly
isolated `ECLASS_TEST_USER_DATA` folder (never the normal userData).
The original school database was not modified as part of testing.

Tests cover mixed SHS-60/JHS-50 profiles, interval adjacency, different
school years and terms, fixed events, multi-period breaks, duplicate
classes, updates/exclusions, atomic rollback, elective shared sections
and teachers, and deliberate legacy conflicting rows.

### Useful commands

```powershell
cd C:\Personal\screenshot-to-spec-main
npm test
npm run typecheck:electron
npm run build:desktop
npm run dev
```

To run the **real** Electron IPC test without using school data:

```powershell
$env:ECLASS_TEST_USER_DATA = Join-Path $env:TEMP "eclass-step4-ipc-isolated"
$env:ECLASS_STATIC = "1"
npm run build:desktop
npx electron . --remote-debugging-port=9244
```

In another terminal:

```powershell
node scripts/verify-step4-electron.cjs
```

The script refuses to write into a nonempty catalog, creates and
validates test assignments and electives, and deletes those records
afterward. **Do not leave the remote debugging port open on a real
school workstation.**

## Step 5

Next: import school-format Excel and CSV class programs, resolve
teacher/subject aliases, validate and preview rows, then save in one
transaction after a backup. The school's actual Term 2 workbook is
still needed for fixture-based comparison.

````

