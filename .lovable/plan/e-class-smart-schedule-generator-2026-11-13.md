# E-CLASS Smart Schedule Generator

Build a desktop-first school scheduling workspace using the existing TanStack app shell, while keeping all school data local and replaceable for a future Electron wrapper.

## Deliverables
- A school dashboard with summary counts, teacher-load status, room use, and visible sample conflicts.
- Sidebar navigation for data setup, schedule creation, schedule review, printable reports, help, and settings.
- Editable mock school data and term-aware schedules, saved through one async local-data service; no login, backend, or direct page-level storage access.
- Shared assignment conflict checks plus a greedy schedule generator and an import flow for CSV and Excel files.
- Responsive app styling, report print styles, route metadata, and tests for schedule conflicts and load thresholds.

## Technical approach
- Use the existing TanStack Start route and installed shadcn components; do not add React Router.
- Define shared school data types, mock data and async storage methods in `src/services/dataService.ts`, and shared conflict logic in `src/lib/conflicts.ts`.
- Keep the workspace in the home route, with small reusable display and form helpers where they improve clarity.
- Update the existing design tokens in `src/styles.css`; keep visual colors semantic and accessible.
