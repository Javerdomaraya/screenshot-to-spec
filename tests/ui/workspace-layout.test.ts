import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Exercise the actual browser layout rules. Without these styles, the dashboard
// becomes a single long column even though the React components still render.
const stylesheet = resolve(process.cwd(), "src/styles/workspace.css");

function renderWithWorkspaceStyles(className: string) {
  const style = document.createElement("style");
  style.textContent = existsSync(stylesheet) ? readFileSync(stylesheet, "utf8") : "";
  document.head.appendChild(style);

  const element = document.createElement("div");
  element.className = className;
  document.body.appendChild(element);
  return element;
}

afterEach(() => {
  document.head.querySelectorAll("style").forEach((node) => node.remove());
  document.body.innerHTML = "";
});

describe("E-CLASS workspace layout", () => {
  it("positions navigation and the workspace side by side", () => {
    const sidebar = renderWithWorkspaceStyles("app-sidebar");
    const workspace = renderWithWorkspaceStyles("workspace");

    expect(getComputedStyle(sidebar).position).toBe("fixed");
    expect(getComputedStyle(sidebar).width).toBe("252px");
    expect(getComputedStyle(workspace).marginLeft).toBe("252px");
  });

  it("lays out dashboard cards in grids instead of a long text column", () => {
    const summary = renderWithWorkspaceStyles("summary-grid");
    const dashboard = renderWithWorkspaceStyles("dashboard-grid");

    expect(getComputedStyle(summary).display).toBe("grid");
    expect(getComputedStyle(dashboard).display).toBe("grid");
  });

  it("keeps wide schedule tables scrollable inside their panels", () => {
    const table = renderWithWorkspaceStyles("table-scroll");
    expect(getComputedStyle(table).overflowX).toBe("auto");
  });

  it("gives the timetable the flexible main column and a compact assignment sidebar", () => {
    const workspace = renderWithWorkspaceStyles("schedule-workspace");
    expect(getComputedStyle(workspace).gridTemplateColumns).toContain("minmax(0, 1fr)");
    expect(getComputedStyle(workspace).gridTemplateColumns).toContain("350px");
  });

  it("adapts the scheduling form grid to its panel instead of forcing two narrow columns", () => {
    const panel = renderWithWorkspaceStyles("schedule-form-panel panel");
    const fields = document.createElement("div");
    fields.className = "schedule-form-fields";
    panel.appendChild(fields);

    expect(getComputedStyle(fields).gridTemplateColumns).toContain("auto-fit");
    expect(getComputedStyle(fields).gridTemplateColumns).toContain("minmax");
  });

  it("keeps long scheduling selections and conflicts inside the available width", () => {
    const panel = renderWithWorkspaceStyles("schedule-form-panel panel");
    const field = document.createElement("label");
    field.className = "form-field";
    const trigger = document.createElement("button");
    trigger.setAttribute("role", "combobox");
    const value = document.createElement("span");
    value.textContent = "CEASAR IAN L. BUSTILLO";
    trigger.appendChild(value);
    field.appendChild(trigger);
    panel.appendChild(field);
    const validation = document.createElement("div");
    validation.className = "validation-box";
    const feedback = document.createElement("div");
    feedback.textContent = "AveryLongConflictMessageWithoutSpaces";
    validation.appendChild(feedback);
    panel.appendChild(validation);

    expect(getComputedStyle(trigger).minWidth).toMatch(/^0(?:px)?$/);
    expect(getComputedStyle(value).textOverflow).toBe("ellipsis");
    expect(getComputedStyle(value).overflow).toBe("hidden");
    expect(getComputedStyle(feedback).overflowWrap).toBe("anywhere");
  });

  it("allows scheduling actions to grow and wrap instead of overflowing narrow panels", () => {
    const actions = renderWithWorkspaceStyles("schedule-actions");
    const button = document.createElement("button");
    actions.appendChild(button);

    expect(getComputedStyle(actions).flexWrap).toBe("wrap");
    expect(getComputedStyle(button).flexGrow).toBe("1");
    expect(getComputedStyle(button).flexBasis).toBe("180px");
  });

  it("displays Reports exports together in a wrapping horizontal action row", () => {
    const group = renderWithWorkspaceStyles("report-actions");
    const buttons = document.createElement("div");
    buttons.className = "report-buttons";
    group.appendChild(buttons);
    expect(getComputedStyle(buttons).display).toBe("flex");
    expect(getComputedStyle(buttons).flexWrap).toBe("wrap");
    expect(getComputedStyle(group).gridColumn).toBe("1 / -1");
  });

  it("gives Import Data a guided upload layout instead of a full-bleed drop target", () => {
    const layout = renderWithWorkspaceStyles("import-layout");
    const start = document.createElement("div");
    start.className = "import-start";
    layout.appendChild(start);
    const zone = document.createElement("label");
    zone.className = "upload-zone";
    start.appendChild(zone);

    expect(getComputedStyle(layout).maxWidth).toBe("1160px");
    expect(getComputedStyle(start).display).toBe("grid");
    expect(getComputedStyle(start).gridTemplateColumns).toContain("minmax");
    expect(getComputedStyle(zone).minHeight).toBe("220px");
  });

  it("keeps the school identity and academic controls distinct in the header", () => {
    const bar = renderWithWorkspaceStyles("topbar");
    const identity = document.createElement("div");
    identity.className = "topbar-identity";
    const controls = document.createElement("div");
    controls.className = "topbar-controls";
    bar.append(identity, controls);
    expect(getComputedStyle(identity).display).toBe("flex");
    expect(getComputedStyle(controls).display).toBe("flex");
    expect(getComputedStyle(controls).flexWrap).toBe("wrap");
  });

  it("uses the transparent school logo without a white background box", () => {
    const school = renderWithWorkspaceStyles("sidebar-school-primary");
    const mark = document.createElement("div");
    mark.className = "brand-mark brand-school-mark";
    school.appendChild(mark);
    expect(getComputedStyle(school).flexDirection).toBe("row");
    expect(getComputedStyle(mark).backgroundColor).toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
    expect(getComputedStyle(mark).borderTopWidth).toBe("0px");
  });
});
