import type { SchoolDatabase } from "../database";
import type { NewSection, Section } from "./types";

export function sectionsRepository(db: SchoolDatabase) {
  const get = (id: number) =>
    db.prepare("SELECT * FROM sections WHERE id=?").get(id) as Section | undefined;
  const list = () =>
    db.prepare("SELECT * FROM sections ORDER BY grade_level,name").all() as Section[];
  const create = (s: NewSection): Section => {
    const result = db
      .prepare(
        `INSERT INTO sections(name,grade_level,school_level,bell_schedule_id,adviser_teacher_id)
      VALUES(@name,@grade_level,@school_level,@bell_schedule_id,@adviser_teacher_id)`,
      )
      .run(s);
    return get(Number(result.lastInsertRowid))!;
  };
  const update = (id: number, s: NewSection): Section => {
    db.prepare(
      `UPDATE sections SET name=@name,grade_level=@grade_level,school_level=@school_level,
      bell_schedule_id=@bell_schedule_id,adviser_teacher_id=@adviser_teacher_id,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=@id`,
    ).run({ ...s, id });
    const result = get(id);
    if (!result) throw new Error("Section not found.");
    return result;
  };
  const remove = (id: number) => db.prepare("DELETE FROM sections WHERE id=?").run(id).changes;
  return { get, list, create, update, delete: remove };
}
