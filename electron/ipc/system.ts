import { app, BrowserWindow, ipcMain } from "electron";
import type { AppInfo, IpcResult } from "../../shared/electron-api";
import { logError } from "../services/logger";

export function registerSystemHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle("system:getAppInfo", (event): IpcResult<AppInfo> => {
    try {
      const window = getWindow();
      if (!window || window.isDestroyed() || event.sender !== window.webContents) {
        return { ok: false, error: { code: "FORBIDDEN", message: "Untrusted window." } };
      }

      return {
        ok: true,
        data: { appName: app.getName(), version: app.getVersion(), platform: process.platform },
      };
    } catch (error) {
      logError("system:getAppInfo", error);
      return {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "Could not read application information." },
      };
    }
  });
}
