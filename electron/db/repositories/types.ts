export interface Teacher {
  id: number;
  name: string;
  name_key: string;
  specialization: string;
  employment_type: "Permanent" | "Contractual" | "Part-time";
  min_hours: number;
  max_hours: number;
}
export type NewTeacher = Omit<Teacher, "id" | "name_key">;

export interface Subject {
  id: number;
  name: string;
  name_key: string;
  grade_level: number;
  minutes_per_week: number;
}
export type NewSubject = Omit<Subject, "id" | "name_key">;

export interface Room {
  id: number;
  name: string;
  capacity: number;
  type: "Classroom" | "Laboratory" | "ICT room";
}
export type NewRoom = Omit<Room, "id">;

export interface Section {
  id: number;
  name: string;
  grade_level: number;
  school_level: "JHS" | "SHS";
  bell_schedule_id: number;
  adviser_teacher_id: number | null;
}
export type NewSection = Omit<Section, "id">;

export interface BellSchedule {
  id: number;
  name: string;
  school_level: "JHS" | "SHS";
}
export interface TimeSlot {
  id: number;
  bell_schedule_id: number;
  kind:
    | "period"
    | "class_preparation"
    | "flag_raising"
    | "flag_lowering"
    | "health_break"
    | "lunch_break";
  period_no: number | null;
  start_time: string;
  end_time: string;
  minutes: number;
}
export type NewTimeSlot = Omit<TimeSlot, "id">;

export interface ElectiveGroup {
  id: number;
  name: string;
  school_year: string;
  term: 1 | 2 | 3;
  day: 1 | 2 | 3 | 4 | 5;
  start_time_slot_id: number;
  start_minute: number;
  end_minute: number;
  duration_periods: number;
}
export type NewElectiveGroup = Omit<ElectiveGroup, "id">;

export interface Assignment {
  id: number;
  school_year: string;
  term: 1 | 2 | 3;
  day: 1 | 2 | 3 | 4 | 5;
  start_time_slot_id: number;
  start_minute: number;
  end_minute: number;
  duration_periods: number;
  section_id: number | null;
  elective_group_id: number | null;
  subject_id: number;
  teacher_id: number;
  room_id: number;
}
export type NewAssignment = Omit<Assignment, "id">;
