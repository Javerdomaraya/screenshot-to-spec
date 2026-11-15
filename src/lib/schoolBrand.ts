/** E-CLASS installation branding. Existing configured school names take priority. */
export const SCHOOL_NAME = "ICT High School of Eastern Biliran";
export const SCHOOL_ADDRESS = "Caibiran, Biliran";

const LEGACY_SCHOOL_NAME =
  "ICT High School of Eastern Biliran Supreme Secondary Learner Government";

/** Correct the former installation default while preserving customized names. */
export function normalizeSchoolName(configured: string): string {
  return configured.trim() === LEGACY_SCHOOL_NAME ? SCHOOL_NAME : configured;
}

/** Relative to Vite's base so packaged Electron file:// builds resolve the image. */
export function schoolLogoSrc(): string {
  return `${import.meta.env.BASE_URL}ICT.png`;
}

export function schoolDisplayName(configured?: string): string {
  return normalizeSchoolName(configured?.trim() ?? "") || SCHOOL_NAME;
}
