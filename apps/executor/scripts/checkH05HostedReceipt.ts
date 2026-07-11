import { readFile, stat } from "node:fs/promises";
import { argv } from "node:process";

import {
  decodeH05HostedReceiptJson,
  type H05HostedReceipt,
} from "../h05/receipt";
import {
  H05SourceEvidenceError,
  h05SourceEvidenceSha256,
  readH05SourceEvidence,
} from "./h05SourceEvidence";

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
  let current: ReturnType<typeof readH05SourceEvidence>;
  try {
    current = readH05SourceEvidence();
  } catch (error) {
    if (
      error instanceof H05SourceEvidenceError &&
      error.code === "dirty-worktree"
    ) {
      return "H05 hosted receipt requires a clean local worktree.";
    }
    return "H05 hosted receipt local source verification could not run.";
  }
  if (current.commit !== source.commit) {
    return "H05 hosted receipt source commit does not match local HEAD.";
  }
  if (current.wranglerVersion !== source.wranglerVersion) {
    return "H05 hosted receipt Wrangler version does not match the local CLI.";
  }
  if (h05SourceEvidenceSha256(current) !== source.evidenceSha256) {
    return "H05 hosted receipt source evidence hash does not match local Git and Wrangler state.";
  }
  return undefined;
}
