/** Calendar identity only; callers retain their existing input validation. */
export function normalizeSchoolYear(value: string): string {
  const trimmed = value.trim();
  return /^(\d{4})[-–](\d{4})$/.test(trimmed) ? trimmed.replace("–", "-") : trimmed;
}

/** Indexed reads must include legacy spellings without rewriting stored rows. */
export function schoolYearAliases(value: string): string[] {
  const canonical = normalizeSchoolYear(value);
  return /^\d{4}-\d{4}$/.test(canonical) ? [canonical, canonical.replace("-", "–")] : [canonical];
}

export function formatSchoolYear(value: string): string {
  const canonical = normalizeSchoolYear(value);
  return /^\d{4}-\d{4}$/.test(canonical) ? canonical.replace("-", "–") : canonical;
}
