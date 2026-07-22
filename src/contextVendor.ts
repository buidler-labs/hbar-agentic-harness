import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const HARNESS_CONTEXT_DIR = ".harness-context";
export const VENDORED_PRD_PATH = `${HARNESS_CONTEXT_DIR}/prd.md`;
export const VENDORED_CONTRACT_PATH = `${HARNESS_CONTEXT_DIR}/acceptance-contract.json`;

/** Playwright MCP config merged into the seeded workspace so the validator agent can drive the live app. */
export const PLAYWRIGHT_MCP_SERVER = {
  command: "npx",
  args: ["-y", "@playwright/mcp@latest", "--headless", "--browser", "chromium"],
} as const;

export interface VendoredContext {
  prdRelativePath: string;
  contractRelativePath?: string;
  prdSourcePath: string;
  contractSourcePath?: string;
  playwrightMcpPath?: string;
}

export async function vendorHarnessContext(
  workspacePath: string,
  input: { prdPath: string; contractPath?: string },
): Promise<VendoredContext> {
  const contextRoot = path.join(workspacePath, HARNESS_CONTEXT_DIR);
  await mkdir(contextRoot, { recursive: true });

  const prdContent = await readFile(input.prdPath, "utf8");
  const prdRelativePath = VENDORED_PRD_PATH;
  await writeFile(path.join(workspacePath, prdRelativePath), prdContent, "utf8");

  let contractRelativePath: string | undefined;
  if (input.contractPath) {
    const contractContent = await readFile(input.contractPath, "utf8");
    contractRelativePath = VENDORED_CONTRACT_PATH;
    await writeFile(path.join(workspacePath, contractRelativePath), contractContent, "utf8");
  }

  const playwrightMcpPath = await ensurePlaywrightMcp(workspacePath);

  await writeFile(
    path.join(contextRoot, "manifest.json"),
    `${JSON.stringify(
      {
        vendoredAt: new Date().toISOString(),
        prd: {
          relativePath: prdRelativePath,
          sourcePath: input.prdPath,
        },
        contract: contractRelativePath
          ? {
              relativePath: contractRelativePath,
              sourcePath: input.contractPath,
            }
          : undefined,
        playwrightMcp: {
          relativePath: playwrightMcpPath,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    prdRelativePath,
    contractRelativePath,
    prdSourcePath: input.prdPath,
    contractSourcePath: input.contractPath,
    playwrightMcpPath,
  };
}

/**
 * Merge the Playwright MCP server into the workspace `.cursor/mcp.json`.
 * The Cursor agent CLI loads MCP from the `--workspace` directory, so the
 * seeded scaffold config alone is not enough for semantic validation.
 */
export async function ensurePlaywrightMcp(workspacePath: string): Promise<string> {
  const relativePath = ".cursor/mcp.json";
  const mcpPath = path.join(workspacePath, relativePath);
  await mkdir(path.dirname(mcpPath), { recursive: true });

  let existing: { mcpServers?: Record<string, unknown> } = {};
  try {
    existing = JSON.parse(await readFile(mcpPath, "utf8")) as typeof existing;
  } catch {
    existing = {};
  }

  const mcpServers = { ...(existing.mcpServers ?? {}) };
  mcpServers.playwright = { ...PLAYWRIGHT_MCP_SERVER };

  await writeFile(
    mcpPath,
    `${JSON.stringify(
      {
        ...existing,
        mcpServers,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return relativePath;
}
