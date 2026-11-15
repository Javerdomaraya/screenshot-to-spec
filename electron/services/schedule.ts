import type { SchoolDatabase } from "../db/database";
import { normalizeSchoolYear, schoolYearAliases } from "../../shared/school-year";
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
  return normalizeSchoolYear(value);
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
        normalizeSchoolYear(group.school_year) !== candidate.schoolYear ||
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
    const aliases = schoolYearAliases(year(filter?.schoolYear));
    const t = filter.term === undefined ? null : parseTerm(filter.term);
    return (
      db
        .prepare(
          `
      SELECT * FROM elective_groups
      WHERE school_year IN (${aliases.map(() => "?").join(",")}) AND (? IS NULL OR term=?)
      ORDER BY term,day,start_minute,id
    `,
        )
        .all(...aliases, t, t) as ElectiveGroup[]
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
    const aliases = schoolYearAliases(year(filter?.schoolYear));
    const term = filter.term === undefined ? null : parseTerm(filter.term);
    return db
      .prepare(
        `
      SELECT * FROM assignments WHERE school_year IN (${aliases.map(() => "?").join(",")})
        AND (? IS NULL OR term=?)
      ORDER BY term,day,start_minute,id
    `,
      )
      .all(...aliases, term, term) as Assignment[];
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
