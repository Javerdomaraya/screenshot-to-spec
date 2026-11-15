import type { SchoolData } from "@/services/dataService";
import type { ImportRow, ImportTarget } from "./importTypes";

export interface ImportField { key: string; label: string; type?: string; options?: string[] }
export const importFields: Record<ImportTarget, ImportField[]> = {
  teachers: [{ key: "name", label: "Full name" }, { key: "specialization", label: "Specialization" }, { key: "employmentType", label: "Employment type", options: ["Permanent", "Contractual", "Part-time"] }, { key: "minHours", label: "Minimum weekly hours", type: "number" }, { key: "maxHours", label: "Maximum weekly hours", type: "number" }],
  sections: [{ key: "name", label: "Section name" }, { key: "gradeLevel", label: "Grade level", type: "number" }, { key: "adviser", label: "Adviser" }, { key: "schoolLevel", label: "School level", options: ["JHS", "SHS"] }],
  subjects: [{ key: "name", label: "Subject name" }, { key: "gradeLevel", label: "Grade level", type: "number" }, { key: "minutesPerWeek", label: "Minutes per week", type: "number" }],
  rooms: [{ key: "name", label: "Room name" }, { key: "capacity", label: "Capacity", type: "number" }, { key: "type", label: "Room type", options: ["Classroom", "Laboratory", "ICT room"] }],
};
export interface ImportIssue { row: number; field: string; message: string }
export interface ImportPreview {
  draftRows: ImportRow[];
  rows: ImportRow[];
  additions: ImportRow[];
  issues: ImportIssue[];
  duplicateIndices: number[];
  duplicateCount: number;
  defaults: string[];
}
export const normalizeImportName = (value: unknown) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

function rowKey(target: ImportTarget, row: ImportRow): string {
  let name = normalizeImportName(row["name"]);
  if (!name) return "";
  if (target === "sections") name = name.replace(/^(?:grade|g)\s*\d{1,2}\s*[-–—:]?\s*/i, "");
  return target === "sections" || target === "subjects" ? `${name}|${row["gradeLevel"]}` : name;
}

export function buildImportPreview(target: ImportTarget, sources: ImportRow[], mapping: Record<string, string>, data: SchoolData, overrides: Record<number, ImportRow> = {}): ImportPreview {
  const fields = importFields[target];
  const supplied = new Set(Object.values(mapping).filter(Boolean));
  const issues: ImportIssue[] = [];
  const defaults: string[] = [];
  const mapped = Object.values(mapping).filter(Boolean);
  if (new Set(mapped).size !== mapped.length) issues.push({ row: 0, field: "mapping", message: "Map each destination field to only one source column." });
  if (sources.length && target === "teachers" && fields.some((field) => field.key !== "name" && !supplied.has(field.key))) defaults.push("Teacher defaults for absent columns: General specialization, Permanent employment, 18 minimum and 30 maximum weekly hours. Review and edit these values before importing.");
  if (sources.length && target === "rooms" && (!supplied.has("capacity") || !supplied.has("type"))) defaults.push("Room defaults for absent columns: capacity 40 and Classroom type. Review and edit these values before importing.");
  const draftRows = sources.map((source, index): ImportRow => {
    const row: ImportRow = {};
    for (const field of fields) row[field.key] = "";
    if (target === "teachers") Object.assign(row, { specialization: "General", employmentType: "Permanent", minHours: 18, maxHours: 30 });
    if (target === "rooms") Object.assign(row, { capacity: 40, type: "Classroom" });
    for (const [header, key] of Object.entries(mapping)) if (key && fields.some((field) => field.key === key)) row[key] = source[header] ?? "";
    if (target === "sections" && !supplied.has("schoolLevel")) {
      const grade = Number(row["gradeLevel"]);
      row["schoolLevel"] = grade >= 11 && grade <= 12 ? "SHS" : grade >= 7 && grade <= 10 ? "JHS" : "";
    }
    Object.assign(row, overrides[index]);
    return row;
  });
  const rows = draftRows.map((draft): ImportRow => {
    const row = { ...draft };
    for (const field of fields) {
      const text = String(row[field.key] ?? "").trim();
      if (field.type === "number") row[field.key] = text !== "" && Number.isFinite(Number(text)) ? Number(text) : text;
      else row[field.key] = field.options?.find((option) => option.toLowerCase() === text.toLowerCase()) ?? text;
    }
    return row;
  });
  const seen = new Set((data[target] as unknown as ImportRow[]).map((row) => rowKey(target, row)).filter(Boolean));
  const duplicateIndices: number[] = [];
  const candidates: ImportRow[] = [];
  rows.forEach((row, index) => {
    const key = rowKey(target, row);
    if (key && seen.has(key)) { duplicateIndices.push(index); return; }
    if (key) seen.add(key);
    const add = (field: string, message: string) => issues.push({ row: index + 1, field, message });
    const text = (field: string, label: string, required: boolean, maximum: number) => {
      const value = String(row[field] ?? "");
      if ((required && !value) || value.length > maximum) add(field, `${label}${required ? " is required and" : ""} must be at most ${maximum} characters.`);
    };
    const number = (field: string, label: string, minimum: number, maximum: number, integer = true) => {
      const value = row[field];
      if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < minimum || value > maximum) add(field, `${label} must be ${integer ? "a whole number " : ""}between ${minimum} and ${maximum}.`);
    };
    text("name", "Name", true, 200);
    for (const field of fields) if (field.options && !field.options.includes(String(row[field.key]))) add(field.key, `${field.label} must be ${field.options.join(", ")}.`);
    if (target === "teachers") {
      text("specialization", "Specialization", false, 500);
      number("minHours", "Minimum hours", 0, 168, false);
      number("maxHours", "Maximum hours", 0, 168, false);
      if (typeof row["minHours"] === "number" && typeof row["maxHours"] === "number" && row["maxHours"] < row["minHours"]) add("maxHours", "Maximum hours must not be below minimum hours.");
    }
    if (target === "subjects" || target === "sections") number("gradeLevel", "Grade level", 7, 12);
    if (target === "subjects") number("minutesPerWeek", "Minutes per week", 1, 10080);
    if (target === "rooms") number("capacity", "Capacity", 1, 10000);
    if (target === "sections") {
      text("adviser", "Adviser", false, 500);
      const expected = Number(row["gradeLevel"]) >= 11 ? "SHS" : "JHS";
      if (row["schoolLevel"] !== expected) add("schoolLevel", "School level must match the section's grade.");
      if (row["adviser"] && !data.teachers.some((teacher) => normalizeImportName(teacher.name) === normalizeImportName(row["adviser"]))) add("adviser", "Import this adviser in Teachers first, correct the name, or clear the adviser field.");
    }
    candidates.push(row);
  });
  return { draftRows, rows, additions: issues.length ? [] : candidates, issues, duplicateIndices, duplicateCount: duplicateIndices.length, defaults };
}
