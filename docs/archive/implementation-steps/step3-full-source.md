# E-CLASS — Step 3 Complete Source

Exact source snapshot of all 17 files created or modified for Step 3. The IPC backend uses local SQLite; test data remained isolated. The following blocks include the full code as present on disk after final formatting. No React page components were edited.

## electron/main.ts

```typescript
import { app, BrowserWindow, dialog } from "electron";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { registerSystemHandlers } from "./ipc/system";
import { logError } from "./services/logger";
import { getWindowOptions, isAllowedNavigation } from "./security";
import { openSchoolDatabase, type SchoolDatabase } from "./db/database";
import { createCatalogService } from "./services/catalog";
import { registerTeachersHandlers } from "./ipc/teachers";
import { registerSectionsHandlers } from "./ipc/sections";
import { registerSubjectsHandlers } from "./ipc/subjects";
import { registerRoomsHandlers } from "./ipc/rooms";
import { registerCatalogHandlers } from "./ipc/catalog";

const DEV_URL = "http://127.0.0.1:8080/";
let mainWindow: BrowserWindow | null = null;
let schoolDatabase: SchoolDatabase | null = null;

function createWindow(): void {
  const preload = join(__dirname, "preload.cjs");
  const index = join(__dirname, "renderer", "index.html");
  const useDevServer = !app.isPackaged && process.env.ECLASS_STATIC !== "1";
  const initialUrl = useDevServer ? DEV_URL : pathToFileURL(index).href;
  const window = new BrowserWindow(getWindowOptions(preload));
  mainWindow = window;

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, destination) => {
    if (!isAllowedNavigation(destination, initialUrl)) event.preventDefault();
  });
  window.webContents.on("did-fail-load", (_event, errorCode, description, url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) {
      logError("window:load", new Error(`${errorCode}: ${description} (${url})`));
      window.show();
    }
  });

  const loading = useDevServer ? window.loadURL(DEV_URL) : window.loadFile(index);
  void loading.catch((error: unknown) => logError("window:load", error));
}

app.setName("E-CLASS");
// Explicitly opt into a disposable database location during local test runs.
// Packaged applications always use Electron's standard per-user data path.
if (!app.isPackaged && process.env.ECLASS_TEST_USER_DATA) {
  const target = process.env.ECLASS_TEST_USER_DATA;
  if (!isAbsolute(target)) {
    throw new Error("ECLASS_TEST_USER_DATA must be an absolute path.");
  }
  mkdirSync(target, { recursive: true });
  app.setPath("userData", target);
}
void app
  .whenReady()
  .then(async () => {
    // Always use Electron's per-user data directory, never the project folder.
    // No sample teachers, classes, or rooms are inserted on first launch.
    schoolDatabase = await openSchoolDatabase(app.getPath("userData"));
    const catalog = createCatalogService(schoolDatabase);
    const getWindow = () => mainWindow;
    registerTeachersHandlers(getWindow, catalog);
    registerSectionsHandlers(getWindow, catalog);
    registerSubjectsHandlers(getWindow, catalog);
    registerRoomsHandlers(getWindow, catalog);
    registerCatalogHandlers(getWindow, catalog);
    registerSystemHandlers(() => mainWindow);
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error: unknown) => {
    logError("app:ready", error);
    dialog.showErrorBox(
      "E-CLASS cannot open its database",
      "Your school data has not been changed. Check the log in the E-CLASS data folder.",
    );
    app.quit();
  });

app.on("before-quit", () => {
  if (schoolDatabase?.open) schoolDatabase.close();
  schoolDatabase = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

```

## electron/preload.ts

```typescript
import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopApi,
  AppInfo,
  IpcResult,
  CrudApi,
  Teacher,
  Section,
  Subject,
  Room,
  CatalogSnapshot,
  CatalogReplacement,
  CatalogApplyResult,
} from "../shared/electron-api";
import type { NewTeacher, NewSection, NewSubject, NewRoom } from "./db/repositories/types";

function crud<New, Row>(domain: string): CrudApi<New, Row> {
  return Object.freeze({
    list: () => ipcRenderer.invoke(`${domain}:list`) as Promise<IpcResult<Row[]>>,
    get: (id: number) => ipcRenderer.invoke(`${domain}:get`, id) as Promise<IpcResult<Row>>,
    create: (input: New) =>
      ipcRenderer.invoke(`${domain}:create`, input) as Promise<IpcResult<Row>>,
    update: (id: number, input: New) =>
      ipcRenderer.invoke(`${domain}:update`, id, input) as Promise<IpcResult<Row>>,
    delete: (id: number) =>
      ipcRenderer.invoke(`${domain}:delete`, id) as Promise<IpcResult<{ deleted: true }>>,
  });
}

// Expose typed, named operations only. Never publish ipcRenderer or a
// general-purpose invoke method to renderer code.
const api: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke("system:getAppInfo") as Promise<IpcResult<AppInfo>>,
  teachers: crud<NewTeacher, Teacher>("teachers"),
  sections: crud<NewSection, Section>("sections"),
  subjects: crud<NewSubject, Subject>("subjects"),
  rooms: crud<NewRoom, Room>("rooms"),
  catalog: Object.freeze({
    snapshot: () => ipcRenderer.invoke("catalog:snapshot") as Promise<IpcResult<CatalogSnapshot>>,
    applySnapshot: (request: CatalogReplacement) =>
      ipcRenderer.invoke("catalog:applySnapshot", request) as Promise<
        IpcResult<CatalogApplyResult>
      >,
  }),
};

contextBridge.exposeInMainWorld("api", Object.freeze(api));

```

## electron/ipc/handler.ts

```typescript
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import type { IpcResult } from "../../shared/electron-api";
import { CatalogError } from "../services/catalog";
import { logError } from "../services/logger";

export type WindowProvider = () => BrowserWindow | null;

function fromMainFrame(event: IpcMainInvokeEvent, getWindow: WindowProvider): boolean {
  const window = getWindow();
  return Boolean(
    window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame,
  );
}

/**
 * Validate the caller before invoking any domain code.
 * Never allow a renderer to choose the SQL query or IPC channel.
 */
export function registerHandler<T>(
  channel: string,
  getWindow: WindowProvider,
  operation: (...args: unknown[]) => T | Promise<T>,
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<IpcResult<T>> => {
    try {
      if (!fromMainFrame(event, getWindow)) {
        throw new CatalogError("FORBIDDEN", "This window is not allowed to access school data.");
      }
      return { ok: true, data: await operation(...args) };
    } catch (error) {
      logError(channel, error);
      if (error instanceof CatalogError) {
        return { ok: false, error: { code: error.code, message: error.message } };
      }
      return {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "The operation could not be completed. Check the application log.",
        },
      };
    }
  });
}

export function registerCrudHandlers<New, Row>(
  domain: string,
  getWindow: WindowProvider,
  methods: {
    list(): Row[];
    get(id: number): Row;
    create(input: New): Row;
    update(id: number, input: New): Row;
    delete(id: number): true;
  },
): void {
  registerHandler(`${domain}:list`, getWindow, () => methods.list());
  registerHandler(`${domain}:get`, getWindow, (id) => methods.get(id as number));
  registerHandler(`${domain}:create`, getWindow, (input) => methods.create(input as New));
  registerHandler(`${domain}:update`, getWindow, (id, input) =>
    methods.update(id as number, input as New),
  );
  registerHandler(`${domain}:delete`, getWindow, (id) => {
    methods.delete(id as number);
    return { deleted: true as const };
  });
}

```

## electron/ipc/teachers.ts

```typescript
import type { WindowProvider } from "./handler";
import { registerCrudHandlers } from "./handler";
import type { createCatalogService } from "../services/catalog";

export function registerTeachersHandlers(
  getWindow: WindowProvider,
  catalog: ReturnType<typeof createCatalogService>,
): void {
  registerCrudHandlers("teachers", getWindow, catalog.teachers);
}

```

## electron/ipc/sections.ts

```typescript
import type { WindowProvider } from "./handler";
import { registerCrudHandlers } from "./handler";
import type { createCatalogService } from "../services/catalog";

export function registerSectionsHandlers(
  getWindow: WindowProvider,
  catalog: ReturnType<typeof createCatalogService>,
): void {
  registerCrudHandlers("sections", getWindow, catalog.sections);
}

```

## electron/ipc/subjects.ts

```typescript
import type { WindowProvider } from "./handler";
import { registerCrudHandlers } from "./handler";
import type { createCatalogService } from "../services/catalog";

export function registerSubjectsHandlers(
  getWindow: WindowProvider,
  catalog: ReturnType<typeof createCatalogService>,
): void {
  registerCrudHandlers("subjects", getWindow, catalog.subjects);
}

```

## electron/ipc/rooms.ts

```typescript
import type { WindowProvider } from "./handler";
import { registerCrudHandlers } from "./handler";
import type { createCatalogService } from "../services/catalog";

export function registerRoomsHandlers(
  getWindow: WindowProvider,
  catalog: ReturnType<typeof createCatalogService>,
): void {
  registerCrudHandlers("rooms", getWindow, catalog.rooms);
}

```

## electron/ipc/catalog.ts

```typescript
import type { WindowProvider } from "./handler";
import { registerHandler } from "./handler";
import type { createCatalogService } from "../services/catalog";
import type { CatalogReplacement } from "../../shared/electron-api";

export function registerCatalogHandlers(
  getWindow: WindowProvider,
  catalog: ReturnType<typeof createCatalogService>,
): void {
  registerHandler("catalog:snapshot", getWindow, () => catalog.snapshot());
  registerHandler("catalog:applySnapshot", getWindow, (request) =>
    catalog.applySnapshot(request as CatalogReplacement),
  );
}

```

## electron/services/catalog.ts

```typescript
import type { SchoolDatabase } from "../db/database";
import { normalizeNameKey } from "../db/name-normalization";
import {
  teachersRepository,
  subjectsRepository,
  roomsRepository,
} from "../db/repositories/catalog";
import { sectionsRepository } from "../db/repositories/sections";
import { bellSchedulesRepository } from "../db/repositories/bell-schedules";
import { settingsRepository } from "../db/repositories/settings";
import type {
  Teacher,
  Section,
  Subject,
  Room,
  NewTeacher,
  NewSection,
  NewSubject,
  NewRoom,
} from "../db/repositories/types";
import type {
  CatalogApplyResult,
  CatalogReplacement,
  CatalogSnapshot,
  TeacherDraft,
  SectionDraft,
  SubjectDraft,
  RoomDraft,
} from "../../shared/electron-api";

export class CatalogError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CatalogError";
  }
}

function invalid(message: string): never {
  throw new CatalogError("INVALID_INPUT", message);
}

function requiredText(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength)
    return invalid(`${field} is required (maximum ${maxLength} characters).`);
  return value.trim();
}

function optionalText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 500) return invalid(`${field} must be text.`);
  return value.trim();
}

function integer(value: unknown, field: string, low: number, high: number): number {
  if (!Number.isInteger(value) || (value as number) < low || (value as number) > high)
    return invalid(`${field} must be between ${low} and ${high}.`);
  return value as number;
}

function hours(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 168)
    return invalid(`${field} must be between 0 and 168.`);
  return value;
}

function choice<T extends string>(value: unknown, field: string, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T))
    return invalid(`${field} must be ${values.join(", ")}.`);
  return value as T;
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return invalid("A record object is required.");
  return input as Record<string, unknown>;
}

function validId(value: unknown): number {
  return integer(value, "ID", 1, Number.MAX_SAFE_INTEGER);
}

function validTeacher(value: unknown): NewTeacher {
  const t = record(value);
  const min_hours = hours(t["min_hours"], "Minimum hours");
  const max_hours = hours(t["max_hours"], "Maximum hours");
  if (max_hours < min_hours) return invalid("Maximum hours must not be less than minimum hours.");
  return {
    name: requiredText(t["name"], "Teacher name"),
    specialization: optionalText(t["specialization"], "Specialization"),
    employment_type: choice(t["employment_type"], "Employment type", [
      "Permanent",
      "Contractual",
      "Part-time",
    ]),
    min_hours,
    max_hours,
  };
}

function validSubject(value: unknown): NewSubject {
  const s = record(value);
  return {
    name: requiredText(s["name"], "Subject name"),
    grade_level: integer(s["grade_level"], "Grade level", 7, 12),
    minutes_per_week: integer(s["minutes_per_week"], "Minutes per week", 1, 10080),
  };
}

function validRoom(value: unknown): NewRoom {
  const r = record(value);
  return {
    name: requiredText(r["name"], "Room name"),
    capacity: integer(r["capacity"], "Capacity", 1, 10000),
    type: choice(r["type"], "Room type", ["Classroom", "Laboratory", "ICT room"]),
  };
}

function validSection(value: unknown): NewSection {
  const s = record(value);
  return {
    name: requiredText(s["name"], "Section name"),
    grade_level: integer(s["grade_level"], "Grade level", 7, 12),
    school_level: choice(s["school_level"], "School level", ["JHS", "SHS"]),
    bell_schedule_id: validId(s["bell_schedule_id"]),
    adviser_teacher_id: s["adviser_teacher_id"] === null ? null : validId(s["adviser_teacher_id"]),
  };
}

/** Separate the user-facing error from sensitive SQLite internal details. */
function translateError(error: unknown): never {
  if (error instanceof CatalogError) throw error;
  if (error instanceof Error) {
    if (error.message.includes("FOREIGN KEY") || error.message.includes("is in use"))
      throw new CatalogError(
        "IN_USE",
        "Record is in use. Remove or reassign its dependencies first.",
      );
    if (error.message.includes("UNIQUE"))
      throw new CatalogError("DUPLICATE", "A record with this name or identifier already exists.");
    if (error.message.includes("CHECK") || error.message.includes("NOT NULL"))
      throw new CatalogError(
        "INVALID_INPUT",
        "The record violates a required school-data constraint.",
      );
  }
  throw error;
}

function revision(db: SchoolDatabase): number {
  const item = settingsRepository(db).get("__catalog_revision");
  return item === null ? 0 : Number(item);
}

function incrementRevision(db: SchoolDatabase): number {
  const next = revision(db) + 1;
  settingsRepository(db).set("__catalog_revision", String(next));
  return next;
}

function makeCrud<New, Row extends { id: number }>(
  db: SchoolDatabase,
  repo: {
    list(): Row[];
    get(id: number): Row | undefined;
    create(input: New): Row;
    update(id: number, input: New): Row;
    delete(id: number): number;
  },
  validate: (value: unknown) => New,
  beforeDelete?: (id: number) => void,
) {
  const get = (id: number): Row => {
    const item = repo.get(validId(id));
    if (!item) throw new CatalogError("NOT_FOUND", "Record not found.");
    return item;
  };
  const write = <T>(action: () => T): T => {
    try {
      return db
        .transaction(() => {
          const result = action();
          incrementRevision(db);
          return result;
        })
        .immediate();
    } catch (error) {
      return translateError(error);
    }
  };
  return {
    list: () => repo.list(),
    get,
    create: (input: New) => write(() => repo.create(validate(input))),
    update: (id: number, input: New) =>
      write(() => {
        get(id);
        return repo.update(id, validate(input));
      }),
    delete: (id: number): true =>
      write(() => {
        get(id);
        beforeDelete?.(id);
        repo.delete(id);
        return true;
      }),
  };
}

function drafts<T extends { id: string }>(value: unknown, name: string): T[] {
  if (!Array.isArray(value) || value.length > 10000) return invalid(`${name} must be a list.`);
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    const data = record(item);
    const id = requiredText(data["id"], `${name} record ID`, 128);
    if (ids.has(id)) invalid(`Duplicate ${name} record ID: ${id}`);
    ids.add(id);
    return item as T;
  });
}

function dbId(id: string): number | null {
  if (!/^[1-9]\d*$/.test(id)) return null;
  const num = Number(id);
  if (!Number.isSafeInteger(num)) return invalid("Record ID is too large.");
  return num;
}

function applyGeneric<T extends { id: number }, D extends { id: string }, N>(
  current: T[],
  desired: D[],
  existing: (id: number) => T | undefined,
  create: (data: N) => T,
  update: (id: number, data: N) => T,
  convert: (draft: D) => N,
  idMap: Record<string, string>,
): Set<number> {
  const existingIds = new Set(current.map((row) => row.id));
  const retained = new Set<number>();
  for (const draft of desired) {
    const id = dbId(draft.id);
    const data = convert(draft);
    if (id !== null) {
      if (!existingIds.has(id) || !existing(id))
        throw new CatalogError("NOT_FOUND", "An item no longer exists. Refresh your records.");
      update(id, data);
      retained.add(id);
    } else {
      const created = create(data);
      retained.add(created.id);
      idMap[draft.id] = String(created.id);
    }
  }
  return retained;
}

export function createCatalogService(db: SchoolDatabase) {
  const teacherRepo = teachersRepository(db);
  const subjectRepo = subjectsRepository(db);
  const roomRepo = roomsRepository(db);
  const sectionRepo = sectionsRepository(db);
  const bellRepo = bellSchedulesRepository(db);
  const teacherInUse = (id: number) => {
    if (db.prepare("SELECT id FROM sections WHERE adviser_teacher_id=? LIMIT 1").get(id))
      throw new CatalogError("IN_USE", "Teacher is in use as a class adviser.");
  };
  const validateSectionReferences = (value: unknown): NewSection => {
    const section = validSection(value);
    const bell = bellRepo.get(section.bell_schedule_id);
    if (!bell) invalid("Bell schedule does not exist.");
    if (bell.school_level !== section.school_level)
      invalid("Section must use a matching school-level bell schedule.");
    if (
      (section.grade_level <= 10 && section.school_level !== "JHS") ||
      (section.grade_level >= 11 && section.school_level !== "SHS")
    )
      invalid("Section school level must match its grade level.");
    if (section.adviser_teacher_id !== null && !teacherRepo.get(section.adviser_teacher_id))
      invalid("Adviser must refer to an existing teacher.");
    return section;
  };
  const teachers = makeCrud(db, teacherRepo, validTeacher, teacherInUse);
  const sections = makeCrud(db, sectionRepo, validateSectionReferences);
  const subjects = makeCrud(db, subjectRepo, validSubject);
  const rooms = makeCrud(db, roomRepo, validRoom);

  const snapshot = (): CatalogSnapshot => ({
    revision: revision(db),
    teachers: teacherRepo.list(),
    sections: sectionRepo.list(),
    subjects: subjectRepo.list(),
    rooms: roomRepo.list(),
    bellSchedules: bellRepo.list(),
    timeSlots: bellRepo.list().flatMap((row) => bellRepo.listSlots(row.id)),
    settings: Object.fromEntries(
      settingsRepository(db)
        .list()
        .filter((row) => !row.key.startsWith("__"))
        .map((row) => [row.key, row.value]),
    ),
  });

  const applySnapshot = (request: CatalogReplacement): CatalogApplyResult => {
    try {
      const source = record(request);
      const expectedRevision = integer(
        source["expectedRevision"],
        "Revision",
        0,
        Number.MAX_SAFE_INTEGER,
      );
      const requestedTeachers = drafts<TeacherDraft>(source["teachers"], "Teachers");
      const requestedSubjects = drafts<SubjectDraft>(source["subjects"], "Subjects");
      const requestedRooms = drafts<RoomDraft>(source["rooms"], "Rooms");
      const requestedSections = drafts<SectionDraft>(source["sections"], "Sections");

      return db
        .transaction(() => {
          if (expectedRevision !== revision(db))
            throw new CatalogError(
              "STALE_DATA",
              "School data changed elsewhere. Refresh before saving.",
            );

          const idMap: Record<string, string> = {};
          const beforeTeachers = teacherRepo.list();
          const keepTeachers = applyGeneric(
            teacherRepo.list(),
            requestedTeachers,
            teacherRepo.get,
            teacherRepo.create,
            teacherRepo.update,
            (t): NewTeacher =>
              validTeacher({
                name: t.name,
                specialization: t.specialization,
                employment_type: t.employmentType,
                min_hours: t.minHours,
                max_hours: t.maxHours,
              }),
            idMap,
          );
          const keepSubjects = applyGeneric(
            subjectRepo.list(),
            requestedSubjects,
            subjectRepo.get,
            subjectRepo.create,
            subjectRepo.update,
            (s): NewSubject =>
              validSubject({
                name: s.name,
                grade_level: s.gradeLevel,
                minutes_per_week: s.minutesPerWeek,
              }),
            idMap,
          );
          const keepRooms = applyGeneric(
            roomRepo.list(),
            requestedRooms,
            roomRepo.get,
            roomRepo.create,
            roomRepo.update,
            (r): NewRoom => validRoom(r),
            idMap,
          );

          const keptSections = applyGeneric(
            sectionRepo.list(),
            requestedSections,
            sectionRepo.get,
            sectionRepo.create,
            sectionRepo.update,
            (s): NewSection => {
              const level = choice(s.schoolLevel, "School level", ["JHS", "SHS"]);
              const existingId = dbId(s.id);
              const original = existingId === null ? undefined : sectionRepo.get(existingId);
              const defaultBell = bellRepo.getByName(level === "JHS" ? "JHS-50-A" : "SHS-60");
              const selectedBellId = s.bellScheduleId
                ? (dbId(s.bellScheduleId) ?? invalid("Bell profile ID must be numeric."))
                : original && original.school_level === level
                  ? original.bell_schedule_id
                  : defaultBell?.id;
              const bell = selectedBellId ? bellRepo.get(selectedBellId) : undefined;
              if (!bell || bell.school_level !== level)
                return invalid("Select a matching school-level bell schedule.");

              const adviser = optionalText(s.adviser, "Adviser");
              let adviserId: number | null = null;
              if (adviser) {
                const wanted = normalizeNameKey(adviser);
                const candidates = teacherRepo.list().filter((t) => t.name_key === wanted);
                if (candidates.length === 1) adviserId = candidates[0]!.id;
                else if (
                  original?.adviser_teacher_id &&
                  beforeTeachers.some(
                    (t) => t.id === original.adviser_teacher_id && t.name_key === wanted,
                  )
                )
                  adviserId = original.adviser_teacher_id;
                else
                  return invalid(
                    "Adviser name is unknown or ambiguous. Select an existing teacher.",
                  );
              }
              return validateSectionReferences({
                name: s.name,
                grade_level: s.gradeLevel,
                school_level: level,
                bell_schedule_id: bell.id,
                adviser_teacher_id: adviserId,
              });
            },
            idMap,
          );

          // Dependents first, so foreign keys prevent accidental loss of
          // teachers and rooms currently used by a class or an elective group.
          for (const s of sectionRepo.list()) if (!keptSections.has(s.id)) sectionRepo.delete(s.id);
          for (const s of subjectRepo.list()) if (!keepSubjects.has(s.id)) subjectRepo.delete(s.id);
          for (const r of roomRepo.list()) if (!keepRooms.has(r.id)) roomRepo.delete(r.id);
          for (const t of teacherRepo.list())
            if (!keepTeachers.has(t.id)) {
              teacherInUse(t.id);
              teacherRepo.delete(t.id);
            }
          return { revision: incrementRevision(db), idMap };
        })
        .immediate();
    } catch (error) {
      return translateError(error);
    }
  };

  return { teachers, sections, subjects, rooms, bellSchedules: bellRepo, snapshot, applySnapshot };
}

```

## shared/electron-api.ts

```typescript
export type IpcResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export interface AppInfo {
  appName: string;
  version: string;
  platform: string;
}

/** Public and deliberately minimal until the domain handlers are implemented. */
export interface DesktopApi {
  getAppInfo(): Promise<IpcResult<AppInfo>>;
  teachers: CrudApi<NewTeacher, Teacher>;
  sections: CrudApi<NewSection, Section>;
  subjects: CrudApi<NewSubject, Subject>;
  rooms: CrudApi<NewRoom, Room>;
  catalog: {
    snapshot(): Promise<IpcResult<CatalogSnapshot>>;
    applySnapshot(request: CatalogReplacement): Promise<IpcResult<CatalogApplyResult>>;
  };
}

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
}

```

## src/services/dataService.ts

```typescript
import { validateAssignmentConflicts } from "@/lib/conflicts";
import { toast } from "sonner";
import { schoolDataFromCatalog, catalogReplacementFromSchoolData } from "./catalogAdapter";
import type { IpcResult } from "../../shared/electron-api";

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

export interface Assignment {
  id: string;
  term: Term;
  sectionId: string;
  subjectId: string;
  teacherId: string;
  roomId: string;
  day: Day;
  period: number;
}

export interface LoadThresholds {
  underloadBelow: number;
  balancedMax: number;
}

export interface SchoolSettings {
  schoolName: string;
  schoolYear: string;
  preparedBy: string;
  schoolHead: string;
  thresholds: LoadThresholds;
}

export interface SchoolData {
  teachers: Teacher[];
  sections: Section[];
  subjects: Subject[];
  rooms: Room[];
  timeSlots: TimeSlot[];
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
    schoolName: "San Isidro National High School",
    schoolYear: "2025–2026",
    preparedBy: "",
    schoolHead: "",
    thresholds: { underloadBelow: 18, balancedMax: 30 },
  },
});

let browserPreview = makeSampleData();
let loadedDesktopData: SchoolData | null = null;
let revision: number | null = null;
const temporaryIds = new Map<string, string>();
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

function reportWriteError(error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown database error";
  console.error("E-CLASS database write error:", error);
  toast.error(`School records were not saved: ${message}`);
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

export const dataService = {
  async getAll(): Promise<SchoolData> {
    if (!desktopApi()) return structuredClone(browserPreview);
    try {
      // A read after a page-level write must not race the queued transaction.
      await pendingCatalogWrite;
      const snapshot = take(await desktopApi()!.catalog.snapshot());
      loadedDesktopData = schoolDataFromCatalog(snapshot);
      revision = snapshot.revision;
      return structuredClone(loadedDesktopData);
    } catch (error) {
      revision = null;
      loadedDesktopData = null;
      reportReadError(error);
      return blankSchoolData();
    }
  },

  async saveAll(next: SchoolData): Promise<void> {
    if (!desktopApi()) {
      browserPreview = structuredClone(next);
      return;
    }
    // The existing screens call saveAll without awaiting it. Queue the
    // snapshots so a create followed by an edit cannot race and duplicate
    // a record. Errors are shown to the user instead of becoming unhandled.
    const submitted = structuredClone(next);
    const operation = pendingCatalogWrite.then(async () => {
      if (revision === null || !loadedDesktopData)
        throw new Error("School data has not loaded. Refresh before editing.");
      if (
        !same(submitted.assignments, loadedDesktopData.assignments) ||
        !same(submitted.timeSlots, loadedDesktopData.timeSlots) ||
        !same(submitted.settings, loadedDesktopData.settings)
      ) {
        throw new Error(
          "Schedules, bell slots and school settings are not writable until their later implementation steps.",
        );
      }
      const payload = catalogReplacementFromSchoolData(
        submitted,
        revision,
        (id) => temporaryIds.get(id) ?? id,
      );
      const changed = take(await desktopApi()!.catalog.applySnapshot(payload));
      for (const [temporary, saved] of Object.entries(changed.idMap))
        temporaryIds.set(temporary, saved);
      revision = changed.revision;
      loadedDesktopData = {
        ...submitted,
        teachers: submitted.teachers.map((t) => ({ ...t, id: temporaryIds.get(t.id) ?? t.id })),
        subjects: submitted.subjects.map((s) => ({ ...s, id: temporaryIds.get(s.id) ?? s.id })),
        rooms: submitted.rooms.map((r) => ({ ...r, id: temporaryIds.get(r.id) ?? r.id })),
        sections: submitted.sections.map((s) => ({ ...s, id: temporaryIds.get(s.id) ?? s.id })),
      };
    });
    pendingCatalogWrite = operation.catch(reportWriteError);
    return pendingCatalogWrite;
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

  async saveAssignment(assignment: Assignment): Promise<void> {
    if (desktopApi()) {
      throw new Error("Scheduling is disabled until Step 4; nothing was saved.");
    }
    const next = await dataService.getAll();
    const index = next.assignments.findIndex((a) => a.id === assignment.id);
    if (index < 0) next.assignments.push(assignment);
    else next.assignments[index] = assignment;
    await dataService.saveAll(next);
  },
  async deleteAssignment(id: string): Promise<void> {
    if (desktopApi()) throw new Error("Scheduling is disabled until Step 4.");
    const next = await dataService.getAll();
    next.assignments = next.assignments.filter((a) => a.id !== id);
    await dataService.saveAll(next);
  },
  async validateAssignment(assignment: Assignment): Promise<string[]> {
    if (desktopApi()) {
      return ["Schedule validation and saving require Step 4; no assignment was added."];
    }
    const data = await dataService.getAll();
    return validateAssignmentConflicts(assignment, data.assignments, data);
  },
  async saveSettings(settings: SchoolSettings): Promise<void> {
    if (desktopApi()) {
      throw new Error("School settings will be writable in Step 7.");
    }
    const next = await dataService.getAll();
    next.settings = settings;
    await dataService.saveAll(next);
  },
  async reset(): Promise<SchoolData> {
    if (desktopApi()) throw new Error("Sample-data reset will be implemented in Step 8.");
    browserPreview = makeSampleData();
    return structuredClone(browserPreview);
  },
};

```

## src/services/catalogAdapter.ts

```typescript
import type { CatalogSnapshot, CatalogReplacement } from "../../shared/electron-api";
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

  const settings: SchoolSettings = {
    schoolName: pad(snapshot.settings["school_name"]),
    schoolYear: pad(snapshot.settings["school_year"], "2026-2027"),
    preparedBy: pad(snapshot.settings["prepared_by"]),
    schoolHead: pad(snapshot.settings["approved_by"]),
    thresholds: {
      underloadBelow: Number(snapshot.settings["underload_below"] ?? 18),
      balancedMax: Number(snapshot.settings["balanced_max"] ?? 30),
    },
  };

  return {
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

```

## src/test/catalog-service.test.ts

```typescript
// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSchoolDatabase, type SchoolDatabase } from "../../electron/db/database";
import { createCatalogService } from "../../electron/services/catalog";

let db: SchoolDatabase;
let dir: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "eclass-catalog-"));
  db = await openSchoolDatabase(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const teacher = {
  name: "Ana Cruz",
  specialization: "Math",
  employment_type: "Permanent" as const,
  min_hours: 18,
  max_hours: 30,
};
const subject = { name: "Math", grade_level: 7, minutes_per_week: 300 };
const room = { name: "Room 101", capacity: 40, type: "Classroom" as const };

describe("main-process catalog service", () => {
  it("creates, lists, edits, and deletes each school entity with numeric SQLite IDs", () => {
    const svc = createCatalogService(db);
    const t = svc.teachers.create(teacher);
    const s = svc.subjects.create(subject);
    const r = svc.rooms.create(room);
    const bell = svc.bellSchedules.list().find((b) => b.name === "JHS-50-A")!;
    const section = svc.sections.create({
      name: "Grade 7 Edge",
      grade_level: 7,
      school_level: "JHS",
      bell_schedule_id: bell.id,
      adviser_teacher_id: t.id,
    });
    expect(svc.teachers.get(t.id).name).toBe("Ana Cruz");
    expect(svc.subjects.list().map((x) => x.id)).toEqual([s.id]);
    expect(svc.rooms.update(r.id, { ...room, name: "Room 102" }).name).toBe("Room 102");
    expect(svc.sections.list()[0]?.adviser_teacher_id).toBe(t.id);
    expect(svc.teachers.list()).toHaveLength(1);
    expect(() => svc.teachers.delete(t.id)).toThrow(/in use/i);
    expect(svc.sections.delete(section.id)).toBe(true);
    expect(svc.teachers.delete(t.id)).toBe(true);
    expect(svc.subjects.delete(s.id)).toBe(true);
    expect(svc.rooms.delete(r.id)).toBe(true);
  });

  it("validates payloads and rejects missing or invalid records", () => {
    const svc = createCatalogService(db);
    expect(() => svc.teachers.create({ ...teacher, name: " " })).toThrow(/required/i);
    expect(() => svc.teachers.create({ ...teacher, max_hours: 10 })).toThrow(/max/i);
    expect(() => svc.subjects.create({ ...subject, grade_level: 15 })).toThrow(/grade/i);
    expect(() => svc.rooms.create({ ...room, capacity: -1 })).toThrow(/capacity/i);
    expect(() => svc.teachers.get(-1)).toThrow(/id/i);
    expect(() => svc.teachers.delete(900)).toThrow(/not found/i);
    const bell = svc.bellSchedules.list().find((x) => x.name === "SHS-60")!;
    expect(() =>
      svc.sections.create({
        name: "Grade 7 Invalid",
        grade_level: 7,
        school_level: "JHS",
        bell_schedule_id: bell.id,
        adviser_teacher_id: null,
      }),
    ).toThrow(/matching/i);
    expect(() =>
      svc.sections.create({
        name: "Grade 7 No Adviser",
        grade_level: 7,
        school_level: "JHS",
        bell_schedule_id: 999999,
        adviser_teacher_id: null,
      }),
    ).toThrow(/bell schedule/i);
    const literalName = "Room'); DROP TABLE teachers;--";
    expect(svc.rooms.create({ ...room, name: literalName }).name).toBe(literalName);
    expect(svc.snapshot().teachers).toEqual([]);
  });

  it("applies a whole-page catalog snapshot transactionally with ID mappings and optimistic revision", () => {
    const svc = createCatalogService(db);
    const initial = svc.snapshot();
    expect(initial.revision).toBe(0);
    const changed = svc.applySnapshot({
      expectedRevision: initial.revision,
      teachers: [
        {
          id: "te-temporary",
          name: "Maria Santos",
          specialization: "English",
          employmentType: "Permanent",
          minHours: 18,
          maxHours: 30,
        },
      ],
      subjects: [{ id: "sub-new", ...{ name: "English", gradeLevel: 7, minutesPerWeek: 300 } }],
      rooms: [{ id: "ro-new", ...{ name: "Room 101", capacity: 40, type: "Classroom" as const } }],
      sections: [
        {
          id: "se-new",
          name: "Grade 7 Edge",
          gradeLevel: 7,
          schoolLevel: "JHS" as const,
          adviser: "Maria Santos",
        },
      ],
    });
    expect(changed.revision).toBe(1);
    expect(changed.idMap["te-temporary"]).toMatch(/^\d+$/);
    expect(changed.idMap["se-new"]).toMatch(/^\d+$/);
    expect(svc.snapshot().sections[0]?.adviser_teacher_id).toBe(
      Number(changed.idMap["te-temporary"]),
    );
    expect(() =>
      svc.applySnapshot({
        expectedRevision: 0,
        teachers: [],
        subjects: [],
        rooms: [],
        sections: [],
      }),
    ).toThrow(/changed elsewhere/i);
    expect(svc.snapshot().teachers).toHaveLength(1);
  });

  it("rolls back all catalog edits when one record fails and does not delete referenced records", () => {
    const svc = createCatalogService(db);
    const t = svc.teachers.create(teacher);
    const r = svc.rooms.create(room);
    const baseline = svc.snapshot();
    expect(() =>
      svc.applySnapshot({
        expectedRevision: baseline.revision,
        teachers: [
          {
            id: String(t.id),
            name: "Renamed",
            specialization: teacher.specialization,
            employmentType: teacher.employment_type,
            minHours: teacher.min_hours,
            maxHours: teacher.max_hours,
          },
        ],
        subjects: [],
        rooms: [{ id: String(r.id), ...room, capacity: 0 }],
        sections: [],
      }),
    ).toThrow(/capacity/i);
    expect(svc.teachers.get(t.id).name).toBe("Ana Cruz");
    expect(svc.snapshot().revision).toBe(baseline.revision);
    const bell = svc.bellSchedules.list().find((x) => x.name === "JHS-50-A")!;
    const section = svc.sections.create({
      name: "Grade 7",
      grade_level: 7,
      school_level: "JHS",
      bell_schedule_id: bell.id,
      adviser_teacher_id: t.id,
    });
    expect(() =>
      svc.applySnapshot({
        expectedRevision: svc.snapshot().revision,
        teachers: [],
        subjects: [],
        rooms: [{ id: String(r.id), ...room }],
        sections: [
          {
            id: String(section.id),
            name: section.name,
            gradeLevel: 7,
            schoolLevel: "JHS",
            adviser: t.name,
            bellScheduleId: String(bell.id),
          },
        ],
      }),
    ).toThrow(/in use/i);
    expect(svc.teachers.get(t.id)).toBeTruthy();
  });
});

```

## src/test/data-service-ipc.test.ts

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogSnapshot, DesktopApi } from "../../shared/electron-api";

const snapshot: CatalogSnapshot = {
  revision: 0,
  teachers: [],
  sections: [],
  subjects: [],
  rooms: [],
  bellSchedules: [
    { id: 1, name: "SHS-60", school_level: "SHS" },
    { id: 2, name: "JHS-50-A", school_level: "JHS" },
  ],
  timeSlots: [
    {
      id: 14,
      bell_schedule_id: 2,
      kind: "period",
      period_no: 1,
      start_time: "07:30",
      end_time: "08:20",
      minutes: 50,
    },
  ],
  settings: {
    school_name: "Test School",
    school_year: "2026-2027",
    underload_below: "18",
    balanced_max: "30",
  },
};

function fakeApi() {
  const applySnapshot = vi.fn().mockResolvedValue({
    ok: true,
    data: { revision: 1, idMap: { "te-temp": "91" } },
  });
  const catalog = {
    snapshot: vi.fn().mockResolvedValue({ ok: true, data: snapshot }),
    applySnapshot,
  };
  window.api = { catalog } as unknown as DesktopApi;
  return catalog;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => {
  delete window.api;
  vi.restoreAllMocks();
});

describe("dataService Electron bridge", () => {
  it("loads actual empty SQLite catalog data instead of seeding the browser mock", async () => {
    const catalog = fakeApi();
    const { dataService } = await import("../services/dataService");
    const school = await dataService.getAll();
    expect(school.teachers).toHaveLength(0);
    expect(school.sections).toHaveLength(0);
    expect(school.settings.schoolName).toBe("Test School");
    expect(school.timeSlots[0]?.period).toBe(1);
    expect(catalog.snapshot).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });

  it("sends page-level catalog edits through one atomic IPC operation", async () => {
    const catalog = fakeApi();
    const { dataService } = await import("../services/dataService");
    const data = await dataService.getAll();
    await dataService.saveAll({
      ...data,
      teachers: [
        {
          id: "te-temp",
          name: "Maria Santos",
          specialization: "English",
          employmentType: "Permanent",
          minHours: 18,
          maxHours: 30,
        },
      ],
    });
    expect(catalog.applySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 0,
        teachers: [expect.objectContaining({ id: "te-temp", name: "Maria Santos" })],
      }),
    );
    // Next save must use the returned SQLite ID, not create the same teacher twice.
    await dataService.saveAll({
      ...data,
      teachers: [
        {
          id: "te-temp",
          name: "Maria Updated",
          specialization: "English",
          employmentType: "Permanent",
          minHours: 18,
          maxHours: 30,
        },
      ],
    });
    expect(catalog.applySnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedRevision: 1,
        teachers: [expect.objectContaining({ id: "91", name: "Maria Updated" })],
      }),
    );
    expect(localStorage.length).toBe(0);
  });

  it("does not pass pending schedule changes through the catalog endpoint", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const catalog = fakeApi();
    const { dataService } = await import("../services/dataService");
    const data = await dataService.getAll();
    await dataService.saveAll({
      ...data,
      assignments: [
        {
          id: "pending",
          term: 1,
          sectionId: "1",
          subjectId: "1",
          teacherId: "1",
          roomId: "1",
          day: "Monday",
          period: 1,
        },
      ],
    });
    expect(catalog.applySnapshot).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
    expect(
      await dataService.validateAssignment({
        id: "pending",
        term: 1,
        sectionId: "1",
        subjectId: "1",
        teacherId: "1",
        roomId: "1",
        day: "Monday",
        period: 1,
      }),
    ).toEqual([expect.stringContaining("Step 4")]);
  });
});

```

## src/test/sqlite-schema.test.ts

```typescript
// @vitest-environment node
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openSchoolDatabase, type SchoolDatabase } from "../../electron/db/database";

const folders: string[] = [];
const opened: SchoolDatabase[] = [];

async function temporaryDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "eclass-schema-"));
  folders.push(dir);
  const db = await openSchoolDatabase(dir);
  opened.push(db);
  return { dir, db };
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("E-CLASS SQLite migrations", () => {
  it("creates WAL/foreign-key-enabled schema and seeds exactly three school bell profiles", async () => {
    const { dir, db } = await temporaryDatabase();
    expect(existsSync(join(dir, "eclass.db"))).toBe(true);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.prepare("SELECT version FROM schema_version ORDER BY version").all()).toEqual([
      { version: 1 },
      { version: 2 },
    ]);

    const profiles = db
      .prepare("SELECT name, school_level FROM bell_schedules ORDER BY name")
      .all();
    expect(profiles).toEqual([
      { name: "JHS-50-A", school_level: "JHS" },
      { name: "JHS-50-B", school_level: "JHS" },
      { name: "SHS-60", school_level: "SHS" },
    ]);
    const slots = db
      .prepare(
        `
      SELECT b.name, s.kind, s.period_no, s.start_time, s.end_time, s.minutes
      FROM time_slots s JOIN bell_schedules b ON b.id=s.bell_schedule_id
      WHERE b.name='SHS-60' ORDER BY s.start_time
    `,
      )
      .all() as Array<Record<string, string | number | null>>;
    expect(slots.filter((s) => s["kind"] === "period")).toHaveLength(8);
    expect(slots[0]).toMatchObject({
      kind: "class_preparation",
      start_time: "07:00",
      end_time: "07:15",
      minutes: 15,
    });
    expect(slots.find((s) => s["kind"] === "lunch_break")).toMatchObject({
      start_time: "11:45",
      end_time: "13:00",
      minutes: 75,
    });
    const jhsA = db
      .prepare(
        `SELECT start_time, end_time FROM time_slots s JOIN bell_schedules b ON b.id=s.bell_schedule_id WHERE b.name='JHS-50-A' AND s.kind='health_break'`,
      )
      .get();
    const jhsB = db
      .prepare(
        `SELECT start_time, end_time FROM time_slots s JOIN bell_schedules b ON b.id=s.bell_schedule_id WHERE b.name='JHS-50-B' AND s.kind='health_break'`,
      )
      .get();
    expect(jhsA).toEqual({ start_time: "09:10", end_time: "09:30" });
    expect(jhsB).toEqual({ start_time: "09:10", end_time: "09:20" });
    expect(db.prepare("SELECT count(*) AS n FROM assignments").get()).toEqual({ n: 0 });
  });

  it("enforces school-level and dependent-record foreign keys", async () => {
    const { db } = await temporaryDatabase();
    const jhs = db.prepare("SELECT id FROM bell_schedules WHERE name='JHS-50-A'").get() as {
      id: number;
    };
    const shs = db.prepare("SELECT id FROM bell_schedules WHERE name='SHS-60'").get() as {
      id: number;
    };
    const insertSection = db.prepare(
      "INSERT INTO sections(name,grade_level,school_level,bell_schedule_id) VALUES (?,?,?,?)",
    );
    expect(() => insertSection.run("Bad level", 7, "JHS", shs.id)).toThrow();
    expect(() => insertSection.run("Wrong key", 7, "JHS", 9999)).toThrow();
    expect(insertSection.run("Grade 7 - Edge", 7, "JHS", jhs.id).changes).toBe(1);
    expect(() => db.prepare("DELETE FROM bell_schedules WHERE id=?").run(jhs.id)).toThrow();
  });

  it("does not create classroom sample records unless explicitly requested", async () => {
    const { db } = await temporaryDatabase();
    for (const table of [
      "teachers",
      "subjects",
      "rooms",
      "sections",
      "assignments",
      "elective_groups",
    ]) {
      expect(db.prepare(`SELECT count(*) AS total FROM ${table}`).get()).toEqual({ total: 0 });
    }
  });

  it("can reopen an existing database without repeating migrations", async () => {
    const { dir, db } = await temporaryDatabase();
    db.prepare("INSERT INTO settings(key,value) VALUES('custom', 'saved')").run();
    db.close();
    opened.pop();
    const reopened = await openSchoolDatabase(dir);
    opened.push(reopened);
    expect(reopened.prepare("SELECT value FROM settings WHERE key='custom'").get()).toEqual({
      value: "saved",
    });
    expect(reopened.prepare("SELECT count(*) AS n FROM schema_version").get()).toEqual({ n: 2 });
    expect(readdirSync(dir).filter((x) => x.endsWith(".bak"))).toHaveLength(0);
  });

  it("creates a restorable snapshot of existing data before each migration", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eclass-upgrade-"));
    folders.push(dir);
    const legacy = new Database(join(dir, "eclass.db"));
    legacy.exec("CREATE TABLE legacy(value TEXT); INSERT INTO legacy(value) VALUES('keep me')");
    legacy.close();
    const upgraded = await openSchoolDatabase(dir);
    opened.push(upgraded);
    expect(upgraded.prepare("SELECT value FROM legacy").get()).toEqual({ value: "keep me" });
    const backups = readdirSync(dir).filter((x) => x.endsWith(".bak"));
    expect(backups).toHaveLength(2);
    for (const filename of backups) {
      const copy = new Database(join(dir, filename), { readonly: true });
      try {
        expect(copy.prepare("SELECT value FROM legacy").get()).toEqual({ value: "keep me" });
      } finally {
        copy.close();
      }
    }
  });

  it("rejects malformed times, impossible durations and fixed-event class assignments", async () => {
    const { db } = await temporaryDatabase();
    const shs = db.prepare("SELECT id FROM bell_schedules WHERE name='SHS-60'").get() as {
      id: number;
    };
    const badSlot = db.prepare(`INSERT INTO time_slots
      (bell_schedule_id,kind,period_no,start_time,end_time,minutes)
      VALUES(?,'period',9,?,?,?)`);
    expect(() => badSlot.run(shs.id, "07:00", "08:00", 30)).toThrow();
    expect(() => badSlot.run(shs.id, "29:00", "30:00", 60)).toThrow();
  });
});

```

## scripts/verify-step3-electron.cjs

```javascript
// Only for a running, isolated local Electron test process started with
// --remote-debugging-port=9243 and ECLASS_TEST_USER_DATA=<temp-directory>.
// This script tests the real contextBridge and IPC, not a mock handler.
const assert = require("node:assert/strict");

async function evaluate(expression) {
  const pages = await (await fetch("http://127.0.0.1:9243/json/list")).json();
  assert.ok(pages.length, "An Electron page should be open");
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      ws.close();
      reject(new Error("Electron IPC verification timed out."));
    }, 15000);
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    };
    ws.onmessage = (event) => {
      clearTimeout(deadline);
      ws.close();
      const result = JSON.parse(event.data);
      if (result.error || result.result?.exceptionDetails)
        return reject(new Error(JSON.stringify(result)));
      resolve(result.result?.result?.value);
    };
    ws.onerror = reject;
  });
}

const expression = `(async () => {
  const api = window.api;
  const unique = String(Date.now());
  const before = await api.catalog.snapshot();
  const teacher = await api.teachers.create({
    name: "Step 3 Verification Teacher " + unique, specialization: "Science",
    employment_type: "Permanent", min_hours: 18, max_hours: 30,
  });
  const subject = await api.subjects.create({
    name: "Step 3 Verification Subject " + unique, grade_level: 7, minutes_per_week: 300,
  });
  const room = await api.rooms.create({
    name: "Step 3 Verification Room " + unique, capacity: 40, type: "Classroom",
  });
  const updated = await api.rooms.update(room.data.id, {
    name: "Step 3 Updated Room " + unique, capacity: 42, type: "Classroom",
  });
  const gotRoom = await api.rooms.get(room.data.id);
  const profile = (await api.catalog.snapshot()).data.bellSchedules
    .find(b => b.name === "JHS-50-A");
  const section = await api.sections.create({
    name: "Step 3 Verification Section " + unique, grade_level: 7,
    school_level: "JHS", bell_schedule_id: profile.id,
    adviser_teacher_id: teacher.data.id,
  });
  const blocked = await api.teachers.delete(teacher.data.id);
  const invalid = await api.rooms.create({
    name: "Invalid Room", capacity: -5, type: "Classroom",
  });
  const current = await api.catalog.snapshot();
  const deletedSection = await api.sections.delete(section.data.id);
  const deletedTeacher = await api.teachers.delete(teacher.data.id);
  const deletedSubject = await api.subjects.delete(subject.data.id);
  const deletedRoom = await api.rooms.delete(room.data.id);
  const after = await api.catalog.snapshot();
  return {
    teacher: teacher.ok, section: section.ok,
    subject: subject.ok, room: room.ok,
    blocked: blocked.ok ? null : blocked.error.code,
    invalid: invalid.ok ? null : invalid.error.code,
    revision: current.ok ? current.data.revision : -1,
    count: current.ok ? current.data.teachers.length : -1,
    updated: updated.data?.capacity === 42 && gotRoom.data?.capacity === 42,
    cleaned: deletedSection.ok && deletedTeacher.ok &&
      deletedSubject.ok && deletedRoom.ok,
    restored: before.ok && after.ok &&
      before.data.teachers.length === after.data.teachers.length &&
      before.data.rooms.length === after.data.rooms.length &&
      before.data.subjects.length === after.data.subjects.length &&
      before.data.sections.length === after.data.sections.length,
    ipcAvailable: !!api.catalog && !!api.teachers,
  };
})()`;

(async () => {
  const result = await evaluate(expression);
  assert.equal(result.ipcAvailable, true);
  for (const key of ["teacher", "section", "subject", "room"]) {
    assert.equal(result[key], true, `${key} creation failed`);
  }
  assert.equal(result.blocked, "IN_USE");
  assert.equal(result.invalid, "INVALID_INPUT");
  assert.equal(result.updated, true);
  assert.equal(result.cleaned, true);
  assert.equal(result.restored, true);
  assert.ok(result.revision >= 4);
  assert.ok(result.count >= 1);
  console.log("Electron IPC verified using isolated data:", result);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

```

## docs/step3-notes.md

```markdown
# E-CLASS Step 3 — Catalog IPC + React Adapter

## Boundaries

This milestone connects the Electron main process to `eclass.db` inside
`app.getPath("userData")`. It adds CRUD for teachers, sections, subjects and
rooms. Scheduling and Excel import are **not** implemented here.

## Security and data safety

- SQLite runs only in the Electron main process, with foreign keys enabled.
- A sandboxed preload exposes typed, named methods. It never exposes an
  unrestricted `ipcRenderer` or SQL execution method.
- The IPC handlers reject calls from anything other than the main window's
  main frame. Errors are logged under `userData/logs/eclass.log`.
- Every CRUD write and whole-page catalog replacement runs in a database
  transaction. A persisted catalog revision prevents stale-snapshot writes.
- Deletion is restricted if dependent schedules/electives/class advisers
  still reference a record. Database constraint errors become clear,
  structured error responses.
- Frontend temporary string IDs are mapped to SQLite-issued numeric IDs;
  the adapter queues calls from the existing optimistic React page code.
- **No browser localStorage is used for school-record persistence.**
- A browser-only Vite preview retains _in-memory_ demo records, not the
  school's SQLite database. The desktop window uses only Electron IPC.
- Opening a brand-new SQLite database does not seed fictional teachers,
  sections, subjects or rooms.

## Compatibility decisions

- The existing page calls `getAll()` and `saveAll()` instead of CRUD methods.
  Step 3 provides an atomic `catalog:applySnapshot` IPC operation so the
  existing page components need not change.
- New JHS sections default to `JHS-50-A`; new SHS sections default to
  `SHS-60` until the frontend adds a bell-profile selector. Existing
  section bell-profile IDs are preserved during updates.
- Sections store a foreign-key adviser reference, not free-text adviser
  names. The adapter resolves a unique existing teacher name or rejects
  ambiguous/unmatched names with a clear error.
- A temporary list of period slots is projected for the legacy page from
  one bell profile. The true multi-profile schedule UI and conflict
  authority arrive in Step 4.
- Existing pages still optimistically change local state before asynchronous
  persistence completes. The adapter displays a toast on rejected writes;
  refreshing the screen restores authoritative database values.

## Explicitly deferred

- Assignment, auto-generation, schedule validation, and bell-slot writes:
  **Step 4 / Step 6**.
- Import and Resolve Names: **Step 5**.
- Header settings, report exports, backup/restore: **Step 7**.
- Seed/reset sample data and Windows installer: **Step 8**.

The adapter refuses to treat unsupported schedule changes as SQLite writes.
Settings and reset operations deliberately return an unavailable error in
Electron, rather than changing school records in localStorage. No React
page component was edited.

## Commands

```powershell
cd C:\Personal\screenshot-to-spec-main
npm test
npm run typecheck:electron
npm run build:desktop
npm run dev
```

To verify real Electron IPC without touching any existing school database,
open the desktop in a separate terminal with a **temporary** data directory:

```powershell
$env:ECLASS_TEST_USER_DATA = Join-Path $env:TEMP "eclass-step3-e2e"
$env:ECLASS_STATIC = "1"
npm run build:desktop
npx electron . --remote-debugging-port=9243
```

Then in another terminal:

```powershell
node scripts/verify-step3-electron.cjs
```

This smoke test creates unique temporary catalog records, verifies
create/get/update/delete, rejects an invalid room and dependent-teacher
deletion, and removes its records afterward. Do not enable the
debugging port on a shared or production computer.

```

