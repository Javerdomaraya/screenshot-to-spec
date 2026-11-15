import { createElement, type ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { Route } from "@/routes/index";
import { dataService, makeSampleData, type SchoolData } from "@/services/dataService";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
HTMLElement.prototype.scrollIntoView = () => {};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  // The old handler discards this promise; keep its rejection from leaking beyond the UI assertion.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
function mutationData() {
  const data = makeSampleData();
  const assignment = data.assignments[0]!;
  data.assignments = [assignment];
  data.teachers = data.teachers.filter(row => row.id === assignment.teacherId);
  data.sections = data.sections.filter(row => row.id === assignment.sectionId);
  data.subjects = data.subjects.filter(row => row.id === assignment.subjectId);
  data.rooms = data.rooms.filter(row => row.id === assignment.roomId);
  return data;
}
async function openApp(data = mutationData()) {
  vi.spyOn(dataService, "getAll").mockResolvedValue(data);
  const save = vi.spyOn(dataService, "saveAll").mockImplementation(async next => structuredClone(next));
  const success = vi.spyOn(toast, "success");
  const error = vi.spyOn(toast, "error");
  await act(async () => { render(createElement(Route.options.component as ComponentType)); });
  return { data, save, success, error };
}
function navigate(page: string) { fireEvent.click(screen.getByRole("button", { name: page })); }
function editFirstTeacher() {
  navigate("Data Setup");
  fireEvent.click(within(document.querySelector(".data-table tbody tr") as HTMLElement).getByRole("button", { name: "Edit" }));
}

it("keeps the invalid teacher draft and committed row after persistence rejects min 31 / max 30", async () => {
  const { save, success, error } = await openApp();
  editFirstTeacher();
  const original = screen.getByLabelText("Full name").getAttribute("value");
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Edited draft" } });
  fireEvent.change(screen.getByLabelText("Minimum weekly hours"), { target: { value: "31" } });
  const write = deferred<SchoolData>(); save.mockReturnValueOnce(write.promise);
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await act(async () => { write.reject(new Error("Minimum weekly hours cannot exceed maximum weekly hours")); });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByLabelText("Full name")).toHaveValue("Edited draft");
  expect(screen.getByLabelText("Minimum weekly hours")).toHaveValue(31);
  expect(document.querySelector(".data-table")).toHaveTextContent(original!);
  expect(document.querySelector(".data-table")).not.toHaveTextContent("Edited draft");
  expect(success).not.toHaveBeenCalled(); expect(error).toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Minimum weekly hours"), { target: { value: "18" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(document.querySelector(".data-table")).toHaveTextContent("Edited draft");
}, 15000);

it("submits a create once while pending and uses the returned database ID for the next edit", async () => {
  const { data, save, success } = await openApp(); navigate("Data Setup");
  fireEvent.click(screen.getByRole("button", { name: "Add teacher" }));
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "AA New Teacher" } });
  fireEvent.change(screen.getByLabelText("Specialization"), { target: { value: "Math" } });
  const write = deferred<SchoolData>(); save.mockReturnValueOnce(write.promise);
  const submit = screen.getByRole("button", { name: "Add record" });
  fireEvent.click(submit); fireEvent.click(submit);
  expect(save).toHaveBeenCalledTimes(1); expect(submit).toBeDisabled();
  expect(screen.getByRole("dialog")).toBeInTheDocument(); expect(success).not.toHaveBeenCalled();
  const committed = structuredClone(data);
  committed.teachers.push({ id: "db-teacher-42", name: "AA New Teacher", specialization: "Math", employmentType: "Permanent", minHours: 18, maxHours: 30 });
  await act(async () => { write.resolve(committed); });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const row = screen.getByText("AA New Teacher").closest("tr")!;
  fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "AA Saved Teacher" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
  expect(save.mock.lastCall![0].teachers.find(t => t.name === "AA Saved Teacher")?.id).toBe("db-teacher-42");
});

it("keeps a rejected create open for retry without adding an optimistic row", async () => {
  const { save, success } = await openApp(); navigate("Data Setup");
  fireEvent.click(screen.getByRole("button", { name: "Add teacher" }));
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Failed Teacher" } });
  fireEvent.change(screen.getByLabelText("Specialization"), { target: { value: "Science" } });
  const write = deferred<SchoolData>(); save.mockReturnValueOnce(write.promise);
  fireEvent.click(screen.getByRole("button", { name: "Add record" }));
  await act(async () => { write.reject(new Error("Write failed")); });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByLabelText("Full name")).toHaveValue("Failed Teacher");
  expect(document.querySelector(".data-table")).not.toHaveTextContent("Failed Teacher");
  expect(screen.getByRole("button", { name: "Add record" })).toBeEnabled(); expect(success).not.toHaveBeenCalled();
});

it.each(["teachers", "sections", "rooms"] as const)("preserves schedules when an in-use %s deletion is rejected", async entity => {
  const { data, save, success, error } = await openApp(); navigate("Data Setup");
  if (entity !== "teachers") fireEvent.mouseDown(screen.getByRole("tab", { name: new RegExp(entity, "i") }), { button: 0, ctrlKey: false });
  const assignment = data.assignments[0]!;
  const id = entity === "teachers" ? assignment.teacherId : entity === "sections" ? assignment.sectionId : assignment.roomId;
  const name = data[entity].find(row => row.id === id)!.name;
  fireEvent.click(screen.getByRole("button", { name: `Delete ${entity === "teachers" ? "teacher" : entity === "sections" ? "section" : "room"} ${name}` }));
  const write = deferred<SchoolData>(); save.mockReturnValueOnce(write.promise);
  fireEvent.click(screen.getByRole("button", { name: "Delete record" }));
  expect(save.mock.lastCall![0].assignments).toEqual(data.assignments);
  await act(async () => { write.reject(Object.assign(new Error("Record is in use"), { code: "IN_USE" })); });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(document.querySelector(".data-table")).toHaveTextContent(name); expect(success).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith(expect.stringMatching(/remove|reassign/i));
});

it("keeps assignments committed and blocks settings/year changes while validation and assignment saving are pending", async () => {
  const { data, save, success } = await openApp(); navigate("Scheduling");
  fireEvent.click(screen.getByRole("button", { name: "Assign a class" }));
  const validation = deferred<string[]>(); const write = deferred<SchoolData>();
  vi.spyOn(dataService, "validateAssignment").mockReturnValueOnce(validation.promise);
  save.mockReturnValueOnce(write.promise);
  const submit = screen.getByRole("button", { name: /Validate & save/ });
  fireEvent.click(submit); fireEvent.click(submit);
  expect(submit).toBeDisabled(); expect(screen.getByRole("combobox", { name: "School year" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "T2" })).toBeDisabled();
  await act(async () => { validation.resolve([]); });
  expect(save).toHaveBeenCalledTimes(1); expect(success).not.toHaveBeenCalled();
  navigate("Settings"); expect(screen.getByLabelText("School name")).toBeDisabled();
  await act(async () => { write.reject(new Error("Assignment write failed")); });
  navigate("Review"); expect(screen.getByText(`${data.assignments.filter(a => a.term === 1).length} assignments`)).toBeInTheDocument();
  navigate("Scheduling"); fireEvent.click(screen.getByRole("button", { name: "Assign a class" }));
  expect(screen.getByRole("button", { name: /Validate & save/ })).toBeEnabled(); expect(success).not.toHaveBeenCalled();
});

it("waits for generation persistence and keeps the existing assignments on failure", async () => {
  const { data, save, success } = await openApp(); navigate("Scheduling");
  fireEvent.click(screen.getByRole("button", { name: "Auto-Generate" }));
  fireEvent.click(screen.getByRole("button", { name: "Fill open periods" }));
  const write = deferred<SchoolData>(); save.mockReturnValueOnce(write.promise);
  const generate = screen.getByRole("button", { name: "Generate open schedules" });
  fireEvent.click(generate); fireEvent.click(generate);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(generate).toBeDisabled(); expect(success).not.toHaveBeenCalled();
  await act(async () => { write.reject(new Error("Generated schedules not saved")); });
  expect(generate).toBeEnabled(); expect(success).not.toHaveBeenCalled();
  navigate("Review"); expect(screen.getByText(`${data.assignments.filter(a => a.term === 1).length} assignments`)).toBeInTheDocument();
});

it("aborts generation without writing or claiming success if desktop validation fails", async () => {
  const { save, success, error } = await openApp(); navigate("Scheduling");
  fireEvent.click(screen.getByRole("button", { name: "Auto-Generate" }));
  fireEvent.click(screen.getByRole("button", { name: "Fill open periods" }));
  vi.spyOn(dataService, "validateAssignment").mockRejectedValueOnce(new Error("Validation IPC disconnected"));
  fireEvent.click(screen.getByRole("button", { name: "Generate open schedules" }));
  await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining("Validation IPC disconnected")));
  expect(save).not.toHaveBeenCalled();
  expect(success).not.toHaveBeenCalled();
});

it("shows an error instead of a valid result when manual validation cannot run", async () => {
  const { error } = await openApp(); navigate("Scheduling");
  fireEvent.click(screen.getByRole("button", { name: "Assign a class" }));
  vi.spyOn(dataService, "validateAssignment").mockRejectedValueOnce(new Error("Validation IPC disconnected"));
  fireEvent.click(screen.getByRole("button", { name: "Validate" }));
  await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining("Validation IPC disconnected")));
  expect(screen.getByText(/Schedule validation could not complete/)).toBeInTheDocument();
  expect(screen.queryByText("Valid assignment")).not.toBeInTheDocument();
});

it("preserves rejected settings drafts and releases the shared pending guard for retry", async () => {
  const { data, success } = await openApp(); navigate("Settings");
  fireEvent.change(screen.getByLabelText("School name"), { target: { value: "Draft School" } });
  const write = deferred<SchoolData>(); const save = vi.spyOn(dataService, "saveSettings").mockReturnValueOnce(write.promise);
  const submit = screen.getByRole("button", { name: "Save school settings" });
  fireEvent.click(submit); fireEvent.click(submit);
  expect(save).toHaveBeenCalledTimes(1); expect(screen.getByLabelText("School name")).toBeDisabled();
  expect(success).not.toHaveBeenCalled();
  await act(async () => { write.reject(new Error("Settings write failed")); });
  expect(screen.getByLabelText("School name")).toHaveValue("Draft School");
  expect(screen.getByRole("button", { name: "Save school settings" })).toBeEnabled();
  expect(success).not.toHaveBeenCalled();
  save.mockResolvedValueOnce({ ...data, settings: { ...data.settings, schoolName: "Saved School" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save school settings" })); });
  expect(screen.getByLabelText("School name")).toHaveValue("Saved School");
});
