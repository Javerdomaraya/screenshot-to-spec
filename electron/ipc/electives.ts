import type { WindowProvider } from "./handler";
import { registerHandler } from "./handler";
import type { createScheduleService } from "../services/schedule";
import { CatalogError } from "../services/catalog";
import type { ElectiveGroupCandidate, ScheduleFilter } from "../../shared/schedule-types";

export function registerElectiveHandlers(
  getWindow: WindowProvider,
  service: ReturnType<typeof createScheduleService>,
): void {
  registerHandler("electives:create", getWindow, (candidate) =>
    service.createElectiveGroup(candidate as ElectiveGroupCandidate),
  );
  registerHandler("electives:get", getWindow, (id) => {
    const group = service.getElectiveGroup(id as number);
    if (!group) throw new CatalogError("NOT_FOUND", "Elective group not found.");
    return group;
  });
  registerHandler("electives:list", getWindow, (filter) =>
    service.listElectiveGroups(filter as ScheduleFilter),
  );
  registerHandler("electives:addSection", getWindow, (groupId, sectionId) =>
    service.addElectiveGroupSection(groupId as number, sectionId as number),
  );
  registerHandler("electives:delete", getWindow, (id) => {
    service.deleteElectiveGroup(id as number);
    return { deleted: true as const };
  });
}
