import { createElement, type ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { Route } from "@/routes/index";
import { dataService, makeSampleData } from "@/services/dataService";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
HTMLElement.prototype.scrollIntoView = () => {};

async function openImport() {
  const data = makeSampleData();
  data.teachers = data.teachers.filter((teacher) => teacher.name !== "Ana Cruz");
  vi.spyOn(dataService, "getAll").mockResolvedValue(data);
  vi.spyOn(dataService, "saveAll").mockImplementation(async (next) => structuredClone(next));
  await act(async () => {
    render(createElement(Route.options.component as ComponentType));
  });
  fireEvent.click(screen.getByRole("button", { name: "Import Data" }));
}
function upload(workbook: XLSX.WorkBook) {
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const file = new File([bytes], "Class Program.xlsx");
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes });
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
}
function uploadCsv(name: string, bytes: Uint8Array) {
  const file = new File([Uint8Array.from(bytes).buffer], name);
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
}
function programBook() {
  const workbook = XLSX.utils.book_new();
  const days = [
    "TIME/DAY",
    "NO. OF MINUTES",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
  ];
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["TEACHER'S PROGRAM"],
      ["SECTION", "", "Teacher Example"],
      days,
      ["7:30 - 8:30", 60, "SCIENCE"],
      ["", "", "G11 - AVAST"],
    ]),
    "Teacher Program",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["GRADE 11 CLASS PROGRAM"],
      ["SECTION", "", "G11 - AVAST"],
      days,
      ["7:30 - 8:30", 60, "SCIENCE"],
      ["", "", "Teacher Example"],
      ["CLASS ADVISER", "", "Teacher Example"],
    ]),
    "Class Program",
  );
  return workbook;
}
function ambiguousProgramBook() {
  const sheet: XLSX.WorkSheet = { "!ref": "A1:Q32" };
  const values: Record<string, string> = {
    A3: "GRADE 11 CLASS PROGRAM",
    A20: "SECTION",
    M20: "G11 - AVAST",
    A21: "TIME/DAY",
    B21: "NO. OF MINUTES",
    M21: "MONDAY",
    N21: "TUESDAY",
    O21: "WEDNESDAY",
    P21: "THURSDAY",
    Q21: "FRIDAY",
    A22: "7:30 - 8:30",
    M22: "PKLP",
    O22: "PKLP",
    A24: "8:30 - 9:30",
    M24: "Chin-Chin Bustillo",
    O24: "Chin-Chin Bustillo",
  };
  for (const [address, value] of Object.entries(values)) sheet[address] = { t: "s", v: value };
  sheet["!merges"] = ["M22:M23", "O22:O23", "M24:M25", "O24:O25"].map(XLSX.utils.decode_range);
  const result = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(result, sheet, "C_prog_G11 (2H)");
  return result;
}

it("guides a first-time import without hiding the upload control", async () => {
  await openImport();
  expect(
    screen.getByRole("heading", { name: "Bring your records into E-CLASS" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("complementary", { name: "How importing works" })).toBeInTheDocument();
  expect(screen.getByText("Choose a data type")).toBeInTheDocument();
  expect(screen.getByText("Review and confirm")).toBeInTheDocument();
  expect(screen.getByLabelText("Upload Excel workbook or CSV")).toHaveAttribute(
    "accept",
    ".xlsx,.csv",
  );
  expect(document.querySelector(".import-start")).toHaveClass("import-start");
  expect(screen.getByLabelText(/data type/i)).toHaveValue("teachers");
});

it("keeps the uploaded timetable preview prominent and removes the first-time guide", async () => {
  await openImport();
  upload(programBook());
  expect(await screen.findByText("Class program detected")).toBeInTheDocument();
  expect(
    screen.queryByRole("complementary", { name: "How importing works" }),
  ).not.toBeInTheDocument();
  expect(document.querySelector(".import-start")).toHaveClass("import-start--selected");
  expect(screen.getByLabelText("Upload Excel workbook or CSV")).toBeEnabled();
  expect(screen.getByLabelText("Row 1 Full name")).toHaveValue("Teacher Example");
});

it("extracts teacher names from a class-program workbook into an editable preview", async () => {
  await openImport();
  upload(programBook());
  expect(await screen.findByText("Class program detected")).toBeInTheDocument();
  expect(screen.getByLabelText("Row 1 Full name")).toHaveValue("Teacher Example");
  expect(screen.getByRole("button", { name: /Confirm import/ })).toBeEnabled();
  expect(dataService.saveAll).not.toHaveBeenCalled();
});

it("confirms extracted records through one catalog import without reloading after the write", async () => {
  await openImport();
  upload(programBook());
  await screen.findByLabelText("Row 1 Full name");
  const committed = makeSampleData();
  committed.teachers.push({
    id: "saved-1",
    name: "Teacher Example",
    specialization: "General",
    employmentType: "Permanent",
    minHours: 18,
    maxHours: 30,
  });
  const importSpy = vi.spyOn(dataService, "importCatalog").mockResolvedValue(committed);
  fireEvent.click(screen.getByRole("button", { name: /Confirm import/ }));
  await waitFor(() =>
    expect(importSpy).toHaveBeenCalledWith("teachers", [
      expect.objectContaining({ name: "Teacher Example" }),
    ]),
  );
  await waitFor(() => expect(screen.getByText(/already in your data/i)).toBeInTheDocument());
  expect(dataService.saveAll).not.toHaveBeenCalled();
  expect(dataService.getAll).toHaveBeenCalledTimes(1);
});

it("reuses the workbook for another data type and reports missing rooms", async () => {
  await openImport();
  upload(programBook());
  await screen.findByText("Class program detected");
  fireEvent.change(screen.getByLabelText(/data type/i), { target: { value: "rooms" } });
  expect(
    await screen.findByText(
      "No room records are present in this class-program format. Import a room list or add rooms in Data Setup.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Confirm import/ })).not.toBeInTheDocument();
  expect(dataService.saveAll).not.toHaveBeenCalled();
});

it("blocks an unmapped Name column instead of adding nameless records", async () => {
  await openImport();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["Unusual heading"], ["Someone"]]),
    "List",
  );
  upload(workbook);
  await screen.findByLabelText("Row 1 Full name");
  expect(screen.getByRole("button", { name: /Confirm import/ })).toBeDisabled();
  expect(dataService.saveAll).not.toHaveBeenCalled();
});

it("keeps the preview and school data after a rejected database write", async () => {
  await openImport();
  upload(programBook());
  await screen.findByLabelText("Row 1 Full name");
  const importSpy = vi
    .spyOn(dataService, "importCatalog")
    .mockRejectedValueOnce(new Error("Database rejected this import"));
  fireEvent.click(screen.getByRole("button", { name: /Confirm import/ }));
  expect(await screen.findByText("Database rejected this import")).toBeInTheDocument();
  expect(screen.getByLabelText("Row 1 Full name")).toHaveValue("Teacher Example");
  expect(importSpy).toHaveBeenCalledWith("teachers", [
    expect.objectContaining({ name: "Teacher Example" }),
  ]);
  expect(dataService.saveAll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Teacher workload" }), {
    button: 0,
    ctrlKey: false,
  });
  await waitFor(() =>
    expect(document.querySelector(".data-table")).not.toHaveTextContent("Teacher Example"),
  );
});

it("does not remove trailing spaces or intermediate decimal text during preview editing", async () => {
  await openImport();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Full name", "Minimum weekly hours"],
      ["Ana", 18],
    ]),
    "Teachers",
  );
  upload(workbook);
  const name = await screen.findByLabelText("Row 1 Full name");
  fireEvent.change(name, { target: { value: "Ana " } });
  expect(name).toHaveValue("Ana ");
  fireEvent.change(name, { target: { value: "Ana Cruz" } });
  expect(name).toHaveValue("Ana Cruz");
  const hours = screen.getByLabelText("Row 1 Minimum weekly hours");
  fireEvent.change(hours, { target: { value: "18." } });
  expect(hours).toHaveValue("18.");
  fireEvent.change(hours, { target: { value: "18.5" } });
  expect(hours).toHaveValue("18.5");
  const imported = vi.spyOn(dataService, "importCatalog").mockResolvedValue(makeSampleData());
  fireEvent.click(screen.getByRole("button", { name: /Confirm import/ }));
  await waitFor(() =>
    expect(imported).toHaveBeenCalledWith("teachers", [
      expect.objectContaining({ name: "Ana Cruz", minHours: 18.5 }),
    ]),
  );
});

it("shows correctly decoded accented CSV names and keeps encoding warnings when the data type changes", async () => {
  await openImport();
  uploadCsv(
    "Roster.csv",
    new Uint8Array([78, 97, 109, 101, 13, 10, 74, 111, 115, 233, 32, 80, 101, 241, 97]),
  );
  expect(await screen.findByLabelText("Row 1 Full name")).toHaveValue("José Peña");
  expect(screen.getByText(/Decoded as Windows-1252/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/data type/i), { target: { value: "sections" } });
  expect(screen.getByText(/Decoded as Windows-1252/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/data type/i), { target: { value: "teachers" } });
  expect(screen.getByLabelText("Row 1 Full name")).toHaveValue("José Peña");
});

it("blocks an ambiguous merged teacher continuation until every source cell is resolved", async () => {
  await openImport();
  fireEvent.change(screen.getByLabelText(/data type/i), { target: { value: "subjects" } });
  upload(ambiguousProgramBook());
  expect(await screen.findByText("Review ambiguous class-program cells")).toBeInTheDocument();
  expect(screen.getByText(/2 source cells need a decision/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Row 1 Subject name")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Confirm import/ })).not.toBeInTheDocument();
  for (const address of ["M24", "O24"]) {
    fireEvent.change(
      screen.getByRole("combobox", { name: `Interpret C_prog_G11 (2H) ${address}` }),
      {
        target: { value: "teacher-continuation" },
      },
    );
  }
  expect(screen.getByText(/0 source cells need a decision/)).toBeInTheDocument();
  expect(screen.getByLabelText("Row 1 Subject name")).toHaveValue("PKLP");
  expect(screen.getByLabelText("Row 1 Minutes per week")).toHaveValue("240");
  const name = screen.getByLabelText("Row 1 Subject name");
  fireEvent.change(name, { target: { value: "PKLP edited" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Interpret C_prog_G11 (2H) M24" }), {
    target: { value: "subject" },
  });
  expect(screen.getByLabelText("Row 1 Subject name")).toHaveValue("PKLP");
  expect(screen.getByText(/Changing a decision rebuilds the preview/)).toBeInTheDocument();
});

it("blocks conflicting catalog, scheduling, and settings controls until an import finishes", async () => {
  await openImport();
  upload(programBook());
  await screen.findByLabelText("Row 1 Full name");
  let reject!: (reason: Error) => void;
  const importSpy = vi.spyOn(dataService, "importCatalog").mockReturnValueOnce(
    new Promise((_resolve, no) => {
      reject = no;
    }),
  );
  const confirm = screen.getByRole("button", { name: /Confirm import/ });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(importSpy).toHaveBeenCalledTimes(1);
  expect(confirm).toBeDisabled();
  expect(screen.getByLabelText("Row 1 Full name")).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "School year" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Data Setup" }));
  expect(screen.getByRole("button", { name: "Add teacher" })).toBeDisabled();
  expect(screen.getAllByRole("button", { name: "Edit" })[0]).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByLabelText("School name")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Scheduling" }));
  expect(screen.getByRole("button", { name: "Assign a class" })).toBeDisabled();
  await act(async () => {
    reject(new Error("Import failed; retry"));
  });
  fireEvent.click(screen.getByRole("button", { name: "Import Data" }));
  expect(screen.getByLabelText("Row 1 Full name")).toHaveValue("Teacher Example");
  expect(screen.getByRole("button", { name: /Confirm import/ })).toBeEnabled();
});

it("shows a read error inside Import Data without a fatal page", async () => {
  await openImport();
  const file = new File(["bad"], "Corrupt.xlsx");
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => {
      throw new Error("This workbook could not be read");
    },
  });
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
  expect(await screen.findByText("This workbook could not be read")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Import Data" })).toBeInTheDocument();
  expect(dataService.saveAll).not.toHaveBeenCalled();
});
