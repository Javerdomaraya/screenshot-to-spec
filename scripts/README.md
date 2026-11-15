# Development scripts

Run these commands from the project root.

## Windows icon generation

`generate-windows-icon.ps1` reads `public/icon.png` and creates the Windows icon resources in `build/`. The source image must be at least 512 by 512 pixels. It requires Windows PowerShell and `System.Drawing`.

```sh
npm run generate:icons
```

`npm run pack:win` runs icon generation before building and packaging the app. The `build/` folder contains required installer resources and belongs in source control.

## Automated checks

Use `npm test` for routine verification. Tests are grouped under `tests/unit/`, `tests/services/`, `tests/desktop/`, and `tests/ui/`. Use `npm run typecheck:electron` for the Electron TypeScript check and `npm run build:desktop` to check desktop compilation.

## Historical manual IPC checks

`verification/verify-step3-electron.cjs` and `verification/verify-step4-electron.cjs` are manual checks from earlier implementation stages. They connect to a separately running Electron process through its local debugging port and exercise real IPC calls. They can modify school records and are not part of `npm test`.

The scripts expect an isolated test profile selected with `ECLASS_TEST_USER_DATA`; Step 3 uses debugging port `9243`, while Step 4 uses port `9244` and the offline renderer with `ECLASS_STATIC=1`. Read the header and assertions before using either script. Use a disposable test database, never the normal school profile.

These checks predate administrator authentication. The test instance must now complete administrator setup or sign in before school-data IPC calls can succeed; the scripts do not perform that login. Treat their assertions as historical integration references rather than an unattended verification command for the current app.
