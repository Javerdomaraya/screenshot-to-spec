import type { Assignment, LoadThresholds, SchoolData } from "@/services/dataService";
import { resolveAssignmentInterval, type IntervalResult } from "@/lib/scheduling/scheduleTiming";

export type ConflictType = "Teacher" | "Section" | "Room" | "Duplicate";

export interface ScheduleConflict {
  type: ConflictType;
  assignment: Assignment;
  other: Assignment;
  message: string;
}

/** Clock comparison is independent of bell-profile period numbers. */
function overlaps(a: IntervalResult, b: IntervalResult): boolean {
  return a.ok && b.ok && a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

export function validateAssignmentConflicts(
  assignment: Assignment,
  assignments: Assignment[],
  data: SchoolData,
): string[] {
  const interval = resolveAssignmentInterval(data, assignment);
  if (!interval.ok) return [interval.message];
  const conflicts: string[] = [];
  const sameDay = assignments.filter(
    (other) =>
      other.id !== assignment.id &&
      other.term === assignment.term &&
      other.day === assignment.day,
  );
  const unresolved = sameDay.filter((other) => {
    const resolved = resolveAssignmentInterval(data, other);
    return !resolved.ok && (
      other.teacherId === assignment.teacherId ||
      other.sectionId === assignment.sectionId ||
      other.roomId === assignment.roomId
    );
  });
  if (unresolved.length) conflicts.push("An existing assignment has invalid timing; review it before scheduling.");
  const sameSlot = sameDay.filter((other) => overlaps(interval, resolveAssignmentInterval(data, other)));
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

export function collectScheduleConflicts(assignments: Assignment[], data: SchoolData): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  const intervals = assignments.map((assignment) => resolveAssignmentInterval(data, assignment));
  assignments.forEach((assignment, index) => {
    assignments.slice(index + 1).forEach((other, offset) => {
      if (
        assignment.term !== other.term ||
        assignment.day !== other.day ||
        !overlaps(intervals[index]!, intervals[index + offset + 1]!)
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
