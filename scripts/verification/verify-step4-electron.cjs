// Run only against the isolated Step 4 test instance:
// ECLASS_TEST_USER_DATA=<fresh temp directory>, ECLASS_STATIC=1,
// electron . --remote-debugging-port=9244
const assert = require("node:assert/strict");

async function evaluate(expression) {
  const pages = await (await fetch("http://127.0.0.1:9244/json/list")).json();
  assert.ok(
    pages[0]?.url.includes("dist-electron/renderer/index.html"),
    "Refusing to test a non-E-CLASS renderer.",
  );
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      ws.close();
      reject(new Error("Electron IPC verification timed out."));
    }, 20000);
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    ws.onmessage = (event) => {
      clearTimeout(deadline);
      ws.close();
      const result = JSON.parse(event.data);
      if (result.error || result.result?.exceptionDetails)
        return reject(new Error(JSON.stringify(result)));
      resolve(result.result?.result?.value);
    };
    ws.onerror = reject;
  });
}

const expression = `(async () => {
  const api = window.api;
  const before = await api.catalog.snapshot();
  if (!before.ok || before.data.teachers.length || before.data.sections.length ||
      before.data.rooms.length || before.data.subjects.length) {
    throw new Error("Refusing to write: this is not an empty isolated test database.");
  }
  const names = "Step4-" + Date.now();
  const created = { assignments:[], groups:[],sections:[],teachers:[],subjects:[],rooms:[] };
  async function must(reply,label) {
    if(!reply.ok) throw new Error(label+": "+JSON.stringify(reply.error));
    return reply.data;
  }
  try {
    const shs = before.data.bellSchedules.find(x=>x.name==="SHS-60");
    const jhsA = before.data.bellSchedules.find(x=>x.name==="JHS-50-A");
    const jhsB = before.data.bellSchedules.find(x=>x.name==="JHS-50-B");
    const slot=(profile,period)=>before.data.timeSlots.find(x=>
      x.bell_schedule_id===profile.id && x.kind==="period" && x.period_no===period);
    for(const n of ["A","B"]) {
      const teacher = await must(await api.teachers.create({
        name:names+" Teacher "+n,specialization:"Science",
        employment_type:"Permanent",min_hours:18,max_hours:30,
      }),"create teacher");
      created.teachers.push(teacher.id);
      const room = await must(await api.rooms.create({
        name:names+" Room "+n,capacity:40,type:"Classroom",
      }),"create room");
      created.rooms.push(room.id);
    }
    const subject = await must(await api.subjects.create({
      name:names+" Science",grade_level:11,minutes_per_week:300,
    }),"create subject");
    created.subjects.push(subject.id);
    for(const [n,grade,profile] of [["SHS",11,shs],["JHS-B",8,jhsB],["JHS-A",8,jhsA]]) {
      const section = await must(await api.sections.create({
        name:names+" "+n,grade_level:grade,
        school_level:grade>=11?"SHS":"JHS",
        bell_schedule_id:profile.id,adviser_teacher_id:null,
      }),"create section");
      created.sections.push(section.id);
    }
    const base = {
      schoolYear:"2026-2027",term:2,day:1,
      teacherId:created.teachers[0],subjectId:subject.id,
      roomId:created.rooms[0],durationPeriods:1,
    };
    const first = await must(await api.schedule.save({
      ...base,sectionId:created.sections[0],
      startTimeSlotId:slot(shs,2).id,
    }),"save SHS");
    created.assignments.push(first.id);
    const overlapping = {
      ...base,sectionId:created.sections[1],roomId:created.rooms[1],
      startTimeSlotId:slot(jhsB,3).id,
    };
    const preview=await must(await api.schedule.validate(overlapping),"validate overlap");
    const rejected=await api.schedule.save(overlapping);
    const sameTimeDifferentTeacher=await must(await api.schedule.save({
      ...overlapping,teacherId:created.teachers[1],
    }),"save JHS with different teacher and room");
    created.assignments.push(sameTimeDifferentTeacher.id);
    const group=await must(await api.electives.create({
      name:names+" Electives",schoolYear:"2026-2027",term:2,day:2,
      startTimeSlotId:slot(jhsA,1).id,durationPeriods:2,
      sectionIds:[created.sections[1],created.sections[2]],
    }),"create elective group");
    created.groups.push(group.id);
    for(let n=0;n<2;n++) {
      const assignment=await must(await api.schedule.save({
        schoolYear:"2026-2027",term:2,day:2,
        sectionId:null,electiveGroupId:group.id,
        teacherId:created.teachers[n],subjectId:subject.id,
        roomId:created.rooms[n],startTimeSlotId:slot(jhsA,1).id,durationPeriods:2,
      }),"save elective teacher");
      created.assignments.push(assignment.id);
    }
    const review=await must(await api.schedule.detectConflicts(2,"2026-2027"),
      "review all conflicts");
    const records=await must(await api.schedule.list({schoolYear:"2026-2027",term:2}),
      "list saved schedule");
    return {
      teacherConflict:preview.valid===false && preview.conflicts.some(x=>x.type==="teacher"),
      serverRejected:rejected.ok===false && rejected.error.code==="CONFLICT",
      crossProfile: first.start_minute===510 && first.end_minute===570 &&
        sameTimeDifferentTeacher.start_minute===560,
      electiveGroup:group.sectionIds.length===2 && records.length===4,
      electiveMinutes:records.filter(x=>x.elective_group_id===group.id)
        .every(x=>x.start_minute===450 && x.end_minute===550),
      cleanReview:review.length===0,
    };
  } finally {
    for(const id of created.assignments) await api.schedule.delete(id);
    for(const id of created.groups) await api.electives.delete(id);
    for(const id of created.sections) await api.sections.delete(id);
    for(const id of created.teachers) await api.teachers.delete(id);
    for(const id of created.subjects) await api.subjects.delete(id);
    for(const id of created.rooms) await api.rooms.delete(id);
  }
})()`;

(async () => {
  const result = await evaluate(expression);
  for (const [label, success] of Object.entries(result))
    assert.equal(success, true, `${label} verification failed`);
  console.log("Step 4 real Electron IPC checks passed:", result);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
