import type { SchoolDatabase } from "../database";
import type { Assignment, NewAssignment } from "./types";
import { schoolYearAliases } from "../../../shared/school-year";

interface AssignmentFilter {
  schoolYear: string;
  term: 1 | 2 | 3;
}
interface OverlapFilter extends AssignmentFilter {
  day: 1 | 2 | 3 | 4 | 5;
  startMinute: number;
  endMinute: number;
  excludeId?: number;
}

export function assignmentsRepository(db: SchoolDatabase) {
  const get = (id: number) =>
    db.prepare("SELECT * FROM assignments WHERE id=?").get(id) as Assignment | undefined;
  const list = ({ schoolYear, term }: AssignmentFilter) => {
    const aliases = schoolYearAliases(schoolYear);
    return db
      .prepare(
        `SELECT * FROM assignments WHERE school_year IN (${aliases.map(() => "?").join(",")}) AND term=?
      ORDER BY day,start_minute,id`,
      )
      .all(...aliases, term) as Assignment[];
  };
  const findOverlaps = ({
    schoolYear,
    term,
    day,
    startMinute,
    endMinute,
    excludeId,
  }: OverlapFilter) => {
    const aliases = schoolYearAliases(schoolYear);
    return db
      .prepare(
        `SELECT * FROM assignments WHERE school_year IN (${aliases.map(() => "?").join(",")})
      AND term=? AND day=?
      AND start_minute < ? AND end_minute > ?
      AND (? IS NULL OR id<>?) ORDER BY start_minute,id`,
      )
      .all(...aliases, term, day, endMinute, startMinute, excludeId ?? null, excludeId ?? null) as Assignment[];
  };

  // Internal write primitive, intentionally unvalidated: Step 4 will call
  // this only inside an IMMEDIATE transaction after checking ALL interval
  // overlaps. No IPC handler should ever call this directly.
  const insertWithinTransaction = (assignment: NewAssignment): Assignment => {
    if (!db.inTransaction) throw new Error("Assignment insertion requires a database transaction.");
    const row = db
      .prepare(
        `
      INSERT INTO assignments(school_year,term,day,start_time_slot_id,start_minute,
        end_minute,duration_periods,section_id,elective_group_id,subject_id,teacher_id,room_id)
      VALUES(@school_year,@term,@day,@start_time_slot_id,@start_minute,
        @end_minute,@duration_periods,@section_id,@elective_group_id,@subject_id,@teacher_id,@room_id)`,
      )
      .run(assignment);
    return get(Number(row.lastInsertRowid))!;
  };
  const updateWithinTransaction = (id: number, assignment: NewAssignment): Assignment => {
    if (!db.inTransaction) throw new Error("Assignment update requires a database transaction.");
    const result = db
      .prepare(
        `
      UPDATE assignments SET school_year=@school_year,term=@term,day=@day,
        start_time_slot_id=@start_time_slot_id,start_minute=@start_minute,
        end_minute=@end_minute,duration_periods=@duration_periods,
        section_id=@section_id,elective_group_id=@elective_group_id,
        subject_id=@subject_id,teacher_id=@teacher_id,room_id=@room_id,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=@id
    `,
      )
      .run({ ...assignment, id });
    if (result.changes !== 1) throw new Error("Assignment not found.");
    return get(id)!;
  };
  const deleteWithinTransaction = (id: number): boolean => {
    if (!db.inTransaction) throw new Error("Assignment deletion requires a database transaction.");
    return db.prepare("DELETE FROM assignments WHERE id=?").run(id).changes === 1;
  };
  return {
    get,
    list,
    findOverlaps,
    insertWithinTransaction,
    updateWithinTransaction,
    deleteWithinTransaction,
  };
}
