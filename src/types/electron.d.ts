import type { DesktopApi } from "../../shared/electron-api";

declare global {
  interface Window {
    /** Only exposed when this frontend is running inside Electron. */
    api?: DesktopApi;
  }
}

export {};
