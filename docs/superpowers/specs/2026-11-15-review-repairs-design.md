# Review repairs: persistence, scheduling, and imports

Status: proposed repair design for user review. This document and the accompanying plan do not change product behavior.

## Intent and success

Repair the eight defects established in the implementation review: post-commit stale cache/data loss, premature save success, school-year aliases, period-only generation, assignment-count workload, teacher names extracted as subjects, trimmed edit drafts, and incorrectly decoded CSV names. Success means the reproduced cases become permanent regressions and existing desktop/browser behavior remains usable.

## Approach and scope

The proposed approach is focused repairs at the existing service and helper boundaries, delivered in persistence, scheduling, and import stages. Isolated UI patches would leave inconsistent state and validation underneath. A broad route rewrite or new scheduling solver would make this repair larger and harder to verify; defer both.

The implementation choices below are recommendations, not previously approved product decisions:

- A write returns committed SchoolData and rejects on failure. Screens retain the last committed state, keep failed forms open, and announce success only after persistence finishes. Prevent duplicate submissions and conflicting mutations while a write is pending.
- Keep current backend dependency protection. Deleting an in-use catalog record must fail with guidance to remove/reassign dependencies; do not silently delete schedules or split that delete into independent transactions.
- Academic-year keys use an ASCII hyphen for new writes and an en dash for display. Existing hyphen/en-dash rows represent one logical calendar. Read and validate both aliases without changing row IDs, deleting duplicates, or rewriting stored data. Preserve distinct academic years and existing input validation boundaries.
- Resolve intervals from the section's bell profile. Stored authoritative times remain preferred for saved rows. Strict scheduling resolution rejects missing periods, invalid durations, gaps, and fixed events; invalid legacy display data must not crash the timetable. Keep schedule conflict rules in src/lib/conflicts.ts and retain main-process validation as the desktop write authority.
- Preserve the current greedy generation order and one-placement-per-subject behavior. This repair does not promise a complete curriculum or optimize a solver. Generated candidates must respect existing/staged clock intervals and main-process reservations before one atomic batch is saved.
- Teaching load is integer scheduled minutes converted to hours, with classification before display rounding. Preserve term selection and the existing global threshold policy.
- Preview controls retain raw drafts. Validation, duplicate detection, and persistence use normalized records. Numeric drafts must preserve intermediate text such as 18. and invalid text until corrected.
- Decode UTF-8 CSV explicitly, with and without a BOM; preserve XLSX binary parsing. Recognize UTF-16 BOMs. If strict UTF-8 decoding fails without a BOM, retain Windows-1252 compatibility with a visible encoding warning rather than silently corrupt names.
- Trusted teacher identities come from loaded teachers and explicit identities in selected sheets. Never classify all multiword names as teachers or scan unselected hidden sheets. Known contiguous teacher continuations contribute minutes to the preceding subject. Unknown text in a structurally evidenced continuation row requires a source-cell decision before editing/import confirmation; affected totals remain unresolved until then.

## Constraints

- Keep school-data persistence behind src/services/dataService.ts.
- Keep schedule validation rules in src/lib/conflicts.ts; SQLite/main-process validation remains authoritative for desktop writes.
- Do not edit supabase/migrations/, drizzle/, automatically generated files, secrets, or published Git history.
- No schema migration, bulk year rewrite, destructive data repair, new dependency, or new IPC endpoint is required by this proposal.
- Test with in-memory/disposable databases and generated fictional workbook fixtures. Do not write to the installed school's database or modify the supplied workbooks.
- Current checkout has no .git directory. Do not initialize Git or claim commits; provide a reviewable file diff instead.

## Acceptance and delivery

All eight reviewed scenarios must be covered by focused tests, then the existing full suite, renderer/Electron type checks, and desktop builds. Include alias duplicates, pending/rejected saves, elective reservations, interval endpoints, fractional loads, raw edits, Unicode names, and ambiguous source decisions. Record any pre-existing lint failures separately and introduce no new lint violations.

Use small focused modules only where the repair needs a reusable boundary: academic-year identity, generation, workload, and strict timing. Do not restructure unrelated screens. Performance work is limited to avoiding repeated whole-list workload scans, indexing year aliases, and checking representative import/generation workloads without machine-sensitive timing assertions.

Independent builder check: no important unanswered questions remained. Implementation is still pending user review of this design and the accompanying plan.
