import { createElement, type ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Route } from "@/routes/index";
import { dataService, makeSampleData, type Assignment } from "@/services/dataService";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
HTMLElement.prototype.scrollIntoView = () => {};

async function openWorkload(incomplete = false) {
  const data = makeSampleData();
  data.teachers = [data.teachers[0]!];
  data.sections = [
    {
      id: "shs",
      name: "Grade 11",
      gradeLevel: 11,
      schoolLevel: "SHS",
      adviser: "",
      bellScheduleId: "shs-clock",
    },
  ];
  data.bellSchedules = [{ id: "shs-clock", name: "SHS clock", schoolLevel: "SHS" }];
  data.programTimeSlots = Array.from({ length: 4 }, (_, index) => ({
    id: `p${index + 1}`,
    bellScheduleId: "shs-clock",
    kind: "period" as const,
    period: index + 1,
    startTime: `${String(7 + Math.floor((30 + index * 60) / 60)).padStart(2, "0")}:${String((30 + index * 60) % 60).padStart(2, "0")}`,
    endTime: `${String(7 + Math.floor((90 + index * 60) / 60)).padStart(2, "0")}:${String((90 + index * 60) % 60).padStart(2, "0")}`,
    minutes: 60,
  }));
  const weekdays: Assignment["day"][] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  data.assignments = Array.from({ length: 10 }, (_, index) => ({
    id: `block-${index}`,
    term: 1 as const,
    day: weekdays[Math.floor(index / 2)]!,
    sectionId: "shs",
    teacherId: data.teachers[0]!.id,
    subjectId: "sub-math",
    roomId: "r101",
    period: index % 2 === 0 ? 1 : 3,
    durationPeriods: 2,
  }));
  if (incomplete) data.assignments.push({ ...data.assignments[0]!, id: "bad", period: 99 });
  vi.spyOn(dataService, "getAll").mockResolvedValue(data);
  vi.spyOn(dataService, "saveAll").mockImplementation(async (value) => value);
  await act(async () => {
    render(createElement(Route.options.component as ComponentType));
  });
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Teacher workload" }), {
    button: 0,
    ctrlKey: false,
  });
  return within(document.querySelector(".review-page") as HTMLElement);
}

it("shows 20 hours and a balanced load for ten two-hour SHS blocks", async () => {
  const review = await openWorkload();
  expect(review.getByText(/20 \/ 30 hrs/)).toBeInTheDocument();
  expect(review.getByText("Balanced")).toBeInTheDocument();
  expect(review.getByText("Weekly hours")).toBeInTheDocument();
});

it("marks invalid legacy lessons as incomplete rather than silently classifying a partial total", async () => {
  const review = await openWorkload(true);
  expect(review.getByText(/Incomplete/)).toBeInTheDocument();
  expect(review.queryByText("Balanced")).not.toBeInTheDocument();
});
