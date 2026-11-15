import { describe, expect, it } from "vitest";
import { calculateTeacherLoads } from "@/lib/scheduling/teacherWorkload";
import { getLoadStatus } from "@/lib/conflicts";
import { makeSampleData, type Assignment, type SchoolData } from "@/services/dataService";

function workloadData(minutes: 50 | 60): SchoolData {
  const data = makeSampleData();
  data.teachers = [data.teachers[0]!];
  data.sections = [
    {
      id: "section",
      name: "Clock section",
      gradeLevel: minutes === 60 ? 11 : 10,
      schoolLevel: minutes === 60 ? "SHS" : "JHS",
      adviser: "",
      bellScheduleId: "profile",
    },
  ];
  data.bellSchedules = [
    {
      id: "profile",
      name: "Profile",
      schoolLevel: minutes === 60 ? "SHS" : "JHS",
    },
  ];
  data.programTimeSlots = Array.from({ length: 5 }, (_, index) => {
    const format = (time: number) =>
      `${String(Math.floor(time / 60)).padStart(2, "0")}:${String(time % 60).padStart(2, "0")}`;
    const start = 450 + index * minutes;
    return {
      id: `period-${index + 1}`,
      bellScheduleId: "profile",
      kind: "period" as const,
      period: index + 1,
      startTime: format(start),
      endTime: format(start + minutes),
      minutes,
    };
  });
  data.assignments = [];
  return data;
}

const lesson = (data: SchoolData, id: string, overrides: Partial<Assignment> = {}): Assignment => ({
  id,
  term: 1,
  day: "Monday",
  sectionId: "section",
  subjectId: "sub-math",
  teacherId: data.teachers[0]!.id,
  roomId: "r101",
  period: 1,
  ...overrides,
});

describe("teacher workload uses scheduled minutes", () => {
  it("sums ten two-period SHS lessons as exactly 1200 minutes or 20 hours", () => {
    const data = workloadData(60);
    const assignments = Array.from({ length: 10 }, (_, index) =>
      lesson(data, `shs-${index}`, {
        durationPeriods: 2,
        day: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][
          Math.floor(index / 2)
        ] as Assignment["day"],
        period: index % 2 === 0 ? 1 : 3,
      }),
    );
    const load = calculateTeacherLoads(data, assignments).get(data.teachers[0]!.id);
    expect(load).toEqual({ minutes: 1200, incomplete: false });
    expect(getLoadStatus(load!.minutes / 60, data.settings.thresholds)).toBe("Balanced");
  });

  it("sums twenty 50-minute JHS lessons without rounding before thresholds", () => {
    const data = workloadData(50);
    const assignments = Array.from({ length: 20 }, (_, index) => lesson(data, `jhs-${index}`));
    const load = calculateTeacherLoads(data, assignments).get(data.teachers[0]!.id)!;
    expect(load).toEqual({ minutes: 1000, incomplete: false });
    expect(load.minutes / 60).toBeCloseTo(16.6666666667);
    expect(getLoadStatus(load.minutes / 60, { underloadBelow: 16.7, balancedMax: 30 })).toBe(
      "Underload",
    );
    expect(getLoadStatus(load.minutes / 60, { underloadBelow: 16.6, balancedMax: 30 })).toBe(
      "Balanced",
    );
  });

  it("uses each section's real minutes and starts missing teachers at zero", () => {
    const data = workloadData(60);
    data.teachers.push({ ...data.teachers[0]!, id: "another", name: "Second teacher" });
    const mixed = {
      ...data.sections[0]!,
      id: "jhs",
      schoolLevel: "JHS" as const,
      bellScheduleId: "jhs-clock",
    };
    data.sections.push(mixed);
    data.bellSchedules!.push({ id: "jhs-clock", name: "JHS 50", schoolLevel: "JHS" });
    data.programTimeSlots!.push({
      id: "jhs-p1",
      bellScheduleId: "jhs-clock",
      kind: "period",
      period: 1,
      startTime: "07:30",
      endTime: "08:20",
      minutes: 50,
    });
    const loads = calculateTeacherLoads(data, [
      lesson(data, "shs-a"),
      lesson(data, "jhs-a", { sectionId: "jhs" }),
    ]);
    expect(loads.get(data.teachers[0]!.id)).toEqual({ minutes: 110, incomplete: false });
    expect(loads.get("another")).toEqual({ minutes: 0, incomplete: false });
  });

  it("marks invalid legacy timing incomplete instead of reporting an accurate zero", () => {
    const data = workloadData(50);
    const loads = calculateTeacherLoads(data, [
      lesson(data, "valid"),
      lesson(data, "bad", { period: 99 }),
    ]);
    expect(loads.get(data.teachers[0]!.id)).toEqual({ minutes: 50, incomplete: true });
  });

  it("counts only the term-selected assignments passed by the caller", () => {
    const data = workloadData(50);
    const assignments = [lesson(data, "t1"), lesson(data, "t2", { term: 2 })];
    const selected = assignments.filter((row) => row.term === 1);
    expect(calculateTeacherLoads(data, selected).get(data.teachers[0]!.id)?.minutes).toBe(50);
  });
});
