import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { argv, env } from "node:process";

import { decodeH05ControlPlaneEvidenceJson } from "../h05/controlPlaneEvidence";
import {
  decodeH05ProbeTeardownEvidenceJson,
  serializeH05ProbeTeardownEvidence,
  validateH05ProbeTeardownDependencies,
} from "../h05/probeTeardownEvidence";
import {
  decodeH05DataPlaneEvidenceJson,
  h05ProbeWorkerName,
} from "../h05/receipt";
import { createH05CloudflareProbeTeardownApi } from "./cloudflareProbeTeardownApi";
import { commandOutput } from "./commandOutput";
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
import { collectH05ProbeTeardownEvidence } from "./h05ProbeTeardownCollector";
import {
  assertH05SourceEvidenceUnchanged,
  readH05SourceEvidence,
} from "./h05SourceEvidence";

const maximumInputBytes = 1024 * 1024;
const dataPlaneArgument = argv[2];
const controlAfterArgument = argv[3];
const outputArgument = argv[4];
if (
  dataPlaneArgument === undefined ||
  controlAfterArgument === undefined ||
  outputArgument === undefined ||
  argv.length !== 5
) {
  throw new Error(
    "Usage: pnpm collect:h05-probe-teardown-evidence <data-plane.json> <control-after.json> <outside-worktree-output.json>",
  );
}

if (env.FLAREX_H05_ALLOW_PROBE_DELETE !== h05ProbeWorkerName) {
  throw new Error(
    `FLAREX_H05_ALLOW_PROBE_DELETE=${h05ProbeWorkerName} is required for the destructive H05 teardown step.`,
  );
}
const apiToken = requiredUntrimmedEnvironmentValue(
  env.FLAREX_H05_TEARDOWN_API_TOKEN,
  "FLAREX_H05_TEARDOWN_API_TOKEN",
);
const accountId = requiredEnvironmentValue(
  env.CLOUDFLARE_ACCOUNT_ID,
  "CLOUDFLARE_ACCOUNT_ID",
);
const workspaceRoot = await realpath(
  resolve(commandOutput("git", ["rev-parse", "--show-toplevel"])),
);
const [dataPlaneJson, controlAfterJson, outputPath] = await Promise.all([
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
    label: "probe teardown evidence",
  }),
]);
await assertNewEvidencePath(outputPath);

const dataPlane = decodeH05DataPlaneEvidenceJson(dataPlaneJson);
if (!dataPlane.ok) throw new Error(dataPlane.message);
const controlPlaneAfter = decodeH05ControlPlaneEvidenceJson(controlAfterJson);
if (!controlPlaneAfter.ok) throw new Error(controlPlaneAfter.message);
const dependencyCheck = validateH05ProbeTeardownDependencies(
  dataPlane.value,
  controlPlaneAfter.value,
);
if (!dependencyCheck.ok) throw new Error(dependencyCheck.message);

const source = readH05SourceEvidence();
if (
  dataPlane.value.source.commit !== source.commit ||
  controlPlaneAfter.value.source.commit !== source.commit ||
  controlPlaneAfter.value.source.wranglerVersion !== source.wranglerVersion
) {
  throw new Error(
    "H05 probe teardown inputs do not match the current clean source evidence.",
  );
}

const api = createH05CloudflareProbeTeardownApi({
  accountId,
  apiToken,
  probePublicOrigin: controlPlaneAfter.value.probe.publicOrigin,
  runId: dataPlane.value.run.runId,
});
const evidence = await collectH05ProbeTeardownEvidence({
  accountId,
  api,
  controlPlaneAfter: controlPlaneAfter.value,
  dataPlane: dataPlane.value,
});
const serialized = serializeH05ProbeTeardownEvidence(evidence);
const verified = decodeH05ProbeTeardownEvidenceJson(serialized);
if (!verified.ok) throw new Error(verified.message);
assertH05SourceEvidenceUnchanged(source);
await writeNewAtomicEvidenceFile(outputPath, serialized);
console.log(
  `Collected H05 teardown evidence for ${evidence.run.deploymentId}; the fixed disposable probe is absent from both authenticated script lookup and its public run path.`,
);
