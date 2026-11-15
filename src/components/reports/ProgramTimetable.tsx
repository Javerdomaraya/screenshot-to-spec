import { Fragment } from "react";
import { collectScheduleConflicts } from "@/lib/conflicts";
import {
  formatProgramTime,
  getAssignmentInterval,
  getProgramRows,
  programAssignments,
  programDays,
  programEventLabels,
  type ProgramEntity,
  type ProgramMode,
  type ProgramRow,
} from "@/lib/scheduling/programTimetable";
import type { Assignment, SchoolData, Term } from "@/services/dataService";
import { SCHOOL_ADDRESS, schoolLogoSrc, schoolDisplayName } from "@/lib/schoolBrand";
import { formatSchoolYear } from "../../../shared/school-year";

interface ProgramTimetableProps {
  data: SchoolData;
  assignments: Assignment[];
  mode: ProgramMode;
  entities: ProgramEntity[];
  term?: Term;
  showHeader?: boolean;
  showSignatures?: boolean;
  conflictIds?: ReadonlySet<string>;
}

export function ProgramTimetable({
  data,
  assignments,
  mode,
  entities,
  term,
  showHeader = true,
  showSignatures = false,
  conflictIds: knownConflictIds,
}: ProgramTimetableProps) {
  if (!entities.length)
    return (
      <div className="program-empty">
        Choose a {mode === "rooms" ? "room" : mode} to view its program.
      </div>
    );
  const section =
    mode === "section" ? data.sections.find((item) => item.id === entities[0]?.id) : undefined;
  const title =
    mode === "teacher"
      ? "TEACHER’S PROGRAM"
      : mode === "rooms"
        ? "ROOM PROGRAM"
        : `${section ? `GRADE ${section.gradeLevel} ` : ""}CLASS PROGRAM`;
  const settings = data.settings;
  const rows = getProgramRows(data, mode, entities[0]!.id, assignments);
  const conflictIds =
    knownConflictIds ??
    new Set(
      collectScheduleConflicts(assignments, data).flatMap((conflict) => [
        conflict.assignment.id,
        conflict.other.id,
      ]),
    );
  const profileNames = [
    ...new Set(
      entities.flatMap((entity) => {
        const ids =
          mode === "section"
            ? [entity.id]
            : programAssignments(assignments, mode, entity.id).map(
                (assignment) => assignment.sectionId,
              );
        return ids
          .map(
            (id) =>
              data.bellSchedules?.find(
                (profile) =>
                  profile.id === data.sections.find((item) => item.id === id)?.bellScheduleId,
              )?.name,
          )
          .filter(Boolean);
      }),
    ),
  ];
  return (
    <article className={`program-sheet program-sheet--${entities.length}`}>
      {showHeader && (
        <header className="program-school-header">
          <div className="program-emblem-row">
            <img
              className="program-seal"
              src={`${import.meta.env.BASE_URL}deped-seal.png`}
              alt="Department of Education seal"
              width="52"
              height="52"
            />
            <img className="program-school-logo" src={schoolLogoSrc()}
              alt="School logo" width="52" height="52" />
          </div>
          <p className="program-republic">Republic of the Philippines</p>
          <p className="program-department">Department of Education</p>
          {settings.region && <p>{settings.region}</p>}
          {settings.division && <p>{settings.division}</p>}
          {settings.district && <p>{settings.district}</p>}
          <h2>{schoolDisplayName(settings.schoolName)}</h2>
          <p>{settings.schoolAddress?.trim() || SCHOOL_ADDRESS}</p>
        </header>
      )}
      <div className="program-title">
        <h3>{title}</h3>
        <p>
          SY {formatSchoolYear(settings.schoolYear)}
          {term && ` · TERM ${term}`}
        </p>
        {profileNames.length > 1 && <small>{profileNames.join(" / ")} · clock-time view</small>}
      </div>
      <div
        className="program-table-scroll"
        role="region"
        aria-label={`${title} timetable`}
        tabIndex={0}
      >
        <table className="program-table">
          <caption className="sr-only">
            {title} for {entities.map((entity) => entity.name).join(", ")}
          </caption>
          <colgroup>
            <col className="program-time-column" />
            <col className="program-minutes-column" />
            {entities.flatMap((entity) =>
              programDays.map((day) => <col key={`${entity.id}-${day}`} />),
            )}
          </colgroup>
          <thead>
            <tr className="program-entity-row">
              <th colSpan={2} scope="col">
                {mode === "section" ? "SECTION" : mode === "teacher" ? "TEACHER" : "ROOM"}
              </th>
              {entities.map((entity) => (
                <th key={entity.id} colSpan={5} scope="colgroup">
                  {entity.name}
                </th>
              ))}
            </tr>
            <tr className="program-day-row">
              <th scope="col">TIME/DAY</th>
              <th scope="col">NO. OF MINUTES</th>
              {entities.flatMap((entity) =>
                programDays.map((day) => (
                  <th key={`${entity.id}-${day}`} scope="col">
                    {day.toUpperCase()}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={row.id}
                className={row.kind === "period" ? "program-period-row" : "program-fixed-row"}
              >
                <th scope="row" className="program-time">
                  {formatProgramTime(row.startMinute)} – {formatProgramTime(row.endMinute)}
                </th>
                <td className="program-minutes">{row.endMinute - row.startMinute}</td>
                {entities.map((entity) => (
                  <ProgramCells
                    key={entity.id}
                    data={data}
                    assignments={programAssignments(assignments, mode, entity.id)}
                    mode={mode}
                    row={row}
                    rows={rows}
                    rowIndex={rowIndex}
                    conflictIds={conflictIds}
                  />
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={2 + entities.length * 5} className="program-empty">
                  No time slots configured.
                </td>
              </tr>
            )}
          </tbody>
          {mode === "section" && (
            <tfoot>
              <tr>
                <th colSpan={2} scope="row">
                  {settings.classAdviserLabel || "CLASS ADVISER"}
                </th>
                {entities.map((entity) => (
                  <td colSpan={5} key={entity.id}>
                    {data.sections.find((item) => item.id === entity.id)?.adviser || "—"}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {showSignatures && (
        <footer className="program-signatures">
          <Signature
            label="Prepared by:"
            name={settings.preparedBy}
            title={settings.preparedByTitle}
          />
          {settings.attestedBy && (
            <Signature
              label="Attested by:"
              name={settings.attestedBy}
              title={settings.attestedByTitle}
            />
          )}
          <Signature
            label="Approved:"
            name={settings.schoolHead}
            title={settings.approvedByTitle}
          />
        </footer>
      )}
    </article>
  );
}

function Signature({
  label,
  name,
  title,
}: {
  label: string;
  name: string;
  title: string | undefined;
}) {
  return (
    <div className="program-signature">
      <p>{label}</p>
      <strong>{name || "\u00a0"}</strong>
      {title && <span>{title}</span>}
    </div>
  );
}

function ProgramCells({
  data,
  assignments,
  mode,
  row,
  rows,
  rowIndex,
  conflictIds,
}: {
  data: SchoolData;
  assignments: Assignment[];
  mode: ProgramMode;
  row: ProgramRow;
  rows: ProgramRow[];
  rowIndex: number;
  conflictIds: ReadonlySet<string>;
}) {
  const at = (time: ProgramRow, day: string) =>
    assignments.filter((assignment) => {
      const interval = getAssignmentInterval(data, assignment);
      return (
        assignment.day === day &&
        interval.startMinute < time.endMinute &&
        time.startMinute < interval.endMinute
      );
    });
  const hasLesson = programDays.some((day) => at(row, day).length);
  if (row.kind !== "period" && !hasLesson) {
    const label = programEventLabels[row.kind] ?? "BREAK";
    if (row.kind === "flag_raising" || row.kind === "flag_lowering")
      return (
        <>
          {programDays.map((day) => (
            <td key={day} className="program-ceremony">
              {day === (row.kind === "flag_raising" ? "Monday" : "Friday") ? label : ""}
            </td>
          ))}
        </>
      );
    return (
      <td colSpan={5} className={`program-break program-break--${row.kind}`}>
        {label}
      </td>
    );
  }
  return (
    <>
      {programDays.map((day) => {
        const current = at(row, day);
        const signature = (items: Assignment[]) =>
          items
            .map((item) => item.id)
            .sort()
            .join("|");
        const previous = rows[rowIndex - 1];
        const continuing =
          current.length > 0 &&
          previous?.endMinute === row.startMinute &&
          signature(at(previous, day)) === signature(current);
        if (continuing) return <Fragment key={day} />;
        let rowSpan = 1;
        if (current.length) {
          while (
            rows[rowIndex + rowSpan] &&
            rows[rowIndex + rowSpan - 1]!.endMinute === rows[rowIndex + rowSpan]!.startMinute &&
            signature(at(rows[rowIndex + rowSpan]!, day)) === signature(current)
          )
            rowSpan++;
        }
        const hasConflict = current.some((assignment) => conflictIds.has(assignment.id));
        return (
          <td
            key={day}
            rowSpan={rowSpan}
            className={`program-lesson-cell${hasConflict ? " program-cell-conflict" : ""}`}
          >
            {current.map((assignment) => (
              <div className="program-lesson" key={assignment.id}>
                <strong>
                  {data.subjects.find((subject) => subject.id === assignment.subjectId)?.name ??
                    "Class"}
                </strong>
                {mode !== "section" && (
                  <span className="program-section-name">
                    {data.sections.find((section) => section.id === assignment.sectionId)?.name ??
                      "Section"}
                  </span>
                )}
                {mode !== "teacher" && (
                  <em>
                    {data.teachers.find((teacher) => teacher.id === assignment.teacherId)?.name ??
                      "Teacher"}
                  </em>
                )}
              </div>
            ))}
            {hasConflict && <span className="program-conflict-label">Conflict</span>}
          </td>
        );
      })}
    </>
  );
}
