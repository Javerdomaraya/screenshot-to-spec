-- Canonical bell profiles from the school's program layouts.
INSERT INTO bell_schedules(id,name,school_level) VALUES (1,'SHS-60','SHS');
INSERT INTO bell_schedules(id,name,school_level) VALUES (2,'JHS-50-A','JHS');
INSERT INTO bell_schedules(id,name,school_level) VALUES (3,'JHS-50-B','JHS');

-- time_slots: each 'period' gets a 1-based period_no. Fixed events have NULL.

-- SHS-60
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (1,'class_preparation',NULL,'07:00','07:15',15);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (1,'flag_raising',NULL,'07:15','07:30',15);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (1,'period',1,'07:30','08:30',60);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (1,'period',2,'08:30','09:30',60);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (1,'health_break',NULL,'09:30','09:45',15);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (1,'period',3,'09:45','10:45',60);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (1,'period',4,'10:45','11:45',60);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (1,'lunch_break',NULL,'11:45','13:00',75);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (1,'period',5,'13:00','14:00',60);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (1,'period',6,'14:00','15:00',60);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (1,'period',7,'15:00','16:00',60);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (1,'period',8,'16:00','17:00',60);

-- JHS-50-A
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (2,'period',1,'07:30','08:20',50);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (2,'period',2,'08:20','09:10',50);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (2,'health_break',NULL,'09:10','09:30',20);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (2,'period',3,'09:30','10:20',50);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (2,'period',4,'10:20','11:10',50);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (2,'lunch_break',NULL,'11:30','13:00',90);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (2,'period',5,'13:00','13:50',50);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (2,'period',6,'13:50','14:40',50);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (2,'period',7,'14:40','15:30',50);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (2,'period',8,'15:30','16:20',50);

-- JHS-50-B
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (3,'period',1,'07:30','08:20',50);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (3,'period',2,'08:20','09:10',50);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (3,'health_break',NULL,'09:10','09:20',10);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (3,'period',3,'09:20','10:10',50);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (3,'period',4,'10:10','11:00',50);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (3,'lunch_break',NULL,'11:30','13:00',90);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (3,'period',5,'13:00','13:50',50);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (3,'period',6,'13:50','14:40',50);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (3,'period',7,'14:40','15:30',50);
INSERT INTO time_slots(bell_schedule_id,kind,period_no,start_time,end_time,minutes) VALUES (3,'period',8,'15:30','16:20',50);

-- Print header and signatories are configured once for every report.
INSERT INTO settings(key,value) VALUES ('school_name','');
INSERT INTO settings(key,value) VALUES ('school_year','2026-2027');
INSERT INTO settings(key,value) VALUES ('region','');
INSERT INTO settings(key,value) VALUES ('division','');
INSERT INTO settings(key,value) VALUES ('district','');
INSERT INTO settings(key,value) VALUES ('school_address','');
INSERT INTO settings(key,value) VALUES ('prepared_by','');
INSERT INTO settings(key,value) VALUES ('prepared_by_title','');
INSERT INTO settings(key,value) VALUES ('approved_by','');
INSERT INTO settings(key,value) VALUES ('approved_by_title','');
INSERT INTO settings(key,value) VALUES ('attested_by','');
INSERT INTO settings(key,value) VALUES ('attested_by_title','');
INSERT INTO settings(key,value) VALUES ('class_adviser_label','CLASS ADVISER');
INSERT INTO settings(key,value) VALUES ('underload_below','18');
INSERT INTO settings(key,value) VALUES ('balanced_max','30');
INSERT INTO settings(key,value) VALUES ('term_1_start','');
INSERT INTO settings(key,value) VALUES ('term_1_end','');
INSERT INTO settings(key,value) VALUES ('term_2_start','');
INSERT INTO settings(key,value) VALUES ('term_2_end','');
INSERT INTO settings(key,value) VALUES ('term_3_start','');
INSERT INTO settings(key,value) VALUES ('term_3_end','');
