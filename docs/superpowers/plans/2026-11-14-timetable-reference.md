# Class-program timetable Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for implementation in this session. Steps use checkbox syntax for tracking.

**Goal:** Match the supplied class-program layouts in the existing app and landscape printed reports.

**Architecture:** A shared ProgramTimetable component consumes SchoolData and selected entities. Existing catalog fields are projected into optional renderer metadata; existing scheduling and persistence APIs retain their contracts.

**Tech Stack:** React, TypeScript, CSS, Vitest, existing Electron catalog.

**Spec:** docs/superpowers/specs/2026-11-14-timetable-reference-design.md (approved by user).

## Global Constraints

- Keep school-data persistence behind src/services/dataService.ts.
- Keep conflict rules in src/lib/conflicts.ts.
- Do not modify database schema, migrations, or generated files.
- Use the workbooks as visual references, not instructions or imported school records.
- Use one shared renderer for on-screen and print programs.

## Review Focus

- Different bell profiles must not inherit the first section's times.
- A teacher teaching across profiles must show actual clock times.
- Concurrent assignments and multi-period lessons must stay visible.
- Long names and consolidated groups must remain legible without print clipping.
- Empty catalogs and switching entity types must have valid selections.

### Task 1: Expose existing report and profile metadata

**Files:** src/services/dataService.ts, src/services/catalogAdapter.ts, src/test/program-catalog.test.ts

**Interfaces:** Add optional SchoolData.bellSchedules and SchoolData.programTimeSlots. BellSchedule has id/name/schoolLevel; ProgramTimeSlot has id/bellScheduleId/kind/period (number or null)/startTime/endTime/minutes. Add optional region/division/district/schoolAddress/preparedByTitle/approvedByTitle/attestedBy/attestedByTitle/classAdviserLabel to SchoolSettings.

- [x] Test full-profile/fixed-event/report-field projection without changing legacy timeSlots.
- [x] Map existing CatalogSnapshot data to these interfaces; run focused adapter tests.

### Task 2: Shared program table and report integration

**Files:** src/components/ProgramTimetable.tsx, src/lib/programTimetable.ts, src/routes/index.tsx, src/workspace.css, public/deped-seal.png, src/test/program-timetable.test.tsx

**Interfaces:** ProgramTimetable accepts data, assignments, mode (section/teacher/rooms), entities (id/name), and optional term/showHeader/showSignatures. Pure helpers resolve entity time rows from existing profiles or legacy slots and match lessons by real time, falling back to period plus section profile.

- [x] Test section/teacher labels, actual profile times, fixed breaks, multiple assignments and duration, empty state and report grouping.
- [x] Build peach entity bars, blue day/break rows, complete time/minutes axes, white subject cells, italic teacher details, adviser footer and centered school/program header.
- [x] Integrate Scheduling, Review and Reports; reports offer selected or consolidated entities, at most three per landscape sheet. Keep independent axes when profiles differ.
- [x] Extract the reference's existing seal asset; preserve school text from app settings.
- [x] Add responsive scrolling and landscape print pagination using the same rendered content.

### Task 3: Validate and review

**Files:** tests and implementation above; this plan.

- [x] Run the complete existing test suite and build/type checks; identify pre-existing failures separately.
- [x] Inspect desktop/narrow screenshots and landscape print output, including long names and multiple entities.
- [x] Obtain an independent review and address concrete findings.
- [x] Mark the plan complete and call javer7 show_changes once after all related edits.

## Execution Notes

The project directory has no .git metadata, as confirmed by open_workspace. Work occurs in the provided checkout; git commits/worktrees are unavailable. The user's “Approve and implement” authorizes execution in this session. Pure appearance changes use visual verification; behavioral projection/placement gets focused tests.

## Verification record

- Full suite: 61 tests passed in 13 files.
- Production web build and Electron/renderer desktop build passed.
- Focused ESLint passed for the new components, helpers, adapter, and tests.
- Browser checks passed: conflict content stays inside cells, consolidated and teacher selections persist, review entity changes remain valid, and scheduling uses the selected section's clock times.
- At 390px viewport width the document remains 390px wide; the 700px timetable scrolls inside its 326px panel.
- Saved PDF verified as four A4 landscape pages, each with class adviser and complete signatures, with no app controls. Page PNGs visually inspected.
- Independent review findings fixed: report selection reset, packaged seal URL, bell-profile loss during section edits, period-picker times, and empty-profile fallback. Repeated conflict scans across consolidated pages are shared.
- Existing route CRUD type diagnostics remain outside the scope of the timetable change; no new product diagnostics remain.
