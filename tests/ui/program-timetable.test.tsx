import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgramTimetable } from "@/components/reports/ProgramTimetable";
import {
  getAssignmentInterval,
  getProgramRows,
  paginateProgramEntities,
} from "@/lib/scheduling/programTimetable";
import { makeSampleData, type Assignment, type SchoolData } from "@/services/dataService";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function fixture(): SchoolData {
  const sample = makeSampleData();
  return {
    ...sample,
    sections: [
      {
        id: "a",
        name: "Grade 11 – Avast",
        gradeLevel: 11,
        schoolLevel: "SHS",
        adviser: "Ana Cruz",
        bellScheduleId: "shs",
      },
      {
        id: "b",
        name: "Grade 10 – Lynx",
        gradeLevel: 10,
        schoolLevel: "JHS",
        adviser: "Maria Santos",
        bellScheduleId: "jhs",
      },
    ],
    bellSchedules: [
      { id: "shs", name: "SHS-60", schoolLevel: "SHS" },
      { id: "jhs", name: "JHS-50-B", schoolLevel: "JHS" },
    ],
    programTimeSlots: [
      {
        id: "prep",
        bellScheduleId: "shs",
        kind: "class_preparation",
        period: null,
        startTime: "07:00",
        endTime: "07:15",
        minutes: 15,
      },
      {
        id: "sp1",
        bellScheduleId: "shs",
        kind: "period",
        period: 1,
        startTime: "07:30",
        endTime: "08:30",
        minutes: 60,
      },
      {
        id: "sp2",
        bellScheduleId: "shs",
        kind: "period",
        period: 2,
        startTime: "08:30",
        endTime: "09:30",
        minutes: 60,
      },
      {
        id: "health",
        bellScheduleId: "shs",
        kind: "health_break",
        period: null,
        startTime: "09:30",
        endTime: "09:45",
        minutes: 15,
      },
      {
        id: "jp1",
        bellScheduleId: "jhs",
        kind: "period",
        period: 1,
        startTime: "07:30",
        endTime: "08:20",
        minutes: 50,
      },
      {
        id: "jp2",
        bellScheduleId: "jhs",
        kind: "period",
        period: 2,
        startTime: "08:20",
        endTime: "09:10",
        minutes: 50,
      },
    ],
    assignments: [],
  };
}
const lesson = (overrides: Partial<Assignment> = {}): Assignment => ({
  id: "one",
  term: 2,
  sectionId: "a",
  teacherId: "t1",
  subjectId: "sub-math",
  roomId: "r101",
  day: "Monday",
  period: 1,
  ...overrides,
});

describe("class-program timetable", () => {
  it("uses the selected section's profile including fixed events", () => {
    const data = fixture();
    const shs = getProgramRows(data, "section", "a", []);
    const jhs = getProgramRows(data, "section", "b", []);
    expect(shs.map((row) => [row.startMinute, row.endMinute, row.kind])).toEqual([
      [420, 435, "class_preparation"],
      [450, 510, "period"],
      [510, 570, "period"],
      [570, 585, "health_break"],
    ]);
    expect(jhs.map((row) => row.endMinute)).toEqual([500, 550]);
  });

  it("does not borrow another section's periods when its profile has no slots", () => {
    const data = fixture();
    data.programTimeSlots = data.programTimeSlots!.filter((slot) => slot.bellScheduleId !== "jhs");
    expect(getProgramRows(data, "section", "b", [])).toEqual([]);
  });

  it("resolves multi-period timing from the section profile", () => {
    expect(getAssignmentInterval(fixture(), lesson({ durationPeriods: 2 }))).toEqual({
      startMinute: 450,
      endMinute: 570,
    });
    expect(
      getAssignmentInterval(fixture(), lesson({ sectionId: "b", durationPeriods: 2 })),
    ).toEqual({ startMinute: 450, endMinute: 550 });
  });

  it("keeps different clock times visible in a teacher's mixed-profile program", () => {
    const data = fixture();
    const assignments = [lesson(), lesson({ id: "two", sectionId: "b", period: 2 })];
    const rows = getProgramRows(data, "teacher", "t1", assignments);
    expect(rows.some((row) => row.endMinute === 500)).toBe(true);
    expect(rows.some((row) => row.startMinute === 500)).toBe(true);
    expect(rows.some((row) => row.endMinute === 550)).toBe(true);
  });

  it("prints subjects above full italic teacher names and a class adviser", () => {
    const data = fixture();
    render(
      <ProgramTimetable
        data={data}
        assignments={[lesson()]}
        mode="section"
        entities={[data.sections[0]!]}
        term={2}
      />,
    );
    expect(screen.getByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("Maria Santos").tagName).toBe("EM");
    expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
    expect(screen.getByText("TIME/DAY")).toBeInTheDocument();
    expect(screen.getByText("NO. OF MINUTES")).toBeInTheDocument();
    expect(screen.getByText("MONDAY")).toBeInTheDocument();
    expect(screen.getByText("7:30 – 8:30")).toBeInTheDocument();
    expect(screen.getByText("HEALTH BREAK").closest("td")).toHaveAttribute("colspan", "5");
  });

  it("shows every concurrent lesson and marks the conflict", () => {
    const data = fixture();
    render(
      <ProgramTimetable
        data={data}
        assignments={[lesson(), lesson({ id: "two", subjectId: "sub-sci", teacherId: "t2" })]}
        mode="section"
        entities={[data.sections[0]!]}
      />,
    );
    const cell = screen.getByText("Mathematics").closest("td")!;
    expect(within(cell).getByText("Science")).toBeInTheDocument();
    expect(within(cell).getByText("Conflict")).toBeInTheDocument();
  });

  it("merges a multi-period lesson while preserving time-axis rows", () => {
    const data = fixture();
    render(
      <ProgramTimetable
        data={data}
        assignments={[lesson({ durationPeriods: 2 })]}
        mode="section"
        entities={[data.sections[0]!]}
      />,
    );
    expect(screen.getByText("Mathematics").closest("td")).toHaveAttribute("rowspan", "2");
    expect(screen.getByText("8:30 – 9:30")).toBeInTheDocument();
  });

  it("uses subject plus section for teacher programs", () => {
    const data = fixture();
    render(
      <ProgramTimetable
        data={data}
        assignments={[lesson()]}
        mode="teacher"
        entities={[data.teachers[0]!]}
      />,
    );
    expect(screen.getByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("Grade 11 – Avast")).toBeInTheDocument();
  });

  it("separates report pages by grade/profile and limits compatible groups to three", () => {
    const data = fixture();
    const entities = [
      ...Array.from({ length: 4 }, (_, index) => ({ ...data.sections[0]!, id: `shs-${index}` })),
      data.sections[1]!,
    ];
    data.sections = entities;
    const pages = paginateProgramEntities(data, [], "section", entities);
    expect(pages.map((page) => page.length)).toEqual([3, 1, 1]);
  });

  it("resolves the DepEd seal beside the packaged Electron renderer", () => {
    vi.stubEnv("BASE_URL", "./");
    const data = fixture();
    render(
      <ProgramTimetable
        data={data}
        assignments={[]}
        mode="section"
        entities={[data.sections[0]!]}
      />,
    );
    const image = screen.getByAltText("Department of Education seal");
    expect(new URL(image.getAttribute("src")!, "file:///C:/ECLASS/renderer/index.html").href).toBe(
      "file:///C:/ECLASS/renderer/deped-seal.png",
    );
  });

  it("handles an empty catalog without an empty table", () => {
    render(<ProgramTimetable data={fixture()} assignments={[]} mode="section" entities={[]} />);
    expect(screen.getByText("Choose a section to view its program.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

it("uses the complete official report header and leaves signature names blank", () => {
  const data = fixture();
  render(
    <ProgramTimetable
      data={data}
      assignments={[]}
      mode="section"
      entities={[data.sections[0]!]}
      showSignatures
    />,
  );
  const header = within(document.querySelector(".program-school-header") as HTMLElement);
  expect(
    header.getByRole("heading", {
      name: "INFORMATION AND COMMUNICATIONS TECHNOLOGY HIGH SCHOOL OF EASTERN BILIRAN",
    }),
  ).toBeInTheDocument();
  expect(header.getByText("Region VIII - Eastern Visayas")).toBeInTheDocument();
  expect(header.getByText("Schools Division Office of Biliran")).toBeInTheDocument();
  expect(header.getByText("Caibiran District II")).toBeInTheDocument();
  expect(header.getByText("Brgy. Palengke, 6565 Caibiran, Biliran Province")).toBeInTheDocument();
  expect(header.getAllByRole("img")).toHaveLength(1);
  expect(screen.getByText("Principal I")).toBeInTheDocument();
  expect(screen.getByText("Public Schools District Supervisor")).toBeInTheDocument();
  const names = document.querySelectorAll(".program-signature strong");
  expect(names).toHaveLength(2);
  expect([...names].every((name) => name.textContent?.trim() === "")).toBe(true);
});

it("preserves a custom report profile and intentionally cleared header fields", () => {
  const data = fixture();
  data.settings = {
    ...data.settings,
    schoolName: "A different school",
    reportSchoolName: "Custom printed name",
    region: "",
    division: "",
    district: "",
    schoolAddress: "",
    preparedBy: "Configured preparer",
    schoolHead: "Configured approver",
    preparedByTitle: "",
    approvedByTitle: "",
  };
  render(
    <ProgramTimetable
      data={data}
      assignments={[]}
      mode="section"
      entities={[data.sections[0]!]}
      showSignatures
    />,
  );
  const header = document.querySelector(".program-school-header") as HTMLElement;
  expect(within(header).getByRole("heading", { name: "Custom printed name" })).toBeInTheDocument();
  expect(header).not.toHaveTextContent("Biliran");
  expect(screen.getByText("Configured preparer")).toBeInTheDocument();
  expect(screen.getByText("Configured approver")).toBeInTheDocument();
  expect(screen.queryByText("Principal I")).not.toBeInTheDocument();
});
