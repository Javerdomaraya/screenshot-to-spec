import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  listImportSheets,
  prepareWorkbookImport,
  readImportWorkbook,
} from "@/lib/imports/importWorkbook";
import { buildImportPreview } from "@/lib/imports/importRecords";
import { makeSampleData } from "@/services/dataService";

function book(sheets: Record<string, unknown[][]>) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets))
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  return workbook;
}
describe("workbook import source selection", () => {
  it("decodes UTF-8 CSV without a BOM including accented names and quoted commas or newlines", () => {
    const csv =
      'Full name,Specialization\r\n"José Peña","Mathematics, JHS"\r\n"Juvy Cañete","Reading\nLiterature"\r\n';
    const loaded = readImportWorkbook("Teachers.csv", new TextEncoder().encode(csv).buffer);
    expect(loaded.warnings).toEqual([]);
    const imported = prepareWorkbookImport(loaded.workbook, "teachers", "visible");
    expect(imported.rows).toEqual([
      expect.objectContaining({ "Full name": "José Peña", Specialization: "Mathematics, JHS" }),
      expect.objectContaining({
        "Full name": "Juvy Cañete",
        Specialization: "Reading\nLiterature",
      }),
    ]);
    const school = makeSampleData();
    school.teachers.push({
      id: "accent",
      name: "José Peña",
      specialization: "",
      employmentType: "Permanent",
      minHours: 0,
      maxHours: 30,
    });
    const preview = buildImportPreview("teachers", imported.rows, imported.mapping, school);
    expect(preview.duplicateCount).toBe(1);
    expect(preview.additions).toEqual([expect.objectContaining({ name: "Juvy Cañete" })]);
  });
  it("decodes UTF-8 BOM and both UTF-16 BOM variants for CSV", () => {
    const csv = "Name\r\nJosé Peña\r\n";
    const utf8 = new TextEncoder().encode(csv);
    const little = new Uint8Array([
      0xff,
      0xfe,
      ...Array.from(csv).flatMap((char) => [char.charCodeAt(0), 0]),
    ]);
    const big = new Uint8Array([
      0xfe,
      0xff,
      ...Array.from(csv).flatMap((char) => [0, char.charCodeAt(0)]),
    ]);
    for (const bytes of [new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]), little, big]) {
      const result = readImportWorkbook("teachers.CSV", bytes.buffer);
      expect(prepareWorkbookImport(result.workbook, "teachers", "visible").rows[0]?.["Name"]).toBe(
        "José Peña",
      );
      expect(result.warnings).toEqual([]);
    }
  });
  it("warns when legacy Windows-1252 decoding is necessary", () => {
    const bytes = new Uint8Array([
      78, 97, 109, 101, 13, 10, 74, 111, 115, 233, 32, 80, 101, 241, 97,
    ]);
    const result = readImportWorkbook("teachers.csv", bytes.buffer);
    expect(prepareWorkbookImport(result.workbook, "teachers", "visible").rows[0]?.["Name"]).toBe(
      "José Peña",
    );
    expect(result.warnings.join(" ")).toMatch(/Windows-1252|encoding/i);
  });
  it("leaves XLSX binary parsing intact", () => {
    const original = book({ Teachers: [["Name"], ["José Peña"]] });
    const bytes = XLSX.write(original, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const result = readImportWorkbook("School.xlsx", bytes);
    expect(result.warnings).toEqual([]);
    expect(prepareWorkbookImport(result.workbook, "teachers", "visible").rows[0]?.["Name"]).toBe(
      "José Peña",
    );
  });
  it("finds the real table headings below a title and blank rows", () => {
    const workbook = book({
      Teachers: [
        ["School teacher list"],
        [],
        ["Full name", "Specialization", "Minimum weekly hours"],
        ["New Teacher", "Science", 0],
      ],
    });
    const result = prepareWorkbookImport(workbook, "teachers", "visible");
    expect(result.headerRow).toBe(3);
    expect(result.mapping["Full name"]).toBe("name");
    expect(result.rows[0]?.["Full name"]).toBe("New Teacher");
  });
  it("labels hidden sheets and never selects the first hidden template by default", () => {
    const workbook = book({
      Old: [["Name"], ["Old Teacher"]],
      Current: [["Name"], ["Current Teacher"]],
    });
    workbook.Workbook = {
      Sheets: [
        { name: "Old", Hidden: 1 },
        { name: "Current", Hidden: 0 },
      ],
    };
    expect(listImportSheets(workbook)[0]).toMatchObject({ name: "Old", hidden: true });
    expect(prepareWorkbookImport(workbook, "teachers", "visible").rows[0]?.["Name"]).toBe(
      "Current Teacher",
    );
    expect(prepareWorkbookImport(workbook, "teachers", "sheet:Old").rows[0]?.["Name"]).toBe(
      "Old Teacher",
    );
  });
  it("lets the user select the room sheet from the same workbook", () => {
    const workbook = book({
      Teachers: [["Name"], ["Teacher One"]],
      Rooms: [
        ["Room name", "Capacity", "Room type"],
        ["Room 201", 35, "Classroom"],
      ],
    });
    const result = prepareWorkbookImport(workbook, "rooms", "sheet:Rooms");
    expect(result.mapping["Room name"]).toBe("name");
    expect(result.rows[0]?.["Room name"]).toBe("Room 201");
  });
  it("supports an explicit header row when headings are unusual", () => {
    const workbook = book({ List: [["Title"], ["Person", "Area"], ["New Teacher", "Science"]] });
    const result = prepareWorkbookImport(workbook, "teachers", "sheet:List", 2);
    expect(result.headerRow).toBe(2);
    expect(result.rows[0]?.["Person"]).toBe("New Teacher");
  });
  it("does not mistake a room's Classroom type for a new header row", () => {
    const workbook = book({
      Rooms: [
        ["Space", "Seats", "Type"],
        ["Room 201", 35, "Classroom"],
        ["Room 202", 40, "Classroom"],
      ],
    });
    const result = prepareWorkbookImport(workbook, "rooms", "visible");
    expect(result.headerRow).toBe(1);
    expect(result.rows).toHaveLength(2);
  });
  it("reports an empty workbook and an invalid header row", () => {
    expect(() => prepareWorkbookImport(book({}), "teachers", "visible")).toThrow(/worksheet/i);
    expect(() =>
      prepareWorkbookImport(book({ List: [["Name"], ["New Teacher"]] }), "teachers", "visible", 0),
    ).toThrow(/header row/i);
  });
});
