import path from "node:path";
import { access, mkdir, readdir } from "node:fs/promises";
import { CommandAgentProvider } from "./providers/commandAgentProvider.js";
import { buildGeneratorPrompt, buildRepairPrompt } from "./promptBuilder.js";
import {
  appendHarnessLog,
  appendHarnessNote,
  createRunLayout,
  writeJsonFile,
  writePromptFile,
  writeStatusFile,
} from "./runArtifacts.js";
import { loadTemplateSpec } from "./specLoader.js";
import type { AgentProgress } from "./agentStreamLogger.js";
import type {
  BlindIntegrityResult,
  CliOptions,
  RunReport,
  SemanticValidationResult,
  TemplateSpec,
  ValidationFinding,
  ValidationResult,
} from "./types.js";
import { auditOracleAccess } from "./oracleAudit.js";
import { vendorHarnessContext } from "./contextVendor.js";
import { vendorSkills } from "./skillVendor.js";
import { commitWorkspaceAttempt, initWorkspaceGit } from "./workspaceGit.js";
import { runDeterministicValidation } from "./validation/index.js";
import { isValidatorEnabled, runSemanticValidation } from "./semanticValidator.js";
import { createDevServerSession, loadDevServerConfig } from "./validation/devServer.js";
import { runPlaywrightGate } from "./validation/playwrightGate.js";
import { WorkspaceWatcher } from "./workspaceWatcher.js";
import { seedWorkspace } from "./workspaceSeeder.js";

export async function runHarness(options: CliOptions): Promise<RunReport> {
  const loaded = await loadTemplateSpec(options.specPath);
  const { spec, projectRoot } = loaded;
  const maxAttempts = options.maxAttempts ?? spec.maxAttempts;
  const layout = await createRunLayout(projectRoot, spec.name, spec.logging);
  const startedAt = new Date();
  const generator = new CommandAgentProvider(spec.generator);

  logPhase("Run started", layout.runDirectory);
  await writeStatusFile(layout.runDirectory, {
    phase: "started",
    specName: spec.name,
    runDirectory: layout.runDirectory,
  });

  await appendHarnessLog(layout.jsonlLogPath, {
    type: "run_started",
    timestamp: startedAt.toISOString(),
    specName: spec.name,
    runDirectory: layout.runDirectory,
  });

  await appendHarnessNote(
    layout.notesLogPath,
    `Run started: ${spec.name}`,
    `Run directory: ${layout.runDirectory}\nSpec: ${loaded.specPath}`,
  );

  logPhase("Seeding workspace from scaffold-hbar main", spec.seed.ref);
  const seedResult = await seedWorkspace({
    seed: spec.seed,
    runDirectory: layout.runDirectory,
    workspacePath: layout.workspacePath,
    runPreflight: true,
  });

  await appendHarnessLog(layout.jsonlLogPath, {
    type: "workspace_seeded",
    timestamp: new Date().toISOString(),
    seedCommitSha: seedResult.commitSha,
    workspacePath: seedResult.workspacePath,
  });
  await writeStatusFile(layout.runDirectory, {
    phase: "seeded",
    seedCommitSha: seedResult.commitSha,
    workspacePath: seedResult.workspacePath,
  });
  logPhase("Workspace seeded", seedResult.workspacePath);

  const vendoredSkills = await vendorSkills(seedResult.workspacePath, spec.skills ?? []);
  await appendHarnessLog(layout.jsonlLogPath, {
    type: "skills_vendored",
    timestamp: new Date().toISOString(),
    count: vendoredSkills.length,
    workspaceSkillsDir: path.join(seedResult.workspacePath, ".harness-skills"),
  });
  logPhase("Skills vendored into workspace", `.harness-skills (${vendoredSkills.length} files)`);

  const vendoredContext = await vendorHarnessContext(seedResult.workspacePath, {
    prdPath: spec.prdPath,
    contractPath: spec.contractPath,
  });
  await appendHarnessLog(layout.jsonlLogPath, {
    type: "context_vendored",
    timestamp: new Date().toISOString(),
    prdPath: vendoredContext.prdRelativePath,
    contractPath: vendoredContext.contractRelativePath,
    workspaceContextDir: path.join(seedResult.workspacePath, ".harness-context"),
  });
  logPhase(
    "Harness context vendored into workspace",
    `.harness-context${vendoredContext.contractRelativePath ? " (prd + contract)" : " (prd)"}${vendoredContext.playwrightMcpPath ? " + playwright MCP" : ""}`,
  );

  const gitInit = await initWorkspaceGit(seedResult.workspacePath);
  await appendHarnessLog(layout.jsonlLogPath, {
    type: "workspace_git_initialized",
    timestamp: new Date().toISOString(),
    commitSha: gitInit.commitSha,
  });
  logPhase("Workspace git initialized", gitInit.commitSha.slice(0, 8));

  let attempts = 0;
  let validation: ValidationResult = {
    passed: false,
    findings: [
      {
        id: "generator-not-run",
        category: "agent",
        message: "Generator did not complete a successful attempt.",
      },
    ],
    commandResults: [],
  };
  let latestPrompt = await buildGeneratorPrompt(spec, 1, vendoredSkills);
  let blindIntegrity: BlindIntegrityResult = {
    passed: true,
    findings: [],
    scannedLogs: [],
  };

  while (attempts < maxAttempts) {
    attempts += 1;
    const promptPath = path.join(
      layout.promptsDirectory,
      attempts === 1 ? "generator-attempt-1.txt" : `repair-attempt-${attempts}.txt`,
    );
    await writePromptFile(promptPath, latestPrompt);

    await appendHarnessLog(layout.jsonlLogPath, {
      type: attempts === 1 ? "generator_started" : "repair_started",
      timestamp: new Date().toISOString(),
      attempt: attempts,
      promptPath,
    });
    await writeStatusFile(layout.runDirectory, {
      phase: attempts === 1 ? "generator_running" : "repair_running",
      attempt: attempts,
      promptPath,
    });
    logPhase(
      attempts === 1 ? `Generator attempt ${attempts} started` : `Repair attempt ${attempts} started`,
      "Tail logs/generator-attempt-N.activity.log and logs/workspace-activity.log",
    );

    const agentLogPath = path.join(layout.logsDirectory, `generator-attempt-${attempts}.log`);
    const agentActivityLogPath = path.join(layout.logsDirectory, `generator-attempt-${attempts}.activity.log`);
    const workspaceActivityLogPath = path.join(layout.logsDirectory, `workspace-attempt-${attempts}.activity.log`);
    const agentStartedAt = Date.now();
    let latestProgress: AgentProgress = {
      lastActivity: "agent process spawned",
      toolCallsStarted: 0,
      toolCallsCompleted: 0,
    };

    const workspaceWatcher = new WorkspaceWatcher(
      seedResult.workspacePath,
      workspaceActivityLogPath,
      async summary => {
        latestProgress = { ...latestProgress, lastActivity: summary };
        await writeStatusFile(layout.runDirectory, buildAgentStatus(attempts, agentStartedAt, latestProgress, {
          activityLogPath: agentActivityLogPath,
          workspaceActivityLogPath,
        }));
      },
    );
    await workspaceWatcher.start();

    const heartbeat = setInterval(() => {
      void writeStatusFile(layout.runDirectory, buildAgentStatus(attempts, agentStartedAt, latestProgress, {
        activityLogPath: agentActivityLogPath,
        workspaceActivityLogPath,
      }));
      console.log(
        `[hbar-harness] agent still running (${Math.round((Date.now() - agentStartedAt) / 1000)}s) — ${latestProgress.lastActivity}`,
      );
    }, 15_000);

    let agentResult;
    try {
      agentResult = await generator.run({
        workspacePath: seedResult.workspacePath,
        prompt: latestPrompt,
        attempt: attempts,
        role: "generator",
        timeoutMs: spec.generator.timeoutMs,
        logPath: agentLogPath,
        activityLogPath: agentActivityLogPath,
        onProgress: async progress => {
          latestProgress = progress;
          await writeStatusFile(layout.runDirectory, buildAgentStatus(attempts, agentStartedAt, progress, {
            activityLogPath: agentActivityLogPath,
            workspaceActivityLogPath,
          }));
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      agentResult = {
        exitCode: 127,
        stdout: "",
        stderr: message,
        durationMs: 0,
        command: spec.generator.command,
        args: spec.generator.args ?? [],
        timedOut: false,
        signal: null,
      };
    } finally {
      clearInterval(heartbeat);
      await workspaceWatcher.stop();
    }

    await appendHarnessLog(layout.jsonlLogPath, {
      type: "generator_finished",
      timestamp: new Date().toISOString(),
      attempt: attempts,
      exitCode: agentResult.exitCode,
      durationMs: agentResult.durationMs,
      timedOut: agentResult.timedOut,
    });

    blindIntegrity = await auditOracleAccess({
      workspacePath: seedResult.workspacePath,
      seedRepo: spec.seed.repo,
      harnessProjectRoot: projectRoot,
      runDirectory: layout.runDirectory,
      activityLogPath: agentActivityLogPath,
      rawLogPath: agentLogPath,
    });
    const oracleAuditPath = path.join(layout.logsDirectory, `oracle-audit-attempt-${attempts}.json`);
    await writeJsonFile(oracleAuditPath, blindIntegrity);
    await appendHarnessLog(layout.jsonlLogPath, {
      type: "oracle_audit_finished",
      timestamp: new Date().toISOString(),
      attempt: attempts,
      passed: blindIntegrity.passed,
      findingCount: blindIntegrity.findings.length,
    });

    if (!blindIntegrity.passed) {
      logPhase(
        "Oracle audit failed (informational)",
        `${blindIntegrity.findings.length} peeking finding(s) — does not affect harness pass/fail`,
      );
    }

    if (agentResult.exitCode !== 0) {
      const agentFinding = {
        id: agentResult.timedOut ? `generator-timeout:${attempts}` : `generator-exit:${attempts}`,
        category: "agent" as const,
        message: agentResult.timedOut
          ? `Generator agent timed out after ${Math.round(agentResult.durationMs / 1000)}s`
          : `Generator agent exited with code ${agentResult.exitCode ?? "null"}`,
        details: truncate(agentResult.stderr || agentResult.stdout),
      };
      validation = await runAttemptValidation({
        workspacePath: seedResult.workspacePath,
        spec,
        runDirectory: layout.runDirectory,
        attempts,
        agentFinding,
        jsonlLogPath: layout.jsonlLogPath,
      });
    } else {
      validation = await runAttemptValidation({
        workspacePath: seedResult.workspacePath,
        spec,
        runDirectory: layout.runDirectory,
        attempts,
        logsDirectory: layout.logsDirectory,
        promptsDirectory: layout.promptsDirectory,
        jsonlLogPath: layout.jsonlLogPath,
      });
    }

    const validationLogPath = path.join(layout.logsDirectory, `validation-attempt-${attempts}.json`);
    await writeJsonFile(validationLogPath, validation);
    if (validation.playwrightGate) {
      const playwrightGateLogPath = path.join(layout.logsDirectory, `playwright-gate-attempt-${attempts}.json`);
      await writeJsonFile(playwrightGateLogPath, validation.playwrightGate);
    }

    await appendHarnessLog(layout.jsonlLogPath, {
      type: "validation_finished",
      timestamp: new Date().toISOString(),
      attempt: attempts,
      passed: validation.passed,
      findingCount: validation.findings.length,
    });

    if (!(validation.passed && !validation.semanticValidation)) {
      await writeStatusFile(layout.runDirectory, {
        phase: "validated",
        attempt: attempts,
        passed: validation.passed,
        findingCount: validation.findings.length,
        semanticPassed: validation.semanticValidation?.passed,
        infrastructureFailure: validation.semanticValidation?.infrastructureFailure ?? false,
      });
    }

    if (validation.semanticValidation) {
      logPhase(
        `Attempt ${attempts} semantic validation ${validation.semanticValidation.passed ? "passed" : "failed"}`,
        validation.semanticValidation.passed
          ? validation.semanticValidation.verdict?.summary
          : validation.semanticValidation.infrastructureFailure
            ? `infrastructure: ${validation.semanticValidation.infrastructureFailureReason}`
            : `${validation.semanticValidation.findings.length} finding(s)`,
      );
    } else {
      logPhase(
        `Attempt ${attempts} deterministic validation ${validation.passed ? "passed" : "failed"}`,
        validation.passed
          ? validation.playwrightGate
            ? `playwright gate passed (${validation.playwrightGate.routes.length} routes)`
            : undefined
          : `${validation.findings.length} finding(s)`,
      );
    }

    if (validation.semanticValidation?.infrastructureFailure) {
      await appendHarnessLog(layout.jsonlLogPath, {
        type: "validator_infra_aborted",
        timestamp: new Date().toISOString(),
        attempt: attempts,
        reason: validation.semanticValidation.infrastructureFailureReason ?? "semantic infrastructure failure",
      });
      await appendHarnessNote(
        layout.notesLogPath,
        `Attempt ${attempts} semantic infrastructure abort`,
        [
          "Repair loop aborted: failure is harness/agent tooling, not the generated app.",
          validation.semanticValidation.infrastructureFailureReason ?? "(no reason)",
          ...validation.semanticValidation.findings.map(finding => `- [${finding.category}] ${finding.message}`),
        ].join("\n"),
      );
      logPhase(
        "Aborting repair loop after semantic infrastructure failure",
        validation.semanticValidation.infrastructureFailureReason,
      );

      const gitCommit = await commitWorkspaceAttempt(
        seedResult.workspacePath,
        attempts,
        false,
        validation.findings.length,
      );
      await appendHarnessLog(layout.jsonlLogPath, {
        type: "workspace_git_committed",
        timestamp: new Date().toISOString(),
        attempt: attempts,
        committed: gitCommit.committed,
        commitSha: gitCommit.commitSha,
        message: gitCommit.message,
      });
      break;
    }

    await appendHarnessNote(
      layout.notesLogPath,
      `Attempt ${attempts} validation`,
      validation.passed
        ? validation.semanticValidation
          ? "Deterministic, Playwright gate, and semantic validation passed."
          : "Deterministic validation passed."
        : validation.findings.map(finding => `- [${finding.category}] ${finding.message}`).join("\n"),
    );

    const gitCommit = await commitWorkspaceAttempt(
      seedResult.workspacePath,
      attempts,
      validation.passed,
      validation.findings.length,
    );
    await appendHarnessLog(layout.jsonlLogPath, {
      type: "workspace_git_committed",
      timestamp: new Date().toISOString(),
      attempt: attempts,
      committed: gitCommit.committed,
      commitSha: gitCommit.commitSha,
      message: gitCommit.message,
    });
    if (gitCommit.committed && gitCommit.commitSha) {
      logPhase(`Workspace committed`, `${gitCommit.message} @ ${gitCommit.commitSha.slice(0, 8)}`);
    } else {
      logPhase("Workspace unchanged", "no git commit needed for this attempt");
    }

    if (validation.passed) {
      break;
    }

    if (attempts < maxAttempts) {
      latestPrompt = await buildRepairPrompt(spec, validation.findings, attempts + 1, vendoredContext);
    }
  }

  const finishedAt = new Date();
  const report: RunReport = {
    specName: spec.name,
    specPath: loaded.specPath,
    runDirectory: layout.runDirectory,
    workspacePath: seedResult.workspacePath,
    seedRepo: seedResult.repo,
    seedRef: seedResult.ref,
    seedCommitSha: seedResult.commitSha,
    attempts,
    maxAttempts,
    passed: validation.passed,
    blindIntegrity,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    validation,
    semanticValidation: validation.semanticValidation,
  };

  await writeJsonFile(layout.reportPath, report);

  await appendHarnessLog(layout.jsonlLogPath, {
    type: "run_finished",
    timestamp: finishedAt.toISOString(),
    passed: report.passed,
    attempts: report.attempts,
    reportPath: layout.reportPath,
  });

  await appendHarnessNote(
    layout.notesLogPath,
    `Run finished: ${spec.name}`,
    [
      report.passed
        ? `Passed after ${report.attempts} attempt(s). Report: ${layout.reportPath}`
        : `Failed after ${report.attempts} attempt(s). Report: ${layout.reportPath}`,
      formatBlindIntegritySummary(report.blindIntegrity),
    ].join("\n"),
  );
  await writeStatusFile(layout.runDirectory, {
    phase: "finished",
    passed: report.passed,
    blindIntegrityPassed: report.blindIntegrity.passed,
    attempts: report.attempts,
    reportPath: layout.reportPath,
  });
  logPhase(
    `Run finished: ${report.passed ? "PASSED" : "FAILED"}`,
    report.passed && !report.blindIntegrity.passed
      ? `${layout.reportPath} — validation passed but oracle audit detected peeking`
      : `${layout.reportPath} (oracleAudit=${report.blindIntegrity.passed ? "passed" : "failed"})`,
  );
  if (report.passed && !report.blindIntegrity.passed) {
    console.log(formatBlindIntegritySummary(report.blindIntegrity));
  }

  return report;
}

export async function validateWorkspace(options: CliOptions) {
  if (!options.workspacePath) {
    throw new Error('Expected --workspace <path> for validate command.');
  }

  const loaded = await loadTemplateSpec(options.specPath);
  return runDeterministicValidation(options.workspacePath, loaded.spec);
}

/**
 * Run Tier 3 semantic validation alone against an existing workspace
 * (skips generator + deterministic gates). Re-vendors PRD/contract/Playwright MCP
 * so older runs pick up current harness tooling.
 */
export async function validateSemanticWorkspace(options: CliOptions): Promise<SemanticValidationResult> {
  if (!options.workspacePath) {
    throw new Error('Expected --workspace <path> for validate-semantic command.');
  }

  const workspacePath = path.resolve(options.workspacePath);
  await access(workspacePath);

  const loaded = await loadTemplateSpec(options.specPath);
  const { spec } = loaded;

  if (!isValidatorEnabled(spec)) {
    throw new Error(
      "Semantic validator is not enabled in the spec (set validator.enabled: true or configure validator).",
    );
  }

  if (!spec.contractPath) {
    throw new Error("Semantic validation requires spec.contract to be configured.");
  }

  const vendored = await vendorHarnessContext(workspacePath, {
    prdPath: spec.prdPath,
    contractPath: spec.contractPath,
  });
  logPhase(
    "Harness context refreshed for semantic validation",
    `.harness-context + ${vendored.playwrightMcpPath ?? "no playwright MCP"}`,
  );

  const artifactDirs = await resolveSemanticArtifactDirs(workspacePath);
  const attempt = await nextSemanticAttempt(artifactDirs.logsDirectory);

  logPhase(`Semantic validation attempt ${attempt} started`, workspacePath);

  const result = await runSemanticValidation({
    workspacePath,
    spec,
    attempt,
    logsDirectory: artifactDirs.logsDirectory,
    promptsDirectory: artifactDirs.promptsDirectory,
  });

  const resultPath = path.join(artifactDirs.logsDirectory, `semantic-validation-attempt-${attempt}.json`);
  await writeJsonFile(resultPath, result);

  logPhase(
    `Semantic validation ${result.passed ? "passed" : "failed"}`,
    `${result.findings.length} finding(s), ${Math.round(result.durationMs / 1000)}s — ${resultPath}`,
  );

  return result;
}

async function runAttemptValidation(input: {
  workspacePath: string;
  spec: TemplateSpec;
  runDirectory: string;
  attempts: number;
  logsDirectory?: string;
  promptsDirectory?: string;
  jsonlLogPath?: string;
  agentFinding?: ValidationFinding;
}): Promise<ValidationResult> {
  const installCachePath = path.join(input.runDirectory, "cache", "install-fingerprint.txt");
  const useSharedDevServer =
    isValidatorEnabled(input.spec) && Boolean(input.spec.validators.playwrightPath);

  const detOptions = {
    skipPlaywrightGate: useSharedDevServer,
    installCachePath,
  };

  let validation: ValidationResult;
  if (input.agentFinding) {
    const deterministic = await runDeterministicValidation(input.workspacePath, input.spec, detOptions);
    validation = {
      passed: false,
      findings: [input.agentFinding, ...deterministic.findings],
      commandResults: deterministic.commandResults,
      playwrightGate: deterministic.playwrightGate,
    };
  } else {
    validation = await runDeterministicValidation(input.workspacePath, input.spec, detOptions);
  }

  const tier01Passed = validation.findings.filter(finding => finding.category !== "agent").length === 0;
  if (!useSharedDevServer || !tier01Passed || input.agentFinding) {
    return validation;
  }

  const playwrightPath = input.spec.validators.playwrightPath!;
  let devSession = null;
  try {
    const serverConfig = await loadDevServerConfig(playwrightPath);
    devSession = await createDevServerSession(input.workspacePath, serverConfig, "runtime");

    console.log("[hbar-harness] Running thin Playwright gate (shared dev server)...");
    const gate = await runPlaywrightGate(input.workspacePath, playwrightPath, devSession);
    validation.playwrightGate = gate.result;
    validation.findings.push(...gate.findings);
    validation.passed = validation.findings.filter(finding => finding.category !== "agent").length === 0;

    if (!validation.passed || !input.logsDirectory || !input.promptsDirectory) {
      return validation;
    }

    const validatorPromptPath = path.join(input.promptsDirectory, `validator-attempt-${input.attempts}.txt`);
    if (input.jsonlLogPath) {
      await appendHarnessLog(input.jsonlLogPath, {
        type: "validator_started",
        timestamp: new Date().toISOString(),
        attempt: input.attempts,
        promptPath: validatorPromptPath,
        serverUrl: devSession.url,
      });
    }
    logPhase(`Validator attempt ${input.attempts} started`, devSession.url);

    const semanticValidation = await runSemanticValidation({
      workspacePath: input.workspacePath,
      spec: input.spec,
      attempt: input.attempts,
      logsDirectory: input.logsDirectory,
      promptsDirectory: input.promptsDirectory,
      devServer: devSession,
    });

    const semanticLogPath = path.join(
      input.logsDirectory,
      `semantic-validation-attempt-${input.attempts}.json`,
    );
    await writeJsonFile(semanticLogPath, semanticValidation);

    if (input.jsonlLogPath) {
      await appendHarnessLog(input.jsonlLogPath, {
        type: "validator_finished",
        timestamp: new Date().toISOString(),
        attempt: input.attempts,
        passed: semanticValidation.passed,
        findingCount: semanticValidation.findings.length,
        durationMs: semanticValidation.durationMs,
        infrastructureFailure: semanticValidation.infrastructureFailure,
        infrastructureFailureReason: semanticValidation.infrastructureFailureReason,
      });
    }

    if (!semanticValidation.passed) {
      validation = {
        ...validation,
        passed: false,
        findings: [...validation.findings, ...semanticValidation.findings],
        semanticValidation,
      };
    } else {
      validation = {
        ...validation,
        semanticValidation,
      };
    }
  } finally {
    await devSession?.stop();
  }

  return validation;
}

async function resolveSemanticArtifactDirs(workspacePath: string): Promise<{
  logsDirectory: string;
  promptsDirectory: string;
}> {
  const parent = path.dirname(workspacePath);
  const siblingLogs = path.join(parent, "logs");
  const siblingPrompts = path.join(parent, "prompts");

  // Typical harness layout: runs/<id>/workspace with sibling logs/ and prompts/
  if (path.basename(workspacePath) === "workspace") {
    try {
      await access(siblingLogs);
      await mkdir(siblingPrompts, { recursive: true });
      return { logsDirectory: siblingLogs, promptsDirectory: siblingPrompts };
    } catch {
      // fall through
    }
  }

  const logsDirectory = path.join(workspacePath, ".harness-semantic", "logs");
  const promptsDirectory = path.join(workspacePath, ".harness-semantic", "prompts");
  await mkdir(logsDirectory, { recursive: true });
  await mkdir(promptsDirectory, { recursive: true });
  return { logsDirectory, promptsDirectory };
}

async function nextSemanticAttempt(logsDirectory: string): Promise<number> {
  let maxAttempt = 0;
  try {
    const entries = await readdir(logsDirectory);
    for (const entry of entries) {
      const match = /^semantic-validation-attempt-(\d+)\.json$/.exec(entry);
      if (match) {
        maxAttempt = Math.max(maxAttempt, Number.parseInt(match[1], 10));
      }
    }
  } catch {
    // empty / missing
  }
  return maxAttempt + 1;
}

function logPhase(title: string, detail?: string): void {
  const suffix = detail ? ` — ${detail}` : "";
  console.log(`[hbar-harness] ${title}${suffix}`);
}


function truncate(value: string, maxLength = 1200): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

function formatBlindIntegritySummary(blindIntegrity: BlindIntegrityResult): string {
  if (blindIntegrity.passed) {
    return "Oracle audit: passed (no peeking detected).";
  }

  const findings = blindIntegrity.findings
    .map(finding => `- ${finding.message}${finding.path ? ` (${finding.path})` : ""}`)
    .join("\n");

  return [
    `Oracle audit: FAILED — agent may have peeked outside the workspace (${blindIntegrity.findings.length} finding(s)).`,
    "This does not fail the harness when deterministic validation passes.",
    findings,
  ].join("\n");
}

function buildAgentStatus(
  attempt: number,
  startedAtMs: number,
  progress: AgentProgress,
  logs: { activityLogPath: string; workspaceActivityLogPath: string },
): Record<string, unknown> {
  return {
    phase: "generator_running",
    attempt,
    elapsedSeconds: Math.round((Date.now() - startedAtMs) / 1000),
    lastActivity: progress.lastActivity,
    toolCallsStarted: progress.toolCallsStarted,
    toolCallsCompleted: progress.toolCallsCompleted,
    sessionId: progress.sessionId,
    activityLogPath: logs.activityLogPath,
    workspaceActivityLogPath: logs.workspaceActivityLogPath,
  };
}
