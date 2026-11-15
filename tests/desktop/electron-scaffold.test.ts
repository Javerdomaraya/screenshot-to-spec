import { describe, expect, it } from "vitest";
import { getWindowOptions, isAllowedNavigation, resolveWindowIconPath } from "../../electron/security";
import { join } from "node:path";

describe("Electron shell security", () => {
  it("isolates the renderer from Node and enables a sandbox", () => {
    const options = getWindowOptions("C:/eclass/preload.cjs");
    expect(options.webPreferences).toMatchObject({
      preload: "C:/eclass/preload.cjs",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    });
  });

  it("allows only the chosen local page to navigate", () => {
    expect(isAllowedNavigation("http://127.0.0.1:8080/review", "http://127.0.0.1:8080/")).toBe(
      true,
    );
    expect(isAllowedNavigation("https://example.com/", "http://127.0.0.1:8080/")).toBe(false);
    expect(
      isAllowedNavigation(
        "file:///C:/Windows/System32/drivers/etc/hosts",
        "file:///C:/eclass/index.html",
      ),
    ).toBe(false);
  });

  it("sets the custom icon for the window and Windows taskbar", () => {
    const path = "C:/eclass/build/icon.ico";
    expect(getWindowOptions("C:/eclass/dist-electron/preload.cjs", path).icon).toBe(path);
    expect(resolveWindowIconPath({
      packaged: false, appPath: "C:/eclass", resourcesPath: "C:/unused", platform: "win32",
    })).toBe(join("C:/eclass", "build", "icon.ico"));
    expect(resolveWindowIconPath({
      packaged: true, appPath: "C:/unused", resourcesPath: "C:/E-CLASS/resources", platform: "win32",
    })).toBe(join("C:/E-CLASS/resources", "icon.ico"));
    expect(resolveWindowIconPath({
      packaged: true, appPath: "/unused", resourcesPath: "/opt/E-CLASS/resources", platform: "linux",
    })).toBe(join("/opt/E-CLASS/resources", "icon.png"));
  });
});
