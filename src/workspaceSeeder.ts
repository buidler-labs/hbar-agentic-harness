import { access, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { executeCommand, executeCommandOrThrow } from "./command.js";
import type {
  CommandExecutionResult,
  PreflightCommandConfig,
  SeedConfig,
  WorkspaceSeedInput,
  WorkspaceSeedResult,
} from "./types.js";

const DEFAULT_GIT_TIMEOUT_MS = 5 * 60 * 1000;

export async function seedWorkspace(input: WorkspaceSeedInput): Promise<WorkspaceSeedResult> {
  const workspacePath = input.workspacePath ?? path.join(input.runDirectory, "workspace");
  await assertWorkspaceCanBeCreated(workspacePath);
  await mkdir(path.dirname(workspacePath), { recursive: true });

  const cloneSource = await resolveCloneSource(input.seed);
  await executeCommandOrThrow({
    command: "git",
    args: ["clone", "--no-checkout", cloneSource, workspacePath],
    cwd: input.runDirectory,
    timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
  });

  const fetchedLatest = input.fetchLatest ?? true;
  if (fetchedLatest) {
    await executeCommandOrThrow({
      command: "git",
      args: ["fetch", "--all", "--tags", "--prune"],
      cwd: workspacePath,
      timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
    });
  }

  const commitSha = await resolveCommitSha(workspacePath, input.seed.ref);

  await executeCommandOrThrow({
    command: "git",
    args: ["checkout", "--detach", commitSha],
    cwd: workspacePath,
    timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
  });

  await rm(path.join(workspacePath, ".git"), { force: true, recursive: true });

  const preflight =
    input.runPreflight === false ? [] : await runPreflightCommands(workspacePath, input.seed.preflight?.commands ?? []);

  return {
    workspacePath,
    repo: input.seed.repo,
    ref: input.seed.ref,
    commitSha,
    fetchedLatest,
    preflight,
  };
}

async function resolveCloneSource(seed: SeedConfig): Promise<string> {
  if (!(await isLocalGitRepo(seed.repo))) {
    return seed.repo;
  }

  if (seed.isolation?.neverModifySeedRepo === false) {
    return seed.repo;
  }

  const origin = await executeCommand({
    command: "git",
    args: ["remote", "get-url", "origin"],
    cwd: seed.repo,
    timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
  });

  const originUrl = origin.stdout.trim();
  return origin.exitCode === 0 && originUrl ? originUrl : seed.repo;
}

async function resolveCommitSha(workspacePath: string, ref: string): Promise<string> {
  const candidates = buildRefCandidates(ref);

  for (const candidate of candidates) {
    const result = await executeCommand({
      command: "git",
      args: ["rev-parse", `${candidate}^{commit}`],
      cwd: workspacePath,
      timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
    });

    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
  }

  throw new Error(`Unable to resolve seed ref "${ref}" to a commit in ${workspacePath}.`);
}

function buildRefCandidates(ref: string): string[] {
  const candidates = [ref, `origin/${ref}`, `refs/heads/${ref}`, `refs/remotes/origin/${ref}`, `refs/tags/${ref}`];
  return [...new Set(candidates)];
}

async function runPreflightCommands(
  workspacePath: string,
  commands: Array<string | PreflightCommandConfig>,
): Promise<CommandExecutionResult[]> {
  const results: CommandExecutionResult[] = [];

  for (const commandConfig of commands) {
    const normalized = normalizePreflightCommand(commandConfig);
    const result = await executeCommand({
      command: normalized.command,
      cwd: workspacePath,
      timeoutMs: normalized.timeoutMs,
      shell: true,
    });

    results.push(result);

    if (result.exitCode !== 0) {
      const label = normalized.name ? ` "${normalized.name}"` : "";
      throw new Error(`Seed preflight${label} failed for command "${normalized.command}".`);
    }
  }

  return results;
}

function normalizePreflightCommand(command: string | PreflightCommandConfig): PreflightCommandConfig {
  return typeof command === "string" ? { command } : command;
}

async function assertWorkspaceCanBeCreated(workspacePath: string): Promise<void> {
  try {
    await access(workspacePath);
  } catch {
    return;
  }

  throw new Error(`Workspace path already exists: ${workspacePath}`);
}

async function isLocalGitRepo(repo: string): Promise<boolean> {
  if (!path.isAbsolute(repo) && !repo.startsWith(".")) {
    return false;
  }

  try {
    const repoStats = await stat(repo);
    await access(path.join(repo, ".git"));
    return repoStats.isDirectory();
  } catch {
    return false;
  }
}
