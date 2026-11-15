import { describe, expect, it } from "vitest";
import { formatSchoolYear, normalizeSchoolYear, schoolYearAliases } from "../../shared/school-year";

describe("school-year identity", () => {
  it.each([
    [" 2026-2027 ", "2026-2027", "2026–2027", ["2026-2027", "2026–2027"]],
    ["2026–2027", "2026-2027", "2026–2027", ["2026-2027", "2026–2027"]],
    ["  Summer-term  ", "Summer-term", "Summer-term", ["Summer-term"]],
    ["2026—2027", "2026—2027", "2026—2027", ["2026—2027"]],
    ["", "", "", [""]],
  ])("normalizes and formats %s without changing custom labels", (input, canonical, label, aliases) => {
    expect(normalizeSchoolYear(input)).toBe(canonical);
    expect(formatSchoolYear(input)).toBe(label);
    expect(schoolYearAliases(input)).toEqual(aliases);
  });
});
