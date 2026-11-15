// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

const registrations = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn((name: string, callback: (...args: unknown[]) => Promise<unknown>) => {
    registrations.set(name, callback);
  }) },
}));
vi.mock("../../electron/services/logger", () => ({ logError: vi.fn() }));

import { registerHandler, setAuthenticationGuard } from "../../electron/ipc/handler";

const mainFrame = {};
const sender = { mainFrame };
const windowMock = {
  isDestroyed: () => false,
  webContents: sender,
};
const event = { sender, senderFrame: mainFrame };
const fromWindow = () => windowMock as never;

afterEach(() => {
  registrations.clear();
  setAuthenticationGuard(() => false);
});

it("rejects private catalog and schedule IPC calls before authentication", async () => {
  let authenticated = false;
  const protectedCall = vi.fn(() => ({ privateData: true }));
  setAuthenticationGuard(() => authenticated);
  registerHandler("catalog:snapshot", fromWindow, protectedCall);
  registerHandler("schedule:list", fromWindow, protectedCall);
  for (const channel of ["catalog:snapshot", "schedule:list"]) {
    const result = await registrations.get(channel)!(event);
    expect(result).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
  }
  expect(protectedCall).not.toHaveBeenCalled();
  authenticated = true;
  expect(await registrations.get("catalog:snapshot")!(event)).toEqual({
    ok: true, data: { privateData: true },
  });
});

it("allows only designated public auth handlers to operate before login and rejects foreign frames", async () => {
  setAuthenticationGuard(() => false);
  registerHandler("auth:status", fromWindow, () => ({ configured: false }), { public: true });
  expect(await registrations.get("auth:status")!(event)).toEqual({ ok: true, data: { configured: false } });
  expect(await registrations.get("auth:status")!({ sender, senderFrame: {} })).toMatchObject({
    ok: false, error: { code: "FORBIDDEN" },
  });
});
