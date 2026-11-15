import { describe, expect, it } from "vitest";
import type { CatalogSnapshot } from "../../shared/electron-api";
import { schoolDataFromCatalog } from "../../src/services/catalogAdapter";

const snapshot: CatalogSnapshot = {
  revision: 0,
  teachers: [],
  sections: [
    {
      id: 7,
      name: "Grade 8 Edge",
      grade_level: 8,
      school_level: "JHS",
      bell_schedule_id: 2,
      adviser_teacher_id: null,
    },
  ],
  subjects: [],
  rooms: [],
  bellSchedules: [
    { id: 1, name: "SHS-60", school_level: "SHS" },
    { id: 2, name: "JHS-50-A", school_level: "JHS" },
  ],
  timeSlots: [
    {
      id: 11,
      bell_schedule_id: 1,
      kind: "class_preparation",
      period_no: null,
      start_time: "07:00",
      end_time: "07:15",
      minutes: 15,
    },
    {
      id: 12,
      bell_schedule_id: 1,
      kind: "flag_raising",
      period_no: null,
      start_time: "07:15",
      end_time: "07:30",
      minutes: 15,
    },
    {
      id: 13,
      bell_schedule_id: 1,
      kind: "period",
      period_no: 1,
      start_time: "07:30",
      end_time: "08:30",
      minutes: 60,
    },
    {
      id: 14,
      bell_schedule_id: 1,
      kind: "health_break",
      period_no: null,
      start_time: "09:30",
      end_time: "09:45",
      minutes: 15,
    },
    {
      id: 15,
      bell_schedule_id: 1,
      kind: "lunch_break",
      period_no: null,
      start_time: "11:45",
      end_time: "13:00",
      minutes: 75,
    },
    {
      id: 16,
      bell_schedule_id: 1,
      kind: "flag_lowering",
      period_no: null,
      start_time: "17:00",
      end_time: "17:15",
      minutes: 15,
    },
    {
      id: 21,
      bell_schedule_id: 2,
      kind: "period",
      period_no: 1,
      start_time: "07:30",
      end_time: "08:20",
      minutes: 50,
    },
  ],
  settings: {
    school_name: "Test National High School",
    school_year: "2026-2027",
    region: "Region VII",
    division: "Cebu",
    district: "District I",
    school_address: "School Road",
    prepared_by: "Ana Cruz",
    prepared_by_title: "Teacher III",
    approved_by: "Jose Reyes",
    approved_by_title: "School Principal",
    attested_by: "Maria Santos",
    attested_by_title: "Schools Division Superintendent",
    class_adviser_label: "CLASS ADVISER",
    underload_below: "18",
    balanced_max: "30",
  },
};

describe("class-program catalog projection", () => {
  it("preserves every bell profile and fixed event while retaining legacy selected-profile periods", () => {
    const data = schoolDataFromCatalog(snapshot);

    expect(data.bellSchedules).toEqual([
      { id: "1", name: "SHS-60", schoolLevel: "SHS" },
      { id: "2", name: "JHS-50-A", schoolLevel: "JHS" },
    ]);
    expect(data.programTimeSlots).toEqual([
      {
        id: "11",
        bellScheduleId: "1",
        kind: "class_preparation",
        period: null,
        startTime: "07:00",
        endTime: "07:15",
        minutes: 15,
      },
      {
        id: "12",
        bellScheduleId: "1",
        kind: "flag_raising",
        period: null,
        startTime: "07:15",
        endTime: "07:30",
        minutes: 15,
      },
      {
        id: "13",
        bellScheduleId: "1",
        kind: "period",
        period: 1,
        startTime: "07:30",
        endTime: "08:30",
        minutes: 60,
      },
      {
        id: "14",
        bellScheduleId: "1",
        kind: "health_break",
        period: null,
        startTime: "09:30",
        endTime: "09:45",
        minutes: 15,
      },
      {
        id: "15",
        bellScheduleId: "1",
        kind: "lunch_break",
        period: null,
        startTime: "11:45",
        endTime: "13:00",
        minutes: 75,
      },
      {
        id: "16",
        bellScheduleId: "1",
        kind: "flag_lowering",
        period: null,
        startTime: "17:00",
        endTime: "17:15",
        minutes: 15,
      },
      {
        id: "21",
        bellScheduleId: "2",
        kind: "period",
        period: 1,
        startTime: "07:30",
        endTime: "08:20",
        minutes: 50,
      },
    ]);
    expect(data.timeSlots).toEqual([
      { id: "21", period: 1, startTime: "07:30", endTime: "08:20", isBreak: false },
    ]);
    expect(data.sections[0]?.bellScheduleId).toBe("2");
  });

  it("makes persisted school header and signatory details available to programs", () => {
    const data = schoolDataFromCatalog(snapshot);

    expect(data.settings).toEqual({
      schoolName: "Test National High School",
      schoolYear: "2026-2027",
      region: "Region VII",
      division: "Cebu",
      district: "District I",
      schoolAddress: "School Road",
      preparedBy: "Ana Cruz",
      preparedByTitle: "Teacher III",
      schoolHead: "Jose Reyes",
      approvedByTitle: "School Principal",
      attestedBy: "Maria Santos",
      attestedByTitle: "Schools Division Superintendent",
      classAdviserLabel: "CLASS ADVISER",
      thresholds: { underloadBelow: 18, balancedMax: 30 },
    });
  });

  it("provides empty program metadata for an empty catalog without inventing school details", () => {
    const data = schoolDataFromCatalog({
      ...snapshot,
      sections: [],
      bellSchedules: [],
      timeSlots: [],
      settings: {},
    });

    expect(data.bellSchedules).toEqual([]);
    expect(data.programTimeSlots).toEqual([]);
    expect(data.timeSlots).toEqual([]);
    expect(data.settings).toMatchObject({
      region: "",
      division: "",
      district: "",
      schoolAddress: "",
      preparedByTitle: "",
      approvedByTitle: "",
      attestedBy: "",
      attestedByTitle: "",
      classAdviserLabel: "",
    });
  });
});
