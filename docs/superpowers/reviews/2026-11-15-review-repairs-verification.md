# E-CLASS eight-finding repair verification

**Project:** `C:\Personal\screenshot-to-spec-main`  
**Date:** November 15, 2026  
**Execution:** Existing checkout, no Git metadata. The recommended subagent runner was attempted but could not start with the available Windows/provider configuration; the approved Superpowers implementation plan was continued directly using test-first changes and local source snapshots.

## Reviewed findings and permanent regression coverage

| Finding | Repair area | Representative regression |
| --- | --- | --- |
| Committed catalog save lost on failed refresh | Authoritative persistence reconciliation | `data-service-ipc.test.ts`, `catalog-import-service.test.ts` |
| UI says saved/deleted before persistence succeeds | Awaited mutations, pending guard, dependent-delete protection | `mutation-flow.test.tsx` |
| Hyphen/en-dash year aliases hide and duplicate schedules | Canonical year identity and compatible SQLite queries | `school-year.test.ts`, `sqlite-repositories.test.ts`, `topbar.test.tsx` |
| Generated SHS/JHS periods overlap | Shared strict section-clock resolver and generator | `schedule-timing.test.ts`, `conflicts.test.ts`, `generate-schedule.test.ts` |
| Workload counts class entries as hours | Duration-based minutes aggregation, incomplete-data status | `teacher-workload.test.ts`, `teacher-workload-ui.test.tsx` |
| A teacher continuation becomes an invented subject | Trusted identity plus explicit source-cell decisions | `class-program-import.test.ts`, `import-flow.test.tsx` |
| Preview edits discard trailing spaces or decimal drafts | Separate raw draft rows from normalized validated rows | `import-records.test.ts`, `import-flow.test.tsx` |
| UTF-8 CSV corrupts accented names | Strict text decoding and reviewed Windows-1252 fallback | `import-workbook.test.ts`, `import-flow.test.tsx` |

## Verification

- `npm test -- --reporter=dot`: **221 tests passing, 32 files**, no failures at the end of functional changes.
- `npx tsc --noEmit --pretty false`: **pass**.
- `npm run typecheck:electron`: **pass**.
- `npm run build:desktop`: **pass** (Electron main/preload and renderer). Vite reports the non-blocking pre-existing >500 kB bundle advisory.
- Focused ESLint on the newly created scheduling/workload modules and tests: **pass**. ESLint on the broader touched existing files is not clean because of `prettier/prettier` violations. The pre-repair formatting baseline is saved at `.superpowers/sdd/review-repairs/lint-baseline.json`; formatting-only changes across the entire large route were intentionally avoided.
- Workbook fixtures and SQLite tests used fictional/in-memory data. No real school SQLite profile, supplied workbook, schema migration, production Electron user-data directory, or installed app profile was modified.

## Scope and follow-ups

The automated tests exercise success and rejection paths in the renderer, school-year aliases, desktop scheduling APIs, mixed-profile generation, CSV/Unicode imports, raw preview drafts, source-cell choices, and workload and report rendering.

The **interactive disposable-desktop GUI smoke test**, systematic benchmark comparison, and **independent implementation review** are **not complete**. A safe launch recipe is recorded at `.superpowers/sdd/review-repairs/smoke-preparation.md`; it requires verifying the isolated `userData` path before any write. Do not test against the real school profile. Full production packaging, publishing, and installer installation were not attempted.

## Reviewability

Because this checkout has no `.git` folder, source snapshots and reviewable text diffs were recorded under `.superpowers/sdd/review-repairs/`: `task-1.diff`, `task-2.diff`, `task-3.diff`, `task-4.diff`, `task-6.diff`, and `imports-combined.diff`. All modifications remain local to the project and were not committed or pushed.
