import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogReplacement, CatalogSnapshot, DesktopApi } from "../../shared/electron-api";

const teacherRecord = {
  name: "Imported Teacher",
  specialization: "General",
  employmentType: "Permanent",
  minHours: 18,
  maxHours: 30,
};

function baseSnapshot(): CatalogSnapshot {
  return {
    revision: 0,
    teachers: [],
    sections: [],
    subjects: [],
    rooms: [],
    bellSchedules: [
      { id: 1, name: "SHS-60", school_level: "SHS" },
      { id: 2, name: "JHS-50-A", school_level: "JHS" },
    ],
    timeSlots: [],
    settings: { school_name: "Real school", school_year: "2026-2027" },
  };
}

function fakeApi(includeSnapshot = true) {
  let committed = baseSnapshot();
  let nextId = 20;
  const snapshot = vi.fn().mockImplementation(async () => ({ ok: true, data: structuredClone(committed) }));
  const list = vi.fn().mockResolvedValue({ ok: true, data: [] });
  const applySnapshot = vi.fn().mockImplementation(async (request: CatalogReplacement) => {
    const idMap: Record<string, string> = {};
    const resolve = (id: string) => {
      if (/^[1-9]\d*$/.test(id)) return Number(id);
      const saved = nextId++;
      idMap[id] = String(saved);
      return saved;
    };
    committed = {
      ...committed,
      revision: committed.revision + 1,
      teachers: request.teachers.map((row) => ({
        id: resolve(row.id), name: row.name, name_key: row.name.toLowerCase(),
        specialization: row.specialization, employment_type: row.employmentType,
        min_hours: row.minHours, max_hours: row.maxHours,
      })),
      sections: request.sections.map((row) => ({
        id: resolve(row.id), name: row.name, grade_level: row.gradeLevel,
        school_level: row.schoolLevel, bell_schedule_id: row.bellScheduleId ? Number(row.bellScheduleId) : row.schoolLevel === "JHS" ? 2 : 1,
        adviser_teacher_id: null,
      })),
      subjects: request.subjects.map((row) => ({ id: resolve(row.id), name: row.name, name_key: row.name.toLowerCase(), grade_level: row.gradeLevel, minutes_per_week: row.minutesPerWeek })),
      rooms: request.rooms.map((row) => ({ id: resolve(row.id), name: row.name, capacity: row.capacity, type: row.type })),
    };
    // An unrelated read failure after a successful commit must never turn an
    // import into a reported failed write or replace the screen with blank data.
    snapshot.mockRejectedValue(new Error("Snapshot unavailable after commit"));
    list.mockRejectedValue(new Error("Schedule unavailable after commit"));
    return { ok: true, data: { revision: committed.revision, idMap, ...(includeSnapshot ? { snapshot: structuredClone(committed) } : {}) } };
  });
  window.api = { catalog: { snapshot, applySnapshot }, schedule: { list } } as unknown as DesktopApi;
  return { snapshot, applySnapshot, list };
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { delete window.api; vi.restoreAllMocks(); });

describe("safe catalog imports", () => {
  it.each([true, false])("retains a successful CRUD record when a later import follows unavailable refresh endpoints (snapshot=%s)", async (includeSnapshot) => {
    const api = fakeApi(includeSnapshot);
    const { dataService } = await import("../../src/services/dataService");
    const base = await dataService.getAll();
    const saved = await dataService.saveAll({
      ...base,
      teachers: [{ ...teacherRecord, id: "crud-teacher", name: "First Teacher", employmentType: "Permanent" }],
    });
    const imported = await dataService.importCatalog("teachers", [{ ...teacherRecord, name: "Second Teacher" }]);
    expect(imported.teachers.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "20", name: "First Teacher" },
      { id: "21", name: "Second Teacher" },
    ]);
    expect(saved.teachers[0]).toMatchObject({ id: "20", name: "First Teacher" });
    expect(api.applySnapshot.mock.calls[1]?.[0]).toMatchObject({ expectedRevision: 1, teachers: [{ id: "20" }, { name: "Second Teacher" }] });
    expect(api.snapshot).toHaveBeenCalledTimes(1);
    expect(api.list).toHaveBeenCalledTimes(1);
    saved.teachers[0]!.name = "Caller mutation";
    expect((await dataService.importCatalog("teachers", [{ ...teacherRecord, name: "First Teacher" }])).teachers[0]?.name).toBe("First Teacher");
  });

  it("returns the committed catalog without any post-write snapshot or schedule read", async () => {
    const api = fakeApi();
    const { dataService } = await import("../../src/services/dataService");
    await dataService.getAll();
    const imported = await dataService.importCatalog("teachers", [teacherRecord]);
    expect(imported.teachers).toEqual([expect.objectContaining({ id: "20", name: "Imported Teacher" })]);
    expect(imported.settings.schoolName).toBe("Real school");
    expect(api.snapshot).toHaveBeenCalledTimes(1);
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it("returns confirmed records and default bell profiles for legacy successful responses", async () => {
    const api = fakeApi(false);
    const { dataService } = await import("../../src/services/dataService");
    await dataService.getAll();
    const imported = await dataService.importCatalog("sections", [
      { name: "Grade 7 Edge", gradeLevel: 7, schoolLevel: "JHS", adviser: "" },
      { name: "Grade 11 STEM", gradeLevel: 11, schoolLevel: "SHS", adviser: "" },
    ]);
    expect(imported.sections).toEqual([
      expect.objectContaining({ id: "20", name: "Grade 7 Edge", bellScheduleId: "2" }),
      expect.objectContaining({ id: "21", name: "Grade 11 STEM", bellScheduleId: "1" }),
    ]);
    expect(api.snapshot).toHaveBeenCalledTimes(1);
    const repeated = await dataService.importCatalog("sections", [
      { name: "Grade 7 Edge", gradeLevel: 7, schoolLevel: "JHS", adviser: "" },
    ]);
    expect(repeated.sections).toHaveLength(2);
    expect(api.applySnapshot).toHaveBeenCalledTimes(1);
  });

  it("retains the loaded base after backend rejection and permits a later valid import", async () => {
    const api = fakeApi();
    api.applySnapshot.mockResolvedValueOnce({ ok: false, error: { code: "INVALID_INPUT", message: "Import rejected" } });
    const { dataService } = await import("../../src/services/dataService");
    const base = await dataService.getAll();
    await expect(dataService.importCatalog("teachers", [teacherRecord])).rejects.toThrow("Import rejected");
    expect(base.teachers).toEqual([]);
    const imported = await dataService.importCatalog("teachers", [{ ...teacherRecord, name: "Accepted Teacher" }]);
    expect(imported.teachers.map((row) => row.name)).toEqual(["Accepted Teacher"]);
    expect(api.applySnapshot.mock.calls[1]?.[0]).toMatchObject({ expectedRevision: 0 });
  });

  it("deduplicates queued imports against the latest successful state", async () => {
    const api = fakeApi();
    const { dataService } = await import("../../src/services/dataService");
    await dataService.getAll();
    const first = dataService.importCatalog("teachers", [teacherRecord]);
    const duplicate = dataService.importCatalog("teachers", [{ ...teacherRecord, name: "  Imported   Teacher  " }]);
    const second = dataService.importCatalog("teachers", [{ ...teacherRecord, name: "Another Teacher" }]);
    await first;
    expect((await duplicate).teachers).toHaveLength(1);
    const imported = await second;
    expect(imported.teachers.map((row) => row.name)).toEqual(["Imported Teacher", "Another Teacher"]);
    expect(api.applySnapshot).toHaveBeenCalledTimes(2);
    expect(api.applySnapshot.mock.calls[1]?.[0]).toMatchObject({ expectedRevision: 1, teachers: [{ id: "20" }, { name: "Another Teacher" }] });
    imported.teachers[0]!.name = "Caller mutation";
    expect((await dataService.importCatalog("teachers", [teacherRecord])).teachers[0]?.name).toBe("Imported Teacher");
  });

  it("rejects invalid browser imports without changing existing records", async () => {
    const { dataService } = await import("../../src/services/dataService");
    const before = await dataService.getAll();
    await expect(dataService.importCatalog("teachers", [{ ...teacherRecord, name: "" }])).rejects.toThrow(/name/i);
    expect(await dataService.getAll()).toEqual(before);
    const imported = await dataService.importCatalog("teachers", [teacherRecord, teacherRecord]);
    expect(imported.teachers).toHaveLength(before.teachers.length + 1);
    expect((await dataService.importCatalog("teachers", [teacherRecord])).teachers).toHaveLength(before.teachers.length + 1);
  });
});
