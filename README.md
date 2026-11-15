# E-CLASS

E-CLASS is a school scheduling workspace for managing teachers, sections, subjects, rooms, and class programs. It includes Excel/CSV imports, manual and automatic scheduling, conflict checks, teacher workload review, and printable reports. The Electron desktop app stores school records locally in SQLite; the browser preview uses disposable demonstration data.

Configured for **ICT High School of Eastern Biliran**, located in **Caibiran, Biliran**.

Printed programs use the school's full official name, Region VIII header, and detailed Palengke address. Edit these in **Settings → Timetable header**. Signatory names start blank; the preparer and approver titles are editable in **School information**.

## Start developing

Install Node.js and npm, then run these commands from the project folder:

```sh
npm ci
npm run dev
```

`npm run dev` builds Electron and starts both the web development server and desktop app. For the browser preview alone, run `npm run dev:web` and open `http://127.0.0.1:8080`.

Both `package-lock.json` and `bun.lock` are retained. These instructions use npm and its lockfile.

## Find your way around

| Folder or file                                 | Purpose                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/app/EClassApp.tsx`                        | Main workspace, screen state, and administrator login flow.                             |
| `src/routes/`                                  | TanStack route definitions and root layout. The home route loads the app component.     |
| `src/components/auth/`, `imports/`, `reports/` | Components grouped by the part of the app they support.                                 |
| `src/components/ui/`                           | Shared interface controls, such as buttons and dialogs.                                 |
| `src/lib/imports/`                             | Spreadsheet parsing, field mapping, and import previews.                                |
| `src/lib/scheduling/`                          | Schedule generation, timetable formatting, time calculations, and workloads.            |
| `src/lib/conflicts.ts`                         | Shared schedule validation rules. Keep these rules here.                                |
| `src/services/dataService.ts`                  | School-data persistence boundary used by screens. Keep data access behind this service. |
| `src/styles/` and `src/styles.css`             | Workspace/import styling and the main Tailwind entry.                                   |
| `electron/`                                    | Desktop startup, secure IPC handlers, database repositories, and services.              |
| `shared/`                                      | Contracts and helpers shared by the desktop and frontend code.                          |
| `tests/`                                       | Unit, service, desktop, and UI tests, plus shared test setup.                           |
| `public/` and `build/`                         | Public images and desktop installer icon resources. Keep both in source control.        |
| `scripts/`                                     | Icon generation and historical manual verification scripts.                             |
| `docs/`                                        | Development notes, plans, and archived implementation snapshots.                        |

Start with `src/app/EClassApp.tsx` for screen changes, the matching component folder for interface details, and the relevant library folder for calculations. Keep route definitions in `src/routes/`; do not edit `src/routeTree.gen.ts` or files marked automatically generated. See [AGENTS.md](AGENTS.md) for the project rules and [the documentation index](docs/README.md) for background material.

## Useful commands

| Command                      | Purpose                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `npm test`                   | Run the automated test suite.                                                                 |
| `npm run test:watch`         | Run tests while developing.                                                                   |
| `npm run typecheck:electron` | Check Electron and shared TypeScript code.                                                    |
| `npm run lint`               | Check source formatting and lint rules.                                                       |
| `npm run build`              | Build the web app.                                                                            |
| `npm run build:desktop`      | Build Electron and its offline renderer.                                                      |
| `npm run pack:win`           | Generate icon resources, build the desktop app, and create a Windows installer in `release/`. |

The Windows packaging and icon-generation commands require Windows and PowerShell. See [scripts/README.md](scripts/README.md) before using the older manual verification scripts.

## Desktop administrator access

The Electron desktop edition requires administrator authentication before it
loads the Dashboard or school records. On the first launch after installing
this version, the authorized school administrator must create a password.
There is **no preset or shared password**. The username is `admin`, and the
chosen password must contain at least 12 characters.

- On later launches, sign in with the saved password. Use **Sign out** in the
  sidebar to lock the workspace. Restarting E-CLASS also requires signing in.
- Passwords are saved as salted, computationally expensive scrypt hashes in
  the per-user SQLite database. Sessions exist only in Electron's main process.
  All school-data IPC operations require an authenticated session.
- Existing school records are retained during the v3 authentication migration,
  and an automatic SQLite backup is created before upgrading an existing
  database. There is no automatic reset or seeded administrator account.
- There is currently **no password recovery mechanism**. Store the administrator
  password securely. The login gate is not database-file encryption: someone
  with operating-system-level access to the database may still read its contents.
- The browser-only development preview is disposable demonstration data and
  **does not provide secure authentication**. Use the Electron edition to
  protect a real local school database.

## Upload to GitHub

Preserve the existing Git history: do not force push or rebase, amend, or squash commits that have already been pushed. Use normal commits so project history and connected integrations stay in sync.

In an existing Git checkout, review the changes, run the relevant checks above, and commit normally on your project branch. If you started from a downloaded copy without a `.git` directory, clone the existing GitHub repository into a separate folder, copy the source files into that clone, and retain the clone's `.git` directory.

Apply the file moves as well as copying the updated files: copying alone leaves the old locations behind. Use the [folder move guide](docs/README.md#folder-move-guide) to remove the former copies from the clone, then review Git's additions and deletions before committing.

Exclude local dependencies and generated output when copying or uploading: `node_modules/`, `dist/`, `dist-electron/`, `release/`, `.output/`, `.wrangler/`, `.superpowers/`, and `outputs/`. The `.gitignore` also excludes environment secrets and local database files. Keep `.env` files, SQLite databases and backups, passwords, and API keys out of GitHub. Keep source assets in `build/` and `public/`, configuration files, and the lockfiles.
