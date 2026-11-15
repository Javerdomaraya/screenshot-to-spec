import { Fragment, useEffect, useId, useState } from "react";
import {
  Check,
  ChevronDown,
  CloudUpload,
  FileSpreadsheet,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { importFields, type ImportPreview } from "@/lib/imports/importRecords";
import type {
  ImportTarget,
  ProgramCellResolution,
  ProgramReviewItem,
} from "@/lib/imports/importTypes";
import "../../styles/import.css";

interface ImportPanelProps {
  target: ImportTarget;
  setTarget: (target: ImportTarget) => void;
  filename: string;
  sheets: { name: string; hidden: boolean }[];
  selection: string;
  setSelection: (value: string) => void;
  headerRow: number;
  setHeaderRow: (value: number) => void;
  format: "table" | "program" | null;
  headers: string[];
  mapping: Record<string, string>;
  setMapping: (mapping: Record<string, string>) => void;
  preview: ImportPreview;
  reviewItems: ProgramReviewItem[];
  resolutions: Readonly<Record<string, ProgramCellResolution>>;
  onSourceDecision: (id: string, resolution: ProgramCellResolution) => void;
  onEdit: (index: number, key: string, value: string) => void;
  warnings: string[];
  error: string;
  loading: boolean;
  saving: boolean;
  onFile: (file?: File) => void | Promise<void>;
  onConfirm: () => void | Promise<void>;
  onClear: () => void;
}

const targetLabels: Record<ImportTarget, string> = {
  teachers: "Teachers",
  sections: "Sections",
  subjects: "Subjects",
  rooms: "Rooms",
};

export function ImportPanel({
  target,
  setTarget,
  filename,
  sheets,
  selection,
  setSelection,
  headerRow,
  setHeaderRow,
  format,
  headers,
  mapping,
  setMapping,
  preview,
  reviewItems,
  resolutions,
  onSourceDecision,
  onEdit,
  warnings,
  error,
  loading,
  saving,
  onFile,
  onConfirm,
  onClear,
}: ImportPanelProps) {
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const [visibleRows, setVisibleRows] = useState(10);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const busy = loading || saving;
  const fields = importFields[target];
  const duplicates = new Set(preview.duplicateIndices);
  const invalidRows = new Set(
    preview.issues.filter((issue) => issue.row > 0).map((issue) => issue.row - 1),
  );
  const globalIssues = preview.issues.filter((issue) => issue.row === 0);
  const filteredRows = preview.draftRows
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => !attentionOnly || invalidRows.has(index) || duplicates.has(index));
  const displayedRows = filteredRows.slice(0, visibleRows);
  const allDuplicates = preview.rows.length > 0 && preview.duplicateCount === preview.rows.length;
  const unresolvedReviewCount = reviewItems.filter((item) => !resolutions[item.id]).length;
  const canConfirm =
    !busy &&
    unresolvedReviewCount === 0 &&
    preview.rows.length > 0 &&
    preview.issues.length === 0 &&
    preview.additions.length > 0;

  useEffect(() => {
    setVisibleRows(10);
    setAttentionOnly(false);
  }, [filename, target, selection, headerRow]);

  return (
    <div className="import-layout" aria-busy={busy}>
      <div className="import-intro">
        <span className="intro-icon">
          <FileSpreadsheet aria-hidden="true" />
        </span>
        <div className="import-intro-copy">
          <span className="import-step-label">SCHOOL DATA · IMPORT WORKSPACE</span>
          <h2>Bring your records into E-CLASS</h2>
          <p>
            Upload a school data sheet or class program, then review the records before adding them.
          </p>
        </div>
        <label className="import-target" htmlFor={`${id}-target`}>
          <span>DATA TYPE</span>
          <select
            id={`${id}-target`}
            className="import-control"
            value={target}
            disabled={busy}
            onChange={(event) => setTarget(event.target.value as ImportTarget)}
          >
            {(Object.keys(targetLabels) as ImportTarget[]).map((item) => (
              <option key={item} value={item}>
                {targetLabels[item]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={`import-start ${filename ? "import-start--selected" : ""}`}>
        <label
          className={`upload-zone ${dragging && !busy ? "upload-zone-active" : ""} ${busy ? "import-upload-disabled" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!busy) void onFile(event.dataTransfer.files[0]);
          }}
        >
          <input
            type="file"
            accept=".xlsx,.csv"
            aria-label="Upload Excel workbook or CSV"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void onFile(file);
            }}
          />
          <span className="upload-icon">
            <CloudUpload aria-hidden="true" />
          </span>
          <span className="upload-copy">
            <span className="import-step-label">
              {filename ? "FILE SELECTED" : "UPLOAD A FILE"}
            </span>
            <strong>
              {loading ? (
                "Reading your file…"
              ) : filename ? (
                "Choose another file or drop one here"
              ) : (
                <>
                  Drop your file here, or <span>browse files</span>
                </>
              )}
            </strong>
            <small>{filename || "Class program or school data sheet"}</small>
          </span>
          <span className="import-file-formats" aria-hidden="true">
            <span>Excel .xlsx</span>
            <span>CSV .csv</span>
          </span>
        </label>
        {!filename && (
          <aside className="import-guide" aria-label="How importing works">
            <div className="import-guide-heading">
              <span className="import-guide-icon">
                <ListChecks aria-hidden="true" />
              </span>
              <div>
                <span className="import-step-label">QUICK GUIDE</span>
                <h3>How importing works</h3>
              </div>
            </div>
            <ol className="import-steps">
              <li>
                <span className="import-step-number">01</span>
                <div>
                  <strong>Choose a data type</strong>
                  <p>Teachers, sections, subjects, or rooms</p>
                </div>
              </li>
              <li>
                <span className="import-step-number">02</span>
                <div>
                  <strong>Upload your spreadsheet</strong>
                  <p>Select an Excel workbook or CSV file</p>
                </div>
              </li>
              <li>
                <span className="import-step-number">03</span>
                <div>
                  <strong>Review and confirm</strong>
                  <p>Edit extracted records before saving</p>
                </div>
              </li>
            </ol>
            <div className="import-guide-footer">
              <ShieldCheck aria-hidden="true" />
              <span>Nothing is added until you confirm.</span>
            </div>
          </aside>
        )}
      </div>

      {error && (
        <div className="import-message import-message-error" role="alert">
          <strong>Import could not be completed</strong>
          <p>{error}</p>
        </div>
      )}

      {(filename || sheets.length > 0) && (
        <section className="table-panel import-source" aria-label="Import source settings">
          <div className="import-source-heading">
            <div>
              <h3>File settings</h3>
              <p>{filename}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClear}>
              Clear file
            </Button>
          </div>
          <div className="import-source-controls">
            {sheets.length > 0 && (
              <label className="import-setting" htmlFor={`${id}-sheet`}>
                <span>Worksheet</span>
                <select
                  id={`${id}-sheet`}
                  className="import-control"
                  value={selection}
                  disabled={busy}
                  onChange={(event) => setSelection(event.target.value)}
                >
                  <option value="visible">All visible worksheets</option>
                  {sheets.map((sheet) => (
                    <option key={sheet.name} value={`sheet:${sheet.name}`}>
                      {sheet.name}
                      {sheet.hidden ? " (hidden)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {format === "table" && (
              <label className="import-setting import-header-row" htmlFor={`${id}-header`}>
                <span>Header row</span>
                <input
                  id={`${id}-header`}
                  className="import-control"
                  type="number"
                  min="1"
                  step="1"
                  value={headerRow}
                  disabled={busy}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isInteger(value) && value >= 1) setHeaderRow(value);
                  }}
                />
              </label>
            )}
            {format === "program" && (
              <p className="import-program-detected">
                <FileSpreadsheet aria-hidden="true" />
                <span>
                  <strong>Class program detected</strong>
                  <small>
                    Import Teachers first, then Sections and Subjects. Switch Data Type without
                    uploading again. Rooms require a separate list.
                  </small>
                </span>
              </p>
            )}
          </div>
          {format === "table" && headers.length > 0 && (
            <div className="import-mapping">
              <h3>Match columns</h3>
              <p>Choose a field for each source heading. Skip columns you do not need.</p>
              <div className="import-mapping-grid">
                {headers.map((header, index) => (
                  <label className="import-setting" key={header} htmlFor={`${id}-mapping-${index}`}>
                    <span title={header}>{header || `Column ${index + 1}`}</span>
                    <select
                      id={`${id}-mapping-${index}`}
                      className="import-control"
                      value={mapping[header] || ""}
                      disabled={busy}
                      onChange={(event) => setMapping({ ...mapping, [header]: event.target.value })}
                    >
                      <option value="">Skip column</option>
                      {fields.map((field) => (
                        <option key={field.key} value={field.key}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {reviewItems.length > 0 && (
        <section className="table-panel import-source-review" aria-label="Source-cell decisions">
          <h3>Review ambiguous class-program cells</h3>
          <p>
            Some merged cells may contain a teacher continuing the preceding lesson or a new
            subject. Decide using the original workbook. Changing a decision rebuilds the preview
            and resets any record edits you have made.
          </p>
          <p aria-live="polite">
            {unresolvedReviewCount} source {unresolvedReviewCount === 1 ? "cell" : "cells"} need a
            decision
          </p>
          {reviewItems.map((item) => (
            <label key={item.id} className="import-setting">
              <span>
                {item.sheetName} · {item.cellAddress} · “{item.text}”
                {item.precedingSubject && ` (after ${item.precedingSubject})`}
              </span>
              <select
                className="import-control"
                aria-label={`Interpret ${item.sheetName} ${item.cellAddress}`}
                value={resolutions[item.id] ?? ""}
                disabled={busy}
                onChange={(event) => {
                  if (event.target.value)
                    onSourceDecision(item.id, event.target.value as ProgramCellResolution);
                }}
              >
                <option value="">Choose interpretation</option>
                <option value="teacher-continuation">Teacher continuing preceding subject</option>
                <option value="subject">New subject</option>
              </select>
            </label>
          ))}
        </section>
      )}
      {preview.defaults.length > 0 && (
        <div className="import-message import-message-info">
          <strong>Defaults to review</strong>
          <ul>
            {preview.defaults.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="import-message import-message-warning" role="status">
          <strong>Source notes</strong>
          <ul>
            {warnings.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {preview.rows.length > 0 && unresolvedReviewCount === 0 && (
        <section className="table-panel import-preview" aria-label="Import preview">
          <div className="table-panel-top">
            <div>
              <div className="eyebrow">PREVIEW · {targetLabels[target].toUpperCase()}</div>
              <h2>Review your records</h2>
              <p aria-live="polite">
                {preview.rows.length} {preview.rows.length === 1 ? "record" : "records"} ·{" "}
                {preview.additions.length} new{" "}
                {preview.additions.length === 1 ? "addition" : "additions"} ·{" "}
                {preview.duplicateCount} {preview.duplicateCount === 1 ? "duplicate" : "duplicates"}
              </p>
            </div>
            <Button type="button" disabled={!canConfirm} onClick={() => void onConfirm()}>
              <Check aria-hidden="true" />
              {saving ? "Saving…" : `Confirm import (${preview.additions.length})`}
            </Button>
          </div>
          {preview.issues.length > 0 && (
            <div className="import-validation-summary" role="alert">
              <strong>
                Review{" "}
                {invalidRows.size > 0
                  ? `${invalidRows.size} ${invalidRows.size === 1 ? "row" : "rows"} with invalid values`
                  : "column mapping"}{" "}
                before importing.
              </strong>
              <p>
                Correct the highlighted fields below. No records will be added until all issues are
                resolved.
              </p>
              {globalIssues.map((issue, index) => (
                <p key={index}>{issue.message}</p>
              ))}
            </div>
          )}
          {allDuplicates && (
            <div className="import-message import-message-info import-inline-message">
              <strong>These records are already in your data.</strong>
              <p>
                There are no new records to add. Choose another file or correct the preview values
                if these should be different records.
              </p>
            </div>
          )}
          {preview.duplicateCount > 0 && !allDuplicates && (
            <p className="import-duplicate-note">
              Duplicates are shown for review and will be skipped when you confirm.
            </p>
          )}
          <div className="import-preview-toolbar">
            <p>Edit any value before importing.</p>
            <label className="import-attention-filter">
              <input
                type="checkbox"
                checked={attentionOnly}
                disabled={busy}
                onChange={(event) => {
                  setAttentionOnly(event.target.checked);
                  setVisibleRows(10);
                }}
              />
              <span>Show only rows needing attention</span>
            </label>
          </div>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Editable import records"
          >
            <table className="data-table import-records-table">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Status</th>
                  {fields.map((field) => (
                    <th key={field.key} scope="col">
                      {field.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedRows.map(({ row, index }) => {
                  const rowIssues = preview.issues.filter((issue) => issue.row === index + 1);
                  const duplicate = duplicates.has(index);
                  return (
                    <tr
                      key={index}
                      className={
                        rowIssues.length
                          ? "import-invalid-row"
                          : duplicate
                            ? "import-duplicate-row"
                            : ""
                      }
                    >
                      <th scope="row" className="import-row-number">
                        {index + 1}
                        {format === "table" && <small>Sheet row {headerRow + index + 1}</small>}
                      </th>
                      <td className="import-status-cell">
                        <span
                          className={`import-row-status ${rowIssues.length ? "import-status-invalid" : duplicate ? "import-status-duplicate" : "import-status-new"}`}
                        >
                          {rowIssues.length
                            ? "Needs attention"
                            : duplicate
                              ? "Duplicate · skipped"
                              : "New record"}
                        </span>
                      </td>
                      {fields.map((field) => {
                        const fieldIssues = rowIssues.filter((issue) => issue.field === field.key);
                        const descriptionId = `${id}-issue-${index}-${field.key}`;
                        const value = String(row[field.key] ?? "");
                        const invalidOption = field.options && !field.options.includes(value);
                        return (
                          <td key={field.key}>
                            <div className="import-edit-cell">
                              {field.options ? (
                                <select
                                  className="import-control"
                                  aria-label={`Row ${index + 1} ${field.label}`}
                                  aria-invalid={fieldIssues.length > 0 || undefined}
                                  aria-describedby={fieldIssues.length ? descriptionId : undefined}
                                  value={value}
                                  disabled={busy}
                                  onChange={(event) => onEdit(index, field.key, event.target.value)}
                                >
                                  {invalidOption && (
                                    <option value={value}>{value || "Choose a value"}</option>
                                  )}
                                  {field.options.map((option) => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  className="import-control"
                                  type="text"
                                  inputMode={field.type === "number" ? "decimal" : undefined}
                                  aria-label={`Row ${index + 1} ${field.label}`}
                                  aria-invalid={fieldIssues.length > 0 || undefined}
                                  aria-describedby={fieldIssues.length ? descriptionId : undefined}
                                  value={value}
                                  disabled={busy}
                                  onChange={(event) => onEdit(index, field.key, event.target.value)}
                                />
                              )}
                              {fieldIssues.length > 0 && (
                                <div id={descriptionId} className="import-field-issues">
                                  {fieldIssues.map((issue, issueIndex) => (
                                    <Fragment key={issueIndex}>
                                      <p>{issue.message}</p>
                                    </Fragment>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredRows.length === 0 && (
              <div className="import-preview-empty">
                No rows need attention. All new records are ready to import.
              </div>
            )}
          </div>
          <div className="show-more-row import-preview-pagination">
            <span>
              Showing {displayedRows.length} of {filteredRows.length}{" "}
              {attentionOnly ? "matching " : ""}rows
            </span>
            {filteredRows.length > visibleRows && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setVisibleRows((count) => count + 10)}
                >
                  Show 10 more <ChevronDown aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setVisibleRows(filteredRows.length)}
                >
                  Show all rows
                </Button>
              </>
            )}
          </div>
        </section>
      )}

      {filename &&
        !loading &&
        preview.rows.length === 0 &&
        !error &&
        unresolvedReviewCount === 0 && (
          <div className="table-panel import-preview-empty">
            <strong>No {targetLabels[target].toLowerCase()} records to preview</strong>
            <p>
              {format === "program"
                ? "Review the source notes above or choose a different worksheet or data type."
                : "Check the worksheet and header row, or upload a sheet with the fields for this data type."}
            </p>
          </div>
        )}
      <div className="import-note">
        <ShieldCheck aria-hidden="true" />
        <span>
          Imported records are added to your current list after they are saved. Existing records are
          preserved.
        </span>
      </div>
    </div>
  );
}
