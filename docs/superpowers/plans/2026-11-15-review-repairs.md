# Review Repairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair all eight verified review findings without losing existing school records or changing the app's overall design.

**Architecture:** Return authoritative committed state through dataService, use canonical academic-year identities with compatible reads, and share strict clock-interval resolution for scheduling and workload. Keep editable import drafts separate from normalized records and make ambiguous source extraction explicit.

**Tech Stack:** Existing TypeScript, React, Electron, better-sqlite3, SheetJS, Vitest, and Testing Library; no new packages.

**Spec:** docs/superpowers/specs/2026-11-15-review-repairs-design.md

## Global Constraints

- Keep school-data persistence behind src/services/dataService.ts.
- Keep schedule validation rules in src/lib/conflicts.ts; SQLite/main-process validation remains authoritative for desktop writes.
- Do not edit supabase/migrations/, drizzle/, automatically generated files, secrets, or published Git history.
- No schema migration, bulk year rewrite, destructive data repair, new dependency, or new IPC endpoint is required by this proposal.
- Test with in-memory/disposable databases and generated fictional workbook fixtures. Do not write to the installed school's database or modify the supplied workbooks.
- Current checkout has no .git directory. Do not initialize Git or claim commits; provide a reviewable file diff instead.

## Review Focus

1. A committed write followed by unavailable read endpoints must remain successful, and a later import must retain the committed records (Task 1).
2. A pending/rejected mutation must not close the form, remove dependent schedules, show success, or admit a duplicate submission (Task 2).
3. Existing assignments/elective reservations under both year aliases must remain visible and conflict with each other without deleting either row (Task 3).
4. Mixed profiles, multi-period continuations, touching endpoints, and fractional workload thresholds must use actual durations (Tasks 4-6).
5. Raw text/number drafts, Unicode CSV names, and unknown teacher-continuation cells must survive review without silent coercion or guesses (Tasks 7-9).

## Delivery order and ownership

Persistence: Tasks 1 -> 2 -> 3. Scheduling: Task 4 -> Tasks 5 and 6, integrated after Tasks 1-3. Imports: Tasks 7-9 can be prepared independently; serialize edits to index.tsx and shared import files. Task 10 verifies the integrated result. One owner integrates each shared file; parallel agents must not edit it concurrently.

## Task 1: Reconcile and return committed state

**Files:** Modify src/services/dataService.ts; tests src/test/data-service-ipc.test.ts, src/test/catalog-import-service.test.ts, src/test/schedule-data-service.test.ts.

**Interfaces:** Change saveAll(next: SchoolData): Promise<SchoolData> to reject failed writes and return a clone of committed state. Keep importCatalog(target: ImportTarget, rows: ImportRow[]): Promise<SchoolData>. Generalize the existing catalogAfterImport fallback internally; no shared IPC contract changes.

- [ ] Add regressions named `retains a successful CRUD record when a later import follows unavailable refresh endpoints`, `does not advance committed state after rejection`, and `preserves legacy adviser identity with duplicate teacher names`. Assert the first and second teacher both remain after the second write; assert no extra snapshot read after commit; assert a rejected write does not poison the queue.
- [ ] Run `npm test -- src/test/data-service-ipc.test.ts src/test/catalog-import-service.test.ts src/test/schedule-data-service.test.ts` and confirm the new assertions fail for the reviewed reasons.
- [ ] Consume CatalogApplyResult.snapshot when present. Reconstruct legacy responses without another read, preserving existing adviser IDs when still applicable and resolving adviser names only when unique. Compute mapped IDs, revision, snapshot, and SchoolData locally, then install them together. Reconcile authoritative ScheduleChangeResult rows for schedule writes, including returned IDs/times, instead of retaining temporary draft timing.
- [ ] Remove swallowed-error success semantics from saveAll. Keep the internal queue tail settled after either outcome so future writes can proceed. Update service wrappers/types and test mocks to the new return contract; do not add a post-commit getAll read.
- [ ] Re-run the focused command; all new and existing cases pass, including legacy no-snapshot/default bell profile and schedule-only writes. Review the task diff; commit only if a real Git checkout exists at execution time.

## Task 2: Show success only after persistence

**Files:** Modify src/routes/index.tsx; tests src/test/data-setup-table.test.tsx, src/test/import-flow.test.tsx, src/test/program-reports.test.tsx; create src/test/mutation-flow.test.tsx.

**Interfaces:** updateData(next: SchoolData): Promise<boolean> awaits Task 1 saveAll, installs its returned data only on success, and handles failure visibly. A mutationPending guard covers entity create/update/delete, assignment create/delete, generation, import, and settings/year changes; dependent controls stay disabled while a conflicting mutation is pending.

- [ ] Add deferred/rejected-write UI cases: invalid minHours 31/maxHours 30; rejected create/update; deletion of a teacher/section/room used by a class; rejected assignment save/delete; two clicks while pending. Assert no success notification or dialog closure, unchanged committed rows/assignments, one submission, and successful use of returned database IDs. Keep forms/edit drafts available after rejection.
- [ ] Run `npm test -- src/test/mutation-flow.test.tsx src/test/data-setup-table.test.tsx` and verify the new cases fail before changing handlers.
- [ ] Await updateData in every mutation caller before success/closing. Keep backend dependency protection: remove the renderer's implicit assignment cascade for catalog deletes, submit catalog-only deletion, and display IN_USE guidance. Do not split dependency deletion into sequential catalog/schedule commits. Use finally to release pending controls after success or failure.
- [ ] Make saveAll mocks return the expected SchoolData rather than undefined. Keep importCatalog/saveSettings as awaited service operations and coordinate them with the same pending guard. Do not broadly reformat the route.
- [ ] Run `npm test -- src/test/mutation-flow.test.tsx src/test/data-setup-table.test.tsx src/test/import-flow.test.tsx src/test/program-reports.test.tsx`; confirm pending, retry, failure, and returned-ID cases pass. Review the focused diff.

## Task 3: Unify school-year aliases without rewriting data

**Files:** Create shared/school-year.ts and src/test/school-year.test.ts. Modify electron/services/catalog.ts, electron/services/schedule.ts, electron/services/conflicts.ts, electron/db/repositories/assignments.ts, src/services/catalogAdapter.ts, src/services/dataService.ts, src/routes/index.tsx. Extend src/test/sqlite-repositories.test.ts, src/test/schedule-service.test.ts, src/test/catalog-service.test.ts, src/test/data-service-ipc.test.ts, src/test/topbar.test.tsx, src/test/settings-ui.test.tsx.

**Interfaces:** normalizeSchoolYear(value: string): string returns canonical YYYY-YYYY for either supported separator; schoolYearAliases(value: string): string[] returns canonical and legacy aliases without duplicates; formatSchoolYear(value: string): string returns an en-dash display label. Trim and preserve other currently permitted labels; retain existing length/required validation.

- [ ] Add cases for hyphen -> another year -> original year, both selector locations, canonical new settings/assignment/group writes, and an actually different year. In disposable SQLite, create assignments under both spellings and assert both IDs are listed unchanged, overlap validation blocks either spelling, and conflicts report preexisting duplicates. Add elective-group membership/reservation cases across aliases.
- [ ] Run `npm test -- src/test/school-year.test.ts src/test/sqlite-repositories.test.ts src/test/schedule-service.test.ts src/test/catalog-service.test.ts src/test/topbar.test.tsx src/test/settings-ui.test.tsx`; establish expected failures.
- [ ] Use shared helpers at settings/assignment/group write boundaries and both UI selectors. Normalize renderer settings and compare canonical identities when deciding whether to reload a year.
- [ ] Update every year-filtered assignment/group listing, overlap query, elective reservation query, and membership comparison. Use parameterized indexed IN predicates over aliases, not SQL replace applied to each stored row. Include raw SQL in schedule.ts and conflicts.ts, not only repository methods.
- [ ] Re-run the focused tests plus data-service-ipc.test.ts. Assert row counts/IDs are unchanged by alias reads and that genuine years remain isolated. No bulk update, deduplication, or migration. Review the focused diff.

## Task 4: Resolve strict teaching intervals once

**Files:** Create src/lib/scheduleTiming.ts and src/test/schedule-timing.test.ts. Modify src/lib/conflicts.ts, src/lib/programTimetable.ts, src/services/dataService.ts, src/components/ProgramTimetable.tsx, src/routes/index.tsx; extend src/test/conflicts.test.ts and src/test/program-timetable.test.tsx.

**Interfaces:** Export getSectionTeachingSlots(data: SchoolData, sectionId: string): TeachingSlot[] and resolveAssignmentInterval(data: SchoolData, assignment: Assignment): IntervalResult from scheduleTiming.ts. TeachingSlot has id, period, startMinute, endMinute. IntervalResult is `{ok:true;startMinute:number;endMinute:number}` or `{ok:false;message:string}`. Helpers must have no React, persistence, or toast imports. Extend validateAssignmentConflicts(assignment: Assignment, assignments: Assignment[], data: SchoolData): string[] and collectScheduleConflicts(assignments: Assignment[], data: SchoolData): ScheduleConflict[] to consume resolved intervals. Update the dashboard, report, and ProgramTimetable call sites to supply data; interval preparation failures must prevent a false valid manual validation result.

- [ ] Add cases for SHS 07:30-08:30 vs JHS 08:20-09:10, adjacent 08:30 endpoints, durationPeriods 2, invalid/missing periods, zero/negative duration, breaks/gaps, explicit profile mismatch, stored authoritative times, and legacy browser timeSlots. Assert overlaps on clock time and separate terms/days remain independent.
- [ ] Run `npm test -- src/test/schedule-timing.test.ts src/test/conflicts.test.ts src/test/program-timetable.test.tsx`; verify the missing strict-resolution behavior fails.
- [ ] Extract profile selection/timing from programTimetable into the strict helper, preserving fixed events when checking contiguous periods. Prefer valid authoritative saved minutes; reject invalid candidates instead of mapping them to 00:00. Keep getAssignmentInterval's display interface compatible with a safe explicit fallback for malformed legacy rows so reports do not crash.
- [ ] Extend conflict checking to resolve candidate and existing assignments before comparisons; reuse the existing teacher/section/room rules. Update memo dependencies where conflict calculation now consumes data. Browser dataService validation uses this path. Keep desktop service validation authoritative and avoid importing renderer runtime values into Electron code.
- [ ] Re-run focused tests, including existing report tests if display behavior changed. Review the focused diff.

## Task 5: Validate and generate using section clock times

**Files:** Create src/lib/generateSchedule.ts and src/test/generate-schedule.test.ts. Modify src/routes/index.tsx, src/services/dataService.ts; extend src/test/schedule-data-service.test.ts and src/test/mutation-flow.test.tsx.

**Interfaces:** generateScheduleCandidates(data: SchoolData, term: Term, validate: (candidate: Assignment) => Promise<string[]>): Promise<Assignment[]> returns only new staged candidates; it never persists. Use Task 4 intervals/conflicts for local existing-plus-staged checks. dataService.validateAssignment(assignment: Assignment): Promise<string[]> returns domain conflicts but rejects infrastructure/API failures, allowing generation to abort rather than silently skip a broken service.

- [ ] Add cases that skip the mixed-profile overlap, occupied continuation periods, and nonteaching rows; find a later valid placement; prevent conflicts between staged additions; honor a main-process elective reservation omitted from renderer assignments; and abort on rejected validation. Keep deterministic greedy ordering and one placement per selected subject.
- [ ] Run `npm test -- src/test/generate-schedule.test.ts src/test/schedule-data-service.test.ts src/test/mutation-flow.test.tsx`; confirm the reviewed generator and Validate failures.
- [ ] Generate from each section's actual teaching slots. Reject local conflicts before invoking desktop validation; continue on returned domain conflicts and abort on thrown failures. Use unique temporary IDs. Do not silently fall back to another section's profile. Both manual Validate and save use the same dataService validation path with visible errors.
- [ ] Await one Task 1/2 save of all accepted additions using the existing atomic schedule.applyChanges route. Keep displayed assignments unchanged on failure; release pending state and allow retry. The final atomic write must revalidate to handle changes after preflight.
- [ ] Re-run focused tests; verify failure causes no partial batch and no success notification. Record candidate/validation counts for a representative mixed-profile fixture to catch accidental duplicate work without a timing assertion. Review the focused diff.

## Task 6: Calculate workload in minutes

**Files:** Create src/lib/teacherWorkload.ts and src/test/teacher-workload.test.ts; modify src/routes/index.tsx; create src/test/teacher-workload-ui.test.tsx.

**Interfaces:** calculateTeacherLoads(data: SchoolData, assignments: readonly Assignment[]): Map<string, TeacherLoad> sums valid resolved durations once per assignment using Task 4. TeacherLoad is {minutes: number; incomplete: boolean}; mark incomplete when an assignment cannot resolve instead of treating its duration as zero. Select the term before passing assignments. Divide minutes by 60 at the caller; preserve getLoadStatus(hours, thresholds) and the current global thresholds.

- [ ] Add exact assertions: ten two-period SHS blocks -> 1,200 minutes/20 hours; twenty 50-minute JHS classes -> 1,000 minutes/16.666... hours; mixed profiles; no assignments -> zero; a different term is excluded; classification uses the unrounded value around thresholds. Invalid legacy intervals must show an explicit incomplete-load indication rather than claim an accurate total or crash.
- [ ] Run `npm test -- src/test/teacher-workload.test.ts src/test/teacher-workload-ui.test.tsx`; verify assignment-count behavior fails.
- [ ] Replace per-teacher filter/count with one aggregation. Update workload tables, dashboard totals/captions, and relevant report labels from periods/counts to hours where they describe teaching load. Round only display text; do not round before status classification or change teacher-specific policy.
- [ ] Re-run focused tests plus `npm test -- src/test/program-reports.test.tsx`; confirm displayed 20-hour status and fractional boundaries. Review the focused diff.

## Task 7: Preserve raw import drafts

**Files:** Modify src/lib/importRecords.ts, src/components/ImportPanel.tsx; extend src/test/import-records.test.ts and src/test/import-flow.test.tsx.

**Interfaces:** Add draftRows: ImportRow[] to ImportPreview. draftRows preserves mapped defaults/overrides before normalization; rows/additions retain normalized validation/persistence semantics and stable corresponding indexes. ImportPanel renders draftRows and continues reporting edits as strings.

- [ ] Add incremental UI input assertions for `Ana` -> `Ana ` -> `Ana Cruz`, including the intermediate trailing space. Assert final persisted name equals Ana Cruz. Cover numeric `18.` -> `18.5`, `-`, zero, empty required values, invalid numeric text, normalized duplicate names, and preserved drafts after rejected confirmation.
- [ ] Run `npm test -- src/test/import-records.test.ts src/test/import-flow.test.tsx`; establish the keystroke failure.
- [ ] Separate draft construction from trimming/conversion. Bind controls to drafts; use text inputs with decimal inputMode for numeric fields so browsers retain intermediate text. Continue blocking invalid confirmation and revalidate at dataService.importCatalog.
- [ ] Re-run focused tests plus catalog-import-service.test.ts; assert normalized additions and duplicate counts remain correct. Review the focused diff.

## Task 8: Decode CSV without corrupting names

**Files:** Modify src/lib/importWorkbook.ts and src/routes/index.tsx; extend src/test/import-workbook.test.ts and src/test/import-flow.test.tsx.

**Interfaces:** readImportWorkbook(filename: string, bytes: ArrayBuffer): {workbook: XLSX.WorkBook; warnings: string[]} distinguishes CSV from XLSX. Decode UTF-8/BOM and UTF-16 BOM text explicitly before SheetJS string parsing; keep XLSX array parsing. Use Windows-1252 only when strict UTF-8 fails without a recognized BOM and emit a visible encoding-review warning.

- [ ] Add CSV cases for BOM-less UTF-8, UTF-8 BOM, UTF-16 BOM, José Peña/Juvy Cañete, CRLF, quoted commas/newlines, a legacy Windows-1252 name with its warning, and unchanged XLSX. Assert an accented imported name matches an existing teacher and is counted as a duplicate.
- [ ] Run `npm test -- src/test/import-workbook.test.ts src/test/import-flow.test.tsx`; verify the BOM-less Unicode regression fails first.
- [ ] Replace direct XLSX.read in handleImportFile with the helper. Read once, retain the current stale-request guard, and keep file-level encoding warnings across data-type/sheet changes alongside extraction warnings. Decode errors remain import-local and preserve existing school data.
- [ ] Re-run focused tests, including file replacement during a pending read and malformed files. Review the focused diff.

## Task 9: Review ambiguous teacher continuation cells

**Files:** Modify src/lib/importTypes.ts, src/lib/classProgramImport.ts, src/lib/importWorkbook.ts, src/components/ImportPanel.tsx, src/routes/index.tsx; extend src/test/class-program-import.test.ts, src/test/import-workbook.test.ts, src/test/import-flow.test.tsx.

**Interfaces:** Add ProgramCellResolution = `teacher-continuation` | `subject`; ProgramReviewItem {id: string; sheetName: string; cellAddress: string; text: string; precedingSubject: string | null}; ImportContext {teacherNames: readonly string[]; resolutions?: Readonly<Record<string, ProgramCellResolution>>}. Give extractClassProgram and prepareWorkbookImport a final optional context argument. ProgramExtraction/WorkbookImport expose reviewItems. Stable review IDs use selected worksheet plus anchor cell address.

- [ ] Generate a fictional fixture with the structure of C_prog_G11 (2H): contiguous 60-minute intervals, subject merges M22:M23/O22:O23, full teacher-name merges M24:M25/O24:O25. Assert a trusted full name is excluded as a subject and its continuation minutes belong to the preceding lesson. An unknown name in the same evidenced layout must yield a source-cell review item and unresolved affected totals, not a valid invented subject.
- [ ] Add cases for choosing each resolution, restored weekly totals, legitimate subjects such as Creative Writing, noncontiguous teacher text, ordinary same-interval detail subrows, repeated cells/merges without double counting, and unselected hidden-sheet isolation.
- [ ] Run `npm test -- src/test/class-program-import.test.ts src/test/import-workbook.test.ts src/test/import-flow.test.tsx`; establish the full-name regression with the generated fixture, not the Downloads file.
- [ ] Combine trusted loaded identities with explicit teacher headers/advisers from selected worksheets. Use positive layout evidence before requesting a continuation decision; do not add a broad full-name regex. Only an immediately contiguous preceding lesson can receive continuation minutes. Preserve existing warning/weekly-total conflict behavior.
- [ ] Show unresolved source decisions before the editable record step and block that step/confirmation until resolved. Re-extract as choices are made before drafts exist; changing source choices after editing explicitly resets the preview with explanatory copy, so edits cannot vanish silently. Pass loaded teacher context and resolutions through existing workbook refresh paths.
- [ ] Re-run focused tests plus import-records.test.ts/catalog-import-service.test.ts. Inspect generated-fixture UI and the supplied workbooks read-only for Teachers, Sections, Subjects, and the existing no-Rooms message. Review the focused diff.

## Task 10: Integration verification and review

**Files:** Only tests/docs needed to record results; product edits must address a failure discovered by the preceding tasks.

- [ ] Verify every reviewed finding maps to a passing permanent regression; run the targeted tests during each task before broader checks. Do not treat the previous 151-test baseline as proof of the new fixes.
- [ ] Run `npm test -- --reporter=dot`, `npx tsc --noEmit --pretty false`, `npm run typecheck:electron`, and `npm run build:desktop`. Require zero test/type/build failures attributable to this repair.
- [ ] Run focused ESLint on changed source/test files. Compare with the existing formatting-lint baseline; fix new violations without whole-repository formatting changes. Record remaining pre-existing failures explicitly.
- [ ] Smoke-test browser preview and a disposable desktop profile: successful/failed create and delete, year roundtrip with alias rows, mixed-profile generation, both Validate actions, fractional workload, incremental editing, accented CSV duplicates, continuation decisions, and landscape reports.
- [ ] Compare representative extraction/10,000-row preview/generation work with the prior local observations, avoiding absolute CI timing gates. Investigate material regressions before adding caches, workers, or virtualization.
- [ ] Request an independent implementation review across all three stages. Resolve material findings, re-run only the checks justified by resulting changes, then call javer7 show_changes once after the final related edit. Report checks, limitations, and changed files; do not write to the real school database, publish, package-install, or push implicitly.

## Completion checklist

- [ ] Finding 1: no stale-state replacement after successful CRUD.
- [ ] Finding 2: truthful save/delete success and protected dependencies.
- [ ] Finding 3: one logical calendar across supported year aliases.
- [ ] Finding 4: interval-aware manual validation and atomic generation.
- [ ] Finding 5: duration-based workload with accurate thresholds.
- [ ] Finding 6: no silently invented subject from teacher continuations.
- [ ] Finding 7: raw name/number edits survive typing and failed saves.
- [ ] Finding 8: correctly decoded Unicode CSV and duplicate matching.
- [ ] Integrated verification and independent review complete.

## Planning self-review

Coverage: all eight findings map to Tasks 1-9 and the five Review Focus entries have owning tests. Interfaces reuse existing IPC and keep storage/validation boundaries intact. The stages can be reviewed independently, with shared route/import edits integrated serially. No product code was changed to create this plan. Execution remains pending the user's plan review and execution-method choice.
