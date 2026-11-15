import { describe, expect, it } from "vitest";
import {
  getSectionTeachingSlots,
  resolveAssignmentInterval,
} from "@/lib/scheduling/scheduleTiming";
import { makeSampleData, type Assignment, type SchoolData } from "@/services/dataService";

const example = (changes: Partial<Assignment> = {}): Assignment => ({
  id: "lesson-1",
  sectionId: "shs",
  teacherId: "t1",
  subjectId: "sub-math",
  roomId: "r101",
  day: "Monday",
  term: 1,
  period: 1,
  ...changes,
});

function withClocks(): SchoolData {
  const data = makeSampleData();
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
      id: "shs-1",
      bellScheduleId: "shs-clock",
      kind: "period",
      period: 1,
      startTime: "07:30",
      endTime: "08:30",
      minutes: 60,
    },
    {
      id: "shs-2",
      bellScheduleId: "shs-clock",
      kind: "period",
      period: 2,
      startTime: "08:30",
      endTime: "09:30",
      minutes: 60,
    },
    {
      id: "jhs-1",
      bellScheduleId: "jhs-clock",
      kind: "period",
      period: 1,
      startTime: "07:30",
      endTime: "08:20",
      minutes: 50,
    },
    {
      id: "jhs-2",
      bellScheduleId: "jhs-clock",
      kind: "period",
      period: 2,
      startTime: "08:20",
      endTime: "09:10",
      minutes: 50,
    },
  ];
  return data;
}

describe("strict section teaching intervals", () => {
  it("returns teaching periods for each section without borrowing the other profile", () => {
    const data = withClocks();
    expect(
      getSectionTeachingSlots(data, "shs").map(({ id, period, startMinute, endMinute }) => [
        id,
        period,
        startMinute,
        endMinute,
      ]),
    ).toEqual([
      ["shs-1", 1, 450, 510],
      ["shs-2", 2, 510, 570],
    ]);
    expect(getSectionTeachingSlots(data, "jhs").map((slot) => slot.endMinute)).toEqual([500, 550]);
    data.programTimeSlots = data.programTimeSlots!.filter(
      (slot) => slot.bellScheduleId !== "jhs-clock",
    );
    expect(getSectionTeachingSlots(data, "jhs")).toEqual([]);
  });

  it("resolves a multi-period assignment only through adjacent teaching periods", () => {
    const data = withClocks();
    expect(resolveAssignmentInterval(data, example({ durationPeriods: 2 }))).toEqual({
      ok: true,
      startMinute: 450,
      endMinute: 570,
    });
    expect(
      resolveAssignmentInterval(data, example({ sectionId: "jhs", durationPeriods: 2 })),
    ).toEqual({
      ok: true,
      startMinute: 450,
      endMinute: 550,
    });
    data.programTimeSlots?.splice(1, 0, {
      id: "break",
      bellScheduleId: "shs-clock",
      kind: "health_break",
      period: null,
      startTime: "08:30",
      endTime: "08:45",
      minutes: 15,
    });
    data.programTimeSlots![2] = {
      ...data.programTimeSlots![2]!,
      startTime: "08:45",
      endTime: "09:45",
    };
    expect(resolveAssignmentInterval(data, example({ durationPeriods: 2 }))).toMatchObject({
      ok: false,
    });
  });

  it("rejects invalid period numbers, durations, section profiles, and explicit mismatched slots", () => {
    const data = withClocks();
    for (const invalid of [
      { period: 99 },
      { period: 0 },
      { durationPeriods: 0 },
      { durationPeriods: -1 },
      { durationPeriods: 3 },
      { sectionId: "missing" },
      { startTimeSlotId: "jhs-1" },
      { period: 2, startTimeSlotId: "shs-1" },
    ]) {
      expect(resolveAssignmentInterval(data, example(invalid))).toMatchObject({ ok: false });
    }
  });

  it("uses valid saved clock minutes and rejects malformed or partial saved intervals", () => {
    const data = withClocks();
    expect(resolveAssignmentInterval(data, example({ startMinute: 472, endMinute: 522 }))).toEqual({
      ok: true,
      startMinute: 472,
      endMinute: 522,
    });
    for (const invalid of [
      { startMinute: 0, endMinute: 0 },
      { startMinute: 522, endMinute: 472 },
      { startMinute: 450 },
      { startMinute: -1, endMinute: 40 },
      { startMinute: Number.NaN, endMinute: 560 },
    ]) {
      expect(resolveAssignmentInterval(data, example(invalid))).toMatchObject({ ok: false });
    }
  });

  it("preserves legacy browser teaching times while rejecting a continuation over a gap", () => {
    const data = makeSampleData();
    const sectionId = data.sections[0]!.id;
    expect(getSectionTeachingSlots(data, sectionId)[0]).toMatchObject({
      startMinute: 450,
      endMinute: 500,
    });
    expect(resolveAssignmentInterval(data, example({ sectionId, period: 1 }))).toEqual({
      ok: true,
      startMinute: 450,
      endMinute: 500,
    });
    expect(
      resolveAssignmentInterval(data, example({ sectionId, period: 5, durationPeriods: 2 })),
    ).toMatchObject({
      ok: false,
    });
  });
});
