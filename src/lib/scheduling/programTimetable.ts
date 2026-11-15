import type { Assignment, SchoolData } from "@/services/dataService";
import { getSectionClockRows, resolveAssignmentInterval } from "@/lib/scheduling/scheduleTiming";

export type ProgramMode = "section" | "teacher" | "rooms";
export interface ProgramEntity {
  id: string;
  name: string;
}
export interface ProgramRow {
  id: string;
  startMinute: number;
  endMinute: number;
  kind: string;
  period: number | null;
}

export const programDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
export const programEventLabels: Record<string, string> = {
  class_preparation: "CLASS PREPARATIONS",
  flag_raising: "FLAG RAISING CEREMONY",
  flag_lowering: "FLAG LOWERING",
  health_break: "HEALTH BREAK",
  lunch_break: "LUNCH BREAK",
  break: "BREAK",
};

export function formatProgramTime(minute: number): string {
  return `${Math.floor(minute / 60) % 12 || 12}:${String(minute % 60).padStart(2, "0")}`;
}

export function programAssignments(assignments: Assignment[], mode: ProgramMode, id: string) {
  const field = mode === "teacher" ? "teacherId" : mode === "rooms" ? "roomId" : "sectionId";
  return assignments.filter((assignment) => assignment[field] === id);
}

function sectionRows(data: SchoolData, sectionId?: string): ProgramRow[] {
  const rows: ProgramRow[] = getSectionClockRows(data, sectionId ?? "");
  if (data.programTimeSlots !== undefined) return rows;
  // Legacy browser previews carry only teaching periods. Preserve their clock
  // times and display the actual midday gap instead of inventing a bell profile.
  return rows.flatMap((row, index) => {
    const previous = rows[index - 1];
    if (previous && previous.endMinute < row.startMinute) {
      return [
        {
          id: `gap-${index}`,
          startMinute: previous.endMinute,
          endMinute: row.startMinute,
          kind: previous.endMinute >= 660 && row.startMinute <= 840 ? "lunch_break" : "break",
          period: null,
        },
        row,
      ];
    }
    return [row];
  });
}

export function getAssignmentInterval(
  data: SchoolData,
  assignment: Assignment,
): { startMinute: number; endMinute: number } {
  const resolved = resolveAssignmentInterval(data, assignment);
  // Legacy malformed rows remain displayable without inventing a teaching interval.
  return resolved.ok
    ? { startMinute: resolved.startMinute, endMinute: resolved.endMinute }
    : { startMinute: 0, endMinute: 0 };
}

export function getProgramRows(
  data: SchoolData,
  mode: ProgramMode,
  entityId: string,
  assignments: Assignment[],
): ProgramRow[] {
  if (mode === "section") return sectionRows(data, entityId);
  const matching = programAssignments(assignments, mode, entityId);
  const sectionIds = [...new Set(matching.map((assignment) => assignment.sectionId))];
  if (!sectionIds.length) return sectionRows(data, data.sections[0]?.id);
  const rowSets = sectionIds.map((id) => sectionRows(data, id));
  const signature = (rows: ProgramRow[]) =>
    rows.map((row) => `${row.startMinute}/${row.endMinute}/${row.kind}`).join(";");
  if (rowSets.every((rows) => signature(rows) === signature(rowSets[0]!))) return rowSets[0]!;
  // Mixed-profile teacher/room programs use real clock boundaries. A break is
  // shared only when every profile active at that time has that same event.
  const all = rowSets.flat();
  const boundaries = [...new Set(all.flatMap((row) => [row.startMinute, row.endMinute]))].sort(
    (a, b) => a - b,
  );
  return boundaries.slice(0, -1).flatMap((startMinute, index) => {
    const endMinute = boundaries[index + 1]!;
    const active = all.filter(
      (row) => row.startMinute <= startMinute && row.endMinute >= endMinute,
    );
    if (!active.length) return [];
    const hasLesson = matching.some((assignment) => {
      const interval = getAssignmentInterval(data, assignment);
      return interval.startMinute < endMinute && startMinute < interval.endMinute;
    });
    const kind =
      !hasLesson && active.every((row) => row.kind === active[0]!.kind)
        ? active[0]!.kind
        : "period";
    return [{ id: `clock-${startMinute}`, startMinute, endMinute, kind, period: null }];
  });
}

export function paginateProgramEntities(
  data: SchoolData,
  assignments: Assignment[],
  mode: ProgramMode,
  entities: ProgramEntity[],
): ProgramEntity[][] {
  const buckets = new Map<string, ProgramEntity[]>();
  for (const entity of entities) {
    const grade =
      mode === "section"
        ? data.sections.find((section) => section.id === entity.id)?.gradeLevel
        : "";
    const rows = getProgramRows(data, mode, entity.id, assignments);
    const key = `${grade}|${rows.map((row) => `${row.startMinute}-${row.endMinute}-${row.kind}`).join(";")}`;
    buckets.set(key, [...(buckets.get(key) ?? []), entity]);
  }
  return [...buckets.values()].flatMap((group) =>
    Array.from({ length: Math.ceil(group.length / 3) }, (_, index) =>
      group.slice(index * 3, index * 3 + 3),
    ),
  );
}
