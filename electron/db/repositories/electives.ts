import type { SchoolDatabase } from "../database";
import type { ElectiveGroup, NewElectiveGroup } from "./types";

export function electivesRepository(db: SchoolDatabase) {
  const get = (id: number) =>
    db.prepare("SELECT * FROM elective_groups WHERE id=?").get(id) as ElectiveGroup | undefined;
  const create = (group: NewElectiveGroup) => {
    const inserted = db
      .prepare(
        `
      INSERT INTO elective_groups(name,school_year,term,day,start_time_slot_id,
        start_minute,end_minute,duration_periods)
      VALUES(@name,@school_year,@term,@day,@start_time_slot_id,
        @start_minute,@end_minute,@duration_periods)`,
      )
      .run(group);
    return get(Number(inserted.lastInsertRowid))!;
  };
  const addSection = (electiveGroupId: number, sectionId: number): void => {
    db.prepare("INSERT INTO elective_group_sections(elective_group_id,section_id) VALUES(?,?)").run(
      electiveGroupId,
      sectionId,
    );
  };
  const listSectionIds = (electiveGroupId: number) =>
    (
      db
        .prepare(
          `SELECT section_id FROM elective_group_sections
      WHERE elective_group_id=? ORDER BY section_id`,
        )
        .all(electiveGroupId) as { section_id: number }[]
    ).map((row) => row.section_id);
  const remove = (id: number) =>
    db.prepare("DELETE FROM elective_groups WHERE id=?").run(id).changes;
  return { get, create, addSection, listSectionIds, delete: remove };
}
