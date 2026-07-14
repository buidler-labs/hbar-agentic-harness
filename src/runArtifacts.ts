import { appendFile, mkdir, writeFile } from "node:fs/promises";
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
