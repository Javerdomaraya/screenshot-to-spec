# Excel import repair and timetable extraction

User reports a fatal page after importing the supplied class-program workbook under each entity type. They explicitly chose automatic timetable extraction. Existing tabular import assumes row 1 of the first (possibly hidden) sheet and confirms wholly unmapped rows, producing nameless records. The two references contain timetable matrices, multiple sheets and no room records.

## Required behavior

- Catch parsing errors and show an import-specific error; never append nameless or invalid records.
- Workbook sheet selection: default to all visible sheets for class-program extraction; hidden sheets are explicitly labelled and opt-in. Flat-table import chooses one sheet and auto-detects its header; allow header-row correction.
- Detect program worksheets and extract only the requested Teachers/Sections/Subjects. Rooms in these files produce a clear absence message, not invented records.
- Preview normalized records with editable values before confirmation. Explain defaults for teacher employment/load. Show source warnings, validation issues and duplicate counts. Invalid rows block confirmation.
- Require a nonblank name, valid numbers/enumerations and grade/school-level consistency. Match advisers to existing teachers or let the user correct/clear them. Deduplicate names (subjects by name+grade), including against existing records.
- Confirm saves through dataService before updating the screen or reporting success. Persistence failures leave the preview available for correction.
- Preserve existing school data, schedule rules, schema and generated files.

## Interfaces and ownership

Shared types in src/lib/importTypes.ts: ImportTarget, ImportRow, ProgramExtraction {recognized,rows,warnings}.

### Task 1: Timetable adapter (delegated)

Create src/lib/classProgramImport.ts exporting extractClassProgram(workbook: XLSX.WorkBook, target: ImportTarget, sheetNames: readonly string[]): ProgramExtraction. Tests in src/test/class-program-import.test.ts. Follow only supplied sheetNames, not every hidden template. Explicit teacher headers/adviser footers, section headers/grades, taught subject rows and actual clock durations are the sources. Exclude letterheads, weekdays, breaks and teacher subrows. Subject minutes aggregate each section's weekly teaching cells; conflicting per-section totals leave minutes blank and warn for review. Never infer room records.

### Task 2: Safe table parsing, validation and UI (root)

Create src/lib/importWorkbook.ts for sheet/header inspection, row conversion, validation and duplicate handling. Integrate into src/routes/index.tsx and an extracted src/components/ImportPanel.tsx. Data service adds an optional rejected-write mode for imports while existing saveAll callers keep handled errors. Focused tests cover unmapped input, invalid/missing fields, duplicates, invalid/corrupt files, sheet selection, editable extraction, failed persistence and no fatal page across all four targets.

### Task 3: Verification

Reproduce with actual workbooks, confirm the invalid-row downstream crash before the fix, then verify extraction/preview for each data type. Test class-program and ordinary table imports, repeated imports and no-room guidance. Run the full suite, focused lint/type checks and web/desktop builds. Review independently and call javer7 show_changes once at the end.

## Progress

- [x] Investigated source and workbook structure.
- [x] User authorized timetable extraction.
- [x] Adapter and tests (existing extraction confirmed in 13 parser tests).
- [x] Safe importer, preview and persistence (catalog transaction returns committed data without a post-write read).
- [ ] Browser reproduction with the original school workbooks (no .xlsx reference files were present in this workspace); fixture-based regression tests pass.
- [x] Full suite: 100/100 tests. Electron and renderer TypeScript checks pass; desktop and web builds succeed.
- [x] Focused ESLint rules pass on changed source files with legacy Prettier formatting enforcement disabled.
- [ ] Full formatting lint (existing widespread Prettier errors) and original-workbook reproduction remain open.
