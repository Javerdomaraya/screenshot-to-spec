import type { WindowProvider } from "./handler";
import { registerCrudHandlers } from "./handler";
import type { createCatalogService } from "../services/catalog";

export function registerRoomsHandlers(
  getWindow: WindowProvider,
  catalog: ReturnType<typeof createCatalogService>,
): void {
  registerCrudHandlers("rooms", getWindow, catalog.rooms);
}
