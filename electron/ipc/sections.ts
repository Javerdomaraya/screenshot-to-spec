import type { WindowProvider } from "./handler";
import { registerCrudHandlers } from "./handler";
import type { createCatalogService } from "../services/catalog";

export function registerSectionsHandlers(
  getWindow: WindowProvider,
  catalog: ReturnType<typeof createCatalogService>,
): void {
  registerCrudHandlers("sections", getWindow, catalog.sections);
}
