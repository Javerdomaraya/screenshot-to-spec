import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import type { IpcResult } from "../../shared/electron-api";
import { CatalogError } from "../services/catalog";
import { logError } from "../services/logger";

export type WindowProvider = () => BrowserWindow | null;

// Fail closed. The main process installs its administrator-session guard
// before registering any catalog or scheduling handlers.
let isAuthenticated: () => boolean = () => false;
export function setAuthenticationGuard(guard: () => boolean): void {
  isAuthenticated = guard;
}

function fromMainFrame(event: IpcMainInvokeEvent, getWindow: WindowProvider): boolean {
  const window = getWindow();
  return Boolean(
    window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame,
  );
}

/**
 * Validate the caller before invoking any domain code.
 * Never allow a renderer to choose the SQL query or IPC channel.
 */
export function registerHandler<T>(
  channel: string,
  getWindow: WindowProvider,
  operation: (...args: unknown[]) => T | Promise<T>,
  options: { public?: true } = {},
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<IpcResult<T>> => {
    try {
      if (!fromMainFrame(event, getWindow)) {
        throw new CatalogError("FORBIDDEN", "This window is not allowed to access school data.");
      }
      if (!options.public && !isAuthenticated()) {
        throw new CatalogError("UNAUTHENTICATED", "Administrator sign-in is required.");
      }
      return { ok: true, data: await operation(...args) };
    } catch (error) {
      logError(channel, error);
      if (error instanceof CatalogError) {
        return { ok: false, error: { code: error.code, message: error.message } };
      }
      return {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "The operation could not be completed. Check the application log.",
        },
      };
    }
  });
}

export function registerCrudHandlers<New, Row>(
  domain: string,
  getWindow: WindowProvider,
  methods: {
    list(): Row[];
    get(id: number): Row;
    create(input: New): Row;
    update(id: number, input: New): Row;
    delete(id: number): true;
  },
): void {
  registerHandler(`${domain}:list`, getWindow, () => methods.list());
  registerHandler(`${domain}:get`, getWindow, (id) => methods.get(id as number));
  registerHandler(`${domain}:create`, getWindow, (input) => methods.create(input as New));
  registerHandler(`${domain}:update`, getWindow, (id, input) =>
    methods.update(id as number, input as New),
  );
  registerHandler(`${domain}:delete`, getWindow, (id) => {
    methods.delete(id as number);
    return { deleted: true as const };
  });
}
