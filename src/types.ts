import type { AgentProgress } from "./agentStreamLogger.js";

export type HarnessCommand = "run" | "supervise" | "validate";

export interface CommandExecutionResult {
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  signal: NodeJS.Signals | null;
}

export interface CliOptions {
  specPath: string;
  agent?: string;
  maxAttempts?: number;
  maxCycles?: number;
  workspacePath?: string;
}

export interface ParsedCli {
  command: HarnessCommand;
  options: CliOptions;
}

export interface AgentRunInput {
  workspacePath: string;
  prompt: string;
  attempt: number;
  role?: "generator" | "validator";
  timeoutMs?: number;
  logPath?: string;
  activityLogPath?: string;
  onProgress?: (progress: AgentProgress) => void | Promise<void>;
}

export interface AgentRunResult extends CommandExecutionResult {
  command: string;
  args: string[];
}

export interface AgentProvider {
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

export interface CommandAgentConfig {
  provider: "command";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export type AgentConfig = CommandAgentConfig;

export interface PreflightCommandConfig {
  name?: string;
  command: string;
  timeoutMs?: number;
}

export interface SeedConfig {
  repo: string;
  ref: string;
  mode?: "clone-ref-to-run-workspace" | "copy-local-ref";
  workspace?: string;
  preflight?: {
    commands?: Array<string | PreflightCommandConfig>;
  };
  isolation?: {
    separateFolder?: boolean;
    neverModifySeedRepo?: boolean;
    excludeFromArtifact?: string[];
  };
}

export interface WorkspaceSeedInput {
  seed: SeedConfig;
  runDirectory: string;
  workspacePath?: string;
  fetchLatest?: boolean;
  runPreflight?: boolean;
}

export interface WorkspaceSeedResult {
  workspacePath: string;
  repo: string;
  ref: string;
  commitSha: string;
  fetchedLatest: boolean;
  preflight: CommandExecutionResult[];
}

export interface TemplateConstraints {
  packageManager?: string;
  workspaces?: string[];
  forbiddenWorkspaces?: string[];
  forbiddenCommands?: string[];
}

export interface TemplateMetadata {
  name?: string;
  frontend?: string;
  solidityFramework?: string;
}

export interface SecretScanConfig {
  failOnFiles: string[];
  patterns: Array<{
    name: string;
    pattern: string;
    allowIn?: string[];
  }>;
}

export interface TemplateSpec {
  name: string;
  description?: string;
  prdPath: string;
  contractPath?: string;
  seed: SeedConfig;
  generator: CommandAgentConfig;
  skills?: string[];
  constraints?: TemplateConstraints;
  templateMetadata?: TemplateMetadata;
  validators: {
    staticPath: string;
    commandsPath: string;
    playwrightPath?: string;
  };
  requiredFiles: string[];
  forbiddenFiles: string[];
  secretScan?: SecretScanConfig;
  maxAttempts: number;
  logging: {
    jsonlPath: string;
    notesPath: string;
  };
}

export interface PlaywrightGateRouteResult {
  name: string;
  path: string;
  statusCode: number | null;
  rendered: boolean;
  consoleErrors: string[];
  forbiddenTextFound: string[];
  durationMs: number;
}

export interface PlaywrightGateResult {
  passed: boolean;
  configPath: string;
  serverUrl: string;
  serverCommand: string;
  routes: PlaywrightGateRouteResult[];
  durationMs: number;
}

export interface ValidationFinding {
  id: string;
  category: "files" | "static" | "secret" | "commands" | "agent" | "oracle" | "playwright";
  message: string;
  details?: string;
}

export interface OracleAccessFinding {
  id: string;
  message: string;
  evidence: string;
  path?: string;
}

export interface BlindIntegrityResult {
  passed: boolean;
  findings: OracleAccessFinding[];
  scannedLogs: string[];
}

export interface ValidationResult {
  passed: boolean;
  findings: ValidationFinding[];
  commandResults: CommandExecutionResult[];
  playwrightGate?: PlaywrightGateResult;
}

export interface RunReport {
  specName: string;
  specPath: string;
  runDirectory: string;
  workspacePath: string;
  seedRepo: string;
  seedRef: string;
  seedCommitSha: string;
  attempts: number;
  maxAttempts: number;
  /** True when deterministic validation passes; oracle audit is reported separately in blindIntegrity. */
  passed: boolean;
  blindIntegrity: BlindIntegrityResult;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  validation: ValidationResult;
}

export type HarnessLogEvent =
  | {
      type: "run_started";
      timestamp: string;
      specName: string;
      runDirectory: string;
    }
  | {
      type: "workspace_seeded";
      timestamp: string;
      seedCommitSha: string;
      workspacePath: string;
    }
  | {
      type: "skills_vendored";
      timestamp: string;
      count: number;
      workspaceSkillsDir: string;
    }
  | {
      type: "context_vendored";
      timestamp: string;
      prdPath: string;
      contractPath?: string;
      workspaceContextDir: string;
    }
  | {
      type: "workspace_git_initialized";
      timestamp: string;
      commitSha: string;
    }
  | {
      type: "workspace_git_committed";
      timestamp: string;
      attempt: number;
      committed: boolean;
      commitSha?: string;
      message: string;
    }
  | {
      type: "generator_started";
      timestamp: string;
      attempt: number;
      promptPath: string;
    }
  | {
      type: "generator_finished";
      timestamp: string;
      attempt: number;
      exitCode: number | null;
      durationMs: number;
      timedOut: boolean;
    }
  | {
      type: "oracle_audit_finished";
      timestamp: string;
      attempt: number;
      passed: boolean;
      findingCount: number;
    }
  | {
      type: "validation_finished";
      timestamp: string;
      attempt: number;
      passed: boolean;
      findingCount: number;
    }
  | {
      type: "repair_started";
      timestamp: string;
      attempt: number;
      promptPath: string;
    }
  | {
      type: "run_finished";
      timestamp: string;
      passed: boolean;
      attempts: number;
      reportPath: string;
    };
