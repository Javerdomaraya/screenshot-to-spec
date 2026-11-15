import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { extractClassProgram } from "../../src/lib/imports/classProgramImport";

function program(
  cells: Record<string, string | number> = {},
  merges: string[] = [],
): XLSX.WorkSheet {
  const values: Record<string, string | number> = {
    A2: "Republic of the Philippines",
    A3: "GRADE 8 CLASS PROGRAM",
    A4: "SECTION",
    C4: "GRADE 8 - EDGE",
    A5: "TIME/DAY",
    B5: "NO. OF MINUTES",
    C5: "MONDAY",
    D5: "TUESDAY",
    E5: "WEDNESDAY",
    F5: "THURSDAY",
    G5: "FRIDAY",
    ...cells,
  };
  const sheet: XLSX.WorkSheet = { "!ref": "A1:Q30" };
  for (const [address, value] of Object.entries(values)) {
    sheet[address] = { t: typeof value === "number" ? "n" : "s", v: value };
  }
  sheet["!merges"] = merges.map((range) => XLSX.utils.decode_range(range));
  return sheet;
}

function workbook(sheets: Record<string, XLSX.WorkSheet>): XLSX.WorkBook {
  return { SheetNames: Object.keys(sheets), Sheets: sheets };
}

describe("class-program workbook extraction", () => {
  function pairedMerges(continuation = "Chin-Chin Bustillo") {
    const sheet: XLSX.WorkSheet = { "!ref": "A1:Q32" };
    const cells: Record<string, string> = {
      A3: "GRADE 11 CLASS PROGRAM",
      A20: "SECTION",
      M20: "G11 - AVAST",
      A21: "TIME/DAY",
      B21: "NO. OF MINUTES",
      M21: "MONDAY",
      N21: "TUESDAY",
      O21: "WEDNESDAY",
      P21: "THURSDAY",
      Q21: "FRIDAY",
      A22: "7:30 - 8:30",
      M22: "PKLP",
      O22: "PKLP",
      A24: "8:30 - 9:30",
      M24: continuation,
      O24: continuation,
    };
    for (const [address, value] of Object.entries(cells)) sheet[address] = { t: "s", v: value };
    sheet["!merges"] = ["M22:M23", "O22:O23", "M24:M25", "O24:O25"].map((range) =>
      XLSX.utils.decode_range(range),
    );
    return workbook({ "C_prog_G11 (2H)": sheet });
  }

  it("counts a trusted ordinary full-name teacher continuation and never invents a subject", () => {
    const book = pairedMerges();
    const result = extractClassProgram(book, "subjects", book.SheetNames, {
      teacherNames: ["Chin-Chin Bustillo"],
    });
    expect(result.reviewItems).toEqual([]);
    expect(result.rows).toEqual([{ name: "PKLP", gradeLevel: 11, minutesPerWeek: 240 }]);
  });

  it("requests source-cell decisions instead of inventing a subject or precise weekly totals", () => {
    const book = pairedMerges();
    const result = extractClassProgram(book, "subjects", book.SheetNames, { teacherNames: [] });
    expect(result.rows).toEqual([{ name: "PKLP", gradeLevel: 11, minutesPerWeek: "" }]);
    expect(result.reviewItems.map((item) => item.id)).toEqual([
      "C_prog_G11 (2H)!M24",
      "C_prog_G11 (2H)!O24",
    ]);
    expect(result.reviewItems[0]).toMatchObject({
      sheetName: "C_prog_G11 (2H)",
      cellAddress: "M24",
      text: "Chin-Chin Bustillo",
      precedingSubject: "PKLP",
    });
    const choices: Record<string, "teacher-continuation"> = Object.fromEntries(
      result.reviewItems.map(({ id }) => [id, "teacher-continuation"]),
    );
    expect(
      extractClassProgram(book, "subjects", book.SheetNames, {
        teacherNames: [],
        resolutions: choices,
      }).rows,
    ).toEqual([{ name: "PKLP", gradeLevel: 11, minutesPerWeek: 240 }]);
  });

  it("allows a two-row legitimate subject to be explicitly classified as a subject", () => {
    const book = pairedMerges("Creative Writing");
    const undecided = extractClassProgram(book, "subjects", book.SheetNames, { teacherNames: [] });
    const chosen = extractClassProgram(book, "subjects", book.SheetNames, {
      teacherNames: [],
      resolutions: Object.fromEntries(undecided.reviewItems.map(({ id }) => [id, "subject"])),
    });
    expect(chosen.reviewItems).toHaveLength(2);
    expect(chosen.rows).toEqual([
      { name: "PKLP", gradeLevel: 11, minutesPerWeek: 120 },
      { name: "Creative Writing", gradeLevel: 11, minutesPerWeek: 120 },
    ]);
  });

  it("does not extend a prior lesson from a noncontiguous known teacher cell", () => {
    const book = pairedMerges();
    book.Sheets["C_prog_G11 (2H)"]!["A24"]!.v = "9:00 - 10:00";
    const result = extractClassProgram(book, "subjects", book.SheetNames, {
      teacherNames: ["Chin-Chin Bustillo"],
    });
    expect(result.rows).toEqual([{ name: "PKLP", gradeLevel: 11, minutesPerWeek: 120 }]);
  });
  it("extracts explicit teacher names without fabricating master fields or reading unselected hidden sheets", () => {
    const book = workbook({
      TP_G8: program({ A3: "TEACHER'S PROGRAM", C4: "ANA S. CRUZ", A20: "CLASS ADVISER" }),
      Hidden: program({ A3: "TEACHER'S PROGRAM", C4: "HIDDEN TEACHER" }),
      CP_G8: program({ A20: "CLASS ADVISER", C20: "MARIA D. REYES" }),
    });
    book.Workbook = {
      Sheets: [
        { name: "TP_G8", Hidden: 0 },
        { name: "Hidden", Hidden: 1 },
        { name: "CP_G8", Hidden: 0 },
      ],
    };

    expect(extractClassProgram(book, "teachers", ["TP_G8", "CP_G8"]).rows).toEqual([
      { name: "ANA S. CRUZ" },
      { name: "MARIA D. REYES" },
    ]);
    expect(extractClassProgram(book, "teachers", ["Hidden"]).rows).toEqual([
      { name: "HIDDEN TEACHER" },
    ]);
  });

  it("rejects a section label accidentally placed in an adviser cell", () => {
    const result = extractClassProgram(
      workbook({ CP_G8: program({ A20: "CLASS ADVISER", C20: "EDGE" }) }),
      "teachers",
      ["CP_G8"],
    );
    expect(result.rows).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/adviser/i);
  });

  it("derives section grades and school levels and leaves conflicting advisers for review", () => {
    const book = workbook({
      Original: program({
        A3: "GRADE 11 CLASS PROGRAM",
        C4: "G11 - AVAST",
        A20: "CLASS ADVISER",
        C20: "ANA S. CRUZ",
      }),
      Revision: program({
        A3: "SENIOR HIGH SCHOOL CLASS PROGRAM",
        A2: "GRADE 11",
        C4: "AVAST",
        A20: "CLASS ADVISER",
        C20: "MARIA D. REYES",
      }),
    });
    const result = extractClassProgram(book, "sections", book.SheetNames);
    expect(result.rows).toEqual([
      { name: "G11 - AVAST", gradeLevel: 11, schoolLevel: "SHS", adviser: "" },
    ]);
    expect(result.warnings.join(" ")).toMatch(/conflicting.*adviser/i);
  });

  it("uses clock durations and merged day and row coverage while excluding teacher subrows and fixed events", () => {
    const sheet = program(
      {
        A6: "7:30 - 8:20",
        B6: 999,
        C6: "MATHEMATICS 8",
        E6: "SCIENCE 8",
        E7: "A. Cruz",
        A8: "8:20 - 9:10",
        B8: 999,
        E8: "SCIENCE 8",
        E9: "A. Cruz",
        A10: "9:10 - 9:20",
        C10: "HEALTH BREAK",
        A12: "11:30 - 1:00",
        C12: "LUNCH BREAK",
        A14: "1:00 - 2:30",
        C14: "ENGLISH 8",
        C15: "M. Reyes",
        A16: "2:30 - 3:00",
        C16: "FLAG LOWERING",
      },
      ["C6:D9", "C10:G11", "C12:G13"],
    );
    const result = extractClassProgram(workbook({ CP_G8: sheet }), "subjects", ["CP_G8"]);
    expect(result.rows).toEqual([
      { name: "MATHEMATICS 8", gradeLevel: 8, minutesPerWeek: 200 },
      { name: "SCIENCE 8", gradeLevel: 8, minutesPerWeek: 100 },
      { name: "ENGLISH 8", gradeLevel: 8, minutesPerWeek: 90 },
    ]);
  });

  it("associates an explicit teacher continuation hour with its preceding lesson", () => {
    const sheet = program(
      {
        A6: "7:30 - 8:30",
        C6: "GENERAL SCIENCE",
        A8: "8:30 - 9:30",
        C8: "ANA S. CRUZ",
        A20: "CLASS ADVISER",
        C20: "ANA S. CRUZ",
      },
      ["C6:C7", "C8:C9"],
    );
    expect(extractClassProgram(workbook({ CP_G8: sheet }), "subjects", ["CP_G8"]).rows).toEqual([
      { name: "GENERAL SCIENCE", gradeLevel: 8, minutesPerWeek: 120 },
    ]);
  });

  it("does not treat lessons on a teacher program as subject catalog records", () => {
    const sheet = program({
      A3: "TEACHER'S PROGRAM",
      C4: "ANA S. CRUZ",
      A6: "7:30 - 8:30",
      C6: "GENERAL SCIENCE",
    });
    expect(extractClassProgram(workbook({ TP_G8: sheet }), "subjects", ["TP_G8"]).rows).toEqual([]);
  });

  it("keeps abbreviated curriculum labels and excludes plural preparation events", () => {
    const sheet = program({
      A6: "7:00 - 7:15",
      C6: "CLASS PREPARATIONS",
      A8: "7:30 - 8:20",
      C8: "GEN. SCIENCE",
      A10: "8:20 - 9:10",
      C10: "ARAL. PAN 8",
      A12: "9:20 - 10:10",
      C12: "VAL. EDUC. 8",
    });
    expect(extractClassProgram(workbook({ CP_G8: sheet }), "subjects", ["CP_G8"]).rows).toEqual([
      { name: "GEN. SCIENCE", gradeLevel: 8, minutesPerWeek: 50 },
      { name: "ARAL. PAN 8", gradeLevel: 8, minutesPerWeek: 50 },
      { name: "VAL. EDUC. 8", gradeLevel: 8, minutesPerWeek: 50 },
    ]);
  });

  it("leaves weekly minutes blank when the same subject has different totals across sections", () => {
    const sheet = program({
      H4: "GRADE 8 - CHROME",
      H5: "MONDAY",
      I5: "TUESDAY",
      J5: "WEDNESDAY",
      K5: "THURSDAY",
      L5: "FRIDAY",
      A6: "7:30 - 8:20",
      C6: "MATHEMATICS 8",
      D6: "MATHEMATICS 8",
      H6: "MATHEMATICS 8",
    });
    const result = extractClassProgram(workbook({ CP_G8: sheet }), "subjects", ["CP_G8"]);
    expect(result.rows).toEqual([{ name: "MATHEMATICS 8", gradeLevel: 8, minutesPerWeek: "" }]);
    expect(result.warnings.join(" ")).toMatch(/minutes.*differ|different.*minutes/i);
  });

  it("combines matching grade-suffixed subject labels before comparing section totals", () => {
    const sheet = program({
      A3: "GRADE 9 CLASS PROGRAM",
      C4: "GRADE 9 - EDGE",
      H4: "GRADE 9 - CHROME",
      H5: "MONDAY",
      I5: "TUESDAY",
      J5: "WEDNESDAY",
      K5: "THURSDAY",
      L5: "FRIDAY",
      A6: "7:30 - 8:20",
      C6: "FILIPINO 9",
      H6: "FILIPINO 9",
      I6: "FILIPINO 9",
      J6: "FILIPINO 9",
      K6: "FILIPINO 9",
      A8: "8:20 - 9:10",
      C8: "FILIPINO",
      D8: "FILIPINO",
      E8: "FILIPINO",
    });
    const result = extractClassProgram(workbook({ CP_G9: sheet }), "subjects", ["CP_G9"]);
    expect(result.rows).toEqual([{ name: "FILIPINO 9", gradeLevel: 9, minutesPerWeek: 200 }]);
    expect(result.warnings.join(" ")).not.toMatch(/minutes.*differ/i);
  });

  it("skips ambiguous merged electives with a review warning", () => {
    const sheet = program({ A6: "7:30 - 8:20", C6: "ELECTIVE A / ELECTIVE B", A8: "8:20 - 9:10" }, [
      "C6:G9",
    ]);
    const result = extractClassProgram(workbook({ CP_G8: sheet }), "subjects", ["CP_G8"]);
    expect(result.rows).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/ambiguous|elective/i);
  });

  it("skips generic specialization placeholders and conflicting subject grade labels", () => {
    const sheet = program({ A6: "7:30 - 8:20", C6: "SPECIALIZATION", D6: "TLE 10" });
    const result = extractClassProgram(workbook({ CP_G8: sheet }), "subjects", ["CP_G8"]);
    expect(result.rows).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/specialization/i);
    expect(result.warnings.join(" ")).toMatch(/grade.*10|10.*grade/i);
  });

  it("recognizes a timetable without inventing rooms", () => {
    const result = extractClassProgram(workbook({ CP_G8: program() }), "rooms", ["CP_G8"]);
    expect(result.recognized).toBe(true);
    expect(result.rows).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/no room|room.*not.*present/i);
  });

  it("leaves ordinary entity lists to the table importer", () => {
    const book = workbook({
      Teachers: XLSX.utils.aoa_to_sheet([
        ["Name", "Specialization"],
        ["Ana Cruz", "Science"],
      ]),
    });
    expect(extractClassProgram(book, "teachers", ["Teachers"])).toEqual({
      recognized: false,
      rows: [],
      warnings: [],
      reviewItems: [],
    });
  });
});
