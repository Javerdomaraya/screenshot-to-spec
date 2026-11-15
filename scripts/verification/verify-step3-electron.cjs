// Only for a running, isolated local Electron test process started with
// --remote-debugging-port=9243 and ECLASS_TEST_USER_DATA=<temp-directory>.
// This script tests the real contextBridge and IPC, not a mock handler.
const assert = require("node:assert/strict");

async function evaluate(expression) {
  const pages = await (await fetch("http://127.0.0.1:9243/json/list")).json();
  assert.ok(pages.length, "An Electron page should be open");
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      ws.close();
      reject(new Error("Electron IPC verification timed out."));
    }, 15000);
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    };
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
  const unique = String(Date.now());
  const before = await api.catalog.snapshot();
  const teacher = await api.teachers.create({
    name: "Step 3 Verification Teacher " + unique, specialization: "Science",
    employment_type: "Permanent", min_hours: 18, max_hours: 30,
  });
  const subject = await api.subjects.create({
    name: "Step 3 Verification Subject " + unique, grade_level: 7, minutes_per_week: 300,
  });
  const room = await api.rooms.create({
    name: "Step 3 Verification Room " + unique, capacity: 40, type: "Classroom",
  });
  const updated = await api.rooms.update(room.data.id, {
    name: "Step 3 Updated Room " + unique, capacity: 42, type: "Classroom",
  });
  const gotRoom = await api.rooms.get(room.data.id);
  const profile = (await api.catalog.snapshot()).data.bellSchedules
    .find(b => b.name === "JHS-50-A");
  const section = await api.sections.create({
    name: "Step 3 Verification Section " + unique, grade_level: 7,
    school_level: "JHS", bell_schedule_id: profile.id,
    adviser_teacher_id: teacher.data.id,
  });
  const blocked = await api.teachers.delete(teacher.data.id);
  const invalid = await api.rooms.create({
    name: "Invalid Room", capacity: -5, type: "Classroom",
  });
  const current = await api.catalog.snapshot();
  const deletedSection = await api.sections.delete(section.data.id);
  const deletedTeacher = await api.teachers.delete(teacher.data.id);
  const deletedSubject = await api.subjects.delete(subject.data.id);
  const deletedRoom = await api.rooms.delete(room.data.id);
  const after = await api.catalog.snapshot();
  return {
    teacher: teacher.ok, section: section.ok,
    subject: subject.ok, room: room.ok,
    blocked: blocked.ok ? null : blocked.error.code,
    invalid: invalid.ok ? null : invalid.error.code,
    revision: current.ok ? current.data.revision : -1,
    count: current.ok ? current.data.teachers.length : -1,
    updated: updated.data?.capacity === 42 && gotRoom.data?.capacity === 42,
    cleaned: deletedSection.ok && deletedTeacher.ok &&
      deletedSubject.ok && deletedRoom.ok,
    restored: before.ok && after.ok &&
      before.data.teachers.length === after.data.teachers.length &&
      before.data.rooms.length === after.data.rooms.length &&
      before.data.subjects.length === after.data.subjects.length &&
      before.data.sections.length === after.data.sections.length,
    ipcAvailable: !!api.catalog && !!api.teachers,
  };
})()`;

(async () => {
  const result = await evaluate(expression);
  assert.equal(result.ipcAvailable, true);
  for (const key of ["teacher", "section", "subject", "room"]) {
    assert.equal(result[key], true, `${key} creation failed`);
  }
  assert.equal(result.blocked, "IN_USE");
  assert.equal(result.invalid, "INVALID_INPUT");
  assert.equal(result.updated, true);
  assert.equal(result.cleaned, true);
  assert.equal(result.restored, true);
  assert.ok(result.revision >= 4);
  assert.ok(result.count >= 1);
  console.log("Electron IPC verified using isolated data:", result);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
