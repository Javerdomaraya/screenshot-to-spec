import type { WindowProvider } from "./handler";
import { registerCrudHandlers } from "./handler";
import type { createCatalogService } from "../services/catalog";

export function registerTeachersHandlers(
  getWindow: WindowProvider,
  catalog: ReturnType<typeof createCatalogService>,
): void {
  registerCrudHandlers("teachers", getWindow, catalog.teachers);
}
