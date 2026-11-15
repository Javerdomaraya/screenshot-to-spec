import type { SchoolDatabase } from "../db/database";
import { schoolYearAliases } from "../../shared/school-year";
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
    const aliases = schoolYearAliases(candidate.school_year);
    const groups = db
      .prepare(
        `
      SELECT DISTINCT g.id,g.name,egs.section_id
      FROM elective_groups g JOIN elective_group_sections egs ON egs.elective_group_id=g.id
      WHERE g.school_year IN (${aliases.map(() => "?").join(",")}) AND g.term=? AND g.day=?
        AND g.start_minute < ? AND g.end_minute > ?
      ORDER BY g.id,egs.section_id
    `,
      )
      .all(
        ...aliases,
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
  const aliases = schoolYearAliases(year);
  const rows = db
    .prepare(
      `
    SELECT DISTINCT g.id, s.section_id
    FROM elective_groups g JOIN elective_group_sections s ON s.elective_group_id=g.id
    WHERE g.school_year IN (${aliases.map(() => "?").join(",")}) AND g.term=? AND g.day=?
      AND g.start_minute < ? AND g.end_minute > ?
  `,
    )
    .all(...aliases, term, day, end, start) as Array<{ id: number; section_id: number }>;
  for (const row of rows) {
    if (row.id !== excludeGroupId && sections.includes(row.section_id)) {
      throw new Error("Section is already reserved for another elective group.");
    }
  }
}
