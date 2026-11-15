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
