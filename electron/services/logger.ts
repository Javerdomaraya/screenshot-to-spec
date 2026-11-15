import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

/** Persist diagnostic errors without exposing private details to the renderer. */
export function logError(scope: string, error: unknown): void {
  try {
    const directory = join(app.getPath("userData"), "logs");
    mkdirSync(directory, { recursive: true });
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    appendFileSync(
      join(directory, "eclass.log"),
      `[${new Date().toISOString()}] [${scope}] ${detail}\n`,
      "utf8",
    );
  } catch (loggingError) {
    console.error("Failed to write E-CLASS diagnostic log", loggingError);
  }
}
