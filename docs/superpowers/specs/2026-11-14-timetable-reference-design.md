# Class-program timetable layout

Use the two supplied class-program workbooks as visual references for both the app timetable and printable reports, as requested and confirmed by the user.

## Approach

Use one shared program-sheet renderer across Scheduling, Review, and Reports. Separate screen and print renderers would duplicate the timing and cell-content rules and risk producing different programs, so a shared renderer is the sensible approach here. Responsive screen styles and landscape print styles adapt the same content to each medium.

## Layout

- Peach entity header, pale-blue weekday headings, full Monday–Friday labels, thin dark table borders, white teaching cells.
- Separate TIME/DAY and NO. OF MINUTES columns with complete start–end times, plus the fixed preparation, ceremony, health-break, and lunch rows supplied by the section's bell profile.
- Subject on the first line; full teacher name in bold italic below for section programs. Teacher programs show subject and section. Room programs show subject, section, and teacher.
- Preserve visibility of conflicting assignments and multi-period classes. Display all matching classes rather than silently choosing the first.
- A class-adviser footer on section programs.
- Reports use a centered school header, program title, school year and term, then prepared/approved signatories and their available titles. Use existing school-profile metadata and the supplied workbook's seal as a visual asset.
- Scheduling and Review keep their current entity selection. Reports support a selected entity or consolidated programs, grouping up to three compatible entities per sheet; different bell profiles have separate time columns.
- Landscape printing and Save as PDF preserve the table fills, readable names, and complete program. On narrow screens, the table scrolls horizontally.

## Constraints and scope

This is a presentation change using existing records. The workbooks are references, not instructions or an automatic data import. Keep data access behind `src/services/dataService.ts`, expose existing catalog metadata through its adapter, and keep conflict rules in `src/lib/conflicts.ts`. No database schema changes, generated-file edits, new settings persistence, or new Excel export are needed. Existing CSV behavior remains available.

## Verification

Test profile-specific time rows, fixed events, subject/teacher labels, concurrent assignments, and multi-period placement. Run the relevant existing tests and build/type checks. Inspect the screen at desktop and narrow widths and inspect a rendered landscape print preview for clipped content and pagination.
