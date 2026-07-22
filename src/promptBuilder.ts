import { readFile } from "node:fs/promises";
import type { TemplateSpec, ValidationFinding } from "./types.js";
import {
  VENDORED_CONTRACT_PATH,
  VENDORED_PRD_PATH,
  type VendoredContext,
} from "./contextVendor.js";
import type { VendoredSkill } from "./skillVendor.js";

export async function buildGeneratorPrompt(
  spec: TemplateSpec,
  attempt: number,
  vendoredSkills: VendoredSkill[] = [],
): Promise<string> {
  const prd = await readFile(spec.prdPath, "utf8");
  const skillSummaries = formatSkillSummaries(vendoredSkills);
  const metadata = spec.templateMetadata;

  return [
    "You are the generator agent for a scaffold-hbar template harness.",
    "",
    `Attempt: ${attempt}`,
    "",
    "## Product Requirements",
    prd.trim(),
    "",
    "## Harness Mission",
    "Transform the seeded scaffold-hbar workspace into a working Hedera ecosystem demo template.",
    "Be creative in implementation choices while respecting the constraints below.",
    "Do not assume any pre-existing finished template. Build the best version you can from the seed.",
    "Do not read or copy from repositories, harness runs, or template branches outside this workspace.",
    "",
    "## Workspace Context Files",
    `The PRD is also vendored at \`${VENDORED_PRD_PATH}\` for later repair attempts.`,
    spec.contractPath
      ? `The acceptance contract is vendored at \`${VENDORED_CONTRACT_PATH}\`.`
      : undefined,
    "",
    "## Template Metadata Targets",
    metadata?.name ? `- template name: ${metadata.name}` : undefined,
    metadata?.frontend ? `- frontend capability: ${metadata.frontend}` : undefined,
    metadata?.solidityFramework
      ? `- solidity framework capability: ${metadata.solidityFramework}`
      : undefined,
    "",
    ...formatHardConstraints(spec),
    "",
    "## Required Deliverables",
    ...spec.requiredFiles.map(file => `- ${file}`),
    "",
    "## Skills To Leverage",
    skillSummaries.length > 0
      ? [
          "Use only the vendored skills copied into this workspace under `.harness-skills/`.",
          skillSummaries,
        ].join("\n\n")
      : "- Use scaffold-hbar and Hedera best practices.",
    "",
    "## Logging Requirement",
    "After making meaningful changes, append a short note to `GENERATION_NOTES.md` at the workspace root. Summarize what you built, what you validated, and what remains risky.",
    "- Do not read or write files outside the current workspace.",
    "",
    "## Completion Standard",
    "The workspace should pass deterministic validation: required files present, forbidden files absent, no secrets, and yarn lint/typecheck/build commands succeeding without live credentials.",
    spec.validators.playwrightPath
      ? "When build passes, the harness also runs a thin Playwright gate (dev server boots, routes render, no console errors)."
      : undefined,
    spec.validator && spec.validator.enabled !== false
      ? "When deterministic and Playwright gates pass, a read-only validator agent grades the live app against the acceptance contract."
      : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function buildRepairPrompt(
  spec: TemplateSpec,
  findings: ValidationFinding[],
  attempt: number,
  vendoredContext?: VendoredContext,
): string {
  const grouped = findings
    .map(finding => `- [${finding.category}] ${finding.message}${finding.details ? `\n  ${finding.details}` : ""}`)
    .join("\n");
  const metadata = spec.templateMetadata;
  const contractPath = vendoredContext?.contractRelativePath ?? VENDORED_CONTRACT_PATH;

  return [
    "You are repairing a scaffold-hbar template in the current workspace.",
    "This is a fresh-context repair attempt. You do not retain memory from prior agent runs.",
    "",
    `Repair attempt: ${attempt}`,
    "",
    "## Read First (Workspace Memory)",
    "Before changing anything, read these files in the current workspace:",
    `- \`${VENDORED_PRD_PATH}\` — product requirements`,
    spec.contractPath ? `- \`${contractPath}\` — numbered acceptance assertions the validator will grade against` : undefined,
    "- `GENERATION_NOTES.md` — prior generator/repair notes (create it if missing)",
    "",
    "## Repair Mission",
    "Fix only the validation findings below. Do not redesign unrelated parts of the app.",
    "",
    "## Template Metadata Targets",
    metadata?.name ? `- template name: ${metadata.name}` : undefined,
    metadata?.frontend ? `- frontend capability: ${metadata.frontend}` : undefined,
    metadata?.solidityFramework
      ? `- solidity framework capability: ${metadata.solidityFramework}`
      : undefined,
    "",
    ...formatHardConstraints(spec),
    "",
    "## Required Deliverables",
    ...spec.requiredFiles.map(file => `- ${file}`),
    "",
    "## Validation Findings",
    grouped,
    "",
    "## Repair Rules",
    "- Keep Yarn-only workflows.",
    "- Do not add secrets or `.env` files.",
    "- Preserve scaffold-hbar template conventions.",
    "- Fix findings in priority order: [agent] process failures, [commands] build/lint, [playwright] runtime gate, [semantic] contract assertions, then [files]/[static]/[secret].",
    "- Re-run the relevant validation mentally before finishing.",
    "",
    "Append a brief repair note to `GENERATION_NOTES.md` at the workspace root, describing what failed and what you changed.",
    "- Do not read or write files outside the current workspace.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function formatHardConstraints(spec: TemplateSpec): string[] {
  return [
    "## Hard Constraints",
    "- Keep all changes inside the current workspace.",
    "- Use Yarn workspace commands only.",
    spec.constraints?.forbiddenWorkspaces?.length
      ? `- Forbidden workspaces: ${spec.constraints.forbiddenWorkspaces.join(", ")}`
      : undefined,
    spec.constraints?.forbiddenCommands?.length
      ? `- Forbidden commands: ${spec.constraints.forbiddenCommands.join(", ")}`
      : undefined,
    "- Do not add `.env` files, private keys, API keys, or live-network credential requirements.",
    "- Produce `template.json`, `README.md`, and `AGENTS.md` suitable for scaffold-hbar.",
  ].filter((line): line is string => Boolean(line));
}

function formatSkillSummaries(skills: VendoredSkill[]): string {
  return skills
    .map(skill => `### ${skill.name}\nSource: ${skill.relativePath}\n${skill.description}`)
    .join("\n\n");
}

export function buildValidatorPrompt(contractJson: string, serverUrl: string): string {
  const outputSchema = {
    passed: true,
    summary: "Brief overall summary of the evaluation.",
    issues: [
      {
        id: "issue-slug",
        contractAssertion: "C1",
        severity: "critical",
        route: "/",
        message: "What failed and why.",
        evidence: "Route visited, elements observed, console output.",
      },
    ],
  };

  return [
    "You are an adversarial QA evaluator for a scaffold-hbar template harness.",
    "",
    "## Mission",
    `Drive the running app at ${serverUrl} in a browser using the Playwright MCP tools (browser_navigate, browser_snapshot, browser_click, etc.).`,
    "For each acceptance-contract assertion, positively verify it or mark it failed.",
    "Do not invent browser access — if Playwright MCP tools are unavailable, fail assertions with that evidence.",
    "You cannot edit files, apply patches, or modify the workspace — judge only. Do not read seed repos, harness runs, or oracle paths outside this workspace.",
    "Do not assume missing context. Fail on uncertainty.",
    "",
    "## Acceptance Contract",
    contractJson.trim(),
    "",
    "## Output Requirements",
    "Output ONLY a single JSON object matching this schema (no prose outside JSON):",
    "```json",
    JSON.stringify(outputSchema, null, 2),
    "```",
    "",
    "## Rules",
    "- Set passed=true only when ALL contract assertions are positively verified.",
    "- Every failed assertion must appear in issues[] with contractAssertion matching the assertion id (e.g. C1).",
    "- severity must be one of: critical, major, minor (per the contract).",
    "- For walletRequired assertions, do NOT complete on-chain transactions; verify affordances and no-wallet handling only.",
    "- Cite route, UI elements, and console observations in evidence for every issue.",
    "- If you cannot positively verify an assertion, mark it failed with evidence explaining the uncertainty.",
  ].join("\n");
}
