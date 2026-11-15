import type { WindowProvider } from "./handler";
import { registerHandler } from "./handler";
import type { createCatalogService } from "../services/catalog";
import type { CatalogReplacement, SchoolSettingsUpdate } from "../../shared/electron-api";

export function registerCatalogHandlers(
  getWindow: WindowProvider,
  catalog: ReturnType<typeof createCatalogService>,
): void {
  registerHandler("catalog:snapshot", getWindow, () => catalog.snapshot());
  registerHandler("catalog:applySnapshot", getWindow, (request) =>
    catalog.applySnapshot(request as CatalogReplacement),
  );
  registerHandler("catalog:ensureSchoolName", getWindow, (name) =>
    catalog.ensureSchoolName(name),
  );
  registerHandler("catalog:saveSettings", getWindow, (request) =>
    catalog.saveSettings(request as SchoolSettingsUpdate),
  );
}
