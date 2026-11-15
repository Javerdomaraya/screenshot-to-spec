import { createElement, type ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Route } from "@/routes/index";
import { dataService, makeSampleData } from "@/services/dataService";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
HTMLElement.prototype.scrollIntoView = () => {};

async function openDataSetup() {
  const data = makeSampleData();
  const template = data.teachers[0]!;
  data.teachers = Array.from({ length: 27 }, (_, i) => ({
    ...template,
    id: `teacher-${i + 1}`,
    name: `Teacher ${27 - i}`,
    minHours: i + 1,
  }));
  vi.spyOn(dataService, "getAll").mockResolvedValue(data);
  vi.spyOn(dataService, "saveAll").mockImplementation(async (next) => structuredClone(next));
  await act(async () => { render(createElement(Route.options.component as ComponentType)); });
  fireEvent.click(screen.getByRole("button", { name: "Data Setup" }));
  return within(document.querySelector(".data-setup-table") as HTMLElement);
}

it("shows a compact page of sorted records instead of rendering every row", async () => {
  const table = await openDataSetup();
  expect(table.getByText("27 total")).toBeInTheDocument();
  expect(table.getByRole("combobox", { name: "Rows per page" })).toHaveValue("10");
  expect(table.getAllByRole("row")).toHaveLength(11);
  expect(within(table.getAllByRole("row")[1]!).getByText("Teacher 1")).toBeInTheDocument();
  expect(table.getByText("1–10 of 27")).toBeInTheDocument();
  fireEvent.click(table.getByRole("button", { name: "Next page" }));
  expect(table.getByText("11–20 of 27")).toBeInTheDocument();
  expect(within(table.getAllByRole("row")[1]!).getByText("Teacher 11")).toBeInTheDocument();
});

it("sorts by a selected column and resets pagination when filtering", async () => {
  const table = await openDataSetup();
  fireEvent.click(table.getByRole("button", { name: "Sort by Full name" }));
  expect(table.getByRole("columnheader", { name: /Full name/ })).toHaveAttribute("aria-sort", "descending");
  expect(within(table.getAllByRole("row")[1]!).getByText("Teacher 27")).toBeInTheDocument();
  fireEvent.click(table.getByRole("button", { name: "Next page" }));
  fireEvent.change(screen.getByPlaceholderText("Search teachers…"), { target: { value: "Teacher 5" } });
  expect(table.getByText("1–1 of 1")).toBeInTheDocument();
  expect(table.getByText("Teacher 5")).toBeInTheDocument();
});

it("uses a named delete action and still requires confirmation", async () => {
  const table = await openDataSetup();
  const first = table.getAllByRole("row")[1]!;
  expect(within(first).getByRole("button", { name: "Edit" })).toBeInTheDocument();
  fireEvent.click(within(first).getByRole("button", { name: "Delete teacher Teacher 1" }));
  expect(screen.getByRole("dialog", { name: /Delete this record/ })).toHaveTextContent("Teacher 1");
  expect(dataService.saveAll).not.toHaveBeenCalled();
});

it("allows 25 or 50 rows per page without removing hidden school records", async () => {
  const table = await openDataSetup();
  fireEvent.change(table.getByRole("combobox", { name: "Rows per page" }), { target: { value: "25" } });
  expect(table.getAllByRole("row")).toHaveLength(26);
  expect(table.getByText("1–25 of 27")).toBeInTheDocument();
  fireEvent.change(table.getByRole("combobox", { name: "Rows per page" }), { target: { value: "50" } });
  expect(table.getAllByRole("row")).toHaveLength(28);
  expect(table.getByText("1–27 of 27")).toBeInTheDocument();
  expect(dataService.saveAll).not.toHaveBeenCalled();
});
