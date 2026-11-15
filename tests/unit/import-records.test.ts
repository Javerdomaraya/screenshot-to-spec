import { describe, expect, it } from "vitest";
import { buildImportPreview } from "@/lib/imports/importRecords";
import { makeSampleData } from "@/services/dataService";

describe("validated import records", () => {
  it("preserves raw typed drafts separately from normalized validation and persistence", () => {
    const sources = [{ name: "Ana", minHours: 18, maxHours: 30 }];
    const mapping = { name: "name", minHours: "minHours", maxHours: "maxHours" };
    const stages = ["Ana ", "Ana Cruz"];
    const data = makeSampleData();
    data.teachers = data.teachers.filter((teacher) => teacher.name !== "Ana Cruz");
    for (const name of stages) {
      const preview = buildImportPreview("teachers", sources, mapping, data, {
        0: { name, minHours: "18.", maxHours: "30" },
      });
      expect(preview.draftRows[0]).toMatchObject({ name, minHours: "18.", maxHours: "30" });
      expect(preview.rows[0]).toMatchObject({ name: name.trim(), minHours: 18, maxHours: 30 });
      expect(preview.additions[0]?.["name"]).toBe(name.trim());
    }
  });
  it("retains intermediate numeric text and invalid drafts while blocking confirmation", () => {
    const sources = [{ name: "Teacher Test", minHours: 0, maxHours: 30 }];
    const mapping = { name: "name", minHours: "minHours", maxHours: "maxHours" };
    for (const raw of ["-", "not a number", ""]) {
      const preview = buildImportPreview("teachers", sources, mapping, makeSampleData(), {
        0: { minHours: raw },
      });
      expect(preview.draftRows[0]?.["minHours"]).toBe(raw);
      expect(preview.issues.some((issue) => issue.field === "minHours")).toBe(true);
      expect(preview.additions).toEqual([]);
    }
    const fractional = buildImportPreview("teachers", sources, mapping, makeSampleData(), {
      0: { minHours: "18.5" },
    });
    expect(fractional.draftRows[0]?.["minHours"]).toBe("18.5");
    expect(fractional.rows[0]?.["minHours"]).toBe(18.5);
    expect(
      buildImportPreview("teachers", sources, mapping, makeSampleData(), { 0: { minHours: "0" } })
        .rows[0]?.["minHours"],
    ).toBe(0);
  });
  it("blocks a class-program sheet with every column skipped", () => {
    const result = buildImportPreview(
      "teachers",
      [{ __EMPTY: "Republic of the Philippines" }],
      { __EMPTY: "" },
      makeSampleData(),
    );
    expect(result.issues.some((issue) => issue.field === "name")).toBe(true);
    expect(result.additions).toEqual([]);
  });
  it("preserves valid zero workload values and rejects invalid numeric text", () => {
    const result = buildImportPreview(
      "teachers",
      [{ name: "New Teacher", minHours: 0, maxHours: "not a number" }],
      { name: "name", minHours: "minHours", maxHours: "maxHours" },
      makeSampleData(),
    );
    expect(result.rows[0]?.["minHours"]).toBe(0);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "maxHours" })]),
    );
    expect(result.additions).toHaveLength(0);
  });
  it("requires actual grade and minutes for a subject", () => {
    const result = buildImportPreview(
      "subjects",
      [{ name: "New Subject" }],
      { name: "name" },
      makeSampleData(),
    );
    expect(result.issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(["gradeLevel", "minutesPerWeek"]),
    );
  });
  it("deduplicates an imported list and existing names without overwriting records", () => {
    const result = buildImportPreview(
      "teachers",
      [{ name: "Maria Santos" }, { name: "New Teacher" }, { name: " NEW  TEACHER " }],
      { name: "name" },
      makeSampleData(),
    );
    expect(result.duplicateCount).toBe(2);
    expect(result.additions.map((row) => row["name"])).toEqual(["New Teacher"]);
  });
  it("keeps same-named subjects in different grades", () => {
    const result = buildImportPreview(
      "subjects",
      [
        { name: "New Subject", grade: 11, minutes: 300 },
        { name: "New Subject", grade: 12, minutes: 240 },
      ],
      { name: "name", grade: "gradeLevel", minutes: "minutesPerWeek" },
      makeSampleData(),
    );
    expect(result.additions).toHaveLength(2);
  });
  it("requires matching school levels and existing advisers", () => {
    const result = buildImportPreview(
      "sections",
      [{ name: "G11 Test", gradeLevel: 11, schoolLevel: "JHS", adviser: "Unknown Teacher" }],
      { name: "name", gradeLevel: "gradeLevel", schoolLevel: "schoolLevel", adviser: "adviser" },
      makeSampleData(),
    );
    expect(result.issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(["schoolLevel", "adviser"]),
    );
  });
  it("allows corrections in the preview before import", () => {
    const result = buildImportPreview(
      "subjects",
      [{ name: "New Subject" }],
      { name: "name" },
      makeSampleData(),
      { 0: { gradeLevel: 11, minutesPerWeek: 240 } },
    );
    expect(result.issues).toHaveLength(0);
    expect(result.additions[0]).toMatchObject({
      name: "New Subject",
      gradeLevel: 11,
      minutesPerWeek: 240,
    });
  });
  it("validates room capacity and type without creating unnamed rooms", () => {
    const result = buildImportPreview(
      "rooms",
      [{ name: "", capacity: 0, type: "Gym" }],
      { name: "name", capacity: "capacity", type: "type" },
      makeSampleData(),
    );
    expect(result.issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(["name", "capacity", "type"]),
    );
    expect(result.additions).toHaveLength(0);
  });
});
