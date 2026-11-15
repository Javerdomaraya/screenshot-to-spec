/** Normalizes spelling variants used in the school's Excel programs. */
export function normalizeNameKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .toLowerCase();
}
