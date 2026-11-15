import { resolveAssignmentInterval } from "@/lib/scheduling/scheduleTiming";
import type { Assignment, SchoolData } from "@/services/dataService";

export interface TeacherLoad {
  minutes: number;
  incomplete: boolean;
}

/** Pass a term-filtered schedule. Each assignment contributes its real duration once. */
export function calculateTeacherLoads(
  data: SchoolData,
  assignments: readonly Assignment[],
): Map<string, TeacherLoad> {
  const loads = new Map<string, TeacherLoad>(
    data.teachers.map((teacher) => [teacher.id, { minutes: 0, incomplete: false }]),
  );
  for (const assignment of assignments) {
    const load = loads.get(assignment.teacherId);
    if (!load) continue;
    const interval = resolveAssignmentInterval(data, assignment);
    if (!interval.ok) load.incomplete = true;
    else load.minutes += interval.endMinute - interval.startMinute;
  }
  return loads;
}
