# E-CLASS Step 3 — Catalog IPC + React Adapter

## Boundaries

This milestone connects the Electron main process to `eclass.db` inside
`app.getPath("userData")`. It adds CRUD for teachers, sections, subjects and
rooms. Scheduling and Excel import are **not** implemented here.

## Security and data safety

- SQLite runs only in the Electron main process, with foreign keys enabled.
- A sandboxed preload exposes typed, named methods. It never exposes an
  unrestricted `ipcRenderer` or SQL execution method.
- The IPC handlers reject calls from anything other than the main window's
  main frame. Errors are logged under `userData/logs/eclass.log`.
- Every CRUD write and whole-page catalog replacement runs in a database
  transaction. A persisted catalog revision prevents stale-snapshot writes.
- Deletion is restricted if dependent schedules/electives/class advisers
  still reference a record. Database constraint errors become clear,
  structured error responses.
- Frontend temporary string IDs are mapped to SQLite-issued numeric IDs;
  the adapter queues calls from the existing optimistic React page code.
- **No browser localStorage is used for school-record persistence.**
- A browser-only Vite preview retains _in-memory_ demo records, not the
  school's SQLite database. The desktop window uses only Electron IPC.
- Opening a brand-new SQLite database does not seed fictional teachers,
  sections, subjects or rooms.

## Compatibility decisions

- The existing page calls `getAll()` and `saveAll()` instead of CRUD methods.
  Step 3 provides an atomic `catalog:applySnapshot` IPC operation so the
  existing page components need not change.
- New JHS sections default to `JHS-50-A`; new SHS sections default to
  `SHS-60` until the frontend adds a bell-profile selector. Existing
  section bell-profile IDs are preserved during updates.
- Sections store a foreign-key adviser reference, not free-text adviser
  names. The adapter resolves a unique existing teacher name or rejects
  ambiguous/unmatched names with a clear error.
- A temporary list of period slots is projected for the legacy page from
  one bell profile. The true multi-profile schedule UI and conflict
  authority arrive in Step 4.
- Existing pages still optimistically change local state before asynchronous
  persistence completes. The adapter displays a toast on rejected writes;
  refreshing the screen restores authoritative database values.

## Explicitly deferred

- Assignment, auto-generation, schedule validation, and bell-slot writes:
  **Step 4 / Step 6**.
- Import and Resolve Names: **Step 5**.
- Header settings, report exports, backup/restore: **Step 7**.
- Seed/reset sample data and Windows installer: **Step 8**.

The adapter refuses to treat unsupported schedule changes as SQLite writes.
Settings and reset operations deliberately return an unavailable error in
Electron, rather than changing school records in localStorage. No React
page component was edited.

## Commands

```powershell
cd C:\Personal\screenshot-to-spec-main
npm test
npm run typecheck:electron
npm run build:desktop
npm run dev
```

To verify real Electron IPC without touching any existing school database,
open the desktop in a separate terminal with a **temporary** data directory:

```powershell
$env:ECLASS_TEST_USER_DATA = Join-Path $env:TEMP "eclass-step3-e2e"
$env:ECLASS_STATIC = "1"
npm run build:desktop
npx electron . --remote-debugging-port=9243
```

Then in another terminal:

```powershell
node scripts/verify-step3-electron.cjs
```

This smoke test creates unique temporary catalog records, verifies
create/get/update/delete, rejects an invalid room and dependent-teacher
deletion, and removes its records afterward. Do not enable the
debugging port on a shared or production computer.
