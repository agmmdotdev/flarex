import { readFile, stat } from "node:fs/promises";
import { argv } from "node:process";

import {
  decodeH05HostedProofBundleJson,
  h05MaximumHostedProofBundleBytes,
} from "../h05/hostedProofBundle";
import { validateH05HostedProofBundleLocalSource } from "./h05HostedProofBundleLocalSource";

const bundlePath = argv[2];

if (bundlePath === undefined || argv.length !== 3) {
  throw new Error(
    "Usage: pnpm check:h05-hosted-proof-bundle <hosted-proof-bundle.json>",
  );
}

const file = await stat(bundlePath);
if (!file.isFile() || file.size > h05MaximumHostedProofBundleBytes) {
  throw new Error(
    "H05 hosted proof bundle must be a regular file no larger than 16 MiB.",
  );
}
const raw = await readFile(bundlePath);
if (raw.byteLength > h05MaximumHostedProofBundleBytes) {
  throw new Error(
    "H05 hosted proof bundle changed beyond the 16 MiB local verification limit.",
  );
}

const decoded = decodeH05HostedProofBundleJson(raw.toString("utf8"));
if (!decoded.ok) {
  console.error(decoded.message);
  process.exitCode = 1;
} else {
  const sourceError = validateH05HostedProofBundleLocalSource(decoded.value);
  if (sourceError !== undefined) {
    console.error(sourceError);
    process.exitCode = 1;
  } else {
    console.log(
      `H05 hosted proof bundle ${decoded.value.bundleSha256} passed for ${decoded.value.receipt.run.runId} at commit ${decoded.value.receipt.source.commit}.`,
    );
  }
}
