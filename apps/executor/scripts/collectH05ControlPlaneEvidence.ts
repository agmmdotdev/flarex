import { execFileSync } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { argv, env } from "node:process";

import {
  decodeH05ControlPlaneEvidenceJson,
  serializeH05ControlPlaneEvidence,
} from "../h05/controlPlaneEvidence";
import { createH05CloudflareReadApi } from "./cloudflareReadApi";
import {
  collectH05ControlPlaneEvidence,
  decodeH05ExpectedPostgresTarget,
} from "./h05ControlPlaneCollector";
import {
  assertNewEvidencePath,
  isPathInside,
  writeNewAtomicEvidenceFile,
} from "./h05EvidenceOutput";
import {
  assertH05SourceEvidenceUnchanged,
  readH05SourceEvidence,
} from "./h05SourceEvidence";

const outputArgument = argv[2];
if (outputArgument === undefined || argv.length !== 3) {
  throw new Error(
    "Usage: pnpm collect:h05-control-plane-evidence <outside-worktree-output.json>",
  );
}

const apiToken = requiredUntrimmedEnvironmentValue(
  env.CLOUDFLARE_API_TOKEN,
  "CLOUDFLARE_API_TOKEN",
);
const accountId = requiredEnvironmentValue(
  env.CLOUDFLARE_ACCOUNT_ID,
  "CLOUDFLARE_ACCOUNT_ID",
);
const hyperdriveId = requiredEnvironmentValue(
  env.FLAREX_H05_HYPERDRIVE_ID,
  "FLAREX_H05_HYPERDRIVE_ID",
);
const expectedHyperdriveName = requiredEnvironmentValue(
  env.FLAREX_H05_HYPERDRIVE_NAME,
  "FLAREX_H05_HYPERDRIVE_NAME",
);
const runId = requiredEnvironmentValue(
  env.FLAREX_H05_RUN_ID,
  "FLAREX_H05_RUN_ID",
);
if (env.FLAREX_H05_ALL_ZONES_TOKEN_SCOPE !== "yes") {
  throw new Error(
    "FLAREX_H05_ALL_ZONES_TOKEN_SCOPE=yes is required to attest that the API token can read every account zone.",
  );
}
const expectedPostgres = decodeH05ExpectedPostgresTarget({
  databaseUrl: env.FLAREX_H05_POSTGRES_DATABASE_URL,
  expectedDatabaseName: env.FLAREX_H05_EXPECTED_DATABASE_NAME,
});
const api = createH05CloudflareReadApi({ apiToken });

const workspaceRoot = await realpath(
  resolve(commandOutput("git", ["rev-parse", "--show-toplevel"])),
);
const requestedOutputPath = resolve(outputArgument);
const parentPath = dirname(requestedOutputPath);
const parent = await stat(parentPath);
if (!parent.isDirectory()) {
  throw new Error("H05 control-plane evidence output parent must be a directory.");
}
const outputPath = resolve(
  await realpath(parentPath),
  basename(requestedOutputPath),
);
if (isPathInside(workspaceRoot, outputPath)) {
  throw new Error(
    "H05 control-plane evidence output must stay outside the Git worktree.",
  );
}
await assertNewEvidencePath(outputPath);

const source = readH05SourceEvidence();
const evidence = await collectH05ControlPlaneEvidence({
  accountId,
  allZonesTokenScopeAttested: true,
  api,
  expectedHyperdriveName,
  expectedPostgres,
  hyperdriveId,
  runId,
  source,
});
const serialized = serializeH05ControlPlaneEvidence(evidence);
const verified = decodeH05ControlPlaneEvidenceJson(serialized);
if (!verified.ok) throw new Error(verified.message);
assertH05SourceEvidenceUnchanged(source);
await writeNewAtomicEvidenceFile(outputPath, serialized);
console.log(
  `Collected H05 control-plane evidence for ${evidence.run.deploymentId}; matching privacy sweeps found no executor ingress across ${evidence.executor.privacy.closing.zones.zoneIds.length} operator-attested account zones.`,
);

function commandOutput(executable: string, args: readonly string[]): string {
  return execFileSync(executable, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
    windowsHide: true,
  }).trim();
}

function requiredEnvironmentValue(
  value: string | undefined,
  name: string,
): string {
  const normalized = value?.trim();
  if (normalized !== undefined && normalized.length > 0) return normalized;
  throw new Error(`${name} is required.`);
}

function requiredUntrimmedEnvironmentValue(
  value: string | undefined,
  name: string,
): string {
  if (value !== undefined && value.length > 0) return value;
  throw new Error(`${name} is required.`);
}
