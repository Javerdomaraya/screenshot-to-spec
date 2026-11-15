import { app, BrowserWindow, dialog } from "electron";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { registerSystemHandlers } from "./ipc/system";
import { logError } from "./services/logger";
import { getWindowOptions, isAllowedNavigation, resolveWindowIconPath } from "./security";
import { openSchoolDatabase, type SchoolDatabase } from "./db/database";
import { createCatalogService } from "./services/catalog";
import { registerTeachersHandlers } from "./ipc/teachers";
import { registerSectionsHandlers } from "./ipc/sections";
import { registerSubjectsHandlers } from "./ipc/subjects";
import { registerRoomsHandlers } from "./ipc/rooms";
import { registerCatalogHandlers } from "./ipc/catalog";
import { createScheduleService } from "./services/schedule";
import { registerScheduleHandlers } from "./ipc/schedule";
import { registerElectiveHandlers } from "./ipc/electives";
import { createAdminAuthService } from "./services/adminAuth";
import { registerAuthHandlers } from "./ipc/auth";
import { setAuthenticationGuard } from "./ipc/handler";

const DEV_URL = "http://127.0.0.1:8080/";
let mainWindow: BrowserWindow | null = null;
let schoolDatabase: SchoolDatabase | null = null;
let lockAdminSession: (() => void) | null = null;

function createWindow(): void {
  const preload = join(__dirname, "preload.cjs");
  const index = join(__dirname, "renderer", "index.html");
  const useDevServer = !app.isPackaged && process.env.ECLASS_STATIC !== "1";
  const initialUrl = useDevServer ? DEV_URL : pathToFileURL(index).href;
  const icon = resolveWindowIconPath({
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    platform: process.platform,
  });
  const window = new BrowserWindow(getWindowOptions(preload, icon));
  mainWindow = window;

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    lockAdminSession?.();
    if (mainWindow === window) mainWindow = null;
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, destination) => {
    if (!isAllowedNavigation(destination, initialUrl)) event.preventDefault();
  });
  window.webContents.on("did-fail-load", (_event, errorCode, description, url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) {
      logError("window:load", new Error(`${errorCode}: ${description} (${url})`));
      window.show();
    }
  });

  const loading = useDevServer ? window.loadURL(DEV_URL) : window.loadFile(index);
  void loading.catch((error: unknown) => logError("window:load", error));
}

app.setName("E-CLASS");
// Keep Windows taskbar grouping consistent with the packaged executable's appId.
if (process.platform === "win32") app.setAppUserModelId("ph.eclass.desktop");
// Explicitly opt into a disposable database location during local test runs.
// Packaged applications always use Electron's standard per-user data path.
if (!app.isPackaged && process.env.ECLASS_TEST_USER_DATA) {
  const target = process.env.ECLASS_TEST_USER_DATA;
  if (!isAbsolute(target)) {
    throw new Error("ECLASS_TEST_USER_DATA must be an absolute path.");
  }
  mkdirSync(target, { recursive: true });
  app.setPath("userData", target);
}
void app
  .whenReady()
  .then(async () => {
    // Always use Electron's per-user data directory, never the project folder.
    // No sample teachers, classes, or rooms are inserted on first launch.
    schoolDatabase = await openSchoolDatabase(app.getPath("userData"));
    const administrator = createAdminAuthService(schoolDatabase);
    lockAdminSession = () => { administrator.logout(); };
    setAuthenticationGuard(() => administrator.authenticated());
    const catalog = createCatalogService(schoolDatabase);
    const getWindow = () => mainWindow;
    registerAuthHandlers(getWindow, administrator);
    registerTeachersHandlers(getWindow, catalog);
    registerSectionsHandlers(getWindow, catalog);
    registerSubjectsHandlers(getWindow, catalog);
    registerRoomsHandlers(getWindow, catalog);
    registerCatalogHandlers(getWindow, catalog);
    const scheduling = createScheduleService(schoolDatabase);
    registerScheduleHandlers(getWindow, scheduling);
    registerElectiveHandlers(getWindow, scheduling);
    registerSystemHandlers(() => mainWindow);
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error: unknown) => {
    logError("app:ready", error);
    dialog.showErrorBox(
      "E-CLASS cannot open its database",
      "Your school data has not been changed. Check the log in the E-CLASS data folder.",
    );
    app.quit();
  });

app.on("before-quit", () => {
  if (schoolDatabase?.open) schoolDatabase.close();
  schoolDatabase = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
