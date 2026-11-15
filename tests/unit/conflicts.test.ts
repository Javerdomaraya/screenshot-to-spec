import { describe, expect, it } from "vitest";

import {
  collectScheduleConflicts,
  getLoadStatus,
  validateAssignmentConflicts,
} from "@/lib/conflicts";
import { makeSampleData, type Assignment } from "@/services/dataService";

describe("schedule conflict rules", () => {
  it("detects an overlapping SHS first period and JHS second period using section clocks", () => {
    const data = makeSampleData();
    data.sections = [
      { id: "shs", name: "Grade 11", gradeLevel: 11, schoolLevel: "SHS", adviser: "", bellScheduleId: "shs-clock" },
      { id: "jhs", name: "Grade 10", gradeLevel: 10, schoolLevel: "JHS", adviser: "", bellScheduleId: "jhs-clock" },
    ];
    data.bellSchedules = [
      { id: "shs-clock", name: "SHS clock", schoolLevel: "SHS" },
      { id: "jhs-clock", name: "JHS clock", schoolLevel: "JHS" },
    ];
    data.programTimeSlots = [
      { id: "shs-p1", bellScheduleId: "shs-clock", kind: "period", period: 1, startTime: "07:30", endTime: "08:30", minutes: 60 },
      { id: "jhs-p2", bellScheduleId: "jhs-clock", kind: "period", period: 2, startTime: "08:20", endTime: "09:10", minutes: 50 },
    ];
    const first: Assignment = { id: "shs-one", term: 1, sectionId: "shs", subjectId: "sub-math", teacherId: "t1", roomId: "r101", day: "Monday", period: 1 };
    const second: Assignment = { ...first, id: "jhs-two", sectionId: "jhs", roomId: "r102", period: 2 };
    expect(collectScheduleConflicts([first, second], data).map((conflict) => conflict.type)).toContain("Teacher");
    expect(validateAssignmentConflicts(second, [first], data)).toContain("Maria Santos is already assigned at this time.");
  });
  it("shows actual-time overlaps between different JHS and SHS period numbers", () => {
    const first: Assignment = {
      id: "1",
      term: 2,
      sectionId: "11",
      subjectId: "1",
      teacherId: "1",
      roomId: "5",
      day: "Monday",
      period: 2,
      startMinute: 510,
      endMinute: 570,
    };
    const second: Assignment = {
      ...first,
      id: "2",
      sectionId: "12",
      roomId: "6",
      period: 3,
      startMinute: 560,
      endMinute: 610,
    };
    expect(collectScheduleConflicts([first, second], makeSampleData()).map((c) => c.type)).toContain("Teacher");
    const adjacent = { ...second, startMinute: 570, endMinute: 620 };
    expect(collectScheduleConflicts([first, adjacent], makeSampleData())).toHaveLength(0);
  });
  it("detects teacher, section, room, and duplicate clashes in the same term and period", () => {
    const data = makeSampleData();
    const conflicts = collectScheduleConflicts(data.assignments, data);
    expect(conflicts.map((conflict) => conflict.type)).toContain("Teacher");
    expect(conflicts.map((conflict) => conflict.type)).toContain("Section");
    expect(conflicts.map((conflict) => conflict.type)).toContain("Room");
    expect(conflicts.map((conflict) => conflict.type)).toContain("Duplicate");
  });

  it("does not flag matching times in another term", () => {
    const data = makeSampleData();
    const first = data.assignments[0];
    const otherTerm = data.assignments.find((assignment) => assignment.term === 2);
    expect(
      first && otherTerm && first.day === otherTerm.day && first.period === otherTerm.period,
    ).toBe(true);
    expect(collectScheduleConflicts([first as Assignment, otherTerm as Assignment], data)).toHaveLength(
      0,
    );
  });

  it("returns teacher and room messages when validating a conflicting assignment", () => {
    const data = makeSampleData();
    const candidate: Assignment = {
      id: "new",
      term: 1,
      sectionId: "s8-edge",
      subjectId: "sub-math",
      teacherId: "t1",
      roomId: "r101",
      day: "Monday",
      period: 1,
    };
    const messages = validateAssignmentConflicts(candidate, data.assignments, data);
    expect(messages).toContain("Maria Santos is already assigned at this time.");
    expect(messages).toContain("Room 101 is already in use at this time.");
    expect(messages).toContain("Grade 8 – Edge already has a class at this time.");
  });
});

describe("teacher workload thresholds", () => {
  const thresholds = { underloadBelow: 18, balancedMax: 30 };

  it("uses the stated boundaries of 18 and 30 weekly hours", () => {
    expect(getLoadStatus(17, thresholds)).toBe("Underload");
    expect(getLoadStatus(18, thresholds)).toBe("Balanced");
    expect(getLoadStatus(30, thresholds)).toBe("Balanced");
    expect(getLoadStatus(31, thresholds)).toBe("Overload");
  });
});
