-- E-CLASS schema v1. All dates/times are local school time; minute values
-- are counted from midnight (00:00 = 0, 09:20 = 560).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE bell_schedules (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  school_level TEXT NOT NULL CHECK (school_level IN ('JHS','SHS')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(id, school_level)
);

CREATE TABLE time_slots (
  id INTEGER PRIMARY KEY,
  bell_schedule_id INTEGER NOT NULL REFERENCES bell_schedules(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('period','class_preparation','flag_raising','flag_lowering','health_break','lunch_break')),
  period_no INTEGER,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK(minutes > 0 AND minutes <= 1440),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((kind = 'period' AND period_no IS NOT NULL AND period_no >= 1)
      OR (kind <> 'period' AND period_no IS NULL)),
  CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]'
    AND end_time GLOB '[0-2][0-9]:[0-5][0-9]'
    AND CAST(substr(start_time,1,2) AS INTEGER)<24
    AND CAST(substr(end_time,1,2) AS INTEGER)<24
    AND start_time < end_time),
  CHECK (minutes =
    (CAST(substr(end_time,1,2) AS INTEGER)*60 + CAST(substr(end_time,4,2) AS INTEGER))
    - (CAST(substr(start_time,1,2) AS INTEGER)*60 + CAST(substr(start_time,4,2) AS INTEGER))),
  UNIQUE (bell_schedule_id, start_time, end_time)
);
CREATE UNIQUE INDEX ux_period_in_profile ON time_slots(bell_schedule_id,period_no) WHERE kind='period';
CREATE INDEX ix_slots_profile_start ON time_slots(bell_schedule_id,start_time);

CREATE TABLE teachers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  specialization TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL DEFAULT 'Permanent'
    CHECK (employment_type IN ('Permanent','Contractual','Part-time')),
  min_hours REAL NOT NULL DEFAULT 18 CHECK (min_hours >= 0),
  max_hours REAL NOT NULL DEFAULT 30 CHECK (max_hours >= min_hours),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_teachers_name_key ON teachers(name_key);

CREATE TABLE sections (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  grade_level INTEGER NOT NULL CHECK (grade_level BETWEEN 7 AND 12),
  school_level TEXT NOT NULL CHECK (school_level IN ('JHS','SHS')),
  bell_schedule_id INTEGER NOT NULL,
  adviser_teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((school_level='JHS' AND grade_level BETWEEN 7 AND 10)
      OR (school_level='SHS' AND grade_level BETWEEN 11 AND 12)),
  FOREIGN KEY(bell_schedule_id,school_level) REFERENCES bell_schedules(id,school_level) ON DELETE RESTRICT
);

CREATE TABLE subjects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  grade_level INTEGER NOT NULL CHECK (grade_level BETWEEN 7 AND 12),
  minutes_per_week INTEGER NOT NULL CHECK (minutes_per_week > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(name_key,grade_level)
);

CREATE TABLE rooms (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  type TEXT NOT NULL CHECK (type IN ('Classroom','Laboratory','ICT room')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE teacher_aliases (
  id INTEGER PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_teacher_alias_owner ON teacher_aliases(teacher_id);

CREATE TABLE subject_aliases (
  id INTEGER PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  grade_level INTEGER NOT NULL CHECK (grade_level BETWEEN 7 AND 12),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(normalized_alias,grade_level)
);
CREATE INDEX ix_subject_alias_owner ON subject_aliases(subject_id);

-- A single elective group occupies one interval and may have many sections
-- and many teacher/subject assignments. Its members are handled in Step 4.
CREATE TABLE elective_groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  school_year TEXT NOT NULL,
  term INTEGER NOT NULL CHECK(term IN (1,2,3)),
  day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 5),
  start_time_slot_id INTEGER NOT NULL REFERENCES time_slots(id) ON DELETE RESTRICT,
  start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
  end_minute INTEGER NOT NULL CHECK(end_minute BETWEEN 1 AND 1440 AND end_minute > start_minute),
  duration_periods INTEGER NOT NULL DEFAULT 1 CHECK(duration_periods >= 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_elective_term ON elective_groups(school_year,term,day,start_minute,end_minute);

CREATE TRIGGER no_group_in_fixed_event BEFORE INSERT ON elective_groups BEGIN
  SELECT CASE WHEN (SELECT kind FROM time_slots WHERE id=NEW.start_time_slot_id)<>'period'
    THEN RAISE(ABORT,'Fixed events cannot contain classes') END;
END;
CREATE TRIGGER no_group_in_fixed_event_update BEFORE UPDATE OF start_time_slot_id ON elective_groups BEGIN
  SELECT CASE WHEN (SELECT kind FROM time_slots WHERE id=NEW.start_time_slot_id)<>'period'
    THEN RAISE(ABORT,'Fixed events cannot contain classes') END;
END;

CREATE TABLE elective_group_sections (
  elective_group_id INTEGER NOT NULL REFERENCES elective_groups(id) ON DELETE RESTRICT,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  PRIMARY KEY(elective_group_id,section_id)
);
CREATE INDEX ix_elective_group_sections_section ON elective_group_sections(section_id);

-- No slot-based UNIQUE indexes here: a class at 09:20 can conflict with a
-- different bell profile's class at 08:30 even when slot IDs differ.
-- Conflicts are checked atomically in the main process in Step 4.
CREATE TABLE assignments (
  id INTEGER PRIMARY KEY,
  school_year TEXT NOT NULL,
  term INTEGER NOT NULL CHECK(term IN (1,2,3)),
  day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 5),
  start_time_slot_id INTEGER NOT NULL REFERENCES time_slots(id) ON DELETE RESTRICT,
  start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
  end_minute INTEGER NOT NULL CHECK(end_minute BETWEEN 1 AND 1440 AND end_minute > start_minute),
  duration_periods INTEGER NOT NULL DEFAULT 1 CHECK(duration_periods >= 1),
  section_id INTEGER REFERENCES sections(id) ON DELETE RESTRICT,
  elective_group_id INTEGER REFERENCES elective_groups(id) ON DELETE RESTRICT,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((section_id IS NOT NULL AND elective_group_id IS NULL)
      OR (section_id IS NULL AND elective_group_id IS NOT NULL))
);
CREATE INDEX ix_assignments_term ON assignments(school_year,term,day,start_minute,end_minute);
CREATE INDEX ix_assignments_teacher ON assignments(teacher_id,school_year,term,day,start_minute);
CREATE INDEX ix_assignments_section ON assignments(section_id,school_year,term,day,start_minute);
CREATE INDEX ix_assignments_room ON assignments(room_id,school_year,term,day,start_minute);
CREATE INDEX ix_assignments_elective_group ON assignments(elective_group_id);

CREATE TRIGGER no_class_in_fixed_event BEFORE INSERT ON assignments BEGIN
  SELECT CASE WHEN (SELECT kind FROM time_slots WHERE id=NEW.start_time_slot_id)<>'period'
    THEN RAISE(ABORT,'Fixed events cannot contain classes') END;
END;
CREATE TRIGGER no_class_in_fixed_event_update BEFORE UPDATE OF start_time_slot_id ON assignments BEGIN
  SELECT CASE WHEN (SELECT kind FROM time_slots WHERE id=NEW.start_time_slot_id)<>'period'
    THEN RAISE(ABORT,'Fixed events cannot contain classes') END;
END;
