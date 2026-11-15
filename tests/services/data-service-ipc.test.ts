import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogReplacement, CatalogSnapshot, DesktopApi } from "../../shared/electron-api";

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
  const applySnapshot = vi.fn().mockImplementation(async (request: CatalogReplacement) => ({
    ok: true,
    data: { revision: request.expectedRevision + 1, idMap: Object.fromEntries(
      [...request.teachers, ...request.sections, ...request.subjects, ...request.rooms]
        .filter((row) => !/^[1-9]\d*$/.test(row.id))
        .map((row, index) => [row.id, String(91 + index)]),
    ) },
  }));
  const catalog = {
    snapshot: vi.fn().mockResolvedValue({ ok: true, data: snapshot }),
    applySnapshot,
  };
  const schedule = {
    list: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    validate: vi.fn().mockResolvedValue({ ok: true, data: { valid: true, conflicts: [] } }),
    applyChanges: vi
      .fn()
      .mockResolvedValue({ ok: true, data: { created: [], updated: [], deleted: [] } }),
  };
  window.api = { catalog, schedule } as unknown as DesktopApi;
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
  it("normalizes loaded settings and does not reload assignments for a separator-only change", async () => {
    const catalog = fakeApi();
    catalog.snapshot.mockResolvedValue({ ok: true, data: { ...snapshot, settings: { ...snapshot.settings, school_year: "2026–2027" } } });
    const saveSettings = vi.fn().mockImplementation(async (request) => ({ ok: true, data: { ...snapshot, revision: request.expectedRevision + 1, settings: { ...snapshot.settings, school_year: request.schoolYear } } }));
    Object.assign(window.api!.catalog, { saveSettings });
    const list = vi.mocked(window.api!.schedule.list);
    list.mockImplementation(async ({ schoolYear }) => ({ ok: true, data: [{
      id: schoolYear === "2027-2028" ? 22 : 11, school_year: schoolYear, term: 1, day: 1,
      start_time_slot_id: 14, start_minute: 450, end_minute: 500, duration_periods: 1,
      section_id: 1, elective_group_id: null, subject_id: 1, teacher_id: 1, room_id: 1,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    }] }));
    const { dataService } = await import("../../src/services/dataService");
    const data = await dataService.getAll();
    expect(data.settings.schoolYear).toBe("2026-2027");
    expect(data.assignments.map((row) => row.id)).toEqual(["11"]);
    const saved = await dataService.saveSettings({ ...data.settings, schoolYear: "2026–2027" });
    expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ schoolYear: "2026-2027" }));
    expect(saved.settings.schoolYear).toBe("2026-2027");
    expect(saved.assignments.map((row) => row.id)).toEqual(["11"]);
    expect(list).toHaveBeenCalledTimes(1);
    const otherYear = await dataService.saveSettings({ ...saved.settings, schoolYear: "2027–2028" });
    expect(list).toHaveBeenLastCalledWith({ schoolYear: "2027-2028" });
    expect(otherYear.assignments.map((row) => row.id)).toEqual(["22"]);
    const originalYear = await dataService.saveSettings({ ...saved.settings, schoolYear: "2026–2027" });
    expect(list).toHaveBeenLastCalledWith({ schoolYear: "2026-2027" });
    expect(originalYear.assignments.map((row) => row.id)).toEqual(["11"]);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("canonicalizes browser preview settings writes", async () => {
    const { dataService } = await import("../../src/services/dataService");
    const data = await dataService.getAll();
    expect(data.settings.schoolYear).toBe("2025-2026");
    const saved = await dataService.saveSettings({ ...data.settings, schoolYear: " 2026–2027 " });
    expect(saved.settings.schoolYear).toBe("2026-2027");
    expect((await dataService.getAll()).settings.schoolYear).toBe("2026-2027");
  });

  it("canonicalizes a browser whole-page settings write", async () => {
    const { dataService } = await import("../../src/services/dataService");
    const data = await dataService.getAll();
    const saved = await dataService.saveAll({ ...data, settings: { ...data.settings, schoolYear: "2026–2027" } });
    expect(saved.settings.schoolYear).toBe("2026-2027");
    expect((await dataService.getAll()).settings.schoolYear).toBe("2026-2027");
  });
  it("saves only school settings through a dedicated Electron transaction and preserves assignments", async () => {
    const catalog = fakeApi();
    const changed = { ...snapshot, revision: 1, settings: {
      ...snapshot.settings, school_name: "Updated School", prepared_by: "Prepared Person",
    } };
    const saveSettings = vi.fn().mockResolvedValue({ ok: true, data: changed });
    Object.assign(window.api!.catalog, { saveSettings });
    const { dataService } = await import("../../src/services/dataService");
    const initial = await dataService.getAll();
    const saved = await dataService.saveSettings({ ...initial.settings, schoolName: "Updated School", preparedBy: "Prepared Person" });
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 0, schoolName: "Updated School", preparedBy: "Prepared Person",
    }));
    expect(catalog.applySnapshot).not.toHaveBeenCalled();
    expect(saved.settings.schoolName).toBe("Updated School");
    catalog.snapshot.mockResolvedValue({ ok: true, data: changed });
    expect((await dataService.getAll()).settings.schoolName).toBe("Updated School");
    expect(localStorage.length).toBe(0);
  });
  it("reloads assignments for a different school year after saving its profile", async () => {
    fakeApi();
    const changed = { ...snapshot, revision: 1, settings: { ...snapshot.settings, school_year: "2027-2028" } };
    const saveSettings = vi.fn().mockResolvedValue({ ok: true, data: changed });
    Object.assign(window.api!.catalog, { saveSettings });
    const list = vi.mocked(window.api!.schedule.list);
    const { dataService } = await import("../../src/services/dataService");
    const school = await dataService.getAll();
    const saved = await dataService.saveSettings({ ...school.settings, schoolYear: "2027-2028" });
    expect(list).toHaveBeenLastCalledWith({ schoolYear: "2027-2028" });
    expect(saved.settings.schoolYear).toBe("2027-2028");
    expect(saved.assignments).toHaveLength(0);
  });
  it("persists the supplied school identity only when the SQLite school name is blank", async () => {
    const catalog = fakeApi();
    catalog.snapshot.mockResolvedValueOnce({ ok: true, data: {
      ...snapshot, settings: { ...snapshot.settings, school_name: "" },
    } });
    const named = {
      ...snapshot,
      revision: 1,
      settings: {
        ...snapshot.settings,
        school_name: "ICT High School of Eastern Biliran",
      },
    };
    const ensure = vi.fn().mockResolvedValue({ ok: true, data: named });
    Object.assign(window.api!.catalog, { ensureSchoolName: ensure });
    const { dataService } = await import("../../src/services/dataService");
    const initial = await dataService.getAll();
    expect(initial.settings.schoolName).toBe("");
    expect((await dataService.ensureSchoolName())?.settings.schoolName).toBe(
      "ICT High School of Eastern Biliran",
    );
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(await dataService.ensureSchoolName()).toMatchObject({ settings: { schoolName: named.settings.school_name } });
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });
  it("lets an import handle a rejected write without claiming success or mutating loaded data", async () => {
    const catalog = fakeApi();
    catalog.applySnapshot.mockResolvedValueOnce({ ok: false, error: { code: "INVALID_INPUT", message: "Imported teacher was rejected" } });
    const { dataService } = await import("../../src/services/dataService");
    const data = await dataService.getAll();
    const next = { ...data, teachers: [{ id: "te-import", name: "New Teacher", specialization: "General", employmentType: "Permanent" as const, minHours: 18, maxHours: 30 }] };
    await expect(dataService.saveAll(next)).rejects.toThrow("Imported teacher was rejected");
    expect((await dataService.getAll()).teachers).toHaveLength(0);
  });

  it("loads actual empty SQLite catalog data instead of seeding the browser mock", async () => {
    const catalog = fakeApi();
    const { dataService } = await import("../../src/services/dataService");
    const school = await dataService.getAll();
    expect(school.teachers).toHaveLength(0);
    expect(school.sections).toHaveLength(0);
    expect(school.settings.schoolName).toBe("Test School");
    expect(school.timeSlots[0]?.period).toBe(1);
    expect(catalog.snapshot).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });

  it("does not advance committed state after rejection", async () => {
    const catalog = fakeApi();
    catalog.applySnapshot.mockResolvedValueOnce({ ok: false, error: { code: "INVALID_INPUT", message: "Rejected teacher" } });
    const { dataService } = await import("../../src/services/dataService");
    const base = await dataService.getAll();
    const rejected = dataService.saveAll({ ...base, teachers: [{ id: "te-temp", name: "Rejected", specialization: "General", employmentType: "Permanent", minHours: 18, maxHours: 30 }] });
    const recovery = dataService.importCatalog("teachers", [{ name: "Accepted", specialization: "General", employmentType: "Permanent", minHours: 18, maxHours: 30 }]);
    await expect(rejected).rejects.toThrow("Rejected teacher");
    expect((await recovery).teachers.map((teacher) => teacher.name)).toEqual(["Accepted"]);
    expect(catalog.applySnapshot.mock.calls[1]?.[0]).toMatchObject({ expectedRevision: 0, teachers: [{ name: "Accepted" }] });
    expect(catalog.snapshot).toHaveBeenCalledTimes(1);
  });

  it("returns the authoritative catalog snapshot from a successful CRUD write", async () => {
    const catalog = fakeApi();
    catalog.applySnapshot.mockResolvedValueOnce({ ok: true, data: {
      revision: 1, idMap: { "te-temp": "91" }, snapshot: {
        ...snapshot, revision: 1, teachers: [{ id: 91, name: "Canonical Teacher", name_key: "canonical teacher", specialization: "General", employment_type: "Permanent", min_hours: 18, max_hours: 30 }],
      },
    } });
    const { dataService } = await import("../../src/services/dataService");
    const base = await dataService.getAll();
    const committed = await dataService.saveAll({ ...base, teachers: [{ id: "te-temp", name: "Draft Teacher", specialization: "General", employmentType: "Permanent", minHours: 18, maxHours: 30 }] });
    expect(committed).toMatchObject({ teachers: [{ id: "91", name: "Canonical Teacher" }] });
    expect(catalog.snapshot).toHaveBeenCalledTimes(1);
  });

  it("preserves legacy adviser identity with duplicate teacher names", async () => {
    const catalog = fakeApi();
    const teacher = { id: 1, name: "Ana Cruz", name_key: "ana cruz", specialization: "General", employment_type: "Permanent" as const, min_hours: 18, max_hours: 30 };
    catalog.snapshot.mockResolvedValueOnce({ ok: true, data: {
      ...snapshot,
      teachers: [teacher, { ...teacher, id: 2, name: "ANA CRUZ" }],
      sections: [
        { id: 3, name: "7 Edge", grade_level: 7, school_level: "JHS", bell_schedule_id: 2, adviser_teacher_id: 1 },
        { id: 4, name: "7 Chrome", grade_level: 7, school_level: "JHS", bell_schedule_id: 2, adviser_teacher_id: null },
      ],
    } });
    const { dataService } = await import("../../src/services/dataService");
    const base = await dataService.getAll();
    const imported = await dataService.importCatalog("rooms", [{ name: "Room A", capacity: 40, type: "Classroom" }]);
    expect(imported.sections[0]?.adviser).toBe("Ana Cruz");
    const saved = await dataService.saveAll({ ...imported, sections: imported.sections.map((section) => ({ ...section, adviser: "Ana Cruz" })) });
    expect(saved.sections.map((section) => section.adviser)).toEqual(["Ana Cruz", ""]);
    expect(base.sections[0]?.adviser).toBe("Ana Cruz");
    expect(catalog.snapshot).toHaveBeenCalledTimes(1);
  });

  it("preserves legacy adviser identity after a teacher rename and later import", async () => {
    const catalog = fakeApi();
    catalog.snapshot.mockResolvedValueOnce({ ok: true, data: {
      ...snapshot,
      teachers: [{ id: 1, name: "Ana Cruz", name_key: "ana cruz", specialization: "General", employment_type: "Permanent", min_hours: 18, max_hours: 30 }],
      sections: [{ id: 3, name: "7 Edge", grade_level: 7, school_level: "JHS", bell_schedule_id: 2, adviser_teacher_id: 1 }],
    } });
    const { dataService } = await import("../../src/services/dataService");
    const base = await dataService.getAll();
    catalog.snapshot.mockRejectedValue(new Error("Refresh unavailable"));
    const saved = await dataService.saveAll({
      ...base, teachers: [{ ...base.teachers[0]!, name: "Ana Reyes" }],
    });
    const imported = await dataService.importCatalog("rooms", [{ name: "Room A", capacity: 40, type: "Classroom" }]);
    expect(saved.sections[0]?.adviser).toBe("Ana Reyes");
    expect(imported.sections[0]?.adviser).toBe("Ana Reyes");
    expect(catalog.applySnapshot.mock.calls[0]?.[0]).toMatchObject({ teachers: [{ id: "1", name: "Ana Reyes" }], sections: [{ id: "3", adviser: "Ana Cruz" }] });
    expect(catalog.applySnapshot.mock.calls[1]?.[0]).toMatchObject({ expectedRevision: 1, teachers: [{ id: "1", name: "Ana Reyes" }], sections: [{ id: "3", adviser: "Ana Reyes" }] });
    expect(catalog.snapshot).toHaveBeenCalledTimes(1);
  });

  it("sends page-level catalog edits through one atomic IPC operation", async () => {
    const catalog = fakeApi();
    const { dataService } = await import("../../src/services/dataService");
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

  it("rejects an assignment for a nonexistent section before invoking scheduling IPC", async () => {
    const catalog = fakeApi();
    const { dataService } = await import("../../src/services/dataService");
    const data = await dataService.getAll();
    await expect(dataService.saveAll({
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
    })).rejects.toThrow("Section not found");
    expect(catalog.applySnapshot).not.toHaveBeenCalled();
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
    ).toEqual([expect.stringContaining("Section not found")]);
  });
});
