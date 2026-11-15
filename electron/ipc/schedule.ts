import type { WindowProvider } from "./handler";
import { registerHandler } from "./handler";
import type { createScheduleService } from "../services/schedule";
import type {
  ScheduleCandidate,
  ScheduleChangeSet,
  ScheduleFilter,
  SchoolTerm,
} from "../../shared/schedule-types";
import { CatalogError } from "../services/catalog";

export function registerScheduleHandlers(
  getWindow: WindowProvider,
  service: ReturnType<typeof createScheduleService>,
): void {
  registerHandler("schedule:list", getWindow, (filter) => service.list(filter as ScheduleFilter));
  registerHandler("schedule:get", getWindow, (id) => {
    const found = service.get(id as number);
    if (!found) throw new CatalogError("NOT_FOUND", "Assignment not found.");
    return found;
  });
  registerHandler("schedule:validate", getWindow, (candidate, excludeId) =>
    service.validateAssignment(candidate as ScheduleCandidate, excludeId as number | undefined),
  );
  registerHandler("schedule:save", getWindow, (candidate) =>
    service.save(candidate as ScheduleCandidate),
  );
  registerHandler("schedule:update", getWindow, (id, candidate) =>
    service.update(id as number, candidate as ScheduleCandidate),
  );
  registerHandler("schedule:delete", getWindow, (id) => {
    service.delete(id as number);
    return { deleted: true as const };
  });
  registerHandler("schedule:applyChanges", getWindow, (changes) =>
    service.applyChanges(changes as ScheduleChangeSet),
  );
  registerHandler("schedule:detectConflicts", getWindow, (term, schoolYear) =>
    service.detectAllConflicts(term as SchoolTerm, schoolYear as string),
  );
}
