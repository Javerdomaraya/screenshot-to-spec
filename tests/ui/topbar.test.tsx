import { createElement, type ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Route } from "@/routes/index";
import { dataService, makeSampleData } from "@/services/dataService";
import { SCHOOL_NAME } from "@/lib/schoolBrand";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
HTMLElement.prototype.scrollIntoView = () => {};

async function openApp(overrides: { schoolName?: string; schoolYear?: string } = {}) {
  const data = makeSampleData();
  data.settings = { ...data.settings, ...overrides };
  vi.spyOn(dataService, "getAll").mockResolvedValue(data);
  vi.spyOn(dataService, "saveSettings").mockImplementation(async (settings) => ({ ...data, settings }));
  await act(async () => {
    render(createElement(Route.options.component as ComponentType));
  });
  return within(document.querySelector(".topbar") as HTMLElement);
}

it("shows the school identity and the saved hyphenated school year", async () => {
  const header = await openApp({ schoolName: "Example National High School", schoolYear: "2026-2027" });
  expect(header.getByText("Academic workspace")).toBeInTheDocument();
  expect(header.getByText("Schedules, school data, and reports")).toBeInTheDocument();
  expect(header.queryByText("Example National High School")).not.toBeInTheDocument();
  expect(header.getByRole("combobox", { name: "School year" })).toHaveTextContent("2026–2027");
  expect(header.getByRole("group", { name: "School term" })).toBeInTheDocument();
  expect(document.querySelector(".sidebar-academic-period")).toHaveTextContent("2026–2027 · Term 1");
  expect(document.querySelector(".page-heading .eyebrow")).toHaveTextContent("2026–2027");
});

it("formats canonical years in the master schedule review", async () => {
  await openApp({ schoolYear: "2026-2027" });
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(within(document.querySelector(".review-page") as HTMLElement).getByText("2026–2027")).toBeInTheDocument();
});

it("returns to the original hyphenated key after switching school years in the topbar", async () => {
  const header = await openApp({ schoolYear: "2026-2027" });
  for (const [label, key] of [["2027–2028", "2027-2028"], ["2026–2027", "2026-2027"]] as const) {
    fireEvent.keyDown(header.getByRole("combobox", { name: "School year" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: label }));
    await waitFor(() => expect(header.getByRole("combobox", { name: "School year" })).toHaveTextContent(label));
    expect(dataService.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ schoolYear: key }));
  }
});

it("provides a non-empty school identity when the school name is not configured", async () => {
  const header = await openApp({ schoolName: "" });
  expect(within(document.querySelector(".sidebar-brand") as HTMLElement).getByText(SCHOOL_NAME)).toBeInTheDocument();
  expect(header.getByRole("button", { name: "Collapse sidebar" })).toBeEnabled();
});

it("keeps term selection interactive and indicates which term is active", async () => {
  const header = await openApp();
  const termGroup = header.getByRole("group", { name: "School term" });
  const term2 = within(termGroup).getByRole("button", { name: "T2" });
  fireEvent.click(term2);
  expect(term2).toHaveAttribute("aria-pressed", "true");
  expect(within(termGroup).getByRole("button", { name: "T1" })).toHaveAttribute("aria-pressed", "false");
});

it("shows the school seal in the sidebar rather than duplicating it in the expanded topbar", async () => {
  const header = await openApp({ schoolName: "" });
  expect(header.queryByRole("img", { name: "School logo" })).not.toBeInTheDocument();
  expect(within(document.querySelector(".sidebar-brand") as HTMLElement).getByRole("img", { name: "School logo" }))
    .toHaveAttribute("src", expect.stringContaining("ICT.png"));
});

it("uses the school seal and full school name as primary sidebar branding", async () => {
  await openApp({ schoolName: "" });
  const sidebar = within(document.querySelector(".app-sidebar") as HTMLElement);
  const brand = within(document.querySelector(".sidebar-brand") as HTMLElement);
  expect(brand.getByRole("img", { name: "School logo" })).toHaveAttribute("src", expect.stringContaining("ICT.png"));
  expect(brand.getByText(SCHOOL_NAME)).toBeInTheDocument();
  expect(brand.getByText("E-CLASS")).toBeInTheDocument();
  expect(brand.getByText("TEACHER'S DIGITAL TOOLBOX PH")).toBeInTheDocument();
  expect(sidebar.getAllByText(SCHOOL_NAME)).toHaveLength(1);
  expect(sidebar.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
});

it("preserves a different configured school name and the collapsed sidebar controls", async () => {
  const header = await openApp({ schoolName: "Example National High School" });
  const brand = within(document.querySelector(".sidebar-brand") as HTMLElement);
  expect(brand.getByText("Example National High School")).toBeInTheDocument();
  fireEvent.click(header.getByRole("button", { name: "Collapse sidebar" }));
  expect(document.querySelector(".app-sidebar")).toHaveClass("app-sidebar-collapsed");
  expect(brand.queryByText("Example National High School")).not.toBeInTheDocument();
  expect(brand.getByRole("img", { name: "School logo" })).toBeInTheDocument();
  expect(header.getByText("Example National High School")).toBeInTheDocument();
  expect(within(document.querySelector(".app-sidebar") as HTMLElement).getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
  fireEvent.click(header.getByRole("button", { name: "Expand sidebar" }));
  expect(brand.getByText("Example National High School")).toBeInTheDocument();
  expect(header.queryByText("Example National High School")).not.toBeInTheDocument();
});
