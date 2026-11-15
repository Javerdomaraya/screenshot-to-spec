export {
  SCHOOL_NAME,
  SCHOOL_ADDRESS,
  SCHOOL_REPORT_DEFAULTS,
  applySchoolReportDefaults,
  normalizeSchoolName,
  schoolDisplayName,
} from "../../shared/school-report-profile";

/** Relative to Vite's base so packaged Electron file:// builds resolve the image. */
export function schoolLogoSrc(): string {
  return `${import.meta.env.BASE_URL}ICT.png`;
}
