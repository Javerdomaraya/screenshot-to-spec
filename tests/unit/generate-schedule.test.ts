import { describe, expect, it, vi } from "vitest";
import { generateScheduleCandidates } from "@/lib/scheduling/generateSchedule";
import { makeSampleData, type Assignment, type SchoolData } from "@/services/dataService";

function dataForGeneration(): SchoolData {
  const data = makeSampleData();
  data.teachers = [data.teachers[0]!];
  data.rooms = [data.rooms[0]!];
  data.subjects = [{ id: "core", name: "Mathematics", gradeLevel: 10, minutesPerWeek: 300 }];
  data.sections = [
    {
      id: "shs",
      name: "Grade 11",
      gradeLevel: 11,
      schoolLevel: "SHS",
      adviser: "",
      bellScheduleId: "shs-clock",
    },
    {
      id: "jhs",
      name: "Grade 10",
      gradeLevel: 10,
      schoolLevel: "JHS",
      adviser: "",
      bellScheduleId: "jhs-clock",
    },
  ];
  data.bellSchedules = [
    { id: "shs-clock", name: "SHS", schoolLevel: "SHS" },
    { id: "jhs-clock", name: "JHS", schoolLevel: "JHS" },
  ];
  data.programTimeSlots = [
    {
      id: "p1",
      bellScheduleId: "jhs-clock",
      kind: "period",
      period: 1,
      startTime: "07:30",
      endTime: "08:20",
      minutes: 50,
    },
    {
      id: "p2",
      bellScheduleId: "jhs-clock",
      kind: "period",
      period: 2,
      startTime: "08:20",
      endTime: "09:10",
      minutes: 50,
    },
    {
      id: "break",
      bellScheduleId: "jhs-clock",
      kind: "health_break",
      period: null,
      startTime: "09:10",
      endTime: "09:20",
      minutes: 10,
    },
    {
      id: "p3",
      bellScheduleId: "jhs-clock",
      kind: "period",
      period: 3,
      startTime: "09:20",
      endTime: "10:10",
      minutes: 50,
    },
    {
      id: "p4",
      bellScheduleId: "jhs-clock",
      kind: "period",
      period: 4,
      startTime: "10:10",
      endTime: "11:00",
      minutes: 50,
    },
  ];
  data.assignments = [];
  return data;
}

const existing = (data: SchoolData, overrides: Partial<Assignment> = {}): Assignment => ({
  id: "existing",
  term: 1,
  day: "Monday",
  sectionId: "shs",
  subjectId: "core",
  teacherId: data.teachers[0]!.id,
  roomId: data.rooms[0]!.id,
  period: 1,
  startMinute: 450,
  endMinute: 510,
  ...overrides,
});

describe("greedy generation with actual clock intervals", () => {
  it("skips overlapping SHS/JHS periods even when the period numbers differ", async () => {
    const data = dataForGeneration();
    data.assignments = [existing(data)];
    const validate = vi.fn().mockResolvedValue([]);
    const additions = await generateScheduleCandidates(data, 1, validate);
    expect(additions).toHaveLength(1);
    expect(additions[0]).toMatchObject({ sectionId: "jhs", period: 3, day: "Monday" });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(data.assignments).toHaveLength(1);
  });

  it("respects all continuation minutes and skips breaks and sections without teaching slots", async () => {
    const data = dataForGeneration();
    const prior = existing(data, { sectionId: "jhs", durationPeriods: 2 });
    delete prior.startMinute;
    delete prior.endMinute;
    data.assignments = [prior];
    const additions = await generateScheduleCandidates(data, 1, async () => []);
    expect(additions).toHaveLength(1);
    expect(additions[0]?.period).toBe(3);
    expect(additions.every((row) => row.sectionId === "jhs")).toBe(true);
  });

  it("continues after an authoritative elective reservation rejects a locally free candidate", async () => {
    const data = dataForGeneration();
    data.assignments = [existing(data)];
    const validate = vi.fn(async (candidate: Assignment) =>
      candidate.period === 3 ? ["Elective group reservation"] : [],
    );
    const additions = await generateScheduleCandidates(data, 1, validate);
    expect(additions).toHaveLength(1);
    expect(additions[0]?.period).toBe(4);
    expect(validate.mock.calls.map(([assignment]) => assignment.period)).toEqual([3, 4]);
  });

  it("prevents overlap between staged candidates and generates distinct temporary IDs", async () => {
    const data = dataForGeneration();
    data.subjects.push({ id: "english", name: "English", gradeLevel: 10, minutesPerWeek: 300 });
    const additions = await generateScheduleCandidates(data, 1, async () => []);
    expect(additions).toHaveLength(2);
    expect(additions.map((row) => row.period)).toEqual([1, 2]);
    expect(new Set(additions.map((row) => row.id)).size).toBe(2);
    expect(data.assignments).toEqual([]);
  });

  it("aborts the entire candidate batch when infrastructure validation rejects", async () => {
    const data = dataForGeneration();
    const validate = vi.fn().mockRejectedValue(new Error("Validation API unavailable"));
    await expect(generateScheduleCandidates(data, 1, validate)).rejects.toThrow(
      "Validation API unavailable",
    );
    expect(data.assignments).toEqual([]);
  });
});
