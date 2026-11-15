import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopApi,
  AppInfo,
  AdminAuthStatus,
  IpcResult,
  CrudApi,
  Teacher,
  Section,
  Subject,
  Room,
  CatalogSnapshot,
  CatalogReplacement,
  CatalogApplyResult,
  SchoolSettingsUpdate,
  ScheduleCandidate,
  ScheduleFilter,
  ScheduleValidation,
  SavedScheduleAssignment,
  ScheduleChangeSet,
  ScheduleChangeResult,
  SchoolTerm,
  ScheduleConflictRecord,
  ElectiveGroupCandidate,
  ElectiveGroupDetails,
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
  auth: Object.freeze({
    status: () => ipcRenderer.invoke("auth:status") as Promise<IpcResult<AdminAuthStatus>>,
    setup: (password: string) =>
      ipcRenderer.invoke("auth:setup", password) as Promise<IpcResult<AdminAuthStatus>>,
    signIn: (password: string) =>
      ipcRenderer.invoke("auth:signIn", password) as Promise<IpcResult<AdminAuthStatus>>,
    logout: () => ipcRenderer.invoke("auth:logout") as Promise<IpcResult<AdminAuthStatus>>,
  }),
  teachers: crud<NewTeacher, Teacher>("teachers"),
  sections: crud<NewSection, Section>("sections"),
  subjects: crud<NewSubject, Subject>("subjects"),
  rooms: crud<NewRoom, Room>("rooms"),
  catalog: Object.freeze({
    snapshot: () => ipcRenderer.invoke("catalog:snapshot") as Promise<IpcResult<CatalogSnapshot>>,
    ensureSchoolName: (name: string) =>
      ipcRenderer.invoke("catalog:ensureSchoolName", name) as Promise<IpcResult<CatalogSnapshot>>,
    saveSettings: (request: SchoolSettingsUpdate) =>
      ipcRenderer.invoke("catalog:saveSettings", request) as Promise<IpcResult<CatalogSnapshot>>,
    applySnapshot: (request: CatalogReplacement) =>
      ipcRenderer.invoke("catalog:applySnapshot", request) as Promise<
        IpcResult<CatalogApplyResult>
      >,
  }),
  schedule: Object.freeze({
    list: (filter: ScheduleFilter) =>
      ipcRenderer.invoke("schedule:list", filter) as Promise<IpcResult<SavedScheduleAssignment[]>>,
    get: (id: number) =>
      ipcRenderer.invoke("schedule:get", id) as Promise<IpcResult<SavedScheduleAssignment>>,
    validate: (candidate: ScheduleCandidate, excludeId?: number) =>
      ipcRenderer.invoke("schedule:validate", candidate, excludeId) as Promise<
        IpcResult<ScheduleValidation>
      >,
    save: (candidate: ScheduleCandidate) =>
      ipcRenderer.invoke("schedule:save", candidate) as Promise<IpcResult<SavedScheduleAssignment>>,
    update: (id: number, candidate: ScheduleCandidate) =>
      ipcRenderer.invoke("schedule:update", id, candidate) as Promise<
        IpcResult<SavedScheduleAssignment>
      >,
    delete: (id: number) =>
      ipcRenderer.invoke("schedule:delete", id) as Promise<IpcResult<{ deleted: true }>>,
    applyChanges: (changes: ScheduleChangeSet) =>
      ipcRenderer.invoke("schedule:applyChanges", changes) as Promise<
        IpcResult<ScheduleChangeResult>
      >,
    detectConflicts: (term: SchoolTerm, schoolYear: string) =>
      ipcRenderer.invoke("schedule:detectConflicts", term, schoolYear) as Promise<
        IpcResult<ScheduleConflictRecord[]>
      >,
  }),
  electives: Object.freeze({
    create: (candidate: ElectiveGroupCandidate) =>
      ipcRenderer.invoke("electives:create", candidate) as Promise<IpcResult<ElectiveGroupDetails>>,
    get: (id: number) =>
      ipcRenderer.invoke("electives:get", id) as Promise<IpcResult<ElectiveGroupDetails>>,
    list: (filter: ScheduleFilter) =>
      ipcRenderer.invoke("electives:list", filter) as Promise<IpcResult<ElectiveGroupDetails[]>>,
    addSection: (groupId: number, sectionId: number) =>
      ipcRenderer.invoke("electives:addSection", groupId, sectionId) as Promise<
        IpcResult<ElectiveGroupDetails>
      >,
    delete: (id: number) =>
      ipcRenderer.invoke("electives:delete", id) as Promise<IpcResult<{ deleted: true }>>,
  }),
};

contextBridge.exposeInMainWorld("api", Object.freeze(api));
