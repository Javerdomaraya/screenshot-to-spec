import * as XLSX from "xlsx";
import type {
  ImportContext,
  ImportRow,
  ImportTarget,
  ProgramExtraction,
  ProgramReviewItem,
} from "./importTypes";

const weekdays = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
const clean = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
const keyOf = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const sectionKey = (name: string) =>
  keyOf(name.replace(/^(?:GRADE\s*|G\s*)?(?:7|8|9|10|11|12)\s*[-–—:]?\s*/i, ""));
const fixedEvent = (name: string) =>
  /\b(?:CLASS PREPARATIONS?|FLAG RAISING|FLAG LOWERING|HEALTH BREAK|LUNCH BREAK|RECESS|ASSEMBLY|TIME\/DAY|CLASS ADVISER)\b/i.test(
    name,
  );
const ambiguousSubject = (name: string) =>
  /elective|speciali[sz]ed subject|^SPECIALI[ZS]ATION$|choose (?:one|any)|\sor\s|\//i.test(name);

interface Block {
  column: number;
  timeColumn: number;
  name: string;
  grade: number | undefined;
  adviser: string;
}

interface ProgramSheet {
  name: string;
  sheet: XLSX.WorkSheet;
  range: XLSX.Range;
  headerRow: number;
  teacherProgram: boolean;
  blocks: Block[];
}

function cellText(sheet: XLSX.WorkSheet, row: number, column: number): string {
  return clean(sheet[XLSX.utils.encode_cell({ r: row, c: column })]?.v);
}

function mergedCell(sheet: XLSX.WorkSheet, row: number, column: number) {
  const range = sheet["!merges"]?.find(
    (merge) => row >= merge.s.r && row <= merge.e.r && column >= merge.s.c && column <= merge.e.c,
  );
  return {
    range,
    text: cellText(sheet, range?.s.r ?? row, range?.s.c ?? column),
  };
}

function gradeFrom(text: string): number | undefined {
  const match = text.match(/\b(?:GRADE\s*|G\s*)(7|8|9|10|11|12)\b/i);
  return match ? Number(match[1]) : undefined;
}

function inspectProgram(name: string, sheet: XLSX.WorkSheet): ProgramSheet | null {
  if (!sheet["!ref"]) return null;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  let headerRow = -1;
  for (let row = range.s.r; row <= Math.min(range.e.r, 80); row++) {
    for (let column = range.s.c; column <= range.e.c; column++) {
      if (/^TIME\s*\/\s*DAY$/i.test(cellText(sheet, row, column))) {
        headerRow = row;
        break;
      }
    }
    if (headerRow >= 0) break;
  }
  if (headerRow < 0) return null;
  const heading = Array.from({ length: headerRow }, (_, row) =>
    Array.from({ length: range.e.c + 1 }, (_, column) => cellText(sheet, row, column)).join(" "),
  ).join(" ");
  const teacherProgram = /TEACHER.?S?\s*(?:PROGRAM|PROG)|^TP[_\s-]/i.test(`${name} ${heading}`);
  if (!teacherProgram && !/CLASS\s+PROGRAM/i.test(heading)) return null;
  let sectionRow = headerRow - 1;
  for (let row = headerRow - 1; row >= Math.max(0, headerRow - 3); row--) {
    if (
      Array.from({ length: range.e.c + 1 }, (_, column) => cellText(sheet, row, column)).includes(
        "SECTION",
      )
    ) {
      sectionRow = row;
      break;
    }
  }
  const defaultGrade = gradeFrom(heading) ?? gradeFrom(name.replace(/_/g, " "));
  const blocks: Block[] = [];
  for (let column = range.s.c; column <= range.e.c - 4; column++) {
    if (
      !weekdays.every(
        (day, index) => cellText(sheet, headerRow, column + index).toUpperCase() === day,
      )
    )
      continue;
    let timeColumn = 0;
    for (let before = 0; before < column; before++) {
      if (/^TIME\s*\/\s*DAY$/i.test(cellText(sheet, headerRow, before))) timeColumn = before;
    }
    const label = mergedCell(sheet, sectionRow, column).text;
    if (!label || label === "SECTION") continue;
    let adviser = "";
    for (let row = headerRow + 1; row <= range.e.r; row++) {
      if (/^CLASS ADVISER$/i.test(cellText(sheet, row, timeColumn)))
        adviser = mergedCell(sheet, row, column).text;
    }
    blocks.push({
      column,
      timeColumn,
      name: label,
      grade: gradeFrom(label) ?? defaultGrade,
      adviser,
    });
  }
  return blocks.length ? { name, sheet, range, headerRow, teacherProgram, blocks } : null;
}

function isPersonDetail(name: string, teacherNames: Set<string>): boolean {
  return (
    teacherNames.has(keyOf(name)) ||
    /(?:^|\s)[A-ZÀ-Ý]\.\s*\p{L}/u.test(name) ||
    /^[A-Z]{1,3}\s+[A-ZÀ-Ý][a-zà-ÿ]+/.test(name) ||
    /\b(?:Jr\.?|Sr\.?)$/i.test(name)
  );
}

function intervalFrom(text: string): { start: number; end: number; minutes: number } | null {
  const match = text.match(
    /^(\d{1,2})[:.](\d{2})\s*(AM|PM)?\s*[-–—]\s*(\d{1,2})[:.](\d{2})\s*(AM|PM)?$/i,
  );
  if (!match) return null;
  const clock = (hours: number, minutes: number, marker: string | undefined) => {
    if (hours > 23 || minutes > 59 || (marker && (hours < 1 || hours > 12))) return null;
    return (
      (marker ? (hours % 12) + (marker.toUpperCase() === "PM" ? 12 : 0) : hours) * 60 + minutes
    );
  };
  let start = clock(Number(match[1]), Number(match[2]), match[3]);
  let end = clock(Number(match[4]), Number(match[5]), match[6]);
  if (start === null || end === null) return null;
  // Unmarked afternoon times in these school programs use a 12-hour clock.
  if (!match[3] && start < 7 * 60) start += 12 * 60;
  if (!match[6] && end < 7 * 60) end += 12 * 60;
  if (end <= start && !match[6]) end += 12 * 60;
  const minutes = end - start;
  return minutes > 0 && minutes <= 6 * 60 ? { start, end, minutes } : null;
}

export function extractClassProgram(
  workbook: XLSX.WorkBook,
  target: ImportTarget,
  sheetNames: readonly string[],
  context: ImportContext = { teacherNames: [] },
): ProgramExtraction {
  const warnings = new Set<string>();
  const reviewItems = new Map<string, ProgramReviewItem>();
  const programs = [...new Set(sheetNames)].flatMap((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return [];
    const program = inspectProgram(name, sheet);
    return program ? [program] : [];
  });
  if (!programs.length) return { recognized: false, rows: [], warnings: [], reviewItems: [] };
  if (target === "rooms")
    return {
      recognized: true,
      rows: [],
      warnings: [
        "No room records are present in this class-program format. Import a room list or add rooms in Data Setup.",
      ],
      reviewItems: [],
    };

  const sectionNames = new Set(
    programs
      .filter((program) => !program.teacherProgram)
      .flatMap((program) => program.blocks.map((block) => sectionKey(block.name))),
  );
  const teacherRows = new Map<string, ImportRow>();
  for (const program of programs) {
    for (const block of program.blocks) {
      if (program.teacherProgram && !fixedEvent(block.name) && !gradeFrom(block.name))
        teacherRows.set(keyOf(block.name), { name: block.name });
      if (!block.adviser) continue;
      if (
        sectionNames.has(sectionKey(block.adviser)) ||
        gradeFrom(block.adviser) ||
        fixedEvent(block.adviser)
      ) {
        warnings.add(
          `${program.name}: adviser value “${block.adviser}” is a section or label and was skipped.`,
        );
        block.adviser = "";
      } else teacherRows.set(keyOf(block.adviser), { name: block.adviser });
    }
  }
  if (target === "teachers")
    return {
      recognized: true,
      rows: [...teacherRows.values()],
      warnings: [...warnings],
      reviewItems: [],
    };

  const sections = new Map<
    string,
    { row: ImportRow; advisers: Set<string>; adviserNames: Set<string> }
  >();
  for (const program of programs.filter((item) => !item.teacherProgram)) {
    for (const block of program.blocks) {
      if (!block.grade) {
        warnings.add(
          `${program.name}: the grade for “${block.name}” could not be identified; this section was skipped.`,
        );
        continue;
      }
      const key = `${block.grade}:${sectionKey(block.name)}`;
      let section = sections.get(key);
      if (!section) {
        section = {
          row: {
            name: block.name,
            gradeLevel: block.grade,
            schoolLevel: block.grade >= 11 ? "SHS" : "JHS",
          },
          advisers: new Set(),
          adviserNames: new Set(),
        };
        sections.set(key, section);
      }
      if (block.adviser) {
        section.advisers.add(keyOf(block.adviser));
        section.adviserNames.add(block.adviser);
        section.row["adviser"] = section.advisers.size === 1 ? block.adviser : "";
      }
      if (section.advisers.size > 1)
        warnings.add(
          `Conflicting advisers for “${String(section.row["name"])}”: ${[...section.adviserNames].join(" / ")}. Choose an adviser in the preview.`,
        );
    }
  }
  if (target === "sections")
    return {
      recognized: true,
      rows: [...sections.values()].map((section) => section.row),
      warnings: [...warnings],
      reviewItems: [],
    };

  const teacherNames = new Set([...teacherRows.keys(), ...context.teacherNames.map(keyOf)]);
  const subjects = new Map<string, { row: ImportRow; totals: Map<string, number> }>();
  const unresolvedSubjects = new Set<string>();
  for (const program of programs.filter((item) => !item.teacherProgram)) {
    for (const block of program.blocks) {
      if (!block.grade) continue;
      const totals = new Map<string, number>();
      const previous: Array<{ subject: string; end: number; merge?: XLSX.Range } | undefined> = [];
      const seenLessons = new Set<string>();
      const addMinutes = (
        subject: string,
        day: number,
        interval: { start: number; end: number; minutes: number },
      ) => {
        const lesson = `${subject}:${day}:${interval.start}:${interval.end}`;
        if (!seenLessons.has(lesson))
          totals.set(subject, (totals.get(subject) ?? 0) + interval.minutes);
        seenLessons.add(lesson);
      };
      for (let row = program.headerRow + 1; row <= program.range.e.r; row++) {
        // Only actual time anchors count. Resolved time merges would count the
        // teacher/detail subrow as a second full lesson.
        const interval = intervalFrom(cellText(program.sheet, row, block.timeColumn));
        if (!interval) continue;
        for (let day = 0; day < 5; day++) {
          const cell = mergedCell(program.sheet, row, block.column + day);
          const text = cell.text;
          const merge = cell.range;
          if (merge && (merge.s.c < block.column || merge.e.c > block.column + 4)) {
            if (text)
              warnings.add(
                `${program.name}: ambiguous merged lesson ${XLSX.utils.encode_range(merge)} crosses sections and was skipped.`,
              );
            previous[day] = undefined;
            continue;
          }
          if (!text || fixedEvent(text)) {
            if (!text && merge && merge.e.c > merge.s.c && merge.e.r > merge.s.r)
              warnings.add(
                `${program.name}: merged lesson area ${XLSX.utils.encode_range(merge)} has no readable subject label and was skipped. Review any electives shown as drawings.`,
              );
            previous[day] = undefined;
            continue;
          }
          if (ambiguousSubject(text)) {
            warnings.add(
              `${program.name}: ambiguous elective/combined subject “${text}” was skipped; enter its subjects and weekly minutes manually.`,
            );
            previous[day] = undefined;
            continue;
          }
          const labelGrade = text.match(/\b(7|8|9|10|11|12)\s*$/)?.[1];
          if (labelGrade && Number(labelGrade) !== block.grade) {
            warnings.add(
              `${program.name}: subject “${text}” has a Grade ${labelGrade} label in a Grade ${block.grade} section and was skipped. Review the source label.`,
            );
            previous[day] = undefined;
            continue;
          }
          const preceding = previous[day];
          const cellAddress = XLSX.utils.encode_cell({
            r: merge?.s.r ?? row,
            c: merge?.s.c ?? block.column + day,
          });
          const reviewId = `${program.name}!${cellAddress}`;
          const relatedSubject = preceding && subjects.get(preceding.subject);
          const sameColumnMerge = Boolean(
            preceding?.merge &&
            merge &&
            preceding.merge.s.c === merge.s.c &&
            preceding.merge.e.c === merge.e.c &&
            preceding.merge.e.r + 1 === merge.s.r &&
            preceding.merge.e.r > preceding.merge.s.r &&
            merge.e.r > merge.s.r,
          );
          const contiguous = preceding?.end === interval.start;
          // Unrecognized text is ambiguous only when matching merged row-pairs
          // establish it as a continuation. Multiword subjects alone are not names.
          const structuralContinuation = sameColumnMerge && contiguous;
          const resolution = context.resolutions?.[reviewId];
          if (structuralContinuation && !isPersonDetail(text, teacherNames)) {
            reviewItems.set(reviewId, {
              id: reviewId,
              sheetName: program.name,
              cellAddress,
              text,
              precedingSubject: String(relatedSubject?.row["name"] ?? "") || null,
            });
            if (!resolution) {
              if (preceding) unresolvedSubjects.add(preceding.subject);
              previous[day] = undefined;
              continue;
            }
          }
          if (isPersonDetail(text, teacherNames) || resolution === "teacher-continuation") {
            if (contiguous && preceding) {
              addMinutes(preceding.subject, day, interval);
              warnings.add(
                `${program.name}: teacher-name continuation hours were included in the preceding lesson. Review calculated weekly minutes.`,
              );
            }
            previous[day] = undefined;
            continue;
          }
          // The section already supplies the grade. A matching grade suffix
          // labels the same subject, including when a sheet omits it in some cells.
          const subjectName = labelGrade
            ? text.replace(/\b(?:7|8|9|10|11|12)\s*$/, "").replace(/[-–—\s]+$/, "")
            : text;
          const subjectKey = `${block.grade}:${keyOf(subjectName)}`;
          if (!subjects.has(subjectKey))
            subjects.set(subjectKey, {
              row: { name: text, gradeLevel: block.grade, minutesPerWeek: "" },
              totals: new Map(),
            });
          addMinutes(subjectKey, day, interval);
          previous[day] = {
            subject: subjectKey,
            end: interval.end,
            ...(merge ? { merge } : {}),
          };
        }
      }
      for (const [subjectKey, total] of totals) {
        subjects
          .get(subjectKey)
          ?.totals.set(`${program.name}:${block.column}:${sectionKey(block.name)}`, total);
      }
    }
  }
  for (const subject of subjects.values()) {
    const totals = [...new Set(subject.totals.values())];
    const name = String(subject.row["name"] ?? "");
    const subjectKey = `${String(subject.row["gradeLevel"])}:${keyOf(name.replace(/\b(?:7|8|9|10|11|12)\s*$/, "").replace(/[-–—\s]+$/, ""))}`;
    subject.row["minutesPerWeek"] =
      !unresolvedSubjects.has(subjectKey) && totals.length === 1 ? totals[0]! : "";
    if (totals.length > 1)
      warnings.add(
        `Weekly minutes differ for “${String(subject.row["name"])}” (Grade ${String(subject.row["gradeLevel"])}): ${totals.join(" / ")}. Enter the intended weekly minutes in the preview.`,
      );
  }
  return {
    recognized: true,
    rows: [...subjects.values()].map((subject) => subject.row),
    warnings: [...warnings],
    reviewItems: [...reviewItems.values()],
  };
}
