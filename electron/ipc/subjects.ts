import type { WindowProvider } from "./handler";
import { registerCrudHandlers } from "./handler";
import type { createCatalogService } from "../services/catalog";

export function registerSubjectsHandlers(
  getWindow: WindowProvider,
  catalog: ReturnType<typeof createCatalogService>,
): void {
  registerCrudHandlers("subjects", getWindow, catalog.subjects);
}
