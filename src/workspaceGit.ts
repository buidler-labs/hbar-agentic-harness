import { executeCommand, executeCommandOrThrow } from "./command.js";

const GIT_IDENTITY_ENV = {
  GIT_AUTHOR_NAME: "hbar-harness",
  GIT_AUTHOR_EMAIL: "harness@local",
  GIT_COMMITTER_NAME: "hbar-harness",
  GIT_COMMITTER_EMAIL: "harness@local",
};

export interface WorkspaceGitInitResult {
  commitSha: string;
}

export interface WorkspaceGitCommitResult {
  committed: boolean;
  commitSha?: string;
  message: string;
}

export async function initWorkspaceGit(workspacePath: string): Promise<WorkspaceGitInitResult> {
  await executeCommandOrThrow({
    command: "git",
    args: ["init", "--template="],
    cwd: workspacePath,
    env: GIT_IDENTITY_ENV,
  });

  await executeCommandOrThrow({
    command: "git",
    args: ["add", "-A"],
    cwd: workspacePath,
    env: GIT_IDENTITY_ENV,
  });

  await executeCommandOrThrow({
    command: "git",
    args: ["commit", "-m", "harness: seeded workspace with skills and context"],
    cwd: workspacePath,
    env: GIT_IDENTITY_ENV,
  });

  return {
    commitSha: await resolveHeadCommitSha(workspacePath),
  };
}

export async function commitWorkspaceAttempt(
  workspacePath: string,
  attempt: number,
  passed: boolean,
  findingCount: number,
): Promise<WorkspaceGitCommitResult> {
  const status = await executeCommand({
    command: "git",
    args: ["status", "--porcelain"],
    cwd: workspacePath,
    env: GIT_IDENTITY_ENV,
  });

  const message = `harness: attempt ${attempt} ${passed ? "passed" : "failed"} (${findingCount} finding(s))`;

  if (!status.stdout.trim()) {
    return { committed: false, message };
  }

  await executeCommandOrThrow({
    command: "git",
    args: ["add", "-A"],
    cwd: workspacePath,
    env: GIT_IDENTITY_ENV,
  });

  await executeCommandOrThrow({
    command: "git",
    args: ["commit", "-m", message],
    cwd: workspacePath,
    env: GIT_IDENTITY_ENV,
  });

  return {
    committed: true,
    commitSha: await resolveHeadCommitSha(workspacePath),
    message,
  };
}

async function resolveHeadCommitSha(workspacePath: string): Promise<string> {
  const result = await executeCommandOrThrow({
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: workspacePath,
    env: GIT_IDENTITY_ENV,
  });

  return result.stdout.trim();
}
