import { validateAssignmentConflicts } from "@/lib/conflicts";
import { getSectionTeachingSlots } from "@/lib/scheduling/scheduleTiming";
import type { Assignment, Day, SchoolData, Term } from "@/services/dataService";

const weekdays: Day[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

/** Returns staged candidates only. Persistence remains one atomic save at the caller. */
export async function generateScheduleCandidates(
  data: SchoolData,
  term: Term,
  validate: (candidate: Assignment) => Promise<string[]>,
): Promise<Assignment[]> {
  const additions: Assignment[] = [];
  const occupied: Assignment[] = [...data.assignments];
  for (const section of data.sections) {
    const slots = getSectionTeachingSlots(data, section.id);
    if (!slots.length) continue;
    const suitable = data.subjects.filter(
      (subject) => subject.gradeLevel === section.gradeLevel || subject.gradeLevel === 7,
    );
    const subjects = suitable.length ? suitable : data.subjects;
    for (const subject of subjects) {
      const key = subject.name.toLowerCase().split(" ")[0] ?? "";
      const teachers = [...data.teachers].sort(
        (a, b) =>
          Number(b.specialization.toLowerCase().includes(key)) -
          Number(a.specialization.toLowerCase().includes(key)),
      );
      let accepted = false;
      for (const day of weekdays) {
        if (accepted) break;
        for (const slot of slots) {
          if (accepted) break;
          for (const teacher of teachers) {
            if (accepted) break;
            for (const room of data.rooms) {
              const candidate: Assignment = {
                id: `auto-${term}-${section.id}-${subject.id}-${day}-${slot.id}-${teacher.id}-${room.id}`,
                term,
                sectionId: section.id,
                subjectId: subject.id,
                teacherId: teacher.id,
                roomId: room.id,
                day,
                period: slot.period,
                startTimeSlotId: slot.id,
              };
              if (validateAssignmentConflicts(candidate, occupied, data).length) continue;
              // Returned messages are domain conflicts; thrown failures abort generation.
              if ((await validate(candidate)).length) continue;
              additions.push(candidate);
              occupied.push(candidate);
              accepted = true;
              break;
            }
          }
        }
      }
    }
  }
  return additions;
}
