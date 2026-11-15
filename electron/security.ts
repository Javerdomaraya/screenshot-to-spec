import type { BrowserWindowConstructorOptions } from "electron";
import { join } from "node:path";

/** Development icons live inside the project; packaged icons are copied into
 * Electron's resources directory (outside app.asar) by electron-builder. */
export function resolveWindowIconPath(options: {
  packaged: boolean;
  appPath: string;
  resourcesPath: string;
  platform: NodeJS.Platform;
}): string {
  const filename = options.platform === "win32" ? "icon.ico" : "icon.png";
  return options.packaged
    ? join(options.resourcesPath, filename)
    : join(options.appPath, "build", filename);
}

export function getWindowOptions(preload: string, icon?: string): BrowserWindowConstructorOptions {
  return {
    title: "E-CLASS — Smart Schedule Generator",
    ...(icon ? { icon } : {}),
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: "#f3f7fb",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  };
}

export function isAllowedNavigation(target: string, startUrl: string): boolean {
  try {
    const next = new URL(target);
    const initial = new URL(startUrl);
    if (initial.protocol === "file:") return next.href === initial.href;
    return initial.protocol === "http:" && next.origin === initial.origin;
  } catch {
    return false;
  }
}
