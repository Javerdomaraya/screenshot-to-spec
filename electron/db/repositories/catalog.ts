import type { SchoolDatabase } from "../database";
import { normalizeNameKey } from "../name-normalization";
import type { NewTeacher, Teacher, NewSubject, Subject, NewRoom, Room } from "./types";

function lastId(result: { lastInsertRowid: number | bigint }): number {
  return Number(result.lastInsertRowid);
}

export function teachersRepository(db: SchoolDatabase) {
  const get = (id: number) =>
    db.prepare("SELECT * FROM teachers WHERE id=?").get(id) as Teacher | undefined;
  const list = () => db.prepare("SELECT * FROM teachers ORDER BY name,id").all() as Teacher[];
  const create = (t: NewTeacher): Teacher => {
    const result = db
      .prepare(
        `
      INSERT INTO teachers(name,name_key,specialization,employment_type,min_hours,max_hours)
      VALUES (@name,@name_key,@specialization,@employment_type,@min_hours,@max_hours)`,
      )
      .run({ ...t, name_key: normalizeNameKey(t.name) });
    return get(lastId(result))!;
  };
  const update = (id: number, t: NewTeacher): Teacher => {
    db.prepare(
      `UPDATE teachers SET name=@name,name_key=@name_key,specialization=@specialization,
      employment_type=@employment_type,min_hours=@min_hours,max_hours=@max_hours,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=@id`,
    ).run({ ...t, id, name_key: normalizeNameKey(t.name) });
    const result = get(id);
    if (!result) throw new Error("Teacher not found.");
    return result;
  };
  const remove = (id: number) => {
    try {
      return db.prepare("DELETE FROM teachers WHERE id=?").run(id).changes;
    } catch (error) {
      if (error instanceof Error && error.message.includes("FOREIGN KEY"))
        throw new Error("Teacher is in use by a school schedule.");
      throw error;
    }
  };
  return { get, list, create, update, delete: remove };
}

export function subjectsRepository(db: SchoolDatabase) {
  const get = (id: number) =>
    db.prepare("SELECT * FROM subjects WHERE id=?").get(id) as Subject | undefined;
  const list = () =>
    db.prepare("SELECT * FROM subjects ORDER BY grade_level,name,id").all() as Subject[];
  const create = (s: NewSubject): Subject => {
    const result = db
      .prepare(
        `
      INSERT INTO subjects(name,name_key,grade_level,minutes_per_week)
      VALUES (@name,@name_key,@grade_level,@minutes_per_week)`,
      )
      .run({ ...s, name_key: normalizeNameKey(s.name) });
    return get(lastId(result))!;
  };
  const update = (id: number, s: NewSubject): Subject => {
    db.prepare(
      `UPDATE subjects SET name=@name,name_key=@name_key,grade_level=@grade_level,
      minutes_per_week=@minutes_per_week,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=@id`,
    ).run({ ...s, id, name_key: normalizeNameKey(s.name) });
    const result = get(id);
    if (!result) throw new Error("Subject not found.");
    return result;
  };
  const remove = (id: number) => db.prepare("DELETE FROM subjects WHERE id=?").run(id).changes;
  return { get, list, create, update, delete: remove };
}

export function roomsRepository(db: SchoolDatabase) {
  const get = (id: number) =>
    db.prepare("SELECT * FROM rooms WHERE id=?").get(id) as Room | undefined;
  const list = () => db.prepare("SELECT * FROM rooms ORDER BY name,id").all() as Room[];
  const create = (r: NewRoom): Room => {
    const result = db
      .prepare("INSERT INTO rooms(name,capacity,type) VALUES(@name,@capacity,@type)")
      .run(r);
    return get(lastId(result))!;
  };
  const update = (id: number, r: NewRoom): Room => {
    db.prepare(
      `UPDATE rooms SET name=@name,capacity=@capacity,type=@type,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=@id`,
    ).run({ ...r, id });
    const result = get(id);
    if (!result) throw new Error("Room not found.");
    return result;
  };
  const remove = (id: number) => db.prepare("DELETE FROM rooms WHERE id=?").run(id).changes;
  return { get, list, create, update, delete: remove };
}
