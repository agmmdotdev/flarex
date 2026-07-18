import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { argv, env } from "node:process";

import { decodeH05ControlPlaneEvidenceJson } from "../h05/controlPlaneEvidence";
import { decodeH05DataPlaneEvidenceJson } from "../h05/receipt";
import {
  decodeH05TraceEvidenceJson,
  serializeH05TraceEvidence,
} from "../h05/traceEvidence";
import { createH05CloudflareTelemetryApi } from "./cloudflareTelemetryApi";
import { commandOutput } from "./commandOutput";
import { collectH05TraceEvidence } from "./h05TraceCollector";
import {
  assertNewEvidencePath,
  readH05EvidenceInputFile,
  resolveH05EvidenceOutputPath,
  writeNewAtomicEvidenceFile,
} from "./h05EvidenceOutput";
import {
  requiredEnvironmentValue,
  requiredUntrimmedEnvironmentValue,
} from "./h05Environment";
import {
  assertH05SourceEvidenceUnchanged,
  readH05SourceEvidence,
} from "./h05SourceEvidence";

const maximumInputBytes = 1024 * 1024;
const controlBeforeArgument = argv[2];
const dataPlaneArgument = argv[3];
const controlAfterArgument = argv[4];
const outputArgument = argv[5];
if (
  controlBeforeArgument === undefined ||
  dataPlaneArgument === undefined ||
  controlAfterArgument === undefined ||
  outputArgument === undefined ||
  argv.length !== 6
) {
  throw new Error(
    "Usage: pnpm collect:h05-trace-evidence <control-before.json> <data-plane.json> <control-after.json> <outside-worktree-output.json>",
  );
}

const apiToken = requiredUntrimmedEnvironmentValue(
  env.FLAREX_H05_TELEMETRY_API_TOKEN,
  "FLAREX_H05_TELEMETRY_API_TOKEN",
);
const accountId = requiredEnvironmentValue(
  env.CLOUDFLARE_ACCOUNT_ID,
  "CLOUDFLARE_ACCOUNT_ID",
);
const workspaceRoot = await realpath(
  resolve(commandOutput("git", ["rev-parse", "--show-toplevel"])),
);
const [controlBeforeJson, dataPlaneJson, controlAfterJson, outputPath] =
  await Promise.all([
    readH05EvidenceInputFile({
      workspaceRoot,
      argument: controlBeforeArgument,
      label: "control-before",
      maximumBytes: maximumInputBytes,
      maximumSizeLabel: "1 MiB",
    }),
    readH05EvidenceInputFile({
      workspaceRoot,
      argument: dataPlaneArgument,
      label: "data-plane",
      maximumBytes: maximumInputBytes,
      maximumSizeLabel: "1 MiB",
    }),
    readH05EvidenceInputFile({
      workspaceRoot,
      argument: controlAfterArgument,
      label: "control-after",
      maximumBytes: maximumInputBytes,
      maximumSizeLabel: "1 MiB",
    }),
    resolveH05EvidenceOutputPath({
      workspaceRoot,
      argument: outputArgument,
      label: "trace evidence",
    }),
  ]);
await assertNewEvidencePath(outputPath);

const controlPlaneBefore = decodeH05ControlPlaneEvidenceJson(controlBeforeJson);
if (!controlPlaneBefore.ok) throw new Error(controlPlaneBefore.message);
const dataPlane = decodeH05DataPlaneEvidenceJson(dataPlaneJson);
if (!dataPlane.ok) throw new Error(dataPlane.message);
const controlPlaneAfter = decodeH05ControlPlaneEvidenceJson(controlAfterJson);
if (!controlPlaneAfter.ok) throw new Error(controlPlaneAfter.message);

const source = readH05SourceEvidence();
if (
  controlPlaneBefore.value.source.commit !== source.commit ||
  controlPlaneBefore.value.source.wranglerVersion !== source.wranglerVersion ||
  dataPlane.value.source.commit !== source.commit ||
  controlPlaneAfter.value.source.commit !== source.commit ||
  controlPlaneAfter.value.source.wranglerVersion !== source.wranglerVersion
) {
  throw new Error(
    "H05 trace evidence inputs do not match the current clean source evidence.",
  );
}

const api = createH05CloudflareTelemetryApi({ apiToken });
const evidence = await collectH05TraceEvidence({
  accountId,
  api,
  controlPlaneBefore: controlPlaneBefore.value,
  dataPlane: dataPlane.value,
  controlPlaneAfter: controlPlaneAfter.value,
});
const serialized = serializeH05TraceEvidence(evidence);
const verified = decodeH05TraceEvidenceJson(serialized);
if (!verified.ok) throw new Error(verified.message);
assertH05SourceEvidenceUnchanged(source);
await writeNewAtomicEvidenceFile(outputPath, serialized);
console.log(
  `Collected stable H05 trace evidence for ${evidence.run.deploymentId}; retained 15 domain-hashed traces and no raw telemetry payloads.`,
);
