import { validateAssignmentConflicts } from "@/lib/conflicts";
import { normalizeSchoolYear } from "../../shared/school-year";
import { buildImportPreview, importFields, normalizeImportName } from "@/lib/imports/importRecords";
import type { ImportRow, ImportTarget } from "@/lib/imports/importTypes";
import { SCHOOL_NAME, SCHOOL_REPORT_DEFAULTS } from "@/lib/schoolBrand";
import { toast } from "sonner";
import { schoolDataFromCatalog, catalogReplacementFromSchoolData } from "./catalogAdapter";
import {
  fromDatabaseAssignments,
  toDatabaseCandidate,
  scheduleDelta,
  mapScheduleResultIds,
} from "./scheduleAdapter";
import type { IpcResult, CatalogSnapshot, CatalogApplyResult } from "../../shared/electron-api";

export type Term = 1 | 2 | 3;
export type Day = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday";
export type EmploymentType = "Permanent" | "Contractual" | "Part-time";
export type RoomType = "Classroom" | "Laboratory" | "ICT room";

export interface Teacher {
  id: string;
  name: string;
  specialization: string;
  employmentType: EmploymentType;
  minHours: number;
  maxHours: number;
}

export interface Section {
  id: string;
  name: string;
  gradeLevel: number;
  adviser: string;
  schoolLevel: "JHS" | "SHS";
  /** The renderer's optional bell-profile selector; defaults from school level. */
  bellScheduleId?: string;
}

export interface Subject {
  id: string;
  name: string;
  gradeLevel: number;
  minutesPerWeek: number;
}

export interface Room {
  id: string;
  name: string;
  capacity: number;
  type: RoomType;
}

export interface TimeSlot {
  id: string;
  period: number;
  startTime: string;
  endTime: string;
  isBreak: boolean;
}

export interface BellSchedule {
  id: string;
  name: string;
  schoolLevel: "JHS" | "SHS";
}

export interface ProgramTimeSlot {
  id: string;
  bellScheduleId: string;
  kind: CatalogSnapshot["timeSlots"][number]["kind"];
  period: number | null;
  startTime: string;
  endTime: string;
  minutes: number;
}

export interface Assignment {
  id: string;
  term: Term;
  sectionId: string;
  subjectId: string;
  teacherId: string;
  roomId: string;
  day: Day;
  period: number;
  durationPeriods?: number;
  startTimeSlotId?: string;
  startMinute?: number;
  endMinute?: number;
}

export interface LoadThresholds {
  underloadBelow: number;
  balancedMax: number;
}

export interface SchoolSettings {
  schoolName: string;
  reportSchoolName?: string;
  schoolYear: string;
  preparedBy: string;
  schoolHead: string;
  region?: string;
  division?: string;
  district?: string;
  schoolAddress?: string;
  preparedByTitle?: string;
  approvedByTitle?: string;
  attestedBy?: string;
  attestedByTitle?: string;
  classAdviserLabel?: string;
  thresholds: LoadThresholds;
}

export interface SchoolData {
  teachers: Teacher[];
  sections: Section[];
  subjects: Subject[];
  rooms: Room[];
  timeSlots: TimeSlot[];
  bellSchedules?: BellSchedule[];
  programTimeSlots?: ProgramTimeSlot[];
  assignments: Assignment[];
  settings: SchoolSettings;
}

// Non-Electron browser preview remains a disposable in-memory demo. The
// installed desktop application NEVER writes school records to localStorage.

export const makeSampleData = (): SchoolData => ({
  teachers: [
    ["t1", "Maria Santos", "Mathematics", "Permanent", 18, 30],
    ["t2", "Jose Reyes", "Science", "Permanent", 18, 30],
    ["t3", "Ana Cruz", "English", "Permanent", 18, 30],
    ["t4", "Mark Dela Rosa", "Filipino", "Permanent", 18, 30],
    ["t5", "Liza Mendoza", "Araling Panlipunan", "Permanent", 18, 30],
    ["t6", "Carlo Garcia", "MAPEH", "Contractual", 18, 30],
    ["t7", "Joyce Ramos", "Mathematics", "Permanent", 18, 30],
    ["t8", "Paolo Flores", "Science", "Permanent", 18, 30],
    ["t9", "Rina Torres", "English", "Part-time", 12, 24],
    ["t10", "Nico Villanueva", "TLE", "Permanent", 18, 30],
    ["t11", "Cynthia Bautista", "Filipino", "Contractual", 18, 30],
    ["t12", "Ramon Navarro", "EsP", "Permanent", 18, 30],
  ].map(([id, name, specialization, employmentType, minHours, maxHours]) => ({
    id: String(id ?? ""),
    name: String(name ?? ""),
    specialization: String(specialization ?? ""),
    employmentType: (employmentType ?? "Permanent") as EmploymentType,
    minHours: Number(minHours),
    maxHours: Number(maxHours),
  })),
  sections: [
    ["s7-edge", "Grade 7 – Edge", 7, "Maria Santos"],
    ["s7-chrome", "Grade 7 – Chrome", 7, "Jose Reyes"],
    ["s8-edge", "Grade 8 – Edge", 8, "Ana Cruz"],
    ["s8-chrome", "Grade 8 – Chrome", 8, "Mark Dela Rosa"],
    ["s8-firefox", "Grade 8 – Firefox", 8, "Liza Mendoza"],
    ["s9-opera", "Grade 9 – Opera", 9, "Carlo Garcia"],
    ["s9-safari", "Grade 9 – Safari", 9, "Joyce Ramos"],
    ["s9-edge", "Grade 9 – Edge", 9, "Paolo Flores"],
    ["s10-chrome", "Grade 10 – Chrome", 10, "Rina Torres"],
    ["s10-firefox", "Grade 10 – Firefox", 10, "Nico Villanueva"],
  ].map(([id, name, gradeLevel, adviser]) => ({
    id: String(id ?? ""),
    name: String(name ?? ""),
    gradeLevel: Number(gradeLevel),
    adviser: String(adviser ?? ""),
    schoolLevel: "JHS" as const,
  })),
  subjects: [
    ["sub-math", "Mathematics", 7, 300],
    ["sub-sci", "Science", 7, 300],
    ["sub-eng", "English", 7, 300],
    ["sub-fil", "Filipino", 7, 240],
    ["sub-ap", "Araling Panlipunan", 7, 240],
    ["sub-mapeh", "MAPEH", 7, 240],
    ["sub-tle", "TLE", 7, 240],
    ["sub-esp", "Edukasyon sa Pagpapakatao", 7, 120],
    ["sub-research", "Research", 10, 180],
    ["sub-reading", "Reading and Literacy", 8, 180],
  ].map(([id, name, gradeLevel, minutesPerWeek]) => ({
    id: String(id ?? ""),
    name: String(name ?? ""),
    gradeLevel: Number(gradeLevel),
    minutesPerWeek: Number(minutesPerWeek),
  })),
  rooms: [
    ["r101", "Room 101", 40, "Classroom"],
    ["r102", "Room 102", 40, "Classroom"],
    ["r103", "Room 103", 40, "Classroom"],
    ["r104", "Room 104", 40, "Classroom"],
    ["r201", "Science Lab", 32, "Laboratory"],
    ["r202", "Computer Lab", 36, "ICT room"],
    ["r203", "TLE Workshop", 32, "Laboratory"],
    ["r105", "Room 105", 40, "Classroom"],
  ].map(([id, name, capacity, type]) => ({
    id: String(id ?? ""),
    name: String(name ?? ""),
    capacity: Number(capacity),
    type: (type ?? "Classroom") as RoomType,
  })),
  timeSlots: [
    [1, "07:30", "08:20", false],
    [2, "08:20", "09:10", false],
    [3, "09:10", "10:00", false],
    [4, "10:00", "10:50", false],
    [5, "10:50", "11:40", false],
    [6, "12:40", "13:30", false],
    [7, "13:30", "14:20", false],
    [8, "14:20", "15:10", false],
  ].map(([period, startTime, endTime, isBreak]) => ({
    id: `p${period}`,
    period: Number(period),
    startTime: String(startTime),
    endTime: String(endTime),
    isBreak: Boolean(isBreak),
  })),
  assignments: [
    {
      id: "a1",
      term: 1,
      sectionId: "s8-edge",
      subjectId: "sub-math",
      teacherId: "t1",
      roomId: "r101",
      day: "Monday",
      period: 1,
    },
    {
      id: "a2",
      term: 1,
      sectionId: "s8-chrome",
      subjectId: "sub-sci",
      teacherId: "t2",
      roomId: "r201",
      day: "Monday",
      period: 1,
    },
    {
      id: "a3",
      term: 1,
      sectionId: "s8-firefox",
      subjectId: "sub-eng",
      teacherId: "t3",
      roomId: "r102",
      day: "Monday",
      period: 1,
    },
    {
      id: "a4",
      term: 1,
      sectionId: "s9-opera",
      subjectId: "sub-fil",
      teacherId: "t4",
      roomId: "r103",
      day: "Monday",
      period: 1,
    },
    {
      id: "a5",
      term: 1,
      sectionId: "s9-safari",
      subjectId: "sub-math",
      teacherId: "t7",
      roomId: "r101",
      day: "Monday",
      period: 1,
    },
    {
      id: "a6",
      term: 1,
      sectionId: "s8-edge",
      subjectId: "sub-sci",
      teacherId: "t2",
      roomId: "r201",
      day: "Monday",
      period: 2,
    },
    {
      id: "a7",
      term: 1,
      sectionId: "s8-chrome",
      subjectId: "sub-eng",
      teacherId: "t3",
      roomId: "r102",
      day: "Monday",
      period: 2,
    },
    {
      id: "a8",
      term: 1,
      sectionId: "s8-edge",
      subjectId: "sub-math",
      teacherId: "t1",
      roomId: "r101",
      day: "Monday",
      period: 1,
    },
    {
      id: "a9",
      term: 1,
      sectionId: "s7-edge",
      subjectId: "sub-math",
      teacherId: "t1",
      roomId: "r104",
      day: "Tuesday",
      period: 1,
    },
    {
      id: "a10",
      term: 1,
      sectionId: "s7-chrome",
      subjectId: "sub-sci",
      teacherId: "t8",
      roomId: "r201",
      day: "Tuesday",
      period: 1,
    },
    {
      id: "a11",
      term: 1,
      sectionId: "s9-opera",
      subjectId: "sub-eng",
      teacherId: "t3",
      roomId: "r103",
      day: "Tuesday",
      period: 2,
    },
    {
      id: "a12",
      term: 1,
      sectionId: "s9-safari",
      subjectId: "sub-fil",
      teacherId: "t11",
      roomId: "r105",
      day: "Tuesday",
      period: 2,
    },
    {
      id: "a13",
      term: 1,
      sectionId: "s10-chrome",
      subjectId: "sub-research",
      teacherId: "t9",
      roomId: "r202",
      day: "Wednesday",
      period: 3,
    },
    {
      id: "a14",
      term: 1,
      sectionId: "s10-firefox",
      subjectId: "sub-tle",
      teacherId: "t10",
      roomId: "r203",
      day: "Wednesday",
      period: 3,
    },
    {
      id: "a15",
      term: 1,
      sectionId: "s8-firefox",
      subjectId: "sub-mapeh",
      teacherId: "t6",
      roomId: "r102",
      day: "Thursday",
      period: 2,
    },
    {
      id: "a16",
      term: 1,
      sectionId: "s9-edge",
      subjectId: "sub-esp",
      teacherId: "t12",
      roomId: "r104",
      day: "Thursday",
      period: 3,
    },
    {
      id: "a17",
      term: 2,
      sectionId: "s8-edge",
      subjectId: "sub-math",
      teacherId: "t1",
      roomId: "r101",
      day: "Monday",
      period: 1,
    },
    {
      id: "a18",
      term: 3,
      sectionId: "s8-edge",
      subjectId: "sub-sci",
      teacherId: "t2",
      roomId: "r201",
      day: "Monday",
      period: 1,
    },
  ],
  settings: {
    schoolName: SCHOOL_NAME,
    ...SCHOOL_REPORT_DEFAULTS,
    schoolYear: "2025-2026",
    preparedBy: "",
    schoolHead: "",
    thresholds: { underloadBelow: 18, balancedMax: 30 },
  },
});

let browserPreview = makeSampleData();
let loadedDesktopData: SchoolData | null = null;
let loadedCatalogSnapshot: CatalogSnapshot | null = null;
let revision: number | null = null;
let temporaryIds = new Map<string, string>();
let pendingCatalogWrite: Promise<void> = Promise.resolve();

function desktopApi() {
  return typeof window !== "undefined" ? window.api : undefined;
}

function take<T>(reply: IpcResult<T>): T {
  if (!reply.ok) throw new Error(`${reply.error.code}: ${reply.error.message}`);
  return reply.data;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function reportReadError(error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown database error";
  console.error("E-CLASS database error:", error);
  toast.error(`Unable to load school records: ${message}`);
}

/** Explicitly blank data if the SQLite database cannot be opened. Never
 * display 12 fictional teachers as if they came from a real school database.
 */
function blankSchoolData(): SchoolData {
  return {
    teachers: [],
    sections: [],
    subjects: [],
    rooms: [],
    timeSlots: [],
    assignments: [],
    settings: {
      schoolName: "",
      schoolYear: "2026-2027",
      preparedBy: "",
      schoolHead: "",
      thresholds: { underloadBelow: 18, balancedMax: 30 },
    },
  };
}

/** Reconstruct the committed catalog from the accepted write and returned IDs.
 * Older Electron versions return no snapshot, and a post-commit read might fail.
 */
function catalogAfterWrite(
  before: CatalogSnapshot,
  saved: SchoolData,
  nextRevision: number,
): CatalogSnapshot {
  const teachersById = new Map(saved.teachers.map((teacher) => [Number(teacher.id), teacher]));
  const teachersByName = new Map<string, Teacher[]>();
  for (const teacher of saved.teachers) {
    const key = normalizeImportName(teacher.name);
    teachersByName.set(key, [...(teachersByName.get(key) ?? []), teacher]);
  }
  return {
    ...before,
    revision: nextRevision,
    teachers: saved.teachers.map((teacher) => ({
      id: Number(teacher.id), name: teacher.name, name_key: normalizeImportName(teacher.name),
      specialization: teacher.specialization, employment_type: teacher.employmentType,
      min_hours: teacher.minHours, max_hours: teacher.maxHours,
    })),
    sections: saved.sections.map((section) => {
      const existing = before.sections.find((row) => String(row.id) === section.id);
      const bell = before.bellSchedules.find((row) => row.name === (section.schoolLevel === "JHS" ? "JHS-50-A" : "SHS-60"))
        ?? before.bellSchedules.find((row) => row.school_level === section.schoolLevel);
      const adviserKey = normalizeImportName(section.adviser);
      const existingAdviser = existing?.adviser_teacher_id == null
        ? undefined : before.teachers.find((teacher) => teacher.id === existing.adviser_teacher_id);
      const matches = teachersByName.get(adviserKey) ?? [];
      // The backend retains the pre-write adviser identity when a teacher is
      // renamed while the section still contains that teacher's old name.
      const adviserId = matches.length === 1 ? Number(matches[0]!.id)
        : existingAdviser && teachersById.has(existingAdviser.id) && normalizeImportName(existingAdviser.name) === adviserKey
          ? existingAdviser.id : null;
      return {
        id: Number(section.id), name: section.name, grade_level: section.gradeLevel,
        school_level: section.schoolLevel,
        bell_schedule_id: Number(section.bellScheduleId ?? existing?.bell_schedule_id ?? bell?.id ?? 0),
        adviser_teacher_id: adviserKey ? adviserId : null,
      };
    }),
    subjects: saved.subjects.map((subject) => ({
      id: Number(subject.id), name: subject.name, name_key: normalizeImportName(subject.name),
      grade_level: subject.gradeLevel, minutes_per_week: subject.minutesPerWeek,
    })),
    rooms: saved.rooms.map((room) => ({
      id: Number(room.id), name: room.name, capacity: room.capacity, type: room.type,
    })),
  };
}

/** Prepare every part of the next cache before replacing committed state. */
function committedCatalog(
  before: CatalogSnapshot,
  submitted: SchoolData,
  accepted: CatalogApplyResult,
  assignments: Assignment[],
) {
  const ids = new Map(temporaryIds);
  for (const [temporary, saved] of Object.entries(accepted.idMap)) ids.set(temporary, saved);
  const resolve = <T extends { id: string }>(rows: T[]) =>
    rows.map((row) => ({ ...row, id: ids.get(row.id) ?? row.id }));
  const resolved = {
    ...submitted,
    teachers: resolve(submitted.teachers), sections: resolve(submitted.sections),
    subjects: resolve(submitted.subjects), rooms: resolve(submitted.rooms),
  };
  const snapshot = structuredClone(accepted.snapshot ?? catalogAfterWrite(before, resolved, accepted.revision));
  const data = { ...schoolDataFromCatalog(snapshot), assignments: structuredClone(assignments) };
  return { ids, snapshot, data, revision: accepted.revision };
}

function installCommittedCatalog(committed: ReturnType<typeof committedCatalog>): SchoolData {
  const returned = structuredClone(committed.data);
  temporaryIds = committed.ids;
  loadedCatalogSnapshot = committed.snapshot;
  loadedDesktopData = committed.data;
  revision = committed.revision;
  return returned;
}

export const dataService = {
  /** Apply the installation's school name to a blank SQLite profile only.
   * This operation is serialized with catalog writes and is idempotent. */
  ensureSchoolName(): Promise<SchoolData | null> {
    const operation = pendingCatalogWrite.then(async () => {
      const desktop = desktopApi();
      if (!desktop) return null;
      if (!loadedDesktopData || revision === null || !loadedCatalogSnapshot)
        throw new Error("School data must finish loading before setting the school name.");
      if (loadedDesktopData.settings.schoolName.trim()) return structuredClone(loadedDesktopData);
      const current = take(await desktop.catalog.ensureSchoolName(SCHOOL_NAME));
      const previous = loadedDesktopData;
      loadedCatalogSnapshot = current;
      revision = current.revision;
      loadedDesktopData = {
        ...schoolDataFromCatalog(current),
        assignments: previous.assignments,
      };
      return structuredClone(loadedDesktopData);
    });
    pendingCatalogWrite = operation.then(() => undefined, () => undefined);
    return operation;
  },
  async getAll(): Promise<SchoolData> {
    if (!desktopApi()) return structuredClone(browserPreview);
    try {
      // A read after a page-level write must not race the queued transaction.
      await pendingCatalogWrite;
      const snapshot = take(await desktopApi()!.catalog.snapshot());
      const rows = take(
        await desktopApi()!.schedule.list({
          schoolYear: snapshot.settings["school_year"] ?? "2026-2027",
        }),
      );
      loadedCatalogSnapshot = snapshot;
      loadedDesktopData = {
        ...schoolDataFromCatalog(snapshot),
        assignments: fromDatabaseAssignments(rows, snapshot),
      };
      revision = snapshot.revision;
      return structuredClone(loadedDesktopData);
    } catch (error) {
      revision = null;
      loadedDesktopData = null;
      loadedCatalogSnapshot = null;
      reportReadError(error);
      return blankSchoolData();
    }
  },

  /** Commit an import as one validated catalog transaction, without a
   * second database read that could make a successful write look failed.
   */
  importCatalog(target: ImportTarget, sources: ImportRow[]): Promise<SchoolData> {
    const operation = pendingCatalogWrite.then(async () => {
      const desktop = desktopApi();
      const base = desktop ? loadedDesktopData : browserPreview;
      if (!base || (desktop && (revision === null || !loadedCatalogSnapshot)))
        throw new Error("School data has not loaded. Refresh before importing.");

      const fields = Object.fromEntries(importFields[target].map((field) => [field.key, field.key]));
      const preview = buildImportPreview(target, sources, fields, base);
      if (preview.issues.length)
        throw new Error(preview.issues.map((issue) => issue.message).join(" "));
      if (!preview.additions.length) return structuredClone(base);

      const batchId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const added = preview.additions.map((row, index) => ({
        ...row, id: `${target}-import-${batchId}-${index}`,
      }));
      const next = {
        ...base,
        [target]: [...base[target], ...added],
      } as SchoolData;
      if (!desktop) {
        browserPreview = structuredClone(next);
        return structuredClone(browserPreview);
      }

      const payload = catalogReplacementFromSchoolData(
        next, revision!, (id) => temporaryIds.get(id) ?? id,
      );
      const accepted = take(await desktop.catalog.applySnapshot(payload));
      return installCommittedCatalog(committedCatalog(loadedCatalogSnapshot!, next, accepted, base.assignments));
    });
    pendingCatalogWrite = operation.then(() => undefined, () => undefined);
    return operation;
  },

  async saveAll(next: SchoolData): Promise<SchoolData> {
    if (!desktopApi()) {
      browserPreview = structuredClone(next);
      browserPreview.settings.schoolYear = normalizeSchoolYear(browserPreview.settings.schoolYear);
      return structuredClone(browserPreview);
    }
    // Serialize snapshots so later edits see the latest committed IDs and revision.
    const submitted = structuredClone(next);
    const operation = pendingCatalogWrite.then(async () => {
      if (revision === null || !loadedDesktopData || !loadedCatalogSnapshot)
        throw new Error("School data has not loaded. Refresh before editing.");
      if (
        !same(submitted.timeSlots, loadedDesktopData.timeSlots) ||
        !same(submitted.settings, loadedDesktopData.settings)
      ) {
        throw new Error(
          "Bell slots and school settings are not writable until their later implementation steps.",
        );
      }
      const payload = catalogReplacementFromSchoolData(
        submitted,
        revision,
        (id) => temporaryIds.get(id) ?? id,
      );
      const oldPayload = catalogReplacementFromSchoolData(
        loadedDesktopData,
        revision,
        (id) => temporaryIds.get(id) ?? id,
      );
      const catalogChanged = !same(
        [payload.teachers, payload.sections, payload.subjects, payload.rooms],
        [oldPayload.teachers, oldPayload.sections, oldPayload.subjects, oldPayload.rooms],
      );
      const { changes, createdIds } = scheduleDelta(
        loadedDesktopData.assignments,
        submitted.assignments,
        loadedDesktopData,
        loadedCatalogSnapshot,
        (id) => temporaryIds.get(id) ?? id,
      );
      const scheduleChanged =
        changes.creates.length > 0 || changes.updates.length > 0 || changes.deletes.length > 0;
      if (catalogChanged && scheduleChanged)
        throw new Error(
          "Save catalog changes and schedule changes separately to avoid partial updates.",
        );
      if (catalogChanged) {
        const changed = take(await desktopApi()!.catalog.applySnapshot(payload));
        return installCommittedCatalog(committedCatalog(loadedCatalogSnapshot, submitted, changed, loadedDesktopData.assignments));
      }
      if (scheduleChanged) {
        const result = take(await desktopApi()!.schedule.applyChanges(changes));
        const ids = new Map(temporaryIds);
        mapScheduleResultIds(createdIds, result, ids);
        const authoritative = new Map([
          ...loadedDesktopData.assignments,
          ...fromDatabaseAssignments([...result.created, ...result.updated], loadedCatalogSnapshot),
        ].map((row) => [row.id, row]));
        const deleted = new Set(result.deleted.map(String));
        const assignments = submitted.assignments
          .map((row) => authoritative.get(ids.get(row.id) ?? row.id)!)
          .filter((row) => row && !deleted.has(row.id));
        const data = { ...loadedDesktopData, assignments: structuredClone(assignments) };
        const returned = structuredClone(data);
        temporaryIds = ids;
        loadedDesktopData = data;
        return returned;
      }
      return structuredClone(loadedDesktopData);
    });
    pendingCatalogWrite = operation.then(() => undefined, () => undefined);
    return operation;
  },

  async getTeachers(): Promise<Teacher[]> {
    return (await dataService.getAll()).teachers;
  },
  async getSections(): Promise<Section[]> {
    return (await dataService.getAll()).sections;
  },
  async getSubjects(): Promise<Subject[]> {
    return (await dataService.getAll()).subjects;
  },
  async getRooms(): Promise<Room[]> {
    return (await dataService.getAll()).rooms;
  },
  async getTimeSlots(): Promise<TimeSlot[]> {
    return (await dataService.getAll()).timeSlots;
  },
  async getSchedule(term?: Term): Promise<Assignment[]> {
    const assignments = (await dataService.getAll()).assignments;
    return term ? assignments.filter((a) => a.term === term) : assignments;
  },

  async saveAssignment(assignment: Assignment): Promise<SchoolData> {
    const next = await dataService.getAll();
    const index = next.assignments.findIndex((a) => a.id === assignment.id);
    if (index < 0) next.assignments.push(assignment);
    else next.assignments[index] = assignment;
    return dataService.saveAll(next);
  },
  async deleteAssignment(id: string): Promise<SchoolData> {
    const next = await dataService.getAll();
    next.assignments = next.assignments.filter((a) => a.id !== id);
    return dataService.saveAll(next);
  },
  async validateAssignment(assignment: Assignment): Promise<string[]> {
    if (desktopApi()) {
      if (!loadedDesktopData || !loadedCatalogSnapshot) await dataService.getAll();
      if (!loadedDesktopData || !loadedCatalogSnapshot)
        throw new Error("School data must load before scheduling.");
      let candidate: ReturnType<typeof toDatabaseCandidate>;
      try {
        candidate = toDatabaseCandidate(
          assignment,
          loadedDesktopData,
          loadedCatalogSnapshot,
          (id) => temporaryIds.get(id) ?? id,
        );
      } catch (error) {
        // Invalid period/profile is a domain issue the user can correct.
        return [error instanceof Error ? error.message : "Schedule validation failed."];
      }
      const excludeId = /^[1-9]\d*$/.test(temporaryIds.get(assignment.id) ?? assignment.id)
        ? Number(temporaryIds.get(assignment.id) ?? assignment.id)
        : undefined;
      // Unavailable IPC/SQLite is infrastructure failure, not a conflict.
      const result = take(await desktopApi()!.schedule.validate(candidate, excludeId));
      return result.conflicts.map((conflict) => conflict.message);
    }
    const data = await dataService.getAll();
    return validateAssignmentConflicts(assignment, data.assignments, data);
  },
  saveSettings(settings: SchoolSettings): Promise<SchoolData> {
    const request = { ...structuredClone(settings), schoolYear: normalizeSchoolYear(settings.schoolYear) };
    const operation = pendingCatalogWrite.then(async () => {
      if (!desktopApi()) {
        const definedSettings = Object.fromEntries(
          Object.entries(request).filter(([, value]) => value !== undefined),
        ) as Partial<SchoolSettings>;
        browserPreview = { ...browserPreview, settings: { ...browserPreview.settings, ...definedSettings } };
        return structuredClone(browserPreview);
      }
      if (revision === null || !loadedCatalogSnapshot || !loadedDesktopData)
        throw new Error("School data has not loaded. Refresh before changing settings.");
      const changed = take(await desktopApi()!.catalog.saveSettings({
        expectedRevision: revision,
        schoolName: request.schoolName,
        schoolYear: request.schoolYear,
        preparedBy: request.preparedBy,
        schoolHead: request.schoolHead,
        ...(request.reportSchoolName !== undefined ? { reportSchoolName: request.reportSchoolName } : {}),
        ...(request.region !== undefined ? { region: request.region } : {}),
        ...(request.division !== undefined ? { division: request.division } : {}),
        ...(request.district !== undefined ? { district: request.district } : {}),
        ...(request.schoolAddress !== undefined ? { schoolAddress: request.schoolAddress } : {}),
        ...(request.preparedByTitle !== undefined ? { preparedByTitle: request.preparedByTitle } : {}),
        ...(request.approvedByTitle !== undefined ? { approvedByTitle: request.approvedByTitle } : {}),
        thresholds: request.thresholds,
      }));
      const previous = loadedDesktopData;
      loadedCatalogSnapshot = changed;
      revision = changed.revision;
      let assignments = previous.assignments;
      if (normalizeSchoolYear(previous.settings.schoolYear) !== normalizeSchoolYear(changed.settings["school_year"] ?? request.schoolYear)) {
        try {
          const rows = take(await desktopApi()!.schedule.list({
            schoolYear: changed.settings["school_year"] ?? request.schoolYear,
          }));
          assignments = fromDatabaseAssignments(rows, changed);
        } catch (error) {
          // Settings have already committed. Do not report a failed save or
          // display assignments from the wrong academic year.
          assignments = [];
          console.error("Unable to reload schedules after changing school year:", error);
          toast.error("Settings saved, but schedules for this year could not be loaded.");
        }
      }
      loadedDesktopData = {
        ...schoolDataFromCatalog(changed),
        assignments,
      };
      return structuredClone(loadedDesktopData);
    });
    pendingCatalogWrite = operation.then(() => undefined, () => undefined);
    return operation;
  },
  async reset(): Promise<SchoolData> {
    if (desktopApi()) throw new Error("Sample-data reset will be implemented in Step 8.");
    browserPreview = makeSampleData();
    return structuredClone(browserPreview);
  },
};
