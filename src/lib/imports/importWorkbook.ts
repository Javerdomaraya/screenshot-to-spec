import * as XLSX from "xlsx";
import { extractClassProgram } from "./classProgramImport";
import { importFields } from "./importRecords";
import type { ImportContext, ImportRow, ImportTarget, ProgramReviewItem } from "./importTypes";

export interface ImportSheet { name: string; hidden: boolean }
export interface WorkbookImport {
  format: "table" | "program";
  rows: ImportRow[];
  headers: string[];
  mapping: Record<string, string>;
  headerRow: number;
  warnings: string[];
  reviewItems: ProgramReviewItem[];
}

/** Decode textual CSVs before handing them to SheetJS; XLSX remains binary. */
export function readImportWorkbook(
  filename: string,
  bytes: ArrayBuffer,
): { workbook: XLSX.WorkBook; warnings: string[] } {
  if (!/\.csv$/i.test(filename)) {
    return { workbook: XLSX.read(bytes, { type: "array" }), warnings: [] };
  }
  const source = new Uint8Array(bytes);
  const utf8Bom = source[0] === 0xef && source[1] === 0xbb && source[2] === 0xbf;
  const utf16Le = source[0] === 0xff && source[1] === 0xfe;
  const utf16Be = source[0] === 0xfe && source[1] === 0xff;
  const warnings: string[] = [];
  let text: string;
  if (utf16Le || utf16Be) {
    text = new TextDecoder(utf16Le ? "utf-16le" : "utf-16be", { fatal: true }).decode(source);
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(source);
    } catch (error) {
      if (utf8Bom) throw error;
      text = new TextDecoder("windows-1252", { fatal: true }).decode(source);
      warnings.push(
        "CSV bytes were not valid UTF-8. Decoded as Windows-1252; review all accented names and the file encoding before confirming.",
      );
    }
  }
  return { workbook: XLSX.read(text, { type: "string" }), warnings };
}

export function listImportSheets(workbook: XLSX.WorkBook): ImportSheet[] {
  return workbook.SheetNames.map((name, index) => {
    const metadata = workbook.Workbook?.Sheets?.find((sheet) => sheet.name === name) ?? workbook.Workbook?.Sheets?.[index];
    return { name, hidden: Boolean(metadata?.Hidden) };
  });
}

const normalize = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function matchField(target: ImportTarget, heading: string): string {
  const nameAliases: Record<ImportTarget, string[]> = {
    teachers: ["name", "teacher", "teachername", "fullname", "instructor", "instructorname"],
    sections: ["name", "section", "sectionname", "class", "classname"],
    subjects: ["name", "subject", "subjectname", "course", "coursename"],
    rooms: ["name", "room", "roomname", "classroom", "classroomname", "space"],
  };
  const value = normalize(heading);
  if (nameAliases[target].includes(value)) return "name";
  const aliases: Record<string, string[]> = {
    gradeLevel: ["grade", "gradelevel"],
    minutesPerWeek: ["minutesperweek", "weeklyminutes", "requiredminutesperweek"],
    minHours: ["minhours", "minimumhours", "minimumweeklyhours"],
    maxHours: ["maxhours", "maximumhours", "maximumweeklyhours"],
    adviser: ["adviser", "advisor", "classadviser", "classadvisor"],
    schoolLevel: ["schoollevel", "jhsshs"],
    employmentType: ["employmenttype", "employmentstatus"],
    specialization: ["specialization", "specialisation", "specialty"],
    capacity: ["capacity", "roomcapacity", "seats", "seatingcapacity"],
    type: ["type", "roomtype"],
  };
  return importFields[target].find((field) => normalize(field.key) === value || normalize(field.label) === value || aliases[field.key]?.includes(value))?.key ?? "";
}

export function prepareWorkbookImport(workbook: XLSX.WorkBook, target: ImportTarget, selection: string, headerOverride?: number, context?: ImportContext): WorkbookImport {
  const sheets = listImportSheets(workbook);
  if (!sheets.length) throw new Error("No worksheet was found in this file.");
  const names = selection === "visible" ? sheets.filter((sheet) => !sheet.hidden).map((sheet) => sheet.name) : [selection.startsWith("sheet:") ? selection.slice(6) : selection];
  if (!names.length) throw new Error("All worksheets are hidden. Choose a worksheet to preview it.");
  if (names.some((name) => !workbook.Sheets[name])) throw new Error("Choose an available worksheet.");
  const program = extractClassProgram(workbook, target, names, context);
  if (program.recognized) {
    const headers = importFields[target].map((field) => field.key).filter((key) => program.rows.some((row) => Object.hasOwn(row, key)));
    return { format: "program", rows: program.rows, headers, mapping: Object.fromEntries(headers.map((key) => [key, key])), headerRow: 1, warnings: program.warnings, reviewItems: program.reviewItems };
  }
  const name = names[0]!;
  const sheet = workbook.Sheets[name]!;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: true, raw: false });
  if (!matrix.some((row) => row.some((value) => String(value ?? "").trim()))) throw new Error(`Worksheet “${name}” is empty.`);
  if (matrix.length > 10050) throw new Error("This worksheet is too large to import at once. Split it into lists of up to 10,000 records.");
  let headerRow = headerOverride;
  if (headerRow === undefined) {
    let bestScore = -1;
    headerRow = matrix.findIndex((row) => row.some((value) => String(value ?? "").trim())) + 1;
    matrix.slice(0, 50).forEach((row, index) => {
      const matched = new Set(row.map((value) => matchField(target, String(value ?? ""))).filter(Boolean));
      const score = matched.size + (matched.has("name") ? 2 : 0);
      if (score > bestScore && score > 0) { bestScore = score; headerRow = index + 1; }
    });
  }
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > matrix.length) throw new Error(`Header row must be between 1 and ${matrix.length}.`);
  const heading = matrix[headerRow - 1]!;
  const width = Math.max(heading.length, ...matrix.slice(headerRow).map((row) => row.length));
  if (width > 200) throw new Error("Choose a worksheet with no more than 200 columns.");
  const counts = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, index) => {
    const base = String(heading[index] ?? "").trim() || `Column ${XLSX.utils.encode_col(index)}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
  const rows = matrix.slice(headerRow).filter((row) => row.some((value) => String(value ?? "").trim())).map((row): ImportRow => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? "").trim()])));
  if (rows.length > 10000) throw new Error("Import up to 10,000 records at a time.");
  if (!rows.length) throw new Error(`No data rows were found below header row ${headerRow}.`);
  const mapping = Object.fromEntries(headers.map((header) => [header, matchField(target, header)]));
  const warnings: string[] = [];
  if (names.length > 1) warnings.push(`Tabular preview uses worksheet “${name}”. Choose a specific worksheet to import another list from this workbook.`);
  if (!Object.values(mapping).includes("name")) warnings.push("No Name column matched automatically. Correct the header row or map the name column before importing.");
  return { format: "table", rows, headers, mapping, headerRow, warnings, reviewItems: [] };
}
