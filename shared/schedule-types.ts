import type { Assignment } from "../electron/db/repositories/types";

export type SchoolTerm = 1 | 2 | 3;
export type SchoolDay = 1 | 2 | 3 | 4 | 5;

/**
 * The renderer chooses a STARTING teaching period and a number of periods.
 * Actual start and end minutes are always calculated by the main process.
 */
export interface ScheduleCandidate {
  schoolYear: string;
  term: SchoolTerm;
  day: SchoolDay;
  sectionId?: number | null;
  electiveGroupId?: number | null;
  subjectId: number;
  teacherId: number;
  roomId: number;
  startTimeSlotId: number;
  durationPeriods: number;
}

export interface ScheduleFilter {
  schoolYear: string;
  term?: SchoolTerm;
}

export type ScheduleConflictType = "teacher" | "section" | "room" | "duplicate";

export interface ScheduleConflict {
  type: ScheduleConflictType;
  message: string;
  conflictingAssignmentId: number | null;
}

export interface ScheduleConflictRecord extends ScheduleConflict {
  assignmentId: number;
}

export interface ScheduleValidation {
  valid: boolean;
  conflicts: ScheduleConflict[];
}

export type SavedScheduleAssignment = Assignment;
export interface ScheduleChangeSet {
  creates: ScheduleCandidate[];
  updates: { id: number; candidate: ScheduleCandidate }[];
  deletes: number[];
}

export interface ScheduleChangeResult {
  created: SavedScheduleAssignment[];
  updated: SavedScheduleAssignment[];
  deleted: number[];
}

export interface ElectiveGroupCandidate {
  name: string;
  schoolYear: string;
  term: SchoolTerm;
  day: SchoolDay;
  startTimeSlotId: number;
  durationPeriods: number;
  sectionIds: number[];
}

export interface ElectiveGroupDetails {
  id: number;
  name: string;
  schoolYear: string;
  term: SchoolTerm;
  day: SchoolDay;
  startTimeSlotId: number;
  startMinute: number;
  endMinute: number;
  durationPeriods: number;
  sectionIds: number[];
}
