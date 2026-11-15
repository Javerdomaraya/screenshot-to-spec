import { createElement, type ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Route } from "@/routes/index";
import { dataService, makeSampleData } from "@/services/dataService";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
HTMLElement.prototype.scrollIntoView = () => {};

async function openApp(data = makeSampleData()) {
  vi.spyOn(dataService, "getAll").mockResolvedValue(data);
  vi.spyOn(dataService, "saveAll").mockImplementation(async (next) => structuredClone(next));
  await act(async () => {
    render(createElement(Route.options.component as ComponentType));
  });
}

async function openReports() {
  await openApp();
  fireEvent.click(screen.getByRole("button", { name: "Reports" }));
  await screen.findByText("Choose a program");
  return within(document.querySelector(".report-controls") as HTMLElement);
}

it("keeps consolidated section reports selected", async () => {
  const controls = await openReports();
  fireEvent.keyDown(controls.getAllByRole("combobox")[1]!, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "All sections · consolidated" }));
  await waitFor(() => expect(document.querySelectorAll(".report-paper").length).toBeGreaterThan(1));
  expect(controls.getAllByRole("combobox")[1]).toHaveTextContent("All sections");
});

it("groups print and exports into one labelled report toolbar", async () => {
  const controls = await openReports();
  const actions = controls.getByRole("group", { name: "Report actions" });
  expect(actions).toHaveClass("report-actions");
  expect(within(actions).getByText(/program sheet/)).toBeInTheDocument();
  expect(within(actions).getByRole("button", { name: "Print" })).toBeEnabled();
  expect(within(actions).getByRole("button", { name: "Export PDF" })).toBeEnabled();
  expect(within(actions).getByRole("button", { name: "Export CSV" })).toBeEnabled();
  expect(within(actions).getByText(/Save as PDF/)).toBeInTheDocument();
  expect(screen.getAllByText("SY 2025–2026 · TERM 1").length).toBeGreaterThan(0);
});

it("keeps Print and Export PDF attached to the system print dialog", async () => {
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  const controls = await openReports();
  fireEvent.click(controls.getByRole("button", { name: "Print" }));
  fireEvent.click(controls.getByRole("button", { name: "Export PDF" }));
  expect(print).toHaveBeenCalledTimes(2);
});

it("keeps a section's bell profile when its adviser is edited", async () => {
  const data = makeSampleData();
  data.sections[0]!.bellScheduleId = "custom-jhs-b";
  await openApp(data);
  fireEvent.click(screen.getByRole("button", { name: "Data Setup" }));
  fireEvent.mouseDown(screen.getByRole("tab", { name: /Sections/ }), { button: 0, ctrlKey: false });
  fireEvent.click(
    within(document.querySelector(".data-table tbody tr") as HTMLElement).getByRole("button", {
      name: "Edit",
    }),
  );
  fireEvent.change(screen.getByLabelText("Adviser"), { target: { value: "New Adviser" } });
  await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Save/ })); });
  expect(vi.mocked(dataService.saveAll).mock.lastCall?.[0].sections[0]?.bellScheduleId).toBe(
    "custom-jhs-b",
  );
});

it("shows the chosen section's times in the scheduling period picker", async () => {
  const data = makeSampleData();
  data.sections.find((section) => section.id === "s8-edge")!.bellScheduleId = "shs";
  data.programTimeSlots = [
    {
      id: "shs-1",
      bellScheduleId: "shs",
      kind: "period",
      period: 1,
      startTime: "07:30",
      endTime: "08:30",
      minutes: 60,
    },
    {
      id: "shs-2",
      bellScheduleId: "shs",
      kind: "period",
      period: 2,
      startTime: "08:30",
      endTime: "09:30",
      minutes: 60,
    },
    {
      id: "shs-3",
      bellScheduleId: "shs",
      kind: "period",
      period: 3,
      startTime: "09:45",
      endTime: "10:45",
      minutes: 60,
    },
  ];
  await openApp(data);
  fireEvent.click(screen.getByRole("button", { name: "Scheduling" }));
  expect(screen.getByLabelText("Period")).toHaveTextContent("9:45–10:45");
});

it("keeps a chosen teacher selected in a teacher program", async () => {
  const controls = await openReports();
  fireEvent.keyDown(controls.getAllByRole("combobox")[0]!, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "Teacher Program" }));
  fireEvent.keyDown(controls.getAllByRole("combobox")[1]!, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "Jose Reyes" }));
  await waitFor(() => expect(controls.getAllByRole("combobox")[1]).toHaveTextContent("Jose Reyes"));
  expect(document.querySelector(".program-entity-row")).toHaveTextContent("Jose Reyes");
});
