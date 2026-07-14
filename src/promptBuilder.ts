import { readFile } from "node:fs/promises";
import type { TemplateSpec, ValidationFinding } from "./types.js";
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
    "## Template Metadata Targets",
    metadata?.name ? `- template name: ${metadata.name}` : undefined,
    metadata?.frontend ? `- frontend capability: ${metadata.frontend}` : undefined,
    metadata?.solidityFramework
      ? `- solidity framework capability: ${metadata.solidityFramework}`
      : undefined,
    "",
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
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function buildRepairPrompt(findings: ValidationFinding[], attempt: number): string {
  const grouped = findings
    .map(finding => `- [${finding.category}] ${finding.message}${finding.details ? `\n  ${finding.details}` : ""}`)
    .join("\n");

  return [
    "You are repairing a scaffold-hbar template in the current workspace.",
    "",
    `Repair attempt: ${attempt}`,
    "",
    "Fix only the issues below. Do not redesign unrelated parts of the app.",
    "",
    "## Validation Findings",
    grouped,
    "",
    "## Repair Rules",
    "- Keep Yarn-only workflows.",
    "- Do not add secrets or `.env` files.",
    "- Preserve scaffold-hbar template conventions.",
    "- Re-run the relevant validation mentally before finishing.",
    "",
    "Append a brief repair note to `GENERATION_NOTES.md` at the workspace root, describing what failed and what you changed.",
    "- Do not read or write files outside the current workspace.",
  ].join("\n");
}

function formatSkillSummaries(skills: VendoredSkill[]): string {
  return skills
    .map(skill => `### ${skill.name}\nSource: ${skill.relativePath}\n${skill.description}`)
    .join("\n\n");
}
