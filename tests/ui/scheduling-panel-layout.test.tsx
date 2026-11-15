import { createElement, type ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Route } from "@/routes/index";
import { dataService, makeSampleData } from "@/services/dataService";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openScheduling() {
  vi.spyOn(dataService, "getAll").mockResolvedValue(makeSampleData());
  await act(async () => {
    render(createElement(Route.options.component as ComponentType));
  });
  fireEvent.click(screen.getByRole("button", { name: "Scheduling" }));
  return document.querySelector(".schedule-workspace") as HTMLElement;
}

it("puts the timetable before the collapsed assignment panel", async () => {
  const workspace = await openScheduling();
  expect(workspace.children[0]).toHaveClass("weekly-panel");
  expect(workspace.children[1]).toHaveClass("schedule-form-panel");
  expect(within(workspace).getByRole("region", { name: /CLASS PROGRAM timetable/i })).toBeInTheDocument();
  const toggle = within(workspace).getByRole("button", { name: /Assign a class/i });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(within(workspace).queryByRole("button", { name: "Validate" })).not.toBeInTheDocument();
});

it("opens and closes the form without losing its selected values", async () => {
  const workspace = await openScheduling();
  const toggle = within(workspace).getByRole("button", { name: /Assign a class/i });
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(within(workspace).getByRole("button", { name: "Validate" })).toBeInTheDocument();
  expect(screen.getByLabelText("Day")).toHaveTextContent("Monday");

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(within(workspace).queryByRole("button", { name: "Validate" })).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(screen.getByLabelText("Day")).toHaveTextContent("Monday");
});

it("keeps automatic scheduling accessible in the same collapsible panel", async () => {
  const workspace = await openScheduling();
  fireEvent.click(screen.getByRole("button", { name: /Auto-Generate/ }));
  const toggle = within(workspace).getByRole("button", { name: /Fill open periods/i });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(within(workspace).getByRole("button", { name: /Generate open schedules/ })).toBeInTheDocument();
});
