import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const HARNESS_CONTEXT_DIR = ".harness-context";
export const VENDORED_PRD_PATH = `${HARNESS_CONTEXT_DIR}/prd.md`;
export const VENDORED_CONTRACT_PATH = `${HARNESS_CONTEXT_DIR}/acceptance-contract.json`;

export interface VendoredContext {
  prdRelativePath: string;
  contractRelativePath?: string;
  prdSourcePath: string;
  contractSourcePath?: string;
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
  };
}
