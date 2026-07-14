import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BlindIntegrityResult, OracleAccessFinding } from "./types.js";

const ORACLE_CONTENT_PATTERNS: Array<{ id: string; pattern: RegExp; message: string }> = [
  {
    id: "templates-hedera-demo",
    pattern: /templates\/hedera-demo/i,
    message: "Referenced the templates/hedera-demo oracle path",
  },
  {
    id: "hedera-demo-baseline",
    pattern: /hedera-demo-baseline/i,
    message: "Referenced hedera-demo baseline oracle material",
  },
];

export interface OracleAuditInput {
  workspacePath: string;
  seedRepo?: string;
  harnessProjectRoot: string;
  runDirectory: string;
  activityLogPath: string;
  rawLogPath: string;
}

export async function auditOracleAccess(input: OracleAuditInput): Promise<BlindIntegrityResult> {
  const workspacePath = path.resolve(input.workspacePath);
  const seedRepo = input.seedRepo ? path.resolve(input.seedRepo) : undefined;
  const harnessProjectRoot = path.resolve(input.harnessProjectRoot);
  const runDirectory = path.resolve(input.runDirectory);

  const findings: OracleAccessFinding[] = [];
  const seen = new Set<string>();

  const record = (finding: OracleAccessFinding): void => {
    const key = `${finding.id}:${finding.path ?? ""}:${finding.evidence}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };

  for (const logPath of [input.activityLogPath, input.rawLogPath]) {
    let content = "";
    try {
      content = await readFile(logPath, "utf8");
    } catch {
      continue;
    }

    for (const evidence of extractEvidenceStrings(content)) {
      for (const oracle of ORACLE_CONTENT_PATTERNS) {
        if (oracle.pattern.test(evidence)) {
          record({
            id: oracle.id,
            message: oracle.message,
            evidence: truncate(evidence),
          });
        }
      }

      for (const candidatePath of extractPaths(evidence)) {
        if (!isOutsideWorkspace(candidatePath, workspacePath)) {
          continue;
        }

        if (isOtherRunWorkspace(candidatePath, runDirectory)) {
          record({
            id: "other-run-workspace",
            message: "Accessed another harness run workspace",
            path: candidatePath,
            evidence: truncate(evidence),
          });
          continue;
        }

        if (isHarnessLeak(candidatePath, harnessProjectRoot, workspacePath)) {
          record({
            id: "harness-outside-workspace",
            message: "Accessed harness files outside the run workspace",
            path: candidatePath,
            evidence: truncate(evidence),
          });
          continue;
        }

        if (seedRepo && isSeedRepoLeak(candidatePath, seedRepo, workspacePath)) {
          record({
            id: "seed-repo-outside-workspace",
            message: "Accessed the local seed repository outside the run workspace",
            path: candidatePath,
            evidence: truncate(evidence),
          });
          continue;
        }

        if (isRunDirectoryLeak(candidatePath, runDirectory, workspacePath)) {
          record({
            id: "run-artifacts-outside-workspace",
            message: "Accessed run artifacts outside the workspace directory",
            path: candidatePath,
            evidence: truncate(evidence),
          });
        }
      }
    }
  }

  return {
    passed: findings.length === 0,
    findings,
    scannedLogs: [input.activityLogPath, input.rawLogPath],
  };
}

function extractEvidenceStrings(content: string): string[] {
  const evidence: string[] = [content];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("{")) {
      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;
        evidence.push(JSON.stringify(event));
        collectToolEvidence(event, evidence);
      } catch {
        evidence.push(trimmed);
      }
      continue;
    }

    const activityMatch = trimmed.match(/^\S+\s+(?:TOOL \w+ \w+ )?(.+)$/);
    if (activityMatch?.[1]) {
      evidence.push(activityMatch[1]);
    }
  }

  return evidence;
}

function collectToolEvidence(event: Record<string, unknown>, evidence: string[]): void {
  const toolCall = event.tool_call;
  if (!toolCall || typeof toolCall !== "object") return;

  for (const payload of Object.values(toolCall as Record<string, unknown>)) {
    if (!payload || typeof payload !== "object") continue;
    const args = (payload as { args?: Record<string, unknown> }).args;
    if (!args) continue;

    for (const value of Object.values(args)) {
      if (typeof value === "string") {
        evidence.push(value);
      }
    }
  }
}

function extractPaths(value: string): string[] {
  const paths = new Set<string>();

  const absolutePattern = /(?:^|[\s"'`(])(\/(?:Users|private|tmp|var|home)[^\s"'`,;)]+)/g;
  for (const match of value.matchAll(absolutePattern)) {
    paths.add(cleanPath(match[1]));
  }

  return [...paths];
}

function cleanPath(value: string): string {
  return value.replace(/[),.;:]+$/g, "");
}

function isOutsideWorkspace(candidatePath: string, workspacePath: string): boolean {
  const resolved = path.resolve(candidatePath);
  if (resolved === workspacePath) return false;
  return !resolved.startsWith(`${workspacePath}${path.sep}`);
}

function isOtherRunWorkspace(candidatePath: string, runDirectory: string): boolean {
  const resolved = path.resolve(candidatePath);
  const runsMarker = `${path.sep}runs${path.sep}`;
  const markerIndex = resolved.indexOf(runsMarker);
  if (markerIndex === -1) return false;
  if (!resolved.includes(`${path.sep}workspace`)) return false;
  return !resolved.startsWith(`${runDirectory}${path.sep}`);
}

function isHarnessLeak(candidatePath: string, harnessRoot: string, workspacePath: string): boolean {
  const resolved = path.resolve(candidatePath);
  return resolved.startsWith(`${harnessRoot}${path.sep}`) && isOutsideWorkspace(resolved, workspacePath);
}

function isSeedRepoLeak(candidatePath: string, seedRepo: string, workspacePath: string): boolean {
  const resolved = path.resolve(candidatePath);
  return resolved.startsWith(`${seedRepo}${path.sep}`) && isOutsideWorkspace(resolved, workspacePath);
}

function isRunDirectoryLeak(candidatePath: string, runDirectory: string, workspacePath: string): boolean {
  const resolved = path.resolve(candidatePath);
  return resolved.startsWith(`${runDirectory}${path.sep}`) && isOutsideWorkspace(resolved, workspacePath);
}

function truncate(value: string, maxLength = 240): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}
