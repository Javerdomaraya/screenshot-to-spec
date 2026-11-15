import { createElement, type ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Route } from "@/routes/index";
import { dataService, makeSampleData } from "@/services/dataService";
import type { AdminAuthStatus, DesktopApi } from "../../shared/electron-api";

const locked: AdminAuthStatus = { configured: true, authenticated: false, username: "admin" };
const unlocked: AdminAuthStatus = { ...locked, authenticated: true };

afterEach(() => { cleanup(); delete window.api; vi.restoreAllMocks(); });
HTMLElement.prototype.scrollIntoView = () => {};

function authApi(first: AdminAuthStatus) {
  const auth = {
    status: vi.fn().mockResolvedValue({ ok: true, data: first }),
    setup: vi.fn().mockResolvedValue({ ok: true, data: unlocked }),
    signIn: vi.fn().mockResolvedValue({ ok: true, data: unlocked }),
    logout: vi.fn().mockResolvedValue({ ok: true, data: locked }),
  };
  window.api = { auth } as unknown as DesktopApi;
  return auth;
}

async function open() {
  await act(async () => { render(createElement(Route.options.component as ComponentType)); });
}

it("does not load school records or render Dashboard before administrator login", async () => {
  authApi(locked);
  const load = vi.spyOn(dataService, "getAll");
  await open();
  expect(await screen.findByRole("heading", { name: "Administrator sign in" })).toBeInTheDocument();
  expect(screen.getByText("ICT High School of Eastern Biliran")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "School logo" })).toHaveAttribute("src", expect.stringContaining("ICT.png"));
  expect(screen.queryByRole("button", { name: "Dashboard" })).not.toBeInTheDocument();
  expect(load).not.toHaveBeenCalled();
});

it("lets a new administrator set a password but blocks mismatched confirmations", async () => {
  const auth = authApi({ ...locked, configured: false });
  vi.spyOn(dataService, "getAll").mockResolvedValue(makeSampleData());
  await open();
  expect(await screen.findByRole("heading", { name: "Create administrator password" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Very-Strong-Password-123" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "mismatch" } });
  fireEvent.click(screen.getByRole("button", { name: "Create administrator account" }));
  expect(auth.setup).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent(/do not match/i);
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "Very-Strong-Password-123" } });
  fireEvent.click(screen.getByRole("button", { name: "Create administrator account" }));
  await waitFor(() => expect(auth.setup).toHaveBeenCalledWith("Very-Strong-Password-123"));
});

it("redirects to Dashboard only after a successful login, then locks again on sign out", async () => {
  const auth = authApi(locked);
  vi.spyOn(dataService, "getAll").mockResolvedValue(makeSampleData());
  await open();
  await screen.findByRole("heading", { name: "Administrator sign in" });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Very-Strong-Password-123" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in to E-CLASS" }));
  await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("Very-Strong-Password-123"));
  expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(auth.logout).toHaveBeenCalledOnce());
  expect(await screen.findByRole("heading", { name: "Administrator sign in" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
});

it("shows an invalid-password error without unlocking the dashboard or loading records", async () => {
  const auth = authApi(locked);
  auth.signIn.mockResolvedValueOnce({
    ok: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid password." },
  });
  const getAll = vi.spyOn(dataService, "getAll");
  await open();
  await screen.findByRole("heading", { name: "Administrator sign in" });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "invalid" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in to E-CLASS" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid password.");
  expect(screen.queryByRole("button", { name: "Dashboard" })).not.toBeInTheDocument();
  expect(getAll).not.toHaveBeenCalled();
});
