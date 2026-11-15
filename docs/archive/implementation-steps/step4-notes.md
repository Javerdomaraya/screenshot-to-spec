# E-CLASS — Step 4: Time-based schedule authority

## What is implemented

- `electron/services/schedule.ts` is the **only public writer** for schedule assignments.
- `electron/services/conflicts.ts` is the main-process conflict source of truth.
- Typed `window.api.schedule` and `window.api.electives` endpoints use
  `ipcMain.handle`, with the same main-frame verification and safe
  `{ok,data}`/`{ok:false,error}` result contract as the catalog APIs.
- Every save, update, delete, bulk change, elective creation, and elective
  section addition uses an SQLite `IMMEDIATE` transaction.
- The backend **derives** assignment `start_minute`/`end_minute` from
  the chosen section's bell schedule. Renderer-supplied minute fields are
  explicitly rejected.
- The interval overlap rule is
  `existing.start_minute < proposed.end_minute && proposed.start_minute < existing.end_minute`
  on matching school year, term, and weekday. Equal boundaries are
  **not** conflicts.
- Teacher, room, section, and identical assignment conflicts produce
  human-readable messages, including referenced assignment IDs.
- Validation cannot treat two teachers teaching distinct electives within
  the same authorized elective group as a false _section_ conflict. Each
  teacher and room is nevertheless checked separately.
- A shared elective block can reserve multiple sections at once. Every
  member section must have teaching periods covering precisely the same
  clock-time interval without crossing fixed events.
- Multi-period classes are allowed only where teaching periods are
  consecutive and contiguous. They cannot cross health/lunch breaks,
  class preparation, flag events, or unscheduled timetable gaps.
- Existing data whose rows were inserted before the scheduling validator
  existed can be audited with `schedule:detectConflicts`.
- `catalog.sections.update` and the legacy catalog snapshot API now
  refuse to change the bell schedule, grade, or school level of a section
  that already has assignments or an elective reservation.

## Existing React frontend compatibility

- `src/services/dataService.ts` now reads SQLite schedule assignments
  through `schedule:list` and uses `schedule:validate` before manual
  saves.
- The existing pages continue to call `saveAll()`. The adapter turns
  assignment additions, edits, and deletions into one
  `schedule:applyChanges` transaction and maps temporary IDs to SQLite
  IDs. Any rejection produces a visible error toast.
- Only _regular section assignments_ are projected into the unchanged
  legacy schedule UI. Elective-group assignments are not represented as
  fake one-section classes; doing so would create misleading conflicts.
  Electives are available through the typed IPC API for a future
  group-aware scheduling/review UI.
- `src/lib/conflicts.ts` uses real clock-minute intervals when present
  for _display_ and retains the period-number fallback for the disposable
  browser demo. It is **not** an authority for saving; the backend
  always validates again within its own transaction.
- The unchanged UI displays the start period for a multi-period
  assignment. Merged multi-period cells and all elective group members
  require a later UI/reporting update.
- The original page still uses optimistic local state. If a write is
  rejected, the toast identifies the issue; refresh to restore the
  authoritative SQLite data.
- The original page has sample-based initial picker IDs. On a new
  database, select the actual teacher/section/subject/room before
  scheduling.
- Import, auto-generation, workload, PDF/CSV printouts, settings and
  sample-data seeding remain in their later steps.

## Safety and verification

All tests open disposable `eclass.db` files in the system temporary
directory. The live Electron IPC exercise also uses an explicitly
isolated `ECLASS_TEST_USER_DATA` folder (never the normal userData).
The original school database was not modified as part of testing.

Tests cover mixed SHS-60/JHS-50 profiles, interval adjacency, different
school years and terms, fixed events, multi-period breaks, duplicate
classes, updates/exclusions, atomic rollback, elective shared sections
and teachers, and deliberate legacy conflicting rows.

### Useful commands

```powershell
cd C:\Personal\screenshot-to-spec-main
npm test
npm run typecheck:electron
npm run build:desktop
npm run dev
```

To run the **real** Electron IPC test without using school data:

```powershell
$env:ECLASS_TEST_USER_DATA = Join-Path $env:TEMP "eclass-step4-ipc-isolated"
$env:ECLASS_STATIC = "1"
npm run build:desktop
npx electron . --remote-debugging-port=9244
```

In another terminal:

```powershell
node scripts/verify-step4-electron.cjs
```

The script refuses to write into a nonempty catalog, creates and
validates test assignments and electives, and deletes those records
afterward. **Do not leave the remote debugging port open on a real
school workstation.**

## Step 5

Next: import school-format Excel and CSV class programs, resolve
teacher/subject aliases, validate and preview rows, then save in one
transaction after a backup. The school's actual Term 2 workbook is
still needed for fixture-based comparison.
