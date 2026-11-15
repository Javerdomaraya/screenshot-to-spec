import type { SchoolDatabase } from "../database";
import type { BellSchedule, NewTimeSlot, TimeSlot } from "./types";

export function bellSchedulesRepository(db: SchoolDatabase) {
  const list = () =>
    db.prepare("SELECT * FROM bell_schedules ORDER BY name").all() as BellSchedule[];
  const get = (id: number) =>
    db.prepare("SELECT * FROM bell_schedules WHERE id=?").get(id) as BellSchedule | undefined;
  const getByName = (name: string) =>
    db.prepare("SELECT * FROM bell_schedules WHERE name=?").get(name) as BellSchedule | undefined;
  const create = (name: string, schoolLevel: "JHS" | "SHS") => {
    const row = db
      .prepare("INSERT INTO bell_schedules(name,school_level) VALUES(?,?)")
      .run(name, schoolLevel);
    return get(Number(row.lastInsertRowid))!;
  };
  const update = (id: number, name: string, schoolLevel: "JHS" | "SHS") => {
    db.prepare(
      `UPDATE bell_schedules SET name=?,school_level=?,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
    ).run(name, schoolLevel, id);
    const result = get(id);
    if (!result) throw new Error("Bell schedule not found.");
    return result;
  };
  const remove = (id: number) =>
    db.prepare("DELETE FROM bell_schedules WHERE id=?").run(id).changes;
  const getSlot = (id: number) =>
    db.prepare("SELECT * FROM time_slots WHERE id=?").get(id) as TimeSlot | undefined;
  const listSlots = (bellId: number) =>
    db
      .prepare("SELECT * FROM time_slots WHERE bell_schedule_id=? ORDER BY start_time,id")
      .all(bellId) as TimeSlot[];
  const listPeriods = (bellId: number) =>
    db
      .prepare(
        "SELECT * FROM time_slots WHERE bell_schedule_id=? AND kind='period' ORDER BY period_no",
      )
      .all(bellId) as TimeSlot[];
  const createSlot = (slot: NewTimeSlot): TimeSlot => {
    const result = db
      .prepare(
        `INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes)
      VALUES(@bell_schedule_id,@kind,@period_no,@start_time,@end_time,@minutes)`,
      )
      .run(slot);
    return db
      .prepare("SELECT * FROM time_slots WHERE id=?")
      .get(result.lastInsertRowid) as TimeSlot;
  };
  const updateSlot = (id: number, slot: NewTimeSlot) => {
    db.prepare(
      `UPDATE time_slots SET bell_schedule_id=@bell_schedule_id,
      kind=@kind,period_no=@period_no,start_time=@start_time,
      end_time=@end_time,minutes=@minutes,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=@id`,
    ).run({ ...slot, id });
    const result = getSlot(id);
    if (!result) throw new Error("Time slot not found.");
    return result;
  };
  const deleteSlot = (id: number) =>
    db.prepare("DELETE FROM time_slots WHERE id=?").run(id).changes;
  return {
    get,
    list,
    getByName,
    create,
    update,
    delete: remove,
    listSlots,
    listPeriods,
    getSlot,
    createSlot,
    updateSlot,
    deleteSlot,
  };
}
