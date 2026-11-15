import type { Assignment, SchoolData } from "@/services/dataService";

export interface TeachingSlot {
  id: string;
  period: number;
  startMinute: number;
  endMinute: number;
}

export interface SectionClockRow {
  id: string;
  kind: string;
  period: number | null;
  startMinute: number;
  endMinute: number;
}

export type IntervalResult =
  { ok: true; startMinute: number; endMinute: number } | { ok: false; message: string };

const isMinute = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= 24 * 60;

function parseClock(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return value === "24:00" ? 1440 : null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Single source of section bell-profile lookup for scheduling and display. */
export function getSectionClockRows(data: SchoolData, sectionId: string): SectionClockRow[] {
  const section = data.sections.find((item) => item.id === sectionId);
  if (!section) return [];

  const source =
    data.programTimeSlots !== undefined
      ? data.programTimeSlots
          .filter((slot) => {
            const profileId =
              section.bellScheduleId ??
              data.bellSchedules?.find((profile) => profile.schoolLevel === section.schoolLevel)
                ?.id;
            return Boolean(profileId) && slot.bellScheduleId === profileId;
          })
          .map((slot) => ({
            id: slot.id,
            kind: slot.kind,
            period: slot.period,
            startTime: slot.startTime,
            endTime: slot.endTime,
          }))
      : data.timeSlots.map((slot) => ({
          id: slot.id,
          kind: slot.isBreak ? "break" : "period",
          period: slot.isBreak ? null : slot.period,
          startTime: slot.startTime,
          endTime: slot.endTime,
        }));

  return source
    .flatMap((slot): SectionClockRow[] => {
      const startMinute = parseClock(slot.startTime);
      const endMinute = parseClock(slot.endTime);
      if (startMinute === null || endMinute === null || startMinute >= endMinute) return [];
      return [{ id: slot.id, kind: slot.kind, period: slot.period, startMinute, endMinute }];
    })
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
}

export function getSectionTeachingSlots(data: SchoolData, sectionId: string): TeachingSlot[] {
  return getSectionClockRows(data, sectionId)
    .filter(
      (slot): slot is SectionClockRow & { period: number } =>
        slot.kind === "period" &&
        slot.period !== null &&
        Number.isInteger(slot.period) &&
        slot.period > 0,
    )
    .map(({ id, period, startMinute, endMinute }) => ({
      id,
      period,
      startMinute,
      endMinute,
    }));
}

/** Strict clock-time resolution; failure must not be interpreted as midnight. */
export function resolveAssignmentInterval(
  data: SchoolData,
  assignment: Assignment,
): IntervalResult {
  const hasSavedStart = assignment.startMinute !== undefined;
  const hasSavedEnd = assignment.endMinute !== undefined;
  if (hasSavedStart || hasSavedEnd) {
    if (
      hasSavedStart &&
      hasSavedEnd &&
      isMinute(assignment.startMinute!) &&
      isMinute(assignment.endMinute!) &&
      assignment.startMinute! < assignment.endMinute!
    ) {
      return { ok: true, startMinute: assignment.startMinute!, endMinute: assignment.endMinute! };
    }
    return { ok: false, message: "Assignment has invalid saved start/end clock times." };
  }

  const duration = assignment.durationPeriods ?? 1;
  if (
    !Number.isInteger(assignment.period) ||
    assignment.period < 1 ||
    !Number.isInteger(duration) ||
    duration < 1
  ) {
    return { ok: false, message: "Assignment has an invalid period or duration." };
  }

  const teaching = getSectionTeachingSlots(data, assignment.sectionId);
  const starts = teaching.filter((slot) => slot.period === assignment.period);
  if (starts.length !== 1) {
    return {
      ok: false,
      message: "The section's bell schedule has no unique matching teaching period.",
    };
  }
  const first = starts[0]!;
  if (assignment.startTimeSlotId && assignment.startTimeSlotId !== first.id) {
    return { ok: false, message: "The chosen time slot does not belong to this section's period." };
  }
  const startIndex = teaching.findIndex((slot) => slot.id === first.id);
  const continuation = teaching.slice(startIndex, startIndex + duration);
  if (continuation.length !== duration) {
    return { ok: false, message: "The section does not have enough continuation periods." };
  }
  for (let index = 1; index < continuation.length; index++) {
    const previous = continuation[index - 1]!;
    const next = continuation[index]!;
    if (next.period !== previous.period + 1 || next.startMinute !== previous.endMinute) {
      return { ok: false, message: "The lesson crosses a break, gap, or noncontiguous period." };
    }
  }
  const endMinute = continuation[continuation.length - 1]!.endMinute;
  if (
    getSectionClockRows(data, assignment.sectionId).some(
      (slot) =>
        slot.kind !== "period" &&
        slot.startMinute < endMinute &&
        first.startMinute < slot.endMinute,
    )
  ) {
    return { ok: false, message: "The lesson overlaps a fixed school event or break." };
  }
  return { ok: true, startMinute: first.startMinute, endMinute };
}
