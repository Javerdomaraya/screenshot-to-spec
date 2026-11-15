import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, CatalogSnapshot } from "../../shared/electron-api";
import type { SavedScheduleAssignment } from "../../shared/schedule-types";

const snapshot: CatalogSnapshot = {
  revision: 0,
  teachers: [
    {
      id: 1,
      name: "Ana Cruz",
      name_key: "anacruz",
      specialization: "Science",
      employment_type: "Permanent",
      min_hours: 18,
      max_hours: 30,
    },
  ],
  sections: [
    {
      id: 2,
      name: "8 Edge",
      grade_level: 8,
      school_level: "JHS",
      bell_schedule_id: 3,
      adviser_teacher_id: null,
    },
  ],
  subjects: [
    { id: 3, name: "Science", name_key: "science", grade_level: 8, minutes_per_week: 300 },
  ],
  rooms: [{ id: 4, name: "Room A", capacity: 40, type: "Classroom" }],
  bellSchedules: [{ id: 3, name: "JHS-50-B", school_level: "JHS" }],
  timeSlots: [
    {
      id: 21,
      bell_schedule_id: 3,
      kind: "period",
      period_no: 1,
      start_time: "07:30",
      end_time: "08:20",
      minutes: 50,
    },
    {
      id: 22,
      bell_schedule_id: 3,
      kind: "period",
      period_no: 2,
      start_time: "08:20",
      end_time: "09:10",
      minutes: 50,
    },
    {
      id: 23,
      bell_schedule_id: 3,
      kind: "health_break",
      period_no: null,
      start_time: "09:10",
      end_time: "09:20",
      minutes: 10,
    },
    {
      id: 24,
      bell_schedule_id: 3,
      kind: "period",
      period_no: 3,
      start_time: "09:20",
      end_time: "10:10",
      minutes: 50,
    },
  ],
  settings: {
    school_name: "School",
    school_year: "2026-2027",
    underload_below: "18",
    balanced_max: "30",
  },
};
const saved: SavedScheduleAssignment = {
  id: 9,
  school_year: "2026-2027",
  term: 2,
  day: 1,
  section_id: 2,
  elective_group_id: null,
  subject_id: 3,
  teacher_id: 1,
  room_id: 4,
  start_time_slot_id: 21,
  start_minute: 450,
  end_minute: 500,
  duration_periods: 1,
};
const second: SavedScheduleAssignment = {
  ...saved,
  id: 10,
  start_time_slot_id: 22,
  start_minute: 500,
  end_minute: 550,
};

function fakeApi() {
  const catalog = {
    snapshot: vi.fn().mockResolvedValue({ ok: true, data: snapshot }),
    applySnapshot: vi.fn().mockResolvedValue({ ok: true, data: { revision: 1, idMap: {} } }),
  };
  const schedule = {
    list: vi.fn().mockResolvedValue({ ok: true, data: [saved] }),
    validate: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        valid: false,
        conflicts: [
          {
            type: "teacher",
            conflictingAssignmentId: 9,
            message: "Teacher is already assigned Monday",
          },
        ],
      },
    }),
    applyChanges: vi
      .fn()
      .mockResolvedValue({ ok: true, data: { created: [second], updated: [], deleted: [] } }),
    save: vi.fn().mockResolvedValue({ ok: true, data: second }),
    update: vi.fn().mockResolvedValue({ ok: true, data: second }),
    delete: vi.fn().mockResolvedValue({ ok: true, data: { deleted: true } }),
    detectConflicts: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  };
  window.api = { catalog, schedule } as unknown as DesktopApi;
  return { schedule, catalog };
}
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => {
  delete window.api;
  vi.restoreAllMocks();
});

describe("existing React page schedule adapter", () => {
  it("projects real SQLite assignments and JHS-50-B period numbers without mock data", async () => {
    const { schedule } = fakeApi();
    const { dataService } = await import("../../src/services/dataService");
    const data = await dataService.getAll();
    expect(schedule.list).toHaveBeenCalledWith({ schoolYear: "2026-2027" });
    expect(data.assignments).toEqual([
      expect.objectContaining({
        id: "9",
        term: 2,
        day: "Monday",
        period: 1,
        sectionId: "2",
        teacherId: "1",
        roomId: "4",
      }),
    ]);
    expect(data.sections[0]?.bellScheduleId).toBe("3");
    expect(localStorage.length).toBe(0);
  });

  it("sends manual assignment validation to SQLite and displays authoritative conflicts", async () => {
    const { schedule } = fakeApi();
    const { dataService } = await import("../../src/services/dataService");
    await dataService.getAll();
    const messages = await dataService.validateAssignment({
      id: "draft",
      term: 2,
      day: "Monday",
      period: 2,
      sectionId: "2",
      subjectId: "3",
      teacherId: "1",
      roomId: "4",
    });
    expect(schedule.validate).toHaveBeenCalledWith(
      expect.objectContaining({
        schoolYear: "2026-2027",
        term: 2,
        day: 1,
        startTimeSlotId: 22,
        sectionId: 2,
        teacherId: 1,
        roomId: 4,
        durationPeriods: 1,
      }),
      undefined,
    );
    expect(messages).toEqual(["Teacher is already assigned Monday"]);
  });

  it("rejects unavailable desktop validation instead of disguising it as a domain conflict", async () => {
    const { schedule } = fakeApi();
    const { dataService } = await import("../../src/services/dataService");
    await dataService.getAll();
    schedule.validate.mockRejectedValueOnce(new Error("Validation IPC disconnected"));
    await expect(dataService.validateAssignment({
      id: "draft", term: 2, day: "Monday", period: 2,
      sectionId: "2", subjectId: "3", teacherId: "1", roomId: "4",
    })).rejects.toThrow("Validation IPC disconnected");
  });

  it("persists page-level schedule additions in an atomic batch and maps returned SQLite IDs", async () => {
    const { schedule, catalog } = fakeApi();
    const { dataService } = await import("../../src/services/dataService");
    const previous = await dataService.getAll();
    const committed = await dataService.saveAll({
      ...previous,
      assignments: [
        ...previous.assignments,
        {
          id: "a-temp",
          term: 2,
          day: "Monday",
          period: 2,
          sectionId: "2",
          subjectId: "3",
          teacherId: "1",
          roomId: "4",
          startMinute: 1,
          endMinute: 2,
        },
      ],
    });
    expect(schedule.applyChanges).toHaveBeenCalledTimes(1);
    expect(schedule.applyChanges).toHaveBeenCalledWith({
      creates: [
        expect.objectContaining({ schoolYear: "2026-2027", term: 2, day: 1, startTimeSlotId: 22 }),
      ],
      updates: [],
      deletes: [],
    });
    expect(catalog.applySnapshot).not.toHaveBeenCalled();
    expect(committed.assignments[1]).toMatchObject({ id: "10", startTimeSlotId: "22", startMinute: 500, endMinute: 550 });
    committed.assignments[1]!.startMinute = 99;
    const again = await dataService.saveAll({ ...previous, assignments: [...previous.assignments, committed.assignments[1]!] });
    expect(again.assignments[1]?.startMinute).toBe(500);
    expect(schedule.applyChanges).toHaveBeenCalledTimes(1);
    expect(catalog.snapshot).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });

  it("reconciles authoritative updated rows and deletions without rereading schedules", async () => {
    const { schedule, catalog } = fakeApi();
    schedule.list.mockResolvedValueOnce({ ok: true, data: [saved, second] });
    schedule.applyChanges.mockResolvedValueOnce({ ok: true, data: {
      created: [], updated: [{ ...saved, start_time_slot_id: 24, start_minute: 560, end_minute: 610 }], deleted: [10],
    } });
    const { dataService } = await import("../../src/services/dataService");
    const previous = await dataService.getAll();
    const committed = await dataService.saveAll({ ...previous, assignments: [{ ...previous.assignments[0]!, period: 3 }] });
    expect(committed.assignments).toEqual([expect.objectContaining({ id: "9", period: 3, startTimeSlotId: "24", startMinute: 560, endMinute: 610 })]);
    expect(schedule.applyChanges).toHaveBeenCalledWith({ creates: [], updates: [{ id: 9, candidate: expect.objectContaining({ startTimeSlotId: 24 }) }], deletes: [10] });
    expect(schedule.list).toHaveBeenCalledTimes(1);
    expect(catalog.snapshot).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported cross-profile or missing section periods before invoking IPC", async () => {
    const { schedule } = fakeApi();
    const { dataService } = await import("../../src/services/dataService");
    await dataService.getAll();
    const errors = await dataService.validateAssignment({
      id: "draft",
      term: 2,
      day: "Friday",
      period: 8,
      sectionId: "2",
      subjectId: "3",
      teacherId: "1",
      roomId: "4",
    });
    expect(errors[0]).toMatch(/period|profile|slot/i);
    expect(schedule.validate).not.toHaveBeenCalled();
  });
});
