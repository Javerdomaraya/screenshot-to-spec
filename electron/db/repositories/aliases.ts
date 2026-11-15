import type { SchoolDatabase } from "../database";
import { normalizeNameKey } from "../name-normalization";

function requireName(name: string): string {
  const normalized = normalizeNameKey(name);
  if (!normalized) throw new Error("Name or alias cannot be empty.");
  return normalized;
}

export function aliasesRepository(db: SchoolDatabase) {
  const resolveTeacher = (name: string): number | null => {
    const normalized = requireName(name);
    const canonical = db.prepare("SELECT id FROM teachers WHERE name_key=?").all(normalized) as {
      id: number;
    }[];
    if (canonical.length > 1) return null; // Namesakes require manual review.
    if (canonical.length === 1) return canonical[0]!.id;
    const alias = db
      .prepare("SELECT teacher_id FROM teacher_aliases WHERE normalized_alias=?")
      .get(normalized) as { teacher_id: number } | undefined;
    return alias?.teacher_id ?? null;
  };
  const addTeacherAlias = (teacherId: number, alias: string): void => {
    const normalized = requireName(alias);
    const existing = resolveTeacher(alias);
    if (existing !== null && existing !== teacherId)
      throw new Error("Teacher alias already belongs to a different teacher.");
    db.prepare(
      `INSERT INTO teacher_aliases(teacher_id,alias,normalized_alias) VALUES(?,?,?)
      ON CONFLICT(normalized_alias) DO UPDATE SET alias=excluded.alias,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).run(teacherId, alias.trim(), normalized);
  };

  // Without a grade, return null on ambiguous matches rather than silently
  // merging two different grade-specific subjects from the school's workbook.
  const resolveSubject = (name: string, gradeLevel?: number): number | null => {
    const normalized = requireName(name);
    const matches = db
      .prepare(
        `
      SELECT id,grade_level FROM subjects WHERE name_key=?
      UNION SELECT s.id,s.grade_level FROM subject_aliases a
      JOIN subjects s ON s.id=a.subject_id WHERE a.normalized_alias=?`,
      )
      .all(normalized, normalized) as { id: number; grade_level: number }[];
    const filtered = matches.filter(
      (x) => gradeLevel === undefined || x.grade_level === gradeLevel,
    );
    return filtered.length === 1 ? filtered[0]!.id : null;
  };
  const addSubjectAlias = (subjectId: number, alias: string): void => {
    const normalized = requireName(alias);
    const subject = db.prepare("SELECT grade_level FROM subjects WHERE id=?").get(subjectId) as
      { grade_level: number } | undefined;
    if (!subject) throw new Error("Subject not found.");
    const existing = resolveSubject(alias, subject.grade_level);
    if (existing !== null && existing !== subjectId)
      throw new Error("Subject alias already belongs to a different subject.");
    db.prepare(
      `INSERT INTO subject_aliases(subject_id,alias,normalized_alias,grade_level) VALUES(?,?,?,?)
      ON CONFLICT(normalized_alias,grade_level) DO UPDATE SET alias=excluded.alias,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).run(subjectId, alias.trim(), normalized, subject.grade_level);
  };
  return { resolveTeacher, addTeacherAlias, resolveSubject, addSubjectAlias };
}
