export type ImportTarget = "teachers" | "sections" | "subjects" | "rooms";
export type ImportRow = Record<string, string | number | boolean>;
export type ProgramCellResolution = "teacher-continuation" | "subject";
export interface ProgramReviewItem {
  id: string;
  sheetName: string;
  cellAddress: string;
  text: string;
  precedingSubject: string | null;
}
export interface ImportContext {
  teacherNames: readonly string[];
  resolutions?: Readonly<Record<string, ProgramCellResolution>>;
}
export interface ProgramExtraction {
  recognized: boolean;
  rows: ImportRow[];
  warnings: string[];
  reviewItems: ProgramReviewItem[];
}
