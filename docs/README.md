# Documentation

Use the [project README](../README.md) for setup, the folder map, build commands, and desktop administrator access. Read [AGENTS.md](../AGENTS.md) before changing project architecture or managed integration files.

| Location                      | What it contains                                           |
| ----------------------------- | ---------------------------------------------------------- |
| `superpowers/specs/`          | Design notes describing intended behavior.                 |
| `superpowers/plans/`          | Implementation plans, including the folder cleanup.        |
| `superpowers/reviews/`        | Review and verification records from earlier work.         |
| [archive/](archive/README.md) | Historical implementation notes and full-source snapshots. |

Plans and reviews record the state of the project when they were written. They can refer to older paths or commands; use the current source tree and `package.json` for today's implementation and scripts. Test files now live in `tests/unit/`, `tests/services/`, `tests/desktop/`, and `tests/ui/`.

## Folder move guide

When copying this cleaned project into an existing Git clone, apply these moves and remove the old copies. Keep the clone's `.git` directory.

| Former location                                                                 | Current location                                                |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| App component code inside `src/routes/index.tsx`                                | `src/app/EClassApp.tsx`; keep the updated route file as well.   |
| `src/components/AdminLogin.tsx`                                                 | `src/components/auth/AdminLogin.tsx`                            |
| `src/components/ImportPanel.tsx`                                                | `src/components/imports/ImportPanel.tsx`                        |
| `src/components/ProgramTimetable.tsx`                                           | `src/components/reports/ProgramTimetable.tsx`                   |
| `src/lib/{classProgramImport,importRecords,importTypes,importWorkbook}.ts`      | The same filenames under `src/lib/imports/`.                    |
| `src/lib/{generateSchedule,programTimetable,scheduleTiming,teacherWorkload}.ts` | The same filenames under `src/lib/scheduling/`.                 |
| `src/workspace.css` and `src/import.css`                                        | `src/styles/workspace.css` and `src/styles/import.css`          |
| `src/test/`                                                                     | `tests/`, grouped by responsibility; setup is `tests/setup.ts`. |
| `docs/step2-full-source.md` and the Step 3/4 full-source and notes files        | `docs/archive/implementation-steps/`                            |
| `scripts/verify-step3-electron.cjs` and `scripts/verify-step4-electron.cjs`     | `scripts/verification/`                                         |
| Empty root scratch file `x.name`                                                | Preserved locally under ignored `outputs/archive/`.             |

The braces in the library rows list several filenames; they are not literal folder names. The `electron/`, `shared/`, `public/`, and `build/` source folders retain their locations.
