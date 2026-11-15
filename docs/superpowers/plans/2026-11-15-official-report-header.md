# Official Report Header Implementation Plan

> **For agentic workers:** Apply the Superpowers test-first and verification workflows. Keep each file owned by one worker and review the final result independently.

**Goal:** Use the supplied timetable's official header with editable report settings and blank default signatory names.

**Architecture:** Keep the shorter school name in the app. Resolve this installation's initial report defaults separately, and persist explicitly edited profile fields through the existing settings service and SQLite key-value table.

**Tech Stack:** React, TypeScript, Electron IPC, SQLite, Vitest.

**Spec:** The two timetable screenshots and the user's choice: “Use the header; keep signatory names blank.”

## Header copy

- Republic of the Philippines
- Department of Education
- Region VIII - Eastern Visayas
- Schools Division Office of Biliran
- Caibiran District II
- INFORMATION AND COMMUNICATIONS TECHNOLOGY HIGH SCHOOL OF EASTERN BILIRAN
- Brgy. Palengke, 6565 Caibiran, Biliran Province

Use the existing DepEd seal above the report header. Keep the school seal in the app's login/sidebar.

## Constraints and interfaces

- Do not seed either person's name from the reference. Preserve already configured names.
- Initial prepared/approved titles are `Principal I` and `Public Schools District Supervisor`; both are editable.
- Keep `SCHOOL_NAME` and `SCHOOL_ADDRESS` unchanged for the short app identity.
- Add optional `reportSchoolName` to `SchoolSettings` and `SchoolSettingsUpdate`; existing region/division/district/address/title fields remain optional.
- `src/lib/schoolBrand.ts` exports `SCHOOL_REPORT_DEFAULTS` and `applySchoolReportDefaults(settings: SchoolSettings, configured?: boolean): SchoolSettings`.
- Initial report defaults apply only to this installation's blank, short, legacy, or full official school name. Preserve nonblank custom profile values and all custom-school profiles.
- Presence of the new `report_school_name` settings key marks an explicitly saved report profile. Subsequently preserve intentionally blank profile fields; do not restore defaults on reload.
- The first partial profile edit must also materialize the effective initial profile and its marker, even when the printed name is omitted. Keep the shared defaults in `shared/school-report-profile.ts` and re-export them from the frontend branding module.
- Preserve blank `schoolName` bootstrap semantics, workload limits, stale revision checks, school records, authentication, and CSRF protections.
- Do not change database schemas, migrations, generated files, or dependencies. Keep frontend persistence behind `src/services/dataService.ts`.
- Older settings payloads that omit optional report fields must preserve stored profile values. Explicit empty strings clear optional fields.

## Review focus

- User-cleared region/address/title fields remain blank after saving and reloading.
- Custom school identity/profile values never inherit Biliran details automatically.
- Profile saves reject invalid fields atomically and preserve school records and schedules.
- The printed name expands without changing the shorter app name.
- No signatory names are invented, seeded, or copied from the screenshots.

## Task 1: Defaults and persistence

- [x] Add meaningful failing persistence tests for profile round trips, optional-field preservation/clearing, and atomic rejection.
- [x] Implement report defaults, profile payload forwarding, validated settings upserts, and adapter loading.
- [x] Update the browser sample profile and verify the affected service/default tests.

## Task 2: Settings and printed report

- [x] Add failing UI tests for editable header/title fields, exact official report copy, blank names, and custom/cleared profiles.
- [x] Add Settings inputs and validation for report name, region, division, district, address, and signatory titles.
- [x] Render a centered single-seal header with the full name and selected profile details, and leave signature names blank until configured.
- [x] Verify affected UI tests, then the full suite, both TypeScript checks, and web/desktop builds.
- [x] Render the report for visual review and request an independent review of the complete change.

## Final verification

- `npm test -- --reporter=dot --maxWorkers=2`: all 248 tests across 32 files passed.
- `npx tsc --noEmit` and `npm run typecheck:electron`: passed.
- `npm run build` and `npm run build:desktop`: passed, with existing toolchain and bundle-size warnings.
- Targeted ESLint checks on the shared profile module, branding wrapper, report component, and changed UI tests: passed.
- Live browser review confirmed the exact supplied header, one DepEd seal, editable profile fields, and two blank signature names. Screenshot: `outputs/report-profile-reference/report-preview.jpg`.
- Independent review identified first partial-profile clears being replaced by defaults. Added failing real-SQLite reopen/adapter regressions, then fixed profile materialization through shared defaults; all 50 focused persistence/default tests passed.
- The first full suite run hit the existing 5-second timeout in the create/edit test in `mutation-flow.test.tsx`. That file subsequently passed all 11 tests alone, and the final full suite passed with two workers. No test timeout or mutation code was changed.

No production school database, schema, migration, generated source, or published Git history was changed. The temporary preview server was stopped after the visual check.
