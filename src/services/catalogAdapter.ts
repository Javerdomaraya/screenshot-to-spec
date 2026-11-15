import type { CatalogSnapshot, CatalogReplacement } from "../../shared/electron-api";
import { normalizeSchoolYear } from "../../shared/school-year";
import { applySchoolReportDefaults, normalizeSchoolName } from "@/lib/schoolBrand";
import type { SchoolData, SchoolSettings } from "./dataService";

const pad = (value: string | undefined, fallback = "") => value ?? fallback;

/** The existing React pages use camelCase and string IDs. SQLite uses numeric IDs. */
export function schoolDataFromCatalog(snapshot: CatalogSnapshot): SchoolData {
  const adviserNames = new Map(snapshot.teachers.map((t) => [t.id, t.name]));
  const fallbackSchedule =
    snapshot.bellSchedules.find((b) => b.name === "JHS-50-A") ?? snapshot.bellSchedules[0];
  const selectedSchedule =
    snapshot.bellSchedules.find((b) => b.id === snapshot.sections[0]?.bell_schedule_id) ??
    fallbackSchedule;

  const configuredReport = Object.prototype.hasOwnProperty.call(snapshot.settings, "report_school_name");
  const settings: SchoolSettings = applySchoolReportDefaults({
    schoolName: normalizeSchoolName(pad(snapshot.settings["school_name"])),
    ...(configuredReport ? { reportSchoolName: pad(snapshot.settings["report_school_name"]) } : {}),
    schoolYear: normalizeSchoolYear(pad(snapshot.settings["school_year"], "2026-2027")),
    preparedBy: pad(snapshot.settings["prepared_by"]),
    schoolHead: pad(snapshot.settings["approved_by"]),
    region: pad(snapshot.settings["region"]),
    division: pad(snapshot.settings["division"]),
    district: pad(snapshot.settings["district"]),
    schoolAddress: pad(snapshot.settings["school_address"]),
    preparedByTitle: pad(snapshot.settings["prepared_by_title"]),
    approvedByTitle: pad(snapshot.settings["approved_by_title"]),
    attestedBy: pad(snapshot.settings["attested_by"]),
    attestedByTitle: pad(snapshot.settings["attested_by_title"]),
    classAdviserLabel: pad(snapshot.settings["class_adviser_label"]),
    thresholds: {
      underloadBelow: Number(snapshot.settings["underload_below"] ?? 18),
      balancedMax: Number(snapshot.settings["balanced_max"] ?? 30),
    },
  }, configuredReport);

  return {
    bellSchedules: snapshot.bellSchedules.map((schedule) => ({
      id: String(schedule.id),
      name: schedule.name,
      schoolLevel: schedule.school_level,
    })),
    programTimeSlots: snapshot.timeSlots.map((slot) => ({
      id: String(slot.id),
      bellScheduleId: String(slot.bell_schedule_id),
      kind: slot.kind,
      period: slot.period_no,
      startTime: slot.start_time,
      endTime: slot.end_time,
      minutes: slot.minutes,
    })),
    teachers: snapshot.teachers.map((t) => ({
      id: String(t.id),
      name: t.name,
      specialization: t.specialization,
      employmentType: t.employment_type,
      minHours: t.min_hours,
      maxHours: t.max_hours,
    })),
    sections: snapshot.sections.map((s) => ({
      id: String(s.id),
      name: s.name,
      gradeLevel: s.grade_level,
      schoolLevel: s.school_level,
      adviser: s.adviser_teacher_id === null ? "" : (adviserNames.get(s.adviser_teacher_id) ?? ""),
      bellScheduleId: String(s.bell_schedule_id),
    })),
    subjects: snapshot.subjects.map((s) => ({
      id: String(s.id),
      name: s.name,
      gradeLevel: s.grade_level,
      minutesPerWeek: s.minutes_per_week,
    })),
    rooms: snapshot.rooms.map((r) => ({
      id: String(r.id),
      name: r.name,
      capacity: r.capacity,
      type: r.type,
    })),
    // Temporary legacy view: full multi-profile scheduling is Step 4.
    timeSlots: snapshot.timeSlots
      .filter((s) => s.kind === "period" && s.bell_schedule_id === selectedSchedule?.id)
      .map((s) => ({
        id: String(s.id),
        period: s.period_no ?? 0,
        startTime: s.start_time,
        endTime: s.end_time,
        isBreak: false,
      })),
    // Scheduling IPC is intentionally not active until Step 4. Never
    // populate the actual SQLite database with legacy mock assignments.
    assignments: [],
    settings,
  };
}

export function catalogReplacementFromSchoolData(
  data: SchoolData,
  expectedRevision: number,
  resolveId: (id: string) => string,
): CatalogReplacement {
  return {
    expectedRevision,
    teachers: data.teachers.map((t) => ({
      id: resolveId(t.id),
      name: t.name,
      specialization: t.specialization,
      employmentType: t.employmentType,
      minHours: t.minHours,
      maxHours: t.maxHours,
    })),
    sections: data.sections.map((s) => ({
      id: resolveId(s.id),
      name: s.name,
      gradeLevel: s.gradeLevel,
      schoolLevel: s.schoolLevel,
      adviser: s.adviser,
      ...(s.bellScheduleId ? { bellScheduleId: s.bellScheduleId } : {}),
    })),
    subjects: data.subjects.map((s) => ({
      id: resolveId(s.id),
      name: s.name,
      gradeLevel: s.gradeLevel,
      minutesPerWeek: s.minutesPerWeek,
    })),
    rooms: data.rooms.map((r) => ({
      id: resolveId(r.id),
      name: r.name,
      capacity: r.capacity,
      type: r.type,
    })),
  };
}
