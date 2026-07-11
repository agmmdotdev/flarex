import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { argv } from "node:process";

import {
  decodeH05HostedReceiptJson,
  type H05HostedReceipt,
} from "../h05/receipt";

const maximumReceiptBytes = 1024 * 1024;
const receiptPath = argv[2];

if (receiptPath === undefined || argv.length !== 3) {
  throw new Error(
    "Usage: pnpm check:h05-hosted-receipt <redacted-receipt.json>",
  );
}

const file = await stat(receiptPath);
if (!file.isFile() || file.size > maximumReceiptBytes) {
  throw new Error(
    "H05 hosted receipt must be a regular file no larger than 1 MiB.",
  );
}
const raw = await readFile(receiptPath);
if (raw.byteLength > maximumReceiptBytes) {
  throw new Error("H05 hosted receipt changed beyond the 1 MiB local preflight limit.");
}

const decoded = decodeH05HostedReceiptJson(raw.toString("utf8"));
if (!decoded.ok) {
  console.error(decoded.message);
  process.exitCode = 1;
} else {
  const sourceError = validateLocalSource(decoded.value.source);
  if (sourceError !== undefined) {
    console.error(sourceError);
    process.exitCode = 1;
  } else {
    console.log(
      `H05 hosted receipt preflight passed for ${decoded.value.run.runId} at commit ${decoded.value.source.commit}.`,
    );
  }
}

function validateLocalSource(
  source: H05HostedReceipt["source"],
): string | undefined {
  let commit: string;
  let status: string;
  let wranglerVersion: string;
  try {
    commit = commandOutput("git", ["rev-parse", "HEAD"]).trim();
    status = commandOutput("git", [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    wranglerVersion = commandOutput(process.execPath, [
      "--no-warnings",
      createRequire(import.meta.url).resolve("wrangler"),
      "--version",
    ]).trim();
  } catch {
    return "H05 hosted receipt local source verification could not run.";
  }
  if (status.length !== 0) {
    return "H05 hosted receipt requires a clean local worktree.";
  }
  if (commit !== source.commit) {
    return "H05 hosted receipt source commit does not match local HEAD.";
  }
  if (wranglerVersion !== source.wranglerVersion) {
    return "H05 hosted receipt Wrangler version does not match the local CLI.";
  }
  const sourceEvidence = `${JSON.stringify(
    { commit, worktreeClean: true, wranglerVersion },
    null,
    2,
  )}\n`;
  const sourceEvidenceSha256 = createHash("sha256")
    .update(sourceEvidence)
    .digest("hex");
  if (sourceEvidenceSha256 !== source.evidenceSha256) {
    return "H05 hosted receipt source evidence hash does not match local Git and Wrangler state.";
  }
  return undefined;
}

function commandOutput(executable: string, args: readonly string[]): string {
  return execFileSync(executable, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
    windowsHide: true,
  });
}
