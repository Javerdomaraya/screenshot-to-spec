import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity, AlertTriangle, ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpDown, ArrowUpRight, BookOpen, CalendarDays, Check,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, ClipboardList, Clock3, Database,
  FileSpreadsheet, FileText, GraduationCap, LayoutDashboard, LockKeyhole, Menu, PanelLeftClose,
  PanelLeftOpen, Plus, Printer, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal,
  Sparkles, Trash2, Users, X, LogOut,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { ProgramTimetable } from "@/components/reports/ProgramTimetable";
import { ImportPanel } from "@/components/imports/ImportPanel";
import { AdminLogin } from "@/components/auth/AdminLogin";
import { buildImportPreview } from "@/lib/imports/importRecords";
import { listImportSheets, prepareWorkbookImport, readImportWorkbook } from "@/lib/imports/importWorkbook";
import type { ImportTarget } from "@/lib/imports/importTypes";
import type { ProgramCellResolution, ProgramReviewItem } from "@/lib/imports/importTypes";
import { SCHOOL_ADDRESS, schoolLogoSrc, schoolDisplayName } from "@/lib/schoolBrand";
import type { AdminAuthStatus } from "../../shared/electron-api";
import { formatSchoolYear, normalizeSchoolYear } from "../../shared/school-year";
import { formatProgramTime, getAssignmentInterval, getProgramRows, paginateProgramEntities, type ProgramMode } from "@/lib/scheduling/programTimetable";
import { generateScheduleCandidates } from "@/lib/scheduling/generateSchedule";
import { calculateTeacherLoads } from "@/lib/scheduling/teacherWorkload";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { collectScheduleConflicts, getLoadStatus, validateAssignmentConflicts } from "@/lib/conflicts";
import { dataService, makeSampleData, type Assignment, type Day, type Room, type SchoolData, type SchoolSettings, type Section, type Subject, type Teacher, type Term } from "@/services/dataService";


type Page = "Dashboard" | "Data Setup" | "Import Data" | "Scheduling" | "Review" | "Reports" | "Tutorial & Help" | "Settings";
type Entity = "teachers" | "sections" | "subjects" | "rooms" | "timeSlots";
type Row = Record<string, string | number | boolean>;
type TeacherLoadView = { teacher: Teacher; hours: number; status: string; incomplete: boolean };
const displayHours = (hours: number) => String(Number(hours.toFixed(2)));

const days: Day[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const pageItems: { label: Page; icon: typeof LayoutDashboard }[] = [
  { label: "Dashboard", icon: LayoutDashboard }, { label: "Data Setup", icon: Database },
  { label: "Import Data", icon: FileSpreadsheet }, { label: "Scheduling", icon: CalendarDays },
  { label: "Review", icon: ClipboardList }, { label: "Reports", icon: FileText },
  { label: "Tutorial & Help", icon: CircleHelp }, { label: "Settings", icon: Settings2 },
];

const entityOptions: Record<Entity, { title: string; noun: string; fields: { key: string; label: string; type?: string; options?: string[] }[] }> = {
  teachers: { title: "Teachers", noun: "teacher", fields: [
    { key: "name", label: "Full name" }, { key: "specialization", label: "Specialization" },
    { key: "employmentType", label: "Employment type", options: ["Permanent", "Contractual", "Part-time"] },
    { key: "minHours", label: "Minimum weekly hours", type: "number" }, { key: "maxHours", label: "Maximum weekly hours", type: "number" },
  ] },
  sections: { title: "Sections", noun: "section", fields: [
    { key: "name", label: "Section name" }, { key: "gradeLevel", label: "Grade level", type: "number" },
    { key: "adviser", label: "Adviser" }, { key: "schoolLevel", label: "School level", options: ["JHS", "SHS"] },
  ] },
  subjects: { title: "Subjects", noun: "subject", fields: [
    { key: "name", label: "Subject name" }, { key: "gradeLevel", label: "Grade level", type: "number" },
    { key: "minutesPerWeek", label: "Minutes per week", type: "number" },
  ] },
  rooms: { title: "Rooms", noun: "room", fields: [
    { key: "name", label: "Room name" }, { key: "capacity", label: "Capacity", type: "number" },
    { key: "type", label: "Room type", options: ["Classroom", "Laboratory", "ICT room"] },
  ] },
  timeSlots: { title: "Time Slots", noun: "time slot", fields: [
    { key: "period", label: "Period number", type: "number" }, { key: "startTime", label: "Start time", type: "time" },
    { key: "endTime", label: "End time", type: "time" }, { key: "isBreak", label: "Break period (yes/no)" },
  ] },
};

export function EClassRoot() {
  const [session, setSession] = useState<AdminAuthStatus | null>(null);
  const [error, setError] = useState("");
  const [check, setCheck] = useState(0);
  const desktop = typeof window !== "undefined" ? window.api : undefined;

  useEffect(() => {
    let active = true;
    if (!desktop) {
      // Browser-only development remains a clearly separate, disposable demo.
      setSession({ configured: true, authenticated: true, username: "admin" });
      return;
    }
    if (!desktop.auth) {
      setError("This desktop build cannot verify administrator access. Update E-CLASS.");
      return;
    }
    void desktop.auth.status().then((reply) => {
      if (!active) return;
      if (!reply.ok) throw new Error(reply.error.message);
      setSession(reply.data);
      setError("");
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Unable to check administrator login.");
    });
    return () => { active = false; };
  }, [desktop, check]);

  const authenticate = async (password: string) => {
    if (!desktop?.auth || !session) throw new Error("Administrator login is unavailable.");
    const reply = await (session.configured ? desktop.auth.signIn(password) : desktop.auth.setup(password));
    if (!reply.ok) throw new Error(reply.error.message);
    setSession(reply.data);
  };
  const logout = async () => {
    if (!desktop?.auth) return;
    const reply = await desktop.auth.logout();
    if (!reply.ok) throw new Error(reply.error.message);
    setSession(reply.data);
  };

  if (error) return (
    <div className="admin-login-unavailable" role="alert">
      <ShieldCheck aria-hidden="true" />
      <h1>Administrator access unavailable</h1>
      <p>{error}</p>
      <Button variant="outline" onClick={() => { setError(""); setCheck((value) => value + 1); }}>Try again</Button>
    </div>
  );
  if (!session) return (
    <div className="admin-login-loading" role="status">
      <LockKeyhole aria-hidden="true" />
      <span>Checking administrator access…</span>
    </div>
  );
  if (!session.authenticated)
    return <AdminLogin firstRun={!session.configured} onAuthenticate={authenticate} />;

  return <EClassApp {...(desktop ? { onLogout: logout } : {})} />;
}

function EClassApp({ onLogout }: { onLogout?: () => Promise<void> }) {
  const [data, setData] = useState<SchoolData>(() => makeSampleData());
  const [page, setPage] = useState<Page>("Dashboard");
  const [term, setTerm] = useState<Term>(1);
  const [collapsed, setCollapsed] = useState(false);
  const [entity, setEntity] = useState<Entity>("teachers");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Row>({});
  const [dialogEntity, setDialogEntity] = useState<Entity>("teachers");
  const [deleteTarget, setDeleteTarget] = useState<{ entity: Entity; row: Row } | null>(null);
  const [settings, setSettings] = useState<SchoolSettings>(() => makeSampleData().settings);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);
  const [mode, setMode] = useState<"Manual" | "Auto-Generate">("Manual");
  const [scheduleForm, setScheduleForm] = useState({ sectionId: "s8-edge", subjectId: "sub-math", teacherId: "t1", roomId: "r101", day: "Monday" as Day, period: 3 });
  const [validation, setValidation] = useState<{ ok: boolean; messages: string[] } | null>(null);
  const [sectionView, setSectionView] = useState("s8-edge");
  const [reviewTab, setReviewTab] = useState("master");
  const [reviewFilter, setReviewFilter] = useState("");
  const [reportType, setReportType] = useState("Section Program");
  const [reportPerson, setReportPerson] = useState("s8-edge");
  const [importTarget, setImportTarget] = useState<ImportTarget>("teachers");
  const [importRows, setImportRows] = useState<Row[]>([]);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [importFile, setImportFile] = useState("");
  const [importWorkbook, setImportWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [importSelection, setImportSelection] = useState("visible");
  const [importHeaderRow, setImportHeaderRow] = useState(1);
  const [importFormat, setImportFormat] = useState<"table" | "program" | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const importFileWarnings = useRef<string[]>([]);
  const [importError, setImportError] = useState("");
  const [importOverrides, setImportOverrides] = useState<Record<number, Row>>({});
  const [importResolutions, setImportResolutions] = useState<Record<string, ProgramCellResolution>>({});
  const [importReviewItems, setImportReviewItems] = useState<ProgramReviewItem[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const importReadId = useRef(0);
  const importSheets = useMemo(() => importWorkbook ? listImportSheets(importWorkbook) : [], [importWorkbook]);
  const importPreview = useMemo(() => buildImportPreview(importTarget, importRows, columnMap, data, importOverrides), [importTarget, importRows, columnMap, data, importOverrides]);

  useEffect(() => {
    void dataService.getAll().then(async (loaded) => {
      setData(loaded);
      setSettings(loaded.settings);
      if (!loaded.settings.schoolName.trim() && window.api) {
        try {
          const named = await dataService.ensureSchoolName();
          if (named) { setData(named); setSettings(named.settings); }
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Unable to save school name.");
        }
      }
    });
  }, []);

  useEffect(() => {
    if (data.sections.length && !data.sections.some((section) => section.id === sectionView)) setSectionView(data.sections[0]?.id ?? "");
  }, [data.sections, sectionView]);

  const [mutationPending, setMutationPending] = useState(false);
  const mutationLock = useRef(false);
  const mutationError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "Changes could not be saved. Please try again.";
    return (error as { code?: string } | null)?.code === "IN_USE" || /in use/i.test(message)
      ? `${message} Remove or reassign linked schedule entries before deleting this record.` : message;
  };
  const runMutation = async (operation: () => Promise<void>) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setMutationPending(true);
    try { await operation(); }
    catch (error) { toast.error(mutationError(error)); }
    finally { mutationLock.current = false; setMutationPending(false); }
  };
  const updateData = async (next: SchoolData): Promise<boolean> => {
    try { setData(await dataService.saveAll(next)); return true; }
    catch (error) { toast.error(mutationError(error)); return false; }
  };
  const termAssignments = useMemo(() => data.assignments.filter((assignment) => assignment.term === term), [data.assignments, term]);
  const allConflicts = useMemo(() => collectScheduleConflicts(termAssignments, data), [termAssignments, data]);
  const teacherLoads: TeacherLoadView[] = useMemo(() => {
    const calculated = calculateTeacherLoads(data, termAssignments);
    return data.teachers.map((teacher) => {
      const load = calculated.get(teacher.id) ?? { minutes: 0, incomplete: false };
      const hours = load.minutes / 60;
      return { teacher, hours, incomplete: load.incomplete,
        status: load.incomplete ? "Incomplete" : getLoadStatus(hours, settings.thresholds) };
    });
  }, [data, termAssignments, settings.thresholds]);
  const selectedSection = data.sections.find((section) => section.id === sectionView);

  const openEntityDialog = (target: Entity, row?: Row) => {
    if (mutationLock.current) return;
    setDialogEntity(target);
    setEditing(row ?? null);
    setForm(row ? { ...row } : Object.fromEntries(entityOptions[target].fields.map((field) => [field.key, field.key === "schoolLevel" ? "JHS" : field.key === "employmentType" ? "Permanent" : field.key === "type" ? "Classroom" : field.key === "period" ? data.timeSlots.length + 1 : field.key === "startTime" ? "08:00" : field.key === "endTime" ? "08:50" : field.key === "gradeLevel" ? 7 : field.key === "minHours" ? 18 : field.key === "maxHours" ? 30 : field.key === "capacity" ? 40 : field.key === "minutesPerWeek" ? 300 : field.key === "isBreak" ? false : ""])));
    setDialogOpen(true);
  };

  const saveEntity = () => runMutation(async () => {
    const config = entityOptions[dialogEntity];
    const required = config.fields.filter((field) => field.key !== "isBreak");
    if (required.some((field) => form[field.key] === "" || form[field.key] === undefined)) {
      toast.error("Complete the required fields before saving."); return;
    }
    const rows = [...data[dialogEntity]] as unknown as Row[];
    const values = Object.fromEntries(config.fields.map((field) => [field.key, field.type === "number" ? Number(form[field.key]) : field.key === "isBreak" ? form[field.key] === true || form[field.key] === "true" : form[field.key]]));
    if (dialogEntity === "sections" && Number(values["gradeLevel"]) < 7 || dialogEntity === "sections" && Number(values["gradeLevel"]) > 12) {
      toast.error("Grade level must be between 7 and 12."); return;
    }
    if (dialogEntity === "timeSlots" && Number(values["period"]) < 1) { toast.error("Period number must be at least 1."); return; }
    const saved = { ...editing, ...values, id: editing?.["id"] ?? `${dialogEntity.slice(0, 2)}-${Date.now()}` } as Row;
    if (dialogEntity === "sections" && editing?.["schoolLevel"] !== saved["schoolLevel"]) delete saved["bellScheduleId"];
    const index = rows.findIndex((row) => row["id"] === editing?.["id"]);
    if (index >= 0) rows[index] = saved; else rows.push(saved);
    if (!await updateData({ ...data, [dialogEntity]: rows } as SchoolData)) return;
    toast.success(`${config.noun[0]?.toUpperCase()}${config.noun.slice(1)} ${editing ? "updated" : "added"}.`);
    setDialogOpen(false);
  });

  const confirmDelete = () => runMutation(async () => {
    if (!deleteTarget) return;
    const { entity: targetEntity, row } = deleteTarget;
    const remaining = (data[targetEntity] as unknown as Row[]).filter((item) => item["id"] !== row["id"]);
    const next = { ...data, [targetEntity]: remaining } as SchoolData;
    if (!await updateData(next)) return;
    toast.success("Record deleted."); setDeleteTarget(null);
  });

  const validateSchedule = () => runMutation(async () => {
    const candidate: Assignment = { ...scheduleForm, id: "draft", term, day: scheduleForm.day, period: Number(scheduleForm.period) };
    try {
      const messages = await dataService.validateAssignment(candidate);
      setValidation({ ok: messages.length === 0, messages });
    } catch (error) {
      setValidation({ ok: false, messages: ["Schedule validation could not complete. Check the database connection and retry."] });
      throw error;
    }
  });

  const saveSchedule = () => runMutation(async () => {
    const candidate: Assignment = { ...scheduleForm, id: `a-${Date.now()}`, term, day: scheduleForm.day, period: Number(scheduleForm.period) };
    const messages = await dataService.validateAssignment(candidate);
    if (messages.length) { setValidation({ ok: false, messages }); toast.error("Resolve schedule conflicts before saving."); return; }
    const next = { ...data, assignments: [...data.assignments, candidate] };
    if (!await updateData(next)) return;
    setValidation({ ok: true, messages: [] }); toast.success("Schedule assignment saved.");
  });

  const generateSchedule = () => runMutation(async () => {
    const additions = await generateScheduleCandidates(data, term, (candidate) =>
      dataService.validateAssignment(candidate),
    );
    if (!additions.length) { toast.error("No open periods were available to fill."); return; }
    if (!await updateData({ ...data, assignments: [...data.assignments, ...additions] })) return;
    toast.success(`${additions.length} open class periods scheduled.`);
  });

  const clearImport = () => {
    importReadId.current++;
    importFileWarnings.current = [];
    setImportWorkbook(null); setImportRows([]); setImportHeaders([]); setColumnMap({});
    setImportFile(""); setImportSelection("visible"); setImportHeaderRow(1); setImportFormat(null);
    setImportWarnings([]); setImportError(""); setImportOverrides({}); setImportLoading(false);
    setImportResolutions({}); setImportReviewItems([]);
  };

  const refreshImport = (workbook: XLSX.WorkBook, target: ImportTarget, selection: string, headerRow?: number, resolutions = importResolutions) => {
    setImportRows([]); setImportHeaders([]); setColumnMap({}); setImportOverrides({});
    setImportReviewItems([]);
    setImportError(""); setImportWarnings(importFileWarnings.current); setImportFormat("table");
    if (headerRow !== undefined) setImportHeaderRow(headerRow);
    try {
      const prepared = prepareWorkbookImport(workbook, target, selection, headerRow, {
        teacherNames: data.teachers.map((teacher) => teacher.name),
        resolutions,
      });
      setImportRows(prepared.rows); setImportHeaders(prepared.headers); setColumnMap(prepared.mapping);
      setImportReviewItems(prepared.reviewItems);
      setImportFormat(prepared.format); setImportHeaderRow(prepared.headerRow);
      setImportWarnings([...importFileWarnings.current, ...prepared.warnings]);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "This worksheet could not be read. Choose another worksheet or correct the header row.");
    }
  };

  const handleImportFile = async (file?: File) => {
    if (!file || mutationLock.current) return;
    clearImport();
    setImportFile(file.name);
    const requestId = ++importReadId.current;
    if (!/\.(xlsx|csv)$/i.test(file.name)) { setImportError("Choose an .xlsx or .csv file."); return; }
    setImportLoading(true);
    try {
      const bytes = await file.arrayBuffer();
      if (requestId !== importReadId.current) return;
      const { workbook, warnings } = readImportWorkbook(file.name, bytes);
      importFileWarnings.current = warnings;
      setImportWorkbook(workbook);
      refreshImport(workbook, importTarget, "visible");
    } catch (error) {
      if (requestId === importReadId.current) setImportError(error instanceof Error ? error.message : "This workbook could not be read. Check the file and try again.");
    } finally {
      if (requestId === importReadId.current) setImportLoading(false);
    }
  };

  const changeImportTarget = (target: ImportTarget) => {
    setImportTarget(target);
    setImportResolutions({});
    if (importWorkbook) refreshImport(importWorkbook, target, importSelection, undefined, {});
  };

  const changeImportSheet = (selection: string) => {
    setImportSelection(selection);
    setImportResolutions({});
    if (importWorkbook) refreshImport(importWorkbook, importTarget, selection, undefined, {});
  };

  const chooseProgramCell = (id: string, resolution: ProgramCellResolution) => {
    const next = { ...importResolutions, [id]: resolution };
    setImportResolutions(next);
    if (importWorkbook)
      refreshImport(importWorkbook, importTarget, importSelection, undefined, next);
  };

  const confirmImport = () => runMutation(async () => {
    if (importSaving || importLoading || importPreview.issues.length ||
        importReviewItems.some((item) => !importResolutions[item.id]) ||
        !importPreview.additions.length) return;
    setImportSaving(true); setImportError("");
    try {
      const saved = await dataService.importCatalog(importTarget, importPreview.additions);
      setData(saved);
      const added = saved[importTarget].length - data[importTarget].length;
      if (added > 0) toast.success(`${added} ${entityOptions[importTarget].title.toLowerCase()} imported.`);
      else toast.info("These records are already in your school data.");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import was not saved. Review the records and try again.");
    } finally {
      setImportSaving(false);
    }
  });

  const saveSchoolSettings = () => runMutation(async () => {
    if (settingsSaving || validateSchoolSettings(settings)) return;
    setSettingsSaving(true);
    setSettingsError("");
    try {
      const saved = await dataService.saveSettings(settings);
      setData(saved);
      setSettings(saved.settings);
      toast.success("School settings saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save school settings.";
      setSettingsError(message);
      toast.error(message);
    } finally {
      setSettingsSaving(false);
    }
  });

  const resetData = () => {
    if (mutationLock.current) return;
    if (window.api) {
      toast.error("Sample data cannot replace records stored in your school database.");
      return;
    }
    setResetConfirmation("");
    setResetOpen(true);
  };
  const confirmResetData = () => runMutation(async () => {
    if (window.api || resetConfirmation !== "RESET" || resetting) return;
    setResetting(true);
    try {
      const restored = await dataService.reset();
      setData(restored);
      setSettings(restored.settings);
      setResetOpen(false);
      setResetConfirmation("");
      setSettingsError("");
      toast.success("Browser demo data restored.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to restore sample data.");
    } finally {
      setResetting(false);
    }
  });

  const exportCsv = () => {
    const header = ["Term", "Section", "Subject", "Teacher", "Room", "Day", "Period"];
    const lines = termAssignments.map((item) => [item.term, data.sections.find((x) => x.id === item.sectionId)?.name, data.subjects.find((x) => x.id === item.subjectId)?.name, data.teachers.find((x) => x.id === item.teacherId)?.name, data.rooms.find((x) => x.id === item.roomId)?.name, item.day, item.period].map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `e-class-term-${term}-schedule.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  const setSchoolYear = (schoolYear: string) => runMutation(async () => {
    const nextSettings = { ...data.settings, schoolYear: normalizeSchoolYear(schoolYear) };
    try {
      const saved = await dataService.saveSettings(nextSettings);
      setData(saved);
      setSettings((current) => ({ ...current, schoolYear: saved.settings.schoolYear }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "School year could not be saved.");
    }
  });

  const currentYear = normalizeSchoolYear(settings.schoolYear ?? "");
  const schoolYearOptions = ["2025-2026", "2026-2027", "2027-2028"].map((value) => ({
    label: formatSchoolYear(value),
    value,
  }));
  if (currentYear && !schoolYearOptions.some((option) => option.value === currentYear)) {
    schoolYearOptions.push({ label: formatSchoolYear(currentYear), value: currentYear });
  }

  return (
    <div className="app-shell min-h-screen">
      <aside className={`app-sidebar no-print ${collapsed ? "app-sidebar-collapsed" : ""}`}>
        <div className="sidebar-brand">
          <div className="sidebar-school-primary">
            <div className="brand-mark brand-school-mark" title={schoolDisplayName(settings.schoolName)}>
              <img src={schoolLogoSrc()} alt="School logo" />
            </div>
            {!collapsed && (
              <div className="brand-school-name" title={schoolDisplayName(settings.schoolName)}>
                {schoolDisplayName(settings.schoolName)}
                <span className="brand-school-location">{settings.schoolAddress?.trim() || SCHOOL_ADDRESS}</span>
              </div>
            )}
          </div>
          {!collapsed && (
            <div className="sidebar-product-brand">
              <span className="brand-name">E-CLASS</span>
              <span className="brand-byline">TEACHER'S DIGITAL TOOLBOX PH</span>
            </div>
          )}
        </div>
        {!collapsed && <div className="sidebar-label">WORKSPACE</div>}
        <nav className="sidebar-nav" aria-label="Main navigation">
          {pageItems.map(({ label, icon: Icon }) => (
            <button key={label} type="button" title={collapsed ? label : undefined} onClick={() => { setPage(label); setSearch(""); }} className={`sidebar-link ${page === label ? "sidebar-link-active" : ""}`} aria-current={page === label ? "page" : undefined}>
              <Icon className="size-[18px] shrink-0" /><span className={collapsed ? "sr-only" : ""}>{label}</span>{page === label && !collapsed && <span className="ml-auto size-1.5 rounded-full bg-sidebar-primary" />}
            </button>
          ))}
        </nav>
        {!collapsed && (
          <div className="sidebar-bottom">
            <div className="sidebar-school-icon"><CalendarDays className="size-4" aria-hidden="true" /></div>
            <div className="sidebar-academic-period">
              <span>ACADEMIC PERIOD</span>
              <strong>{formatSchoolYear(settings.schoolYear)} · Term {term}</strong>
            </div>
          </div>
        )}
        {onLogout && (
          <button type="button" className="sidebar-signout" aria-label="Sign out"
            title="Sign out" onClick={() => {
              void onLogout().catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : "Could not sign out."));
            }}>
            <LogOut aria-hidden="true" className="size-[18px] shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>
        )}
      </aside>

      <div className={`workspace ${collapsed ? "workspace-collapsed" : ""}`}>
        <header className="topbar no-print">
          <div className="topbar-identity">
            <Button variant="ghost" size="icon" className="topbar-icon" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed((value) => !value)}>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</Button>
            <span className="topbar-divider" aria-hidden="true" />
            <div className="topbar-identity-copy">
              <span className="topbar-eyebrow">{collapsed ? "SCHOOL PROFILE" : "E-CLASS"}</span>
              <div className="topbar-school" title={collapsed ? schoolDisplayName(settings.schoolName) : "Academic workspace"}>
                {collapsed ? schoolDisplayName(settings.schoolName) : "Academic workspace"}
              </div>
              <div className="topbar-caption">{collapsed ? "Academic planning and school administration" : "Schedules, school data, and reports"}</div>
            </div>
          </div>
          <div className="topbar-controls">
            <div className="topbar-control">
              <span className="topbar-control-label">SCHOOL YEAR</span>
              <Select disabled={mutationPending} value={currentYear} onValueChange={setSchoolYear}>
                <SelectTrigger className="topbar-select" aria-label="School year"><SelectValue placeholder="Choose year" /></SelectTrigger>
                <SelectContent>{schoolYearOptions.map(({ label, value }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="topbar-term-control">
              <span className="topbar-control-label">TERM</span>
              <div className="term-switcher" role="group" aria-label="School term">{([1, 2, 3] as Term[]).map((item) => <Button key={item} disabled={mutationPending} variant={term === item ? "default" : "ghost"} size="sm" className="term-button" aria-pressed={term === item} onClick={() => { setTerm(item); setValidation(null); }}>T{item}</Button>)}</div>
            </div>
          </div>
        </header>

        <main className="page-main">
          <fieldset disabled={mutationPending} className="contents">
          <div className="page-heading no-print"><div><div className="eyebrow">{formatSchoolYear(settings.schoolYear)} <span>·</span> TERM {term}</div><h1>{page}</h1><p>{pageDescription(page)}</p></div>{page === "Dashboard" && <Button onClick={() => setPage("Scheduling")}><Plus /> Add schedule</Button>}</div>

          {page === "Dashboard" && <Dashboard data={data} termAssignments={termAssignments} teacherLoads={teacherLoads} conflicts={allConflicts} onNavigate={setPage} onTermChange={setTerm} />}

          {page === "Data Setup" && <section className="content-section"><div className="section-toolbar"><Tabs value={entity} onValueChange={(value) => setEntity(value as Entity)}><TabsList className="entity-tabs">{Object.entries(entityOptions).map(([key, config]) => <TabsTrigger key={key} value={key}>{config.title}<span className="tab-count">{data[key as Entity].length}</span></TabsTrigger>)}</TabsList></Tabs><div className="toolbar-actions"><div className="search-field"><Search className="size-4" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${entityOptions[entity].title.toLowerCase()}…`} aria-label={`Search ${entityOptions[entity].title}`} /></div><Button onClick={() => openEntityDialog(entity)}><Plus /> Add {entityOptions[entity].noun}</Button></div></div><EntityTable key={entity} entity={entity} rows={data[entity] as unknown as Row[]} search={search} onEdit={(row) => openEntityDialog(entity, row)} onDelete={(row) => setDeleteTarget({ entity, row })} /></section>}

          {page === "Import Data" && <ImportPanel target={importTarget} setTarget={changeImportTarget} filename={importFile} sheets={importSheets} selection={importSelection} setSelection={changeImportSheet} headerRow={importHeaderRow} setHeaderRow={(value) => { if (importWorkbook) refreshImport(importWorkbook, importTarget, importSelection, value); }} format={importFormat} headers={importHeaders} mapping={columnMap} setMapping={(mapping) => { setColumnMap(mapping); setImportOverrides({}); setImportError(""); }} preview={importPreview} reviewItems={importReviewItems} resolutions={importResolutions} onSourceDecision={chooseProgramCell} onEdit={(index, key, value) => { setImportOverrides((previous) => ({ ...previous, [index]: { ...previous[index], [key]: value } })); setImportError(""); }} warnings={importWarnings} error={importError} loading={importLoading} saving={importSaving} onFile={handleImportFile} onConfirm={confirmImport} onClear={clearImport} />}

          {page === "Scheduling" && <SchedulingPanel data={data} term={term} setTerm={setTerm} assignments={termAssignments} mode={mode} setMode={setMode} form={scheduleForm} setForm={setScheduleForm} validation={validation} onValidate={validateSchedule} onSave={saveSchedule} onGenerate={generateSchedule} selectedSection={selectedSection} sectionView={sectionView} setSectionView={setSectionView} />}

          {page === "Review" && <ReviewPanel data={data} term={term} assignments={termAssignments} conflicts={allConflicts} teacherLoads={teacherLoads} selectedTab={reviewTab} setSelectedTab={setReviewTab} search={reviewFilter} setSearch={setReviewFilter} onFix={() => setPage("Scheduling")} />}

          {page === "Reports" && <ReportsPanel data={data} assignments={termAssignments} term={term} reportType={reportType} setReportType={setReportType} selected={reportPerson} setSelected={setReportPerson} onPrint={() => window.print()} onCsv={exportCsv} />}

          {page === "Tutorial & Help" && <HelpPanel onReset={resetData} onNavigate={setPage} />}

          {page === "Settings" && <SettingsPanel settings={settings} savedSettings={data.settings} setSettings={setSettings} onSave={saveSchoolSettings} saving={settingsSaving} error={settingsError} onReset={resetData} />}
          </fieldset>
        </main>
        <footer className="app-footer no-print"><span>Designed for Philippine schools · Three-term calendar</span><span><span className="status-dot" /> Local changes saved on this device</span></footer>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!mutationLock.current) setDialogOpen(open); }}><DialogContent className="entity-dialog"><DialogHeader><div className="eyebrow">DATA SETUP</div><DialogTitle>{editing ? "Edit" : "Add"} {entityOptions[dialogEntity].noun}</DialogTitle><DialogDescription>Keep your school records up to date.</DialogDescription></DialogHeader><fieldset disabled={mutationPending} className="contents"><div className="form-grid">{entityOptions[dialogEntity].fields.map((field) => <FieldControl key={field.key} field={field} value={form[field.key]} onChange={(value) => setForm((previous) => ({ ...previous, [field.key]: value }))} />)}</div><DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button onClick={saveEntity}>{editing ? "Save changes" : "Add record"}</Button></DialogFooter></fieldset></DialogContent></Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !mutationLock.current) setDeleteTarget(null); }}><DialogContent><DialogHeader><DialogTitle>Delete this record?</DialogTitle><DialogDescription>{deleteTarget ? `${entityOptions[deleteTarget.entity].noun[0]?.toUpperCase()}${entityOptions[deleteTarget.entity].noun.slice(1)}: ${String(deleteTarget.row["name"] ?? deleteTarget.row["period"] ?? deleteTarget.row["id"])}. ` : ""}This record will be removed from your school data. Remove or reassign linked schedule entries first. This cannot be undone.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={mutationPending} onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="destructive" disabled={mutationPending} onClick={confirmDelete}>Delete record</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={resetOpen} onOpenChange={(open) => { if (!mutationLock.current) { setResetOpen(open); if (!open) setResetConfirmation(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore sample data?</DialogTitle>
            <DialogDescription>This will replace all current data in this browser demo, including your example schedule. This action cannot be undone. It does not affect the desktop school database.</DialogDescription>
          </DialogHeader>
          <label className="form-field">
            <span>Type RESET to confirm</span>
            <Input disabled={mutationPending} value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} placeholder="RESET" />
          </label>
          <DialogFooter>
            <Button variant="outline" disabled={mutationPending} onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={resetConfirmation !== "RESET" || mutationPending} onClick={confirmResetData}>Restore sample data now</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function pageDescription(page: Page) {
  const descriptions: Record<Page, string> = {
    Dashboard: "A clear view of the school week, staffing, and schedule health.",
    "Data Setup": "Manage the teachers, classes, subjects, rooms, and periods in your school.",
    "Import Data": "Bring your existing school records into E-CLASS.",
    Scheduling: "Place classes into the week and check every assignment before saving.",
    Review: "Inspect schedules, teaching loads, room use, and conflicts.",
    Reports: "Prepare school programs for printing or export the term schedule.",
    "Tutorial & Help": "Get started with your school schedule and data.",
    Settings: "Update school information and workload thresholds.",
  };
  return descriptions[page];
}

function Dashboard({ data, termAssignments, teacherLoads, conflicts, onNavigate, onTermChange }: {
  data: SchoolData; termAssignments: Assignment[]; teacherLoads: TeacherLoadView[]; conflicts: ReturnType<typeof collectScheduleConflicts>; onNavigate: (page: Page) => void; onTermChange: (term: Term) => void;
}) {
  const under = teacherLoads.filter((item) => item.status === "Underload").length;
  const balanced = teacherLoads.filter((item) => item.status === "Balanced").length;
  const overload = teacherLoads.filter((item) => item.status === "Overload").length;
  const occupiedSlots = new Set(termAssignments.map((assignment) => `${assignment.day}-${assignment.period}`)).size;
  const roomUse = Math.min(100, Math.round(termAssignments.length / Math.max(1, data.rooms.length * 5 * data.timeSlots.length) * 100));
  const summary = [
    { label: "Teachers", value: data.teachers.length, icon: Users, hint: `${under} need more hours`, accent: "summary-blue" },
    { label: "Sections", value: data.sections.length, icon: GraduationCap, hint: "Grades 7–10 · JHS", accent: "summary-teal" },
    { label: "Subjects", value: data.subjects.length, icon: BookOpen, hint: "Across grade levels", accent: "summary-violet" },
    { label: "Rooms", value: data.rooms.length, icon: Database, hint: `${roomUse}% weekly use`, accent: "summary-amber" },
  ];
  return <div className="dashboard-content">
    <section className="summary-grid">{summary.map(({ label, value, icon: Icon, hint, accent }) => <div className="summary-card" key={label}><div className={`summary-icon ${accent}`}><Icon className="size-[18px]" /></div><div className="summary-text"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div><ArrowUpRight className="summary-arrow size-4" /></div>)}</section>
    <section className="dashboard-grid">
      <div className="dashboard-main-column">
        <div className="panel schedule-overview"><div className="panel-heading"><div><div className="eyebrow">TERM AT A GLANCE</div><h2>Schedule overview</h2></div><button type="button" className="text-action" onClick={() => onNavigate("Review")}>View master schedule <ChevronRight /></button></div><div className="overview-stats"><div><span>Scheduled classes</span><strong>{termAssignments.length}</strong><small>in Term {termAssignments[0]?.term ?? "—"}</small></div><div><span>Conflict flags</span><strong className={conflicts.length ? "text-destructive" : "text-success"}>{conflicts.length}</strong><small>{conflicts.length ? "review recommended" : "all clear"}</small></div><div><span>Section coverage</span><strong>{data.sections.length ? Math.round(new Set(termAssignments.map((item) => item.sectionId)).size / data.sections.length * 100) : 0}%</strong><small>with scheduled classes</small></div></div><div className="schedule-mini-grid"><div className="mini-grid-label">CLASS ACTIVITY</div>{days.map((day) => { const count = termAssignments.filter((item) => item.day === day).length; return <div key={day} className="mini-day"><span>{day.slice(0, 3)}</span><div className="mini-bars">{Array.from({ length: 8 }, (_, index) => <i key={index} className={index < Math.ceil(count / 3) ? "mini-bar-filled" : ""} />)}</div><small>{count} classes</small></div>; })}</div></div>
        <div className="panel workload-panel"><div className="panel-heading"><div><div className="eyebrow">STAFFING BALANCE</div><h2>Teacher load status</h2></div><button type="button" className="text-action" onClick={() => onNavigate("Review")}>View workload <ChevronRight /></button></div><div className="load-status-row"><div className="load-status-cell"><span className="status-key"><i className="dot-success" />Balanced</span><strong>{balanced}</strong><small>{data.settings.thresholds.underloadBelow}–{data.settings.thresholds.balancedMax} hrs/week</small></div><div className="load-status-cell"><span className="status-key"><i className="dot-warning" />Underload</span><strong>{under}</strong><small>Below {data.settings.thresholds.underloadBelow} hrs/week</small></div><div className="load-status-cell"><span className="status-key"><i className="dot-danger" />Overload</span><strong>{overload}</strong><small>Above {data.settings.thresholds.balancedMax} hrs/week</small></div></div><div className="load-bar"><span className="load-bar-balanced" style={{ width: `${teacherLoads.length ? balanced / teacherLoads.length * 100 : 0}%` }} /><span className="load-bar-under" style={{ width: `${teacherLoads.length ? under / teacherLoads.length * 100 : 0}%` }} /><span className="load-bar-over" style={{ width: `${teacherLoads.length ? overload / teacherLoads.length * 100 : 0}%` }} /></div><div className="load-caption"><span>{teacherLoads.length} teachers reviewed</span><span>{teacherLoads.some((item) => item.incomplete) ? `${teacherLoads.filter((item) => item.incomplete).length} incomplete · review missing clock times` : "Based on scheduled teaching minutes"}</span></div></div>
      </div>
      <div className="dashboard-side-column">
        <div className={`conflict-panel ${conflicts.length ? "conflict-panel-active" : ""}`}><div className="conflict-head"><div className="conflict-icon"><AlertTriangle className="size-5" /></div><div><div className="eyebrow">SCHEDULE HEALTH</div><h2>{conflicts.length ? `${conflicts.length} conflicts to review` : "No conflicts detected"}</h2></div></div><p>{conflicts.length ? "Check these overlaps before printing programs." : "Every room, teacher, and section has its own period."}</p><div className="conflict-counts">{["Teacher", "Section", "Room", "Duplicate"].map((type) => <div key={type}><span>{type}</span><strong>{conflicts.filter((item) => item.type === type).length}</strong></div>)}</div><Button className="w-full" variant={conflicts.length ? "destructive" : "outline"} onClick={() => onNavigate("Review")}>{conflicts.length ? "Review conflicts" : "Open schedule review"}<ArrowUpRight /></Button></div>
        <div className="panel room-panel"><div className="panel-heading"><div><div className="eyebrow">SPACE PLANNING</div><h2>Room utilization</h2></div><span className="room-percent">{roomUse}%</span></div><div className="room-use-track"><span style={{ width: `${roomUse}%` }} /></div><div className="room-use-legend"><span>{occupiedSlots} active day-periods</span><span>{data.rooms.length} available rooms</span></div><div className="room-rows">{data.rooms.slice(0, 3).map((room, index) => { const count = termAssignments.filter((item) => item.roomId === room.id).length; return <div className="room-row" key={room.id}><span className={`room-index room-index-${index + 1}`}>{room.name.replace("Room ", "R")}</span><span>{room.name}</span><strong>{count}</strong></div>; })}</div></div>
      </div>
    </section>
    <section className="quick-actions"><div><div className="eyebrow">NEXT STEPS</div><h2>Keep your term moving</h2></div><div className="quick-action-list"><button onClick={() => onNavigate("Scheduling")}><span className="quick-action-icon"><Plus /></span><span><strong>Add a schedule</strong><small>Assign a teacher, class, and room</small></span><ChevronRight /></button><button onClick={() => onNavigate("Import Data")}><span className="quick-action-icon"><FileSpreadsheet /></span><span><strong>Import school data</strong><small>Upload an Excel or CSV file</small></span><ChevronRight /></button><button onClick={() => { onTermChange(1); onNavigate("Reports"); }}><span className="quick-action-icon"><Printer /></span><span><strong>Prepare a report</strong><small>Print a teacher or section program</small></span><ChevronRight /></button></div></section>
  </div>;
}

function EntityTable({ entity, rows, search, onEdit, onDelete }: { entity: Entity; rows: Row[]; search: string; onEdit: (row: Row) => void; onDelete: (row: Row) => void }) {
  const config = entityOptions[entity];
  const [sorting, setSorting] = useState<{ field: string; descending: boolean }>({
    field: config.fields[0]?.key ?? "name", descending: false,
  });
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const collator = useMemo(() => new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }), []);
  const filtered = useMemo(() => rows
    .filter((row) => Object.values(row).some((value) => String(value).toLowerCase().includes(search.trim().toLowerCase())))
    .sort((a, b) => {
      const left = a[sorting.field];
      const right = b[sorting.field];
      const compare = typeof left === "number" && typeof right === "number"
        ? left - right
        : collator.compare(String(left ?? ""), String(right ?? ""));
      return sorting.descending ? -compare : compare;
    }), [rows, search, sorting, collator]);
  useEffect(() => setPage(1), [search, sorting, pageSize]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const first = (currentPage - 1) * pageSize;
  const visibleRows = filtered.slice(first, first + pageSize);
  const changeSort = (field: string) => setSorting((prev) => ({
    field,
    descending: prev.field === field ? !prev.descending : false,
  }));
  const recordName = (row: Row) => String(row["name"] ?? row["period"] ?? row["id"]);

  return (
    <div className="table-panel data-setup-table">
      <div className="table-panel-top">
        <div><h2>{config.title}</h2><p>{filtered.length} {filtered.length === 1 ? "record" : "records"}</p></div>
        <span className="table-count">{rows.length} total</span>
      </div>
      <div className="table-scroll" role="region" tabIndex={0} aria-label={config.title + " records"}>
        <table className="data-table">
          <thead><tr>
            {config.fields.map((field) => (
              <th scope="col" key={field.key} aria-sort={sorting.field === field.key ? sorting.descending ? "descending" : "ascending" : "none"}>
                <button type="button" className="data-sort-button"
                  aria-label={"Sort by " + field.label} onClick={() => changeSort(field.key)}>
                  {field.label}
                  {sorting.field === field.key
                    ? sorting.descending ? <ArrowDown /> : <ArrowUp />
                    : <ArrowUpDown />}
                </button>
              </th>
            ))}
            <th scope="col" className="text-right">Actions</th>
          </tr></thead>
          <tbody>
            {visibleRows.map((row) => <tr key={String(row["id"])}>
              {config.fields.map((field) => <td key={field.key}>{field.key === "isBreak"
                ? row[field.key] ? <Badge variant="secondary">Break</Badge> : <span className="text-muted-foreground">—</span>
                : <span>{row[field.key]}</span>}</td>)}
              <td><div className="row-actions">
                <Button size="sm" variant="outline" className="row-edit" onClick={() => onEdit(row)}>Edit</Button>
                <Button size="icon" variant="ghost" className="row-delete"
                  aria-label={"Delete " + config.noun + " " + recordName(row)}
                  title={"Delete " + config.noun + " " + recordName(row)}
                  onClick={() => onDelete(row)}><Trash2 aria-hidden="true" /></Button>
              </div></td>
            </tr>)}
          </tbody>
        </table>
        {!filtered.length && <EmptyState
          title={rows.length ? "No matching records" : "No " + config.title.toLowerCase() + " yet"}
          detail={rows.length ? "Try a different search." : "Add a record to begin building your school data."} />}
      </div>
      <div className="data-table-pagination" role="group" aria-label={config.title + " pagination"}>
        <label className="data-page-size">
          <span>Rows per page</span>
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            {[10, 25, 50].map((amount) => <option key={amount} value={amount}>{amount}</option>)}
          </select>
        </label>
        <span className="data-page-range" aria-live="polite">
          {filtered.length ? (first + 1) + "–" + Math.min(first + pageSize, filtered.length) : "0"} of {filtered.length}
        </span>
        <div className="data-page-buttons">
          <Button variant="outline" size="sm" aria-label="Previous page"
            disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft /> Previous
          </Button>
          <span className="data-page-current">Page {currentPage} of {totalPages}</span>
          <Button variant="outline" size="sm" aria-label="Next page"
            disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            Next <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

function FieldControl({ field, value, onChange }: { field: { key: string; label: string; type?: string; options?: string[] }; value: string | number | boolean | undefined; onChange: (value: string | number | boolean) => void }) {
  return <label className="form-field"><span>{field.label}</span>{field.options ? <Select value={String(value ?? "")} onValueChange={onChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{field.options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select> : <Input type={field.type === "number" || field.type === "time" ? field.type : "text"} value={field.key === "isBreak" ? value ? "true" : "false" : String(value ?? "")} min={field.type === "number" ? 0 : undefined} onChange={(event) => onChange(field.type === "number" ? Number(event.target.value) : field.key === "isBreak" ? event.target.value.toLowerCase() === "true" || event.target.value.toLowerCase() === "yes" : event.target.value)} placeholder={field.key === "isBreak" ? "Yes or no" : undefined} />}</label>;
}


function SchedulingPanel({ data, term, setTerm, assignments, mode, setMode, form, setForm, validation, onValidate, onSave, onGenerate, selectedSection, sectionView, setSectionView }: {
  data: SchoolData; term: Term; setTerm: (term: Term) => void; assignments: Assignment[]; mode: "Manual" | "Auto-Generate"; setMode: (mode: "Manual" | "Auto-Generate") => void; form: { sectionId: string; subjectId: string; teacherId: string; roomId: string; day: Day; period: number }; setForm: (form: { sectionId: string; subjectId: string; teacherId: string; roomId: string; day: Day; period: number }) => void; validation: { ok: boolean; messages: string[] } | null; onValidate: () => void; onSave: () => void; onGenerate: () => void; selectedSection: Section | undefined; sectionView: string; setSectionView: (id: string) => void;
}) {
  const programPeriods = getProgramRows(data, "section", form.sectionId, assignments).filter((row) => row.kind === "period" && row.period !== null);
  const options = [
    { key: "sectionId", label: "Section", rows: data.sections.map((item) => ({ id: item.id, name: item.name })) },
    { key: "subjectId", label: "Subject", rows: data.subjects.map((item) => ({ id: item.id, name: item.name })) },
    { key: "teacherId", label: "Teacher", rows: data.teachers.map((item) => ({ id: item.id, name: item.name })) },
    { key: "roomId", label: "Room", rows: data.rooms.map((item) => ({ id: item.id, name: item.name })) },
  ] as const;
  const fieldValue = (key: string) => form[key as keyof typeof form] as string;
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const assignmentContentId = useId();

  return (
    <div className="schedule-page">
      <div className="schedule-toolbar">
        <div className="term-step">
          <span className="step-number">01</span>
          <div>
            <strong>Choose term</strong>
            <div className="term-selector">
              {([1, 2, 3] as Term[]).map((item) => (
                <Button
                  key={item}
                  size="sm"
                  variant={term === item ? "default" : "outline"}
                  aria-pressed={term === item}
                  onClick={() => setTerm(item)}
                >
                  Term {item}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <div className="method-control">
          <span className="step-number">02</span>
          <div>
            <strong>Schedule method</strong>
            <div className="mode-switch">
              {(["Manual", "Auto-Generate"] as const).map((item) => (
                <Button
                  key={item}
                  size="sm"
                  variant={mode === item ? "secondary" : "ghost"}
                  onClick={() => setMode(item)}
                >
                  {item === "Manual" ? <ClipboardList /> : <Sparkles />}
                  {item}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="schedule-workspace">
        <ScheduleGrid
          data={data}
          assignments={assignments}
          section={selectedSection}
          sectionView={sectionView}
          setSectionView={setSectionView}
          term={term}
        />

        <section className="panel schedule-form-panel" data-expanded={assignmentOpen}>
          <div className="panel-heading schedule-assignment-heading">
            <div className="schedule-assignment-heading-copy">
              <div className="eyebrow">
                {mode === "Manual" ? "NEW ASSIGNMENT" : "SMART SCHEDULING"}
              </div>
              <h2>
                <button
                  type="button"
                  className="schedule-form-toggle"
                  aria-controls={assignmentContentId}
                  aria-expanded={assignmentOpen}
                  onClick={() => setAssignmentOpen((open) => !open)}
                >
                  {mode === "Manual" ? "Assign a class" : "Fill open periods"}
                  <ChevronDown aria-hidden="true" className={assignmentOpen ? "schedule-chevron-open" : ""} />
                </button>
              </h2>
              {!assignmentOpen && (
                <p className="schedule-collapse-hint">
                  {mode === "Manual" ? "Click to make an assignment" : "Click to configure automatic scheduling"}
                </p>
              )}
            </div>
            <Badge variant="secondary">Term {term}</Badge>
          </div>
          <div
            id={assignmentContentId}
            className="schedule-assignment-body"
            hidden={!assignmentOpen}
          >
            {mode === "Manual" ? (
              <>
                <div className="schedule-form-fields">
                  {options.map(({ key, label, rows }) => (
                    <label className="form-field" key={key}>
                      <span>{label}</span>
                      <Select
                        value={fieldValue(key)}
                        onValueChange={(value) => setForm({ ...form, [key]: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={"Choose " + label.toLowerCase()} />
                        </SelectTrigger>
                        <SelectContent>
                          {rows.map((row) => (
                            <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  ))}
                  <label className="form-field">
                    <span>Day</span>
                    <Select
                      value={form.day}
                      onValueChange={(value) => setForm({ ...form, day: value as Day })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {days.map((day) => (
                          <SelectItem key={day} value={day}>{day}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="form-field">
                    <span>Period</span>
                    <Select
                      value={String(form.period)}
                      onValueChange={(value) => setForm({ ...form, period: Number(value) })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {programPeriods.map((slot) => (
                          <SelectItem key={slot.id} value={String(slot.period)}>
                            Period {slot.period} · {formatProgramTime(slot.startMinute)}–{formatProgramTime(slot.endMinute)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
                <div className={"validation-box " + (validation ? (validation.ok ? "validation-good" : "validation-bad") : "validation-idle")}>
                  {validation ? validation.ok ? (
                    <>
                      <Check />
                      <div>
                        <strong>Valid assignment</strong>
                        <span>This teacher, section, and room are free at the selected time.</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <AlertTriangle />
                      <div>
                        <strong>{validation.messages.length} {validation.messages.length === 1 ? "conflict" : "conflicts"} found</strong>
                        {validation.messages.map((message) => <span key={message}>{message}</span>)}
                      </div>
                    </>
                  ) : (
                    <>
                      <Activity />
                      <div>
                        <strong>Ready to check</strong>
                        <span>Choose a class time, then validate the assignment.</span>
                      </div>
                    </>
                  )}
                </div>
                <div className="schedule-actions">
                  <Button variant="outline" onClick={onValidate}>
                    <ShieldCheck /> Validate
                  </Button>
                  <Button onClick={onSave}>
                    <Check /> Validate &amp; save
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="auto-banner">
                  <Sparkles />
                  <div>
                    <strong>Greedy open-slot fill</strong>
                    <p>Match each section with an available teacher, room, and period. Existing classes will stay in place.</p>
                  </div>
                </div>
                <div className="auto-steps">
                  <span><i>1</i>Use subjects at the section’s grade level</span>
                  <span><i>2</i>Find an available teacher and room</span>
                  <span><i>3</i>Leave unresolved slots for manual fixing</span>
                </div>
                <Button className="w-full" onClick={onGenerate}>
                  <Sparkles /> Generate open schedules
                </Button>
                <p className="micro-note">Existing schedule conflicts are preserved for review.</p>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ScheduleGrid({ data, assignments, sectionView, setSectionView, term }: { data: SchoolData; assignments: Assignment[]; section: Section | undefined; sectionView: string; setSectionView: (id: string) => void; term: Term }) {
  const section = data.sections.find((item) => item.id === sectionView);
  return <section className="panel weekly-panel">
    <div className="panel-heading"><div><div className="eyebrow">CLASS PROGRAM</div><h2>Section timetable</h2></div>
      <Select value={sectionView} onValueChange={setSectionView}><SelectTrigger className="section-select"><SelectValue placeholder="Choose a section" /></SelectTrigger><SelectContent>{data.sections.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
    </div>
    <ProgramTimetable data={data} assignments={assignments} mode="section" entities={section ? [section] : []} term={term} />
    <div className="grid-legend"><span><i className="legend-class" />Scheduled class</span><span><i className="legend-conflict" />Conflict</span></div>
  </section>;
}

function ReviewPanel({ data, term, assignments, conflicts, teacherLoads, selectedTab, setSelectedTab, search, setSearch, onFix }: {
  data: SchoolData; term: Term; assignments: Assignment[]; conflicts: ReturnType<typeof collectScheduleConflicts>; teacherLoads: TeacherLoadView[]; selectedTab: string; setSelectedTab: (tab: string) => void; search: string; setSearch: (search: string) => void; onFix: () => void;
}) {
  const tabs = [{ id: "master", label: "Master schedule" }, { id: "teacher", label: "Teacher timetable" }, { id: "section", label: "Section timetable" }, { id: "rooms", label: "Room use" }, { id: "workload", label: "Teacher workload" }, { id: "conflicts", label: `Conflicts${conflicts.length ? ` · ${conflicts.length}` : ""}` }];
  const filtered = assignments.filter((assignment) => [data.sections.find((item) => item.id === assignment.sectionId)?.name, data.subjects.find((item) => item.id === assignment.subjectId)?.name, data.teachers.find((item) => item.id === assignment.teacherId)?.name, data.rooms.find((item) => item.id === assignment.roomId)?.name, assignment.day].some((value) => value?.toLowerCase().includes(search.toLowerCase())));
  const [chosen, setChosen] = useState("");
  const activeTeacher = chosen || data.teachers[0]?.id || "";
  const activeRoom = chosen || data.rooms[0]?.id || "";
  const activeSection = chosen || data.sections[0]?.id || "";
  return <div className="review-page"><div className="review-toolbar"><Tabs value={selectedTab} onValueChange={setSelectedTab}><TabsList className="review-tabs">{tabs.map((tab) => <TabsTrigger key={tab.id} value={tab.id}>{tab.label}</TabsTrigger>)}</TabsList></Tabs><div className="search-field"><Search className="size-4" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter this view…" aria-label="Filter review" /></div></div><div className="review-body">
    {selectedTab === "master" && <div className="table-panel"><div className="table-panel-top"><div><div className="eyebrow">TERM {term}</div><h2>Master schedule</h2><p>{filtered.length} assignments</p></div><Badge variant="secondary">{formatSchoolYear(data.settings.schoolYear)}</Badge></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Section</th><th>Subject</th><th>Teacher</th><th>Room</th><th>Day</th><th>Period</th><th>Status</th></tr></thead><tbody>{filtered.map((item) => { const conflict = conflicts.find((row) => row.assignment.id === item.id || row.other.id === item.id); return <tr key={item.id}><td className="font-medium">{data.sections.find((x) => x.id === item.sectionId)?.name}</td><td>{data.subjects.find((x) => x.id === item.subjectId)?.name}</td><td>{data.teachers.find((x) => x.id === item.teacherId)?.name}</td><td>{data.rooms.find((x) => x.id === item.roomId)?.name}</td><td>{item.day}</td><td>Period {item.period}</td><td>{conflict ? <Badge variant="destructive">{conflict.type}</Badge> : <Badge className="status-balanced">Valid</Badge>}</td></tr>; })}</tbody></table>{!filtered.length && <EmptyState title="No schedule entries" detail="Add or generate class assignments to populate this view." />}</div></div>}
    {selectedTab === "conflicts" && <div className="table-panel"><div className="table-panel-top"><div><div className="eyebrow">TERM {term} · SCHEDULE HEALTH</div><h2>Conflicts to resolve</h2><p>{conflicts.length} detected overlaps</p></div><Button onClick={onFix}><SlidersHorizontal /> Go to scheduling</Button></div><div className="conflict-list">{conflicts.map((conflict, index) => <div className="conflict-row" key={`${conflict.assignment.id}-${conflict.other.id}-${conflict.type}-${index}`}><span className="conflict-type-mark"><AlertTriangle /></span><div><Badge variant={conflict.type === "Duplicate" ? "secondary" : "destructive"}>{conflict.type}</Badge><strong>{conflict.message}</strong><span>{data.sections.find((x) => x.id === conflict.assignment.sectionId)?.name} · {conflict.assignment.day} · Period {conflict.assignment.period}</span></div><Button variant="outline" size="sm" onClick={onFix}>Go to fix <ArrowUpRight /></Button></div>)}{!conflicts.length && <EmptyState title="No conflicts detected" detail="Your schedule is clear for this term." />}</div></div>}
    {selectedTab === "workload" && <div className="table-panel"><div className="table-panel-top"><div><div className="eyebrow">TERM {term} · LOAD BALANCE</div><h2>Teacher workload</h2><p>Scheduled teaching hours · thresholds are editable in Settings</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Teacher</th><th>Specialization</th><th>Weekly hours</th><th>Load</th><th>Status</th></tr></thead><tbody>{teacherLoads.filter(({ teacher }) => teacher.name.toLowerCase().includes(search.toLowerCase())).map(({ teacher, hours, status, incomplete }) => <tr key={teacher.id}><td className="font-medium">{teacher.name}</td><td>{teacher.specialization}</td><td><div className="load-table-cell"><span>{incomplete ? `${displayHours(hours)}+ hrs verified · incomplete` : `${displayHours(hours)} / ${teacher.maxHours} hrs`}</span><div className="teacher-load-track"><span className={status === "Balanced" ? "bar-balanced" : status === "Underload" ? "bar-under" : status === "Overload" ? "bar-over" : ""} style={{ width: `${Math.min(100, hours / Math.max(1, teacher.maxHours) * 100)}%` }} /></div></div></td><td>{incomplete ? "Cannot classify incomplete schedule" : status === "Balanced" ? `${data.settings.thresholds.underloadBelow}–${data.settings.thresholds.balancedMax} hrs` : status === "Underload" ? `Below ${data.settings.thresholds.underloadBelow} hrs` : `Above ${data.settings.thresholds.balancedMax} hrs`}</td><td><StatusBadge status={status} /></td></tr>)}</tbody></table></div></div>}
    {(selectedTab === "teacher" || selectedTab === "section" || selectedTab === "rooms") && <TimetableReview data={data} assignments={assignments} mode={selectedTab} chosen={selectedTab === "teacher" ? activeTeacher : selectedTab === "rooms" ? activeRoom : activeSection} setChosen={setChosen} term={term} />}
    {selectedTab === "rooms" && <RoomHeatmap data={data} assignments={assignments} />}
  </div></div>;
}

function TimetableReview({ data, assignments, mode, chosen, setChosen, term }: { data: SchoolData; assignments: Assignment[]; mode: ProgramMode; chosen: string; setChosen: (id: string) => void; term: Term }) {
  const options = mode === "teacher" ? data.teachers : mode === "rooms" ? data.rooms : data.sections;
  const selected = options.find((item) => item.id === chosen) ?? options[0];
  return <div className="panel review-grid-panel">
    <div className="panel-heading"><div><div className="eyebrow">WEEKLY PROGRAM</div><h2>{mode === "teacher" ? "Teacher timetable" : mode === "rooms" ? "Room timetable" : "Section timetable"}</h2></div>
      <Select value={selected?.id ?? ""} onValueChange={setChosen}><SelectTrigger className="section-select"><SelectValue placeholder="Choose one" /></SelectTrigger><SelectContent>{options.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
    </div>
    <ProgramTimetable data={data} assignments={assignments} mode={mode} entities={selected ? [selected] : []} term={term} />
  </div>;
}

function RoomHeatmap({ data, assignments }: { data: SchoolData; assignments: Assignment[] }) {
  return <div className="table-panel room-heatmap-panel"><div className="table-panel-top"><div><div className="eyebrow">SPACE PLANNING</div><h2>Room utilization by day</h2></div></div><div className="heatmap-table"><div className="heatmap-row heatmap-header"><span>Room</span>{days.map((day) => <span key={day}>{day.slice(0, 3)}</span>)}</div>{data.rooms.map((room) => <div className="heatmap-row" key={room.id}><span className="font-medium">{room.name}</span>{days.map((day) => { const count = assignments.filter((item) => item.roomId === room.id && item.day === day).length; return <span key={day} className="heatmap-cell-wrap"><i className={`heatmap-cell ${count > 4 ? "heat-high" : count > 1 ? "heat-medium" : count ? "heat-low" : "heat-empty"}`} title={`${count} scheduled classes`} /><small>{count}</small></span>; })}</div>)}</div></div>;
}

function ReportsPanel({ data, assignments, term, reportType, setReportType, selected, setSelected, onPrint, onCsv }: { data: SchoolData; assignments: Assignment[]; term: Term; reportType: string; setReportType: (value: string) => void; selected: string; setSelected: (value: string) => void; onPrint: () => void; onCsv: () => void }) {
  const options = reportType === "Teacher Program" ? data.teachers : reportType === "Room Program" ? data.rooms : data.sections;
  const mode: ProgramMode = reportType === "Teacher Program" ? "teacher" : reportType === "Room Program" ? "rooms" : "section";
  const active = selected === "all" ? "all" : options.some((item) => item.id === selected) ? selected : options[0]?.id ?? "";
  const entities = active === "all" ? options : options.filter((item) => item.id === active);
  const pages = paginateProgramEntities(data, assignments, mode, entities);
  const reportConflictIds = useMemo(() => new Set(collectScheduleConflicts(assignments, data).flatMap((conflict) => [conflict.assignment.id, conflict.other.id])), [data, assignments]);
  return <div className="reports-layout">
    <section className="panel report-controls no-print">
      <div><div className="eyebrow">PRINTABLE PROGRAMS</div><h2>Choose a program</h2><p>Class-program sheets for your school, ready to print in landscape.</p></div>
      <div className="report-picker">
        <label className="form-field"><span>Program type</span><Select value={reportType} onValueChange={(value) => { setReportType(value); setSelected("all"); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Teacher Program", "Section Program", "Room Program"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label>
        <label className="form-field"><span>{reportType.replace(" Program", "")}</span><Select value={active} onValueChange={setSelected}><SelectTrigger><SelectValue placeholder="Choose one" /></SelectTrigger><SelectContent><SelectItem value="all">All {mode === "section" ? "sections" : mode === "teacher" ? "teachers" : "rooms"} · consolidated</SelectItem>{options.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label>
      </div>
      <div className="report-actions" role="group" aria-label="Report actions">
        <div className="report-actions-details">
          <span className="report-actions-eyebrow">READY TO EXPORT</span>
          <p className="report-page-count">{pages.length} program {pages.length === 1 ? "sheet" : "sheets"} · up to 3 per sheet</p>
          <p className="report-actions-note">
            For PDF, choose “Save as PDF” in the print dialog. CSV includes all assignments in Term {term}.
          </p>
        </div>
        <div className="report-buttons">
          <Button className="report-action-button report-print-button" onClick={onPrint} disabled={!entities.length}><Printer /> Print</Button>
          <Button className="report-action-button" variant="outline" onClick={onPrint} disabled={!entities.length}><ArrowDownToLine /> Export PDF</Button>
          <Button className="report-action-button" variant="outline" onClick={onCsv}><FileSpreadsheet /> Export CSV</Button>
        </div>
      </div>
    </section>
    <section className="print-area program-report-pages">
      {pages.map((group, index) => <div className="report-paper" key={group.map((item) => item.id).join("-")}><ProgramTimetable data={data} assignments={assignments} mode={mode} entities={group} term={term} showSignatures conflictIds={reportConflictIds} /><div className="program-page-number no-print">Sheet {index + 1} of {pages.length}</div></div>)}
      {!pages.length && <div className="report-paper"><ProgramTimetable data={data} assignments={assignments} mode={mode} entities={[]} term={term} /></div>}
    </section>
  </div>;
}

function HelpPanel({ onReset, onNavigate }: { onReset: () => void; onNavigate: (page: Page) => void }) {
  const steps = [
    { title: "Set up your school", detail: "Add the people, sections, subjects, rooms, and periods your school uses.", icon: Database, page: "Data Setup" as Page },
    { title: "Import existing records", detail: "Bring in a teacher, section, subject, or room list from Excel or CSV.", icon: FileSpreadsheet, page: "Import Data" as Page },
    { title: "Build the schedule", detail: "Assign classes one at a time or fill open periods automatically.", icon: CalendarDays, page: "Scheduling" as Page },
    { title: "Review the week", detail: "Check teacher workloads, room use, and potential schedule conflicts.", icon: ClipboardList, page: "Review" as Page },
    { title: "Print a program", detail: "Choose a teacher, section, or room to prepare a weekly program.", icon: Printer, page: "Reports" as Page },
  ];
  return <div className="help-page"><section className="help-steps"><div className="eyebrow">GETTING STARTED</div><h2>From school data to a school week</h2><p>Make your schedule with five simple steps.</p>{steps.map(({ title, detail, icon: Icon, page }, index) => <button className="help-step" key={title} onClick={() => onNavigate(page)}><span className="help-step-number">0{index + 1}</span><span className="help-step-icon"><Icon /></span><span className="help-step-copy"><strong>{title}</strong><small>{detail}</small></span><ChevronRight /></button>)}</section><section className="panel faq-panel"><div className="eyebrow">COMMON QUESTIONS</div><h2>Good to know</h2><Accordion type="single" collapsible><AccordionItem value="data"><AccordionTrigger>Where is my school data saved?</AccordionTrigger><AccordionContent>The desktop app stores school data in SQLite on this device. The browser preview uses temporary demo data.</AccordionContent></AccordionItem><AccordionItem value="terms"><AccordionTrigger>Do the three terms share assignments?</AccordionTrigger><AccordionContent>No. Each term has its own schedule, and the term selector filters the planner and reports.</AccordionContent></AccordionItem><AccordionItem value="conflicts"><AccordionTrigger>What happens when there is a conflict?</AccordionTrigger><AccordionContent>E-CLASS checks for a teacher, section, or room booked for the same period. Fix the overlapping assignment before preparing a final program.</AccordionContent></AccordionItem><AccordionItem value="sample"><AccordionTrigger>Can I restore the example school data?</AccordionTrigger><AccordionContent>The browser preview can restore its example records after confirmation. This is unavailable for saved desktop school databases.</AccordionContent></AccordionItem></Accordion><div className="help-reset"><span><strong>Sample school data</strong><small>Reset only the browser demo, never the saved desktop school database.</small></span><Button variant="outline" disabled={Boolean(window.api)} onClick={onReset}><RefreshCw /> Restore sample data</Button></div></section></div>;
}

function validateSchoolSettings(settings: SchoolSettings): string | null {
  if (!settings.schoolName.trim() || settings.schoolName.trim().length > 250)
    return "Enter a school name (maximum 250 characters).";
  const year = /^(\d{4})[-–](\d{4})$/.exec(settings.schoolYear);
  if (!year || Number(year[2]) !== Number(year[1]) + 1)
    return "School year must contain two consecutive years.";
  if (settings.preparedBy.length > 500 || settings.schoolHead.length > 500)
    return "Signatory names must not exceed 500 characters.";
  if ((settings.reportSchoolName ?? "").length > 250)
    return "The printed school name must not exceed 250 characters.";
  if ([settings.region, settings.division, settings.district, settings.schoolAddress,
    settings.preparedByTitle, settings.approvedByTitle].some((value) => (value ?? "").length > 500))
    return "Report header details and signatory titles must not exceed 500 characters.";
  const { underloadBelow, balancedMax } = settings.thresholds;
  if (![underloadBelow, balancedMax].every((number) => Number.isInteger(number) && number >= 0 && number <= 168))
    return "Workload thresholds must be whole numbers between 0 and 168.";
  if (balancedMax <= underloadBelow)
    return "Balanced maximum must be greater than the underload threshold.";
  return null;
}

function SettingsPanel({
  settings, savedSettings, setSettings, onSave, onReset, saving, error,
}: {
  settings: SchoolSettings;
  savedSettings: SchoolSettings;
  setSettings: (settings: SchoolSettings) => void;
  onSave: () => void;
  onReset: () => void;
  saving: boolean;
  error: string;
}) {
  const change = (key: "schoolName" | "schoolYear" | "preparedBy" | "schoolHead"
    | "reportSchoolName" | "region" | "division" | "district" | "schoolAddress"
    | "preparedByTitle" | "approvedByTitle", value: string) =>
    setSettings({ ...settings, [key]: value });
  const dirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);
  const validation = validateSchoolSettings(settings);
  const isDesktop = typeof window !== "undefined" && Boolean(window.api);
  const currentYear = normalizeSchoolYear(settings.schoolYear);
  const years = ["2025-2026", "2026-2027", "2027-2028"];
  if (!years.includes(currentYear)) {
    years.unshift(currentYear);
  }
  const choices = years.map((year) => ({
    label: formatSchoolYear(year),
    value: year,
  }));
  return (
    <div className="settings-page">
      <section className="panel settings-panel">
        <div className="settings-heading">
          <span className="settings-icon"><GraduationCap /></span>
          <div>
            <div className="eyebrow">SCHOOL PROFILE</div>
            <h2>School information</h2>
            <p>Used for your school identity and signatures on printed class programs.</p>
          </div>
        </div>
        <div className="settings-form">
          <label className="form-field settings-school-name">
            <span>School name</span>
            <Textarea aria-label="School name" rows={3} maxLength={250} value={settings.schoolName}
              onChange={(event) => change("schoolName", event.target.value)} />
            <small>The shorter school name used in the workspace. Set the full printed name below.</small>
          </label>
          <label className="form-field">
            <span>School year</span>
            <select aria-label="School year" value={currentYear} className="settings-year-select"
              onChange={(event) => change("schoolYear", event.target.value)}>
              {choices.map((item) =>
                <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <small>Changing the year changes which schedules are displayed.</small>
          </label>
          <label className="form-field">
            <span>Prepared by</span>
            <Input aria-label="Prepared by" value={settings.preparedBy} maxLength={500}
              onChange={(event) => change("preparedBy", event.target.value)}
              placeholder="Name or position" />
            <small>Leave blank until the preparer's name is confirmed.</small>
          </label>
          <label className="form-field">
            <span>Approved by</span>
            <Input aria-label="Approved by" value={settings.schoolHead} maxLength={500}
              onChange={(event) => change("schoolHead", event.target.value)}
              placeholder="Approver's name" />
            <small>Leave blank until the approver's name is confirmed.</small>
          </label>
          <label className="form-field">
            <span>Prepared by title</span>
            <Input aria-label="Prepared by title" value={settings.preparedByTitle ?? ""} maxLength={500}
              onChange={(event) => change("preparedByTitle", event.target.value)} />
            <small>Position shown below the preparer's name.</small>
          </label>
          <label className="form-field">
            <span>Approved by title</span>
            <Input aria-label="Approved by title" value={settings.approvedByTitle ?? ""} maxLength={500}
              onChange={(event) => change("approvedByTitle", event.target.value)} />
            <small>Position shown below the approver's name.</small>
          </label>
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="settings-heading">
          <span className="settings-icon"><FileText /></span>
          <div>
            <div className="eyebrow">PRINTED PROGRAMS</div>
            <h2>Timetable header</h2>
            <p>Use the full school identity and address from your official class programs.</p>
          </div>
        </div>
        <div className="settings-form">
          <label className="form-field settings-school-name">
            <span>Printed school name</span>
            <Textarea aria-label="Printed school name" rows={3} maxLength={250}
              value={settings.reportSchoolName ?? ""}
              onChange={(event) => change("reportSchoolName", event.target.value)} />
            <small>Leave blank to use the workspace's school name.</small>
          </label>
          {([
            { key: "region", label: "Region" },
            { key: "division", label: "Division" },
            { key: "district", label: "District" },
          ] as const).map(({ key, label }) => (
            <label className="form-field" key={key}>
              <span>{label}</span>
              <Input aria-label={label} value={settings[key] ?? ""} maxLength={500}
                onChange={(event) => change(key, event.target.value)} />
            </label>
          ))}
          <label className="form-field settings-school-name">
            <span>School address</span>
            <Textarea aria-label="School address" rows={2} maxLength={500}
              value={settings.schoolAddress ?? ""}
              onChange={(event) => change("schoolAddress", event.target.value)} />
            <small>Blank header lines are omitted from printed reports.</small>
          </label>
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="settings-heading">
          <span className="settings-icon settings-icon-blue"><SlidersHorizontal /></span>
          <div>
            <div className="eyebrow">TEACHER WORKLOAD</div>
            <h2>Load thresholds</h2>
            <p>Determine underloaded, balanced, and overloaded teacher status.</p>
          </div>
        </div>
        <div className="threshold-row">
          <label className="form-field">
            <span>Underload below (hours/week)</span>
            <Input aria-label="Underload below (hours/week)" type="number" min="0" max="168" step="1"
              value={settings.thresholds.underloadBelow}
              onChange={(event) => setSettings({ ...settings, thresholds: {
                ...settings.thresholds, underloadBelow: Number(event.target.value),
              } })} />
          </label>
          <label className="form-field">
            <span>Balanced up to (hours/week)</span>
            <Input aria-label="Balanced up to (hours/week)" type="number" min="0" max="168" step="1"
              value={settings.thresholds.balancedMax}
              onChange={(event) => setSettings({ ...settings, thresholds: {
                ...settings.thresholds, balancedMax: Number(event.target.value),
              } })} />
          </label>
          <div className="threshold-preview" aria-label="Teacher workload ranges">
            <span><i className="dot-warning" />Underload</span><strong>&lt; {settings.thresholds.underloadBelow} hrs</strong>
            <span><i className="dot-success" />Balanced</span>
            <strong>{settings.thresholds.underloadBelow}–{settings.thresholds.balancedMax} hrs</strong>
            <span><i className="dot-danger" />Overload</span><strong>&gt; {settings.thresholds.balancedMax} hrs</strong>
          </div>
        </div>
      </section>
      <section className="settings-actions" aria-label="Save settings">
        <div className="settings-save-status" aria-live="polite">
          {validation
            ? <span className="settings-validation-error"><AlertTriangle /> {validation}</span>
            : dirty ? <span className="settings-unsaved"><Activity /> Unsaved changes</span>
              : <span className="settings-saved"><Check /> All changes saved</span>}
          {error && <span className="settings-validation-error" role="alert">{error}</span>}
        </div>
        <Button disabled={!dirty || Boolean(validation) || saving} onClick={onSave}>
          <Check /> {saving ? "Saving..." : "Save school settings"}
        </Button>
      </section>
      <section className="panel settings-danger-zone" aria-label="Danger Zone">
        <div>
          <div className="eyebrow">DANGER ZONE</div>
          <h2>Restore sample data</h2>
          <p>{isDesktop
            ? "Unavailable for saved school databases. Your school's existing records are protected."
            : "Replace this browser preview with its original example school. Confirmation is required."}</p>
        </div>
        <Button variant="outline" onClick={onReset} disabled={isDesktop}>
          <RefreshCw /> Restore sample data
        </Button>
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) { return <Badge variant="outline" className={`workload-badge ${status === "Balanced" ? "status-balanced" : status === "Underload" ? "status-underload" : status === "Overload" ? "status-overload" : ""}`}>{status}</Badge>; }

function EmptyState({ title, detail }: { title: string; detail: string }) { return <div className="empty-state"><span><FileText /></span><strong>{title}</strong><p>{detail}</p></div>; }
