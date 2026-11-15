export type IpcResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export interface AppInfo {
  appName: string;
  version: string;
  platform: string;
}

export interface AdminAuthStatus {
  configured: boolean;
  authenticated: boolean;
  username: "admin";
}

/** Public and deliberately minimal until the domain handlers are implemented. */
export interface DesktopApi {
  getAppInfo(): Promise<IpcResult<AppInfo>>;
  auth: {
    status(): Promise<IpcResult<AdminAuthStatus>>;
    setup(password: string): Promise<IpcResult<AdminAuthStatus>>;
    signIn(password: string): Promise<IpcResult<AdminAuthStatus>>;
    logout(): Promise<IpcResult<AdminAuthStatus>>;
  };
  teachers: CrudApi<NewTeacher, Teacher>;
  sections: CrudApi<NewSection, Section>;
  subjects: CrudApi<NewSubject, Subject>;
  rooms: CrudApi<NewRoom, Room>;
  catalog: {
    snapshot(): Promise<IpcResult<CatalogSnapshot>>;
    ensureSchoolName(name: string): Promise<IpcResult<CatalogSnapshot>>;
    saveSettings(request: SchoolSettingsUpdate): Promise<IpcResult<CatalogSnapshot>>;
    applySnapshot(request: CatalogReplacement): Promise<IpcResult<CatalogApplyResult>>;
  };
  schedule: {
    list(filter: ScheduleFilter): Promise<IpcResult<SavedScheduleAssignment[]>>;
    get(id: number): Promise<IpcResult<SavedScheduleAssignment>>;
    validate(
      candidate: ScheduleCandidate,
      excludeId?: number,
    ): Promise<IpcResult<ScheduleValidation>>;
    save(candidate: ScheduleCandidate): Promise<IpcResult<SavedScheduleAssignment>>;
    update(id: number, candidate: ScheduleCandidate): Promise<IpcResult<SavedScheduleAssignment>>;
    delete(id: number): Promise<IpcResult<{ deleted: true }>>;
    applyChanges(changes: ScheduleChangeSet): Promise<IpcResult<ScheduleChangeResult>>;
    detectConflicts(
      term: SchoolTerm,
      schoolYear: string,
    ): Promise<IpcResult<ScheduleConflictRecord[]>>;
  };
  electives: {
    create(candidate: ElectiveGroupCandidate): Promise<IpcResult<ElectiveGroupDetails>>;
    get(id: number): Promise<IpcResult<ElectiveGroupDetails>>;
    list(filter: ScheduleFilter): Promise<IpcResult<ElectiveGroupDetails[]>>;
    addSection(groupId: number, sectionId: number): Promise<IpcResult<ElectiveGroupDetails>>;
    delete(id: number): Promise<IpcResult<{ deleted: true }>>;
  };
}

import type {
  ScheduleFilter,
  ScheduleCandidate,
  ScheduleValidation,
  SavedScheduleAssignment,
  ScheduleChangeSet,
  ScheduleChangeResult,
  SchoolTerm,
  ScheduleConflictRecord,
  ElectiveGroupCandidate,
  ElectiveGroupDetails,
} from "./schedule-types";
export type {
  ScheduleFilter,
  ScheduleCandidate,
  ScheduleValidation,
  SavedScheduleAssignment,
  ScheduleChangeSet,
  ScheduleChangeResult,
  SchoolTerm,
  ScheduleConflictRecord,
  ElectiveGroupCandidate,
  ElectiveGroupDetails,
};

import type {
  Teacher,
  Section,
  Subject,
  Room,
  BellSchedule,
  TimeSlot,
  NewTeacher,
  NewSection,
  NewSubject,
  NewRoom,
} from "../electron/db/repositories/types";
export type { Teacher, Section, Subject, Room, BellSchedule, TimeSlot };

export interface CrudApi<New, Row> {
  list(): Promise<IpcResult<Row[]>>;
  get(id: number): Promise<IpcResult<Row>>;
  create(input: New): Promise<IpcResult<Row>>;
  update(id: number, input: New): Promise<IpcResult<Row>>;
  delete(id: number): Promise<IpcResult<{ deleted: true }>>;
}

export interface CatalogSnapshot {
  revision: number;
  teachers: Teacher[];
  sections: Section[];
  subjects: Subject[];
  rooms: Room[];
  bellSchedules: BellSchedule[];
  timeSlots: TimeSlot[];
  settings: Record<string, string>;
}

export interface SchoolSettingsUpdate {
  expectedRevision: number;
  schoolName: string;
  schoolYear: string;
  preparedBy: string;
  schoolHead: string;
  reportSchoolName?: string;
  region?: string;
  division?: string;
  district?: string;
  schoolAddress?: string;
  preparedByTitle?: string;
  approvedByTitle?: string;
  thresholds: { underloadBelow: number; balancedMax: number };
}

export interface TeacherDraft {
  id: string;
  name: string;
  specialization: string;
  employmentType: NewTeacher["employment_type"];
  minHours: number;
  maxHours: number;
}
export interface SectionDraft {
  id: string;
  name: string;
  gradeLevel: number;
  schoolLevel: "JHS" | "SHS";
  adviser: string;
  bellScheduleId?: string;
}
export interface SubjectDraft {
  id: string;
  name: string;
  gradeLevel: number;
  minutesPerWeek: number;
}
export interface RoomDraft {
  id: string;
  name: string;
  capacity: number;
  type: NewRoom["type"];
}
export interface CatalogReplacement {
  expectedRevision: number;
  teachers: TeacherDraft[];
  sections: SectionDraft[];
  subjects: SubjectDraft[];
  rooms: RoomDraft[];
}
export interface CatalogApplyResult {
  revision: number;
  idMap: Record<string, string>;
  /** Optional committed snapshot; older desktop builds return only the revision and ID map. */
  snapshot?: CatalogSnapshot;
}
