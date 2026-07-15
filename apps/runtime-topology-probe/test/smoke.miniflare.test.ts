import { describe, expect, it } from "vitest";

import {
  decodeProbeCampaignControlReceiptV1OrNull,
  ProbeCampaignControlReceiptV1Schema,
  ProbeCampaignManifestV1Schema,
} from "../src/campaignProtocol";
import { probeEvidencePersistenceReceiptV1 } from "../src/evidenceProtocol";
import {
  PROBE_CAMPAIGN_RECONCILE_ROUTE,
  PROBE_CAMPAIGN_PURGE_ROUTE,
  PROBE_CAMPAIGN_STATUS_ROUTE,
  PROBE_EXTERNAL_COMPLETION_ROUTE,
  PROBE_SAMPLE_ROUTE,
} from "../src/gateway";
import { ProbeCampaignIdSchema } from "../src/identity";
import { PROBE_LOCAL_REHEARSAL_MATRIX_V1 } from "../src/matrix";
import { PROBE_PROTOCOL_VERSION_V1 } from "../src/protocol";
import {
  createInMemoryProbeCheckpointStore,
  reconcileProbeCampaignForAbortV1,
  runProbeCampaignSmokeV1,
  runProbeCampaignV1,
  type ProbeRunnerTransport,
} from "../src/runner";
import {
  createRuntimeProbeHarness,
  createRuntimeProbeHarnessWithoutRuns,
  PROBE_TEST_AUTHORIZATION,
  removeRuntimeProbePersistPath,
  type RuntimeProbeHarness,
} from "./runtimeHarness";

const localTarget = {
  kind: "local-miniflare",
  compatibilityDate: "2026-06-14",
} as const;

describe.sequential("P08 resumable production flow", () => {
  it("smokes every scenario once and resumes the same campaign to completion", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const checkpoint = createInMemoryProbeCheckpointStore();
      let firstPurgeRequest: number | undefined;
      let gatewayRequests = 0;
      let sampleRequests = 0;
      const transport = harnessTransport(harness, request => {
        gatewayRequests += 1;
        const pathname = new URL(request.url).pathname;
        if (
          pathname === PROBE_CAMPAIGN_PURGE_ROUTE &&
          firstPurgeRequest === undefined
        ) {
          firstPurgeRequest = gatewayRequests;
        }
        if (pathname === PROBE_SAMPLE_ROUTE) {
          sampleRequests += 1;
        }
      });

      const smoke = await runProbeCampaignSmokeV1({
        manifest: PROBE_LOCAL_REHEARSAL_MATRIX_V1,
        transport,
        checkpoint,
      });
      expect(smoke.campaign.state).toBe("running");
      expect(smoke.samples).toHaveLength(8);
      expect(new Set(smoke.samples.map(sample => sample.scenario)).size).toBe(8);
      expect(smoke.samples.every(sample => sample.state === "completed"))
        .toBe(true);
      expect(sampleRequests).toBe(8);
      expect(gatewayRequests).toBe(42);
      expect((await checkpoint.load(smoke.campaign.manifest.campaignId))
        .externalCompletions).toHaveLength(8);

      const beforeReplay = gatewayRequests;
      const replay = await runProbeCampaignSmokeV1({
        manifest: PROBE_LOCAL_REHEARSAL_MATRIX_V1,
        transport,
        checkpoint,
      });
      expect(replay.samples).toEqual(smoke.samples);
      expect(sampleRequests).toBe(8);
      expect(gatewayRequests - beforeReplay).toBe(34);

      const beforeCompletion = gatewayRequests;
      const completed = await runProbeCampaignV1({
        manifest: PROBE_LOCAL_REHEARSAL_MATRIX_V1,
        target: localTarget,
        transport,
        checkpoint,
        purgeBatchSize: 4,
        maxPurgeControlSteps: 256,
        persistEvidence: persistEvidenceInMemory,
      });
      expect(completed.summary.integrity).toMatchObject({
        publishable: true,
        plannedSamples: 32,
        observedSamples: 32,
        externalDurationMissingSamples: 0,
        abandonedSamples: 0,
        notStartedSamples: 0,
      });
      expect(completed.purgedCampaign.state).toBe("purged");
      expect(sampleRequests).toBe(32);
      if (firstPurgeRequest === undefined) {
        throw new Error("expected the completed runner to begin purge");
      }
      expect(firstPurgeRequest - beforeCompletion - 1).toBe(95);
      expect(gatewayRequests - firstPurgeRequest + 1).toBe(29);
      expect((await checkpoint.load(completed.raw.campaign.manifest.campaignId))
        .externalCompletions).toHaveLength(32);
    } finally {
      await harness.dispose();
    }
  }, 120_000);

  it("reconciles a stopped smoke before sealing partial evidence and purging", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const manifest = focusedAbortManifest();
      const checkpoint = createInMemoryProbeCheckpointStore();
      const transport = harnessTransport(harness);
      const smoke = await runProbeCampaignSmokeV1({
        manifest,
        transport,
        checkpoint,
      });
      expect(smoke.samples).toHaveLength(1);
      expect(smoke.campaign.state).toBe("running");

      const reconciled = await reconcileProbeCampaignForAbortV1({
        manifest,
        transport,
        checkpoint,
      });
      expect(reconciled.state).toBe("reconciled");

      const aborted = await runProbeCampaignV1({
        manifest,
        target: localTarget,
        transport,
        checkpoint,
        purgeBatchSize: 4,
        maxPurgeControlSteps: 256,
        persistEvidence: persistEvidenceInMemory,
      });
      expect(aborted.summary.integrity).toMatchObject({
        publishable: false,
        plannedSamples: 3,
        observedSamples: 1,
        externalDurationMissingSamples: 0,
        abandonedSamples: 0,
        notStartedSamples: 2,
      });
      expect(aborted.purgedCampaign.state).toBe("purged");
    } finally {
      await harness.dispose();
    }
  }, 90_000);

  it("refuses to create a campaign when abort has no existing target", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const manifest = focusedAbortManifest("p08_abort_requires_existing");
      const observedPaths: string[] = [];
      await expect(reconcileProbeCampaignForAbortV1({
        manifest,
        transport: harnessTransport(harness, request => {
          observedPaths.push(new URL(request.url).pathname);
        }),
        checkpoint: createInMemoryProbeCheckpointStore(),
      })).rejects.toMatchObject({
        stage: "campaign-status",
        retryable: false,
        cause: "campaign-not-found",
      });
      expect(observedPaths).toEqual([PROBE_CAMPAIGN_STATUS_ROUTE]);
    } finally {
      await harness.dispose();
    }
  });

  it("recovers an existing registering campaign after a transient run binding outage", async () => {
    const manifest = focusedAbortManifest("p08_abort_partial_registration");
    const checkpoint = createInMemoryProbeCheckpointStore();
    const interrupted = await createRuntimeProbeHarnessWithoutRuns({
      removePersistPathOnDispose: false,
    });
    const persistPath = interrupted.persistPath;
    let initialFailureProved = false;
    try {
      await expect(runProbeCampaignSmokeV1({
        manifest,
        checkpoint,
        transport: harnessTransport(interrupted),
      })).rejects.toMatchObject({
        stage: "campaign-registration",
        retryable: true,
        cause: {
          code: "registration-incomplete",
          retryable: true,
        },
      });
      initialFailureProved = true;
    } finally {
      await interrupted.dispose();
      if (!initialFailureProved) {
        await removeRuntimeProbePersistPath(persistPath);
      }
    }

    let recovered: RuntimeProbeHarness | undefined;
    try {
      recovered = await createRuntimeProbeHarness({
        persistPath,
        removePersistPathOnDispose: true,
      });
      const transport = harnessTransport(recovered);
      const reconciled = await reconcileProbeCampaignForAbortV1({
        manifest,
        transport,
        checkpoint,
      });
      expect(reconciled.state).toBe("reconciled");

      const aborted = await runProbeCampaignV1({
        manifest,
        target: localTarget,
        transport,
        checkpoint,
        purgeBatchSize: 4,
        maxPurgeControlSteps: 256,
        persistEvidence: persistEvidenceInMemory,
      });
      expect(aborted.summary.integrity).toMatchObject({
        publishable: false,
        plannedSamples: 3,
        observedSamples: 0,
        externalDurationMissingSamples: 0,
        abandonedSamples: 0,
        notStartedSamples: 3,
      });
      expect(aborted.purgedCampaign.state).toBe("purged");
    } finally {
      if (recovered === undefined) {
        await removeRuntimeProbePersistPath(persistPath);
      } else {
        await recovered.dispose();
      }
    }
  }, 90_000);

  it("replays a checkpointed completion before abort reconciliation", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const manifest = focusedAbortManifest("p08_abort_checkpoint_replay");
      const checkpoint = createInMemoryProbeCheckpointStore();
      let rejectNextCompletion = true;
      await expect(runProbeCampaignSmokeV1({
        manifest,
        checkpoint,
        transport: harnessTransport(harness, request => {
          if (
            rejectNextCompletion &&
            new URL(request.url).pathname === PROBE_EXTERNAL_COMPLETION_ROUTE
          ) {
            rejectNextCompletion = false;
            throw new Error("synthetic completion acknowledgement outage");
          }
        }),
      })).rejects.toMatchObject({
        stage: "external-completion",
        retryable: true,
      });
      expect((await checkpoint.load(manifest.campaignId)).externalCompletions)
        .toHaveLength(1);

      const transport = harnessTransport(harness);
      const reconciled = await reconcileProbeCampaignForAbortV1({
        manifest,
        transport,
        checkpoint,
      });
      expect(reconciled.state).toBe("reconciled");

      const aborted = await runProbeCampaignV1({
        manifest,
        target: localTarget,
        transport,
        checkpoint,
        purgeBatchSize: 4,
        maxPurgeControlSteps: 256,
        persistEvidence: persistEvidenceInMemory,
      });
      expect(aborted.summary.integrity).toMatchObject({
        publishable: false,
        observedSamples: 1,
        externalDurationMissingSamples: 0,
        abandonedSamples: 0,
        notStartedSamples: 2,
      });
      expect(aborted.purgedCampaign.state).toBe("purged");
    } finally {
      await harness.dispose();
    }
  }, 90_000);

  it("rejects an abort reconciliation response that remains running", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const manifest = focusedAbortManifest("p08_abort_postcondition");
      const checkpoint = createInMemoryProbeCheckpointStore();
      const baseTransport = harnessTransport(harness);
      await runProbeCampaignSmokeV1({
        manifest,
        transport: baseTransport,
        checkpoint,
      });
      const transport: ProbeRunnerTransport = {
        ...baseTransport,
        fetch: async request => {
          const response = await baseTransport.fetch(request);
          if (
            new URL(request.url).pathname !== PROBE_CAMPAIGN_RECONCILE_ROUTE
          ) {
            return response;
          }
          const raw: unknown = await response.json();
          const receipt = decodeProbeCampaignControlReceiptV1OrNull(raw);
          if (receipt === null || receipt.kind !== "accepted") {
            throw new Error("expected an accepted reconciliation receipt");
          }
          const tampered = ProbeCampaignControlReceiptV1Schema.make({
            ...receipt,
            status: {
              ...receipt.status,
              state: "running",
              progress: {
                ...receipt.status.progress,
                completedReconciliationTasks: 0,
              },
            },
          });
          return new Response(JSON.stringify(tampered), {
            status: response.status,
            headers: { "content-type": "application/json" },
          });
        },
      };

      await expect(reconcileProbeCampaignForAbortV1({
        manifest,
        transport,
        checkpoint,
      })).rejects.toMatchObject({
        stage: "reconciliation",
        retryable: false,
        cause: "abort reconciliation did not reach a terminal pre-evidence state: running",
      });
    } finally {
      await harness.dispose();
    }
  }, 90_000);
});

function focusedAbortManifest(
  campaignId = "p08_abort_recovery",
) {
  const run = PROBE_LOCAL_REHEARSAL_MATRIX_V1.runs.find(
    candidate => candidate.runId === "local_01_edge",
  );
  if (run === undefined) throw new Error("abort smoke run is missing");
  return ProbeCampaignManifestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    campaignId: ProbeCampaignIdSchema.make(campaignId),
    collectorConcurrency: 1,
    runs: [run],
  });
}

async function persistEvidenceInMemory(
  raw: Parameters<typeof probeEvidencePersistenceReceiptV1>[0],
  summary: Parameters<typeof probeEvidencePersistenceReceiptV1>[1],
) {
  return probeEvidencePersistenceReceiptV1(raw, summary);
}

function harnessTransport(
  harness: Pick<RuntimeProbeHarness, "mf">,
  observe?: (request: Request) => void,
): ProbeRunnerTransport {
  return {
    origin: "https://probe.test",
    authorization: PROBE_TEST_AUTHORIZATION,
    fetch: async request => {
      observe?.(request);
      const body = request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.text();
      const response = await harness.mf.dispatchFetch(request.url, {
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
        ...(body === undefined ? {} : { body }),
      });
      return new Response(await response.arrayBuffer(), {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
      });
    },
    now: () => performance.now(),
  };
}
