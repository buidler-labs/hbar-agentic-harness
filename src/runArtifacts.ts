import { appendFile, access, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HarnessLogEvent } from "./types.js";

export interface RunLayout {
  runDirectory: string;
  workspacePath: string;
  promptsDirectory: string;
  logsDirectory: string;
  reportsDirectory: string;
  reportPath: string;
  jsonlLogPath: string;
  notesLogPath: string;
}

export async function createRunLayout(
  projectRoot: string,
  specName: string,
  logging: { jsonlPath: string; notesPath: string },
): Promise<RunLayout> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDirectory = path.join(projectRoot, "runs", `${timestamp}-${specName}`);
  const workspacePath = path.join(runDirectory, "workspace");
  const promptsDirectory = path.join(runDirectory, "prompts");
  const logsDirectory = path.join(runDirectory, "logs");
  const reportsDirectory = path.join(runDirectory, "reports");

  await mkdir(runDirectory, { recursive: true });
  await mkdir(promptsDirectory, { recursive: true });
  await mkdir(logsDirectory, { recursive: true });
  await mkdir(reportsDirectory, { recursive: true });
  await mkdir(path.dirname(logging.jsonlPath), { recursive: true });
  await mkdir(path.dirname(logging.notesPath), { recursive: true });

  return {
    runDirectory,
    workspacePath,
    promptsDirectory,
    logsDirectory,
    reportsDirectory,
    reportPath: path.join(reportsDirectory, "report.json"),
    jsonlLogPath: logging.jsonlPath,
    notesLogPath: logging.notesPath,
  };
}

/** Reopen an existing accumulating run directory (for --continue). */
export async function openRunLayout(
  runDirectory: string,
  logging: { jsonlPath: string; notesPath: string },
): Promise<RunLayout> {
  const absoluteRunDirectory = path.resolve(runDirectory);
  const workspacePath = path.join(absoluteRunDirectory, "workspace");
  const promptsDirectory = path.join(absoluteRunDirectory, "prompts");
  const logsDirectory = path.join(absoluteRunDirectory, "logs");
  const reportsDirectory = path.join(absoluteRunDirectory, "reports");

  await access(workspacePath);

  await mkdir(promptsDirectory, { recursive: true });
  await mkdir(logsDirectory, { recursive: true });
  await mkdir(reportsDirectory, { recursive: true });
  await mkdir(path.join(absoluteRunDirectory, "cache"), { recursive: true });
  await mkdir(path.dirname(logging.jsonlPath), { recursive: true });
  await mkdir(path.dirname(logging.notesPath), { recursive: true });

  return {
    runDirectory: absoluteRunDirectory,
    workspacePath,
    promptsDirectory,
    logsDirectory,
    reportsDirectory,
    reportPath: path.join(reportsDirectory, "report.json"),
    jsonlLogPath: logging.jsonlPath,
    notesLogPath: logging.notesPath,
  };
}

/** Highest attempt number seen in logs/*-attempt-N.* filenames. */
export async function lastAttemptNumber(logsDirectory: string): Promise<number> {
  let maxAttempt = 0;
  try {
    const entries = await readdir(logsDirectory);
    for (const entry of entries) {
      const match = /-attempt-(\d+)(?:\.|$)/.exec(entry);
      if (match) {
        maxAttempt = Math.max(maxAttempt, Number.parseInt(match[1], 10));
      }
    }
  } catch {
    // empty / missing
  }
  return maxAttempt;
}

export async function nextAttemptNumber(logsDirectory: string): Promise<number> {
  return (await lastAttemptNumber(logsDirectory)) + 1;
}

/** 1-based cycle index for the next --continue kick. */
export async function nextCycleNumber(reportsDirectory: string): Promise<number> {
  let maxCycle = 0;
  try {
    const entries = await readdir(reportsDirectory);
    for (const entry of entries) {
      const match = /^cycle-(\d+)\.json$/.exec(entry);
      if (match) {
        maxCycle = Math.max(maxCycle, Number.parseInt(match[1], 10));
      }
    }
  } catch {
    // empty / missing
  }
  return maxCycle + 1;
}

export async function appendHarnessLog(jsonlLogPath: string, event: HarnessLogEvent): Promise<void> {
  await appendFile(jsonlLogPath, `${JSON.stringify(event)}\n`, "utf8");
}

export async function appendHarnessNote(
  notesLogPath: string,
  title: string,
  body: string,
): Promise<void> {
  const entry = `\n## ${title}\n\n${body.trim()}\n`;
  await appendFile(notesLogPath, entry, "utf8");
}

export async function writePromptFile(promptPath: string, prompt: string): Promise<void> {
  await writeFile(promptPath, `${prompt.trim()}\n`, "utf8");
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeStatusFile(
  runDirectory: string,
  status: Record<string, unknown>,
): Promise<void> {
  await writeJsonFile(path.join(runDirectory, "status.json"), {
    updatedAt: new Date().toISOString(),
    ...status,
  });
}
