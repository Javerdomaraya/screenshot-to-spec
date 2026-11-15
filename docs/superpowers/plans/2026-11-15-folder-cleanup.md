# Folder Cleanup Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to carry out the tasks and superpowers:verification-before-completion to verify the result.

**Goal:** Make E-CLASS easier to navigate and prepare its source folders for a GitHub upload.

**Architecture:** Preserve the existing React/TanStack frontend, Electron backend, and shared contracts. Group existing files by responsibility and update references without changing app behavior.

**Tech Stack:** React, TypeScript, TanStack Start, Vite, Electron, SQLite, Vitest.

**Spec:** The user's folder-cleanup request and the architecture constraints in `AGENTS.md`.

## Constraints

- Keep persistence behind `src/services/dataService.ts`.
- Keep shared frontend schedule validation in `src/lib/conflicts.ts`.
- Preserve generated files, database migrations, Lovable metadata, and public asset URLs.
- Keep framework entry files, `components/ui/`, and shadcn aliases at their current paths.
- This folder has no Git metadata; do not initialize Git, create commits, or push.
- Keep all existing local outputs; exclude them from Git instead of deleting them.

## Review Focus

- Route metadata and the Electron renderer still load the same app component.
- Relative imports, dynamic imports, and test mocks still resolve after moves.
- CSS imports and Tailwind's source path remain valid.
- Vitest discovers all 32 test files from their new folders.
- Source assets and lockfiles remain available while local outputs are ignored.

## Task 1: Organize source and tests

- [x] Move the home route's component code to `src/app/EClassApp.tsx`, retaining route metadata in `src/routes/index.tsx`.
- [x] Group custom components under `src/components/{auth,imports,reports}/`.
- [x] Group import helpers under `src/lib/imports/` and scheduling helpers under `src/lib/scheduling/`.
- [x] Move supporting styles to `src/styles/`, preserving the `src/styles.css` entry.
- [x] Move tests to `tests/{unit,services,desktop,ui}/` and setup to `tests/setup.ts`.
- [x] Update imports, TypeScript includes, Vitest setup/discovery, and the stylesheet path used by layout tests.
- [x] Verify with `npm test`, `npx tsc --noEmit`, and `npm run typecheck:electron`.

## Task 2: Organize supporting files and explain the project

- [x] Move historical step notes/source snapshots into `docs/archive/implementation-steps/`.
- [x] Group legacy Electron verification scripts under `scripts/verification/`.
- [x] Preserve the empty root scratch file under ignored local outputs.
- [x] Add folder guides and a project README with development, build, and GitHub preparation instructions.
- [x] Exclude local outputs, agent scratch files, credentials, and local databases from Git and irrelevant tooling scans.
- [x] Verify web and desktop builds and request an independent review.

## Baseline

`npm test -- --reporter=dot`: 32 test files and 221 tests passed before changes.

No new behavior is introduced, so existing behavior tests and both builds are the verification for this mechanical refactor.

## Final verification

- `npm test -- --reporter=dot`: 32 test files, 221 tests passed after the final source edits.
- `npx tsc --noEmit`: passed.
- `npm run typecheck:electron`: passed.
- `npm run build`: passed; toolchain and bundle-size warnings remain.
- `npm run build:desktop`: passed; bundle-size warning remains.
- Targeted Prettier check of the new guides, changed configuration, thin route, and previously clean files affected by longer import paths: passed.
- `npm run lint`: fails on 977 Prettier formatting errors and 6 React Refresh warnings. The saved original source produced 980 formatting errors and the same 6 warnings under the current source-only scan; full-project formatting cleanup is outside this folder reorganization.
- File integrity: all 193 baseline files preserved at their expected destinations, all 54 old file locations removed, and all 53 protected desktop/shared/asset/metadata/lock/generated files unchanged. Historical documents and moved manual scripts retain their exact contents.
- Independent review: no remaining findings. The GitHub instructions explicitly cover deleting former file locations when copying into an existing clone.

All local build/review artifacts were retained. No Git repository was initialized and no commit, upload, or push was performed.
