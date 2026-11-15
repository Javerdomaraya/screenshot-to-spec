/** Installation identity and initial print defaults shared by the app and SQLite service. */
export const SCHOOL_NAME = "ICT High School of Eastern Biliran";
export const SCHOOL_ADDRESS = "Caibiran, Biliran";

export interface SchoolReportProfile {
  reportSchoolName?: string;
  region?: string;
  division?: string;
  district?: string;
  schoolAddress?: string;
  preparedByTitle?: string;
  approvedByTitle?: string;
}

export const SCHOOL_REPORT_DEFAULTS = {
  reportSchoolName: "INFORMATION AND COMMUNICATIONS TECHNOLOGY HIGH SCHOOL OF EASTERN BILIRAN",
  region: "Region VIII - Eastern Visayas",
  division: "Schools Division Office of Biliran",
  district: "Caibiran District II",
  schoolAddress: "Brgy. Palengke, 6565 Caibiran, Biliran Province",
  preparedByTitle: "Principal I",
  approvedByTitle: "Public Schools District Supervisor",
} as const;

const LEGACY_SCHOOL_NAME =
  "ICT High School of Eastern Biliran Supreme Secondary Learner Government";

/** Adopt the initial print profile while preserving custom values and saved blanks. */
export function applySchoolReportDefaults<T extends SchoolReportProfile & { schoolName: string }>(
  settings: T,
  configured = settings.reportSchoolName !== undefined,
): T {
  const schoolName = settings.schoolName.trim();
  if (
    configured ||
    !["", SCHOOL_NAME, LEGACY_SCHOOL_NAME, SCHOOL_REPORT_DEFAULTS.reportSchoolName].includes(
      schoolName,
    )
  )
    return settings;
  const additions: SchoolReportProfile = {};
  for (const key of Object.keys(SCHOOL_REPORT_DEFAULTS) as (keyof SchoolReportProfile)[]) {
    if (
      !settings[key]?.trim() ||
      (key === "schoolAddress" && settings[key]?.trim() === SCHOOL_ADDRESS)
    )
      additions[key] = SCHOOL_REPORT_DEFAULTS[key];
  }
  return { ...settings, ...additions };
}

/** Correct the former installation default while preserving customized names. */
export function normalizeSchoolName(configured: string): string {
  return configured.trim() === LEGACY_SCHOOL_NAME ? SCHOOL_NAME : configured;
}

export function schoolDisplayName(configured?: string): string {
  return normalizeSchoolName(configured?.trim() ?? "") || SCHOOL_NAME;
}
