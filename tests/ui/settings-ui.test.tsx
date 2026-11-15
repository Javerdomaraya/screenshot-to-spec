import { createElement, type ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Route } from "@/routes/index";
import { dataService, makeSampleData } from "@/services/dataService";
import type { DesktopApi } from "../../shared/electron-api";

afterEach(() => {
  cleanup();
  delete window.api;
  vi.restoreAllMocks();
});
HTMLElement.prototype.scrollIntoView = () => {};

async function openSettings(schoolYear?: string) {
  const data = makeSampleData();
  if (schoolYear) data.settings.schoolYear = schoolYear;
  vi.spyOn(dataService, "getAll").mockResolvedValue(data);
  const save = vi.spyOn(dataService, "saveSettings").mockImplementation(async (settings) => ({
    ...makeSampleData(),
    settings,
  }));
  vi.spyOn(dataService, "reset");
  await act(async () => {
    render(createElement(Route.options.component as ComponentType));
  });
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  return { save };
}

it.each(["2026-2027", "2026–2027"])(
  "saves canonical year keys after switching away and back from %s in Settings",
  async (storedYear) => {
    const { save } = await openSettings(storedYear);
    const page = within(document.querySelector(".settings-page") as HTMLElement);
    expect(page.getByRole("combobox", { name: "School year" })).toHaveValue("2026-2027");
    for (const [label, key] of [
      ["2027–2028", "2027-2028"],
      ["2026–2027", "2026-2027"],
    ] as const) {
      const selector = page.getByRole("combobox", { name: "School year" });
      const option = within(selector).getByRole("option", { name: label }) as HTMLOptionElement;
      fireEvent.change(selector, { target: { value: option.value } });
      await act(async () => {
        fireEvent.click(page.getByRole("button", { name: "Save school settings" }));
      });
      expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ schoolYear: key }));
      expect(page.getByRole("button", { name: "Save school settings" })).toBeDisabled();
    }
  },
);

it("shows the complete school name and the settings layout without truncation", async () => {
  await openSettings();
  expect(screen.getByRole("textbox", { name: "School name" }).tagName).toBe("TEXTAREA");
  expect(
    within(document.querySelector(".settings-page") as HTMLElement).getByRole("combobox", {
      name: "School year",
    }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save school settings" })).toBeDisabled();
  expect(screen.getByText(/All changes saved/)).toBeInTheDocument();
});

it("validates weekly thresholds, shows unsaved changes, and saves only valid values", async () => {
  const { save } = await openSettings();
  fireEvent.change(screen.getByRole("textbox", { name: "Prepared by" }), {
    target: { value: "Ms. Reyes" },
  });
  expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("spinbutton", { name: /Balanced up to/ }), {
    target: { value: "12" },
  });
  expect(screen.getByText(/must be greater/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save school settings" })).toBeDisabled();
  fireEvent.change(screen.getByRole("spinbutton", { name: /Balanced up to/ }), {
    target: { value: "30" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save school settings" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ preparedBy: "Ms. Reyes" })),
  );
  expect(await screen.findByText(/All changes saved/)).toBeInTheDocument();
});

it("asks for explicit confirmation before restoring browser sample data", async () => {
  await openSettings();
  fireEvent.click(screen.getByRole("button", { name: "Restore sample data" }));
  expect(screen.getByRole("dialog", { name: /Restore sample data/ })).toBeInTheDocument();
  expect(dataService.reset).not.toHaveBeenCalled();
  const dialog = within(screen.getByRole("dialog", { name: /Restore sample data/ }));
  expect(dialog.getByRole("button", { name: "Restore sample data now" })).toBeDisabled();
  fireEvent.change(dialog.getByRole("textbox", { name: /Type RESET/ }), {
    target: { value: "RESET" },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  expect(dataService.reset).not.toHaveBeenCalled();
});

it("restores the browser demo only after the exact confirmation is entered", async () => {
  await openSettings();
  fireEvent.click(screen.getByRole("button", { name: "Restore sample data" }));
  const dialog = within(screen.getByRole("dialog", { name: /Restore sample data/ }));
  fireEvent.change(dialog.getByRole("textbox", { name: /Type RESET/ }), {
    target: { value: "RESET" },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Restore sample data now" }));
  await waitFor(() => expect(dataService.reset).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: /Restore sample data/ })).not.toBeInTheDocument(),
  );
});

it("does not claim that settings were saved if the persistence operation fails", async () => {
  const { save } = await openSettings();
  save.mockRejectedValueOnce(new Error("Storage unavailable"));
  fireEvent.change(screen.getByRole("textbox", { name: "Prepared by" }), {
    target: { value: "Ms. Reyes" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save school settings" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Storage unavailable");
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save school settings" })).toBeEnabled();
});

it("protects stored desktop school records from restoring browser sample data", async () => {
  window.api = {
    auth: {
      status: async () => ({
        ok: true,
        data: { configured: true, authenticated: true, username: "admin" },
      }),
    },
  } as unknown as DesktopApi;
  await openSettings();
  expect(screen.getByText(/Unavailable for saved school databases/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Restore sample data" })).toBeDisabled();
  expect(dataService.reset).not.toHaveBeenCalled();
});

it("saves editable report header details and titles while keeping signatory names blank", async () => {
  const { save } = await openSettings();
  expect(screen.getByRole("textbox", { name: "Prepared by" })).toHaveValue("");
  expect(screen.getByRole("textbox", { name: "Approved by" })).toHaveValue("");
  const edits = {
    "Printed school name": "Updated official school header",
    Region: "Updated region",
    Division: "Updated division",
    District: "Updated district",
    "School address": "Updated school address",
    "Prepared by title": "Teacher III",
    "Approved by title": "District Supervisor",
  };
  for (const [name, value] of Object.entries(edits)) {
    fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Save school settings" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        reportSchoolName: "Updated official school header",
        region: "Updated region",
        division: "Updated division",
        district: "Updated district",
        schoolAddress: "Updated school address",
        preparedByTitle: "Teacher III",
        approvedByTitle: "District Supervisor",
        preparedBy: "",
        schoolHead: "",
      }),
    ),
  );
  expect(await screen.findByText(/All changes saved/)).toBeInTheDocument();
});
