import { join, resolve } from "node:path";

import {
  PROBE_ACTIVE_CAMPAIGN_MATRIX_V1,
  PROBE_POSTGRES_HYPERDRIVE_MATRIX_V1,
} from "../src/matrix";
import {
  PROBE_DEFAULT_REQUEST_TIMEOUT_MS,
  ProbeRunnerError,
  reconcileProbeCampaignForAbortV1,
  resumeProbeCampaignPurgeV1,
  runProbeCampaignV1,
  runProbeCampaignSmokeV1,
  type ProbeRunnerTransport,
} from "../src/runner";
import {
  createFileProbeCheckpointStore,
  ProbeFileError,
  probeEvidenceArtifactPaths,
  readProbeEvidenceArtifacts,
  writeProbeEvidenceArtifacts,
} from "./probeFiles";

const mode = process.argv[2] ?? "run";
if (
  mode !== "run" &&
  mode !== "smoke" &&
  mode !== "abort" &&
  mode !== "purge"
) {
  console.error("Usage: runProbeMatrix.ts run|smoke|abort|purge");
  process.exit(1);
}

const origin = process.env.RUNTIME_TOPOLOGY_PROBE_ORIGIN;
const token = process.env.RUNTIME_TOPOLOGY_PROBE_TOKEN;
if (origin === undefined || token === undefined || token.length === 0) {
  console.error(
    "RUNTIME_TOPOLOGY_PROBE_ORIGIN and RUNTIME_TOPOLOGY_PROBE_TOKEN are required.",
  );
  process.exit(1);
}

const manifest = process.env.RUNTIME_TOPOLOGY_PROBE_ARM === "postgres"
  ? PROBE_POSTGRES_HYPERDRIVE_MATRIX_V1
  : PROBE_ACTIVE_CAMPAIGN_MATRIX_V1;
const campaignId = manifest.campaignId;
const stateDirectory = resolve(
  process.env.RUNTIME_TOPOLOGY_PROBE_STATE_DIR ?? ".probe-state",
);
const outputDirectory = resolve(
  process.env.RUNTIME_TOPOLOGY_PROBE_OUTPUT_DIR ?? ".probe-output",
);
const requestTimeoutMs = Number(
  process.env.RUNTIME_TOPOLOGY_PROBE_REQUEST_TIMEOUT_MS ??
    PROBE_DEFAULT_REQUEST_TIMEOUT_MS,
);
const productionPurgeBatchSize = 4;
const productionMaxPurgeControlSteps = 256;
const checkpoint = createFileProbeCheckpointStore(
  join(stateDirectory, `${campaignId}.json`),
);
const transport: ProbeRunnerTransport = {
  origin,
  authorization: `Bearer ${token}`,
  fetch: async request => await fetch(request),
  now: () => performance.now(),
};

try {
  if (mode === "purge") {
    const artifacts = await readProbeEvidenceArtifacts(
      outputDirectory,
      campaignId,
    );
    const paths = probeEvidenceArtifactPaths(outputDirectory, campaignId);
    if (
      artifacts.raw.target.kind !== "cloudflare-production" ||
      artifacts.raw.campaign.evidence === null
    ) {
      throw new ProbeFileError({
        operation: "verify",
        path: paths.raw,
        cause: "purge requires production evidence with a durable seal",
      });
    }
    const outcome = await resumeProbeCampaignPurgeV1({
      campaignId,
      expectedSeal: {
        manifestSha256: artifacts.raw.campaign.manifestSha256,
        evidence: artifacts.raw.campaign.evidence,
      },
      transport,
      requestTimeoutMs,
      purgeBatchSize: productionPurgeBatchSize,
      maxPurgeControlSteps: productionMaxPurgeControlSteps,
    });
    console.log(JSON.stringify({
      campaignId,
      operation: "purge-resume",
      state: outcome.state,
      progress: outcome.progress,
    }, null, 2));
  } else if (mode === "smoke") {
    const outcome = await runProbeCampaignSmokeV1({
      manifest,
      transport,
      requestTimeoutMs,
      checkpoint,
    });
    const failed = outcome.samples.filter(sample => sample.state === "failed");
    if (failed.length > 0) {
      throw new ProbeRunnerError({
        stage: "sample",
        retryable: false,
        cause: {
          code: "production-smoke-scenario-failed",
          samples: failed,
        },
      });
    }
    console.log(JSON.stringify({
      campaignId,
      operation: "smoke",
      campaignState: outcome.campaign.state,
      samples: outcome.samples,
    }, null, 2));
  } else {
    if (mode === "abort") {
      await reconcileProbeCampaignForAbortV1({
        manifest,
        transport,
        checkpoint,
        requestTimeoutMs,
      });
    }
    const paths = probeEvidenceArtifactPaths(outputDirectory, campaignId);
    const outcome = await runProbeCampaignV1({
      manifest,
      target: {
        kind: "cloudflare-production",
        compatibilityDate: "2026-06-14",
      },
      transport,
      requestTimeoutMs,
      checkpoint,
      purgeBatchSize: productionPurgeBatchSize,
      maxPurgeControlSteps: productionMaxPurgeControlSteps,
      persistEvidence: async (raw, summary) => {
        return await writeProbeEvidenceArtifacts(
          outputDirectory,
          campaignId,
          raw,
          summary,
        );
      },
    });
    console.log(JSON.stringify({
      campaignId,
      operation: mode,
      rawArtifact: paths.raw,
      summaryArtifact: paths.summary,
      integrity: outcome.summary.integrity,
      purgeState: outcome.purgedCampaign.state,
    }, null, 2));
  }
} catch (cause) {
  if (cause instanceof ProbeRunnerError) {
    failRunner(cause);
  } else if (cause instanceof ProbeFileError) {
    console.error(
      `Probe file ${cause.operation} failed for ${cause.path}. No cleanup was started by this command.`,
    );
  } else {
    console.error("Runtime topology probe failed at an unexpected local boundary.");
  }
  process.exit(1);
}

function failRunner(error: ProbeRunnerError): never {
  console.error(
    `Runtime topology probe failed at ${error.stage}; retryable=${String(error.retryable)}.`,
  );
  console.error(`Failure cause: ${probeFailureCauseSummary(error.cause)}`);
  process.exit(1);
}

function probeFailureCauseSummary(cause: unknown): string {
  if (cause instanceof Error) {
    return JSON.stringify({ name: cause.name });
  }
  if (
    cause === null ||
    typeof cause === "number" ||
    typeof cause === "boolean"
  ) {
    return JSON.stringify(cause);
  }
  if (typeof cause === "object" && cause !== null) {
    const record = cause as Record<string, unknown>;
    const safe = Object.fromEntries(
      ["code", "retryable", "stage", "kind", "status"].flatMap(key =>
        typeof record[key] === "string" || typeof record[key] === "boolean" ||
            typeof record[key] === "number"
          ? [[key, record[key]]]
          : []
      ),
    );
    if (Object.keys(safe).length > 0) return JSON.stringify(safe);
  }
  return typeof cause === "string"
    ? "[string cause redacted]"
    : "[structured cause redacted]";
}
