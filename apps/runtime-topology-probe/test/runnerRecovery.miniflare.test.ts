import { describe, expect, it } from "vitest";

import { ProbeCampaignManifestV1Schema } from "../src/campaignProtocol";
import {
  probeEvidencePersistenceReceiptV1,
  ProbeEvidencePersistenceReceiptV1Schema,
} from "../src/evidenceProtocol";
import {
  PROBE_CAMPAIGN_ROUTE,
  PROBE_CAMPAIGN_STATUS_ROUTE,
  PROBE_EVIDENCE_PAGE_ROUTE,
  PROBE_EXTERNAL_COMPLETION_ROUTE,
  PROBE_SAMPLE_ROUTE,
} from "../src/gateway";
import {
  ProbeCampaignIdSchema,
  ProbeOrdinalSchema,
  probeRunActorId,
} from "../src/identity";
import { PROBE_LOCAL_REHEARSAL_MATRIX_V1 } from "../src/matrix";
import {
  PROBE_PROTOCOL_VERSION_V1,
  ProbeDurationMsSchema,
} from "../src/protocol";
import {
  decodeProbeExternalCompletionReceiptV1OrNull,
  decodeProbeRunEvidencePageReceiptV1OrNull,
  ProbePublicSampleRequestV1Schema,
} from "../src/runProtocol";
import {
  createInMemoryProbeCheckpointStore,
  ProbeRunnerCheckpointV1Schema,
  ProbeRunnerError,
  runProbeCampaignV1,
  type ProbeRunnerTransport,
} from "../src/runner";
import {
  createRuntimeProbeHarness,
  PROBE_TEST_AUTHORIZATION,
  type RuntimeProbeHarness,
} from "./runtimeHarness";

describe.sequential("P07B runner recovery", () => {
  it("retries a campaign registration whose body stream fails after headers", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const manifest = singleRunManifest(
        "p07b_runner_registration_body_retry",
        "local_01_edge",
      );
      const checkpoint = createInMemoryProbeCheckpointStore();
      let failNextBody = true;
      const first = await rejectedRunner(
        runProbeCampaignV1({
          manifest,
          target: localTarget,
          checkpoint,
          persistEvidence: persistEvidenceInMemory,
          transport: harnessTransport(harness, request => {
            if (
              failNextBody &&
              new URL(request.url).pathname === PROBE_CAMPAIGN_ROUTE
            ) {
              failNextBody = false;
              return failedBodyAfterDispatch(harness, request);
            }
            return undefined;
          }),
        }),
      );
      expect(first).toMatchObject({
        stage: "campaign-registration",
        retryable: true,
      });
      expect(await campaignState(harness, manifest.campaignId)).toBe("running");

      const resumed = await runProbeCampaignV1({
        manifest,
        target: localTarget,
        checkpoint,
        persistEvidence: persistEvidenceInMemory,
        transport: harnessTransport(harness),
      });
      expect(resumed.summary.integrity.publishable).toBe(true);
      expect(resumed.purgedCampaign.state).toBe("purged");
    } finally {
      await harness.dispose();
    }
  }, 90_000);

  it("preserves a retryable sample stage when its response body stream fails", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const manifest = singleRunManifest(
        "p07b_runner_sample_body_retry",
        "local_01_edge",
      );
      const checkpoint = createInMemoryProbeCheckpointStore();
      let failNextBody = true;
      const first = await rejectedRunner(
        runProbeCampaignV1({
          manifest,
          target: localTarget,
          checkpoint,
          persistEvidence: persistEvidenceInMemory,
          transport: harnessTransport(harness, request => {
            if (
              failNextBody &&
              new URL(request.url).pathname === PROBE_SAMPLE_ROUTE
            ) {
              failNextBody = false;
              return failedBodyAfterDispatch(harness, request);
            }
            return undefined;
          }),
        }),
      );
      expect(first).toMatchObject({
        stage: "sample",
        retryable: true,
      });
      expect(await campaignState(harness, manifest.campaignId)).toBe("running");

      const resumed = await runProbeCampaignV1({
        manifest,
        target: localTarget,
        checkpoint,
        persistEvidence: persistEvidenceInMemory,
        transport: harnessTransport(harness),
      });
      expect(resumed.summary.integrity).toMatchObject({
        publishable: false,
        externalDurationMissingSamples: 1,
      });
      expect(resumed.purgedCampaign.state).toBe("purged");
    } finally {
      await harness.dispose();
    }
  }, 90_000);

  it("leaves an unclaimed transport failure running for an exact retry", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const manifest = singleRunManifest(
        "p07b_runner_preclaim_retry",
        "local_01_edge",
      );
      const checkpoint = createInMemoryProbeCheckpointStore();
      let rejectNextSample = true;
      const first = await rejectedRunner(
        runProbeCampaignV1({
          manifest,
          target: localTarget,
          checkpoint,
          persistEvidence: persistEvidenceInMemory,
          transport: harnessTransport(harness, request => {
            if (
              rejectNextSample &&
              new URL(request.url).pathname === PROBE_SAMPLE_ROUTE
            ) {
              rejectNextSample = false;
              return Promise.reject(new Error("synthetic pre-claim outage"));
            }
            return undefined;
          }),
        }),
      );
      expect(first).toMatchObject({
        stage: "sample",
        retryable: true,
      });
      expect(await campaignState(harness, manifest.campaignId)).toBe("running");
      expect((await checkpoint.load(manifest.campaignId)).externalCompletions)
        .toHaveLength(0);

      const resumed = await runProbeCampaignV1({
        manifest,
        target: localTarget,
        checkpoint,
        persistEvidence: persistEvidenceInMemory,
        transport: harnessTransport(harness),
      });
      expect(resumed.summary.integrity.publishable).toBe(true);
      expect(resumed.purgedCampaign.state).toBe("purged");
    } finally {
      await harness.dispose();
    }
  }, 90_000);

  it("replays a checkpointed external completion before continuing", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const manifest = singleRunManifest(
        "p07b_runner_external_ack_retry",
        "local_01_edge",
      );
      const checkpoint = createInMemoryProbeCheckpointStore();
      let rejectNextCompletion = true;
      const first = await rejectedRunner(
        runProbeCampaignV1({
          manifest,
          target: localTarget,
          checkpoint,
          persistEvidence: persistEvidenceInMemory,
          transport: harnessTransport(harness, request => {
            if (
              rejectNextCompletion &&
              new URL(request.url).pathname === PROBE_EXTERNAL_COMPLETION_ROUTE
            ) {
              rejectNextCompletion = false;
              return Promise.reject(new Error("synthetic ack outage"));
            }
            return undefined;
          }),
        }),
      );
      expect(first).toMatchObject({
        stage: "external-completion",
        retryable: true,
      });
      expect(await campaignState(harness, manifest.campaignId)).toBe("running");
      expect((await checkpoint.load(manifest.campaignId)).externalCompletions)
        .toHaveLength(1);

      const resumed = await runProbeCampaignV1({
        manifest,
        target: localTarget,
        checkpoint,
        persistEvidence: persistEvidenceInMemory,
        transport: harnessTransport(harness),
      });
      expect(resumed.summary.integrity).toMatchObject({
        publishable: true,
        externalDurationMissingSamples: 0,
      });
      expect(resumed.purgedCampaign.state).toBe("purged");
    } finally {
      await harness.dispose();
    }
  }, 90_000);

  it("keeps a controlled scenario error as publishable measurement evidence", async () => {
    const harness = await createRuntimeProbeHarness({ workerLoader: false });
    try {
      const manifest = singleRunManifest(
        "p07b_runner_controlled_error",
        "local_03_direct_stable",
      );
      const result = await runProbeCampaignV1({
        manifest,
        target: localTarget,
        checkpoint: createInMemoryProbeCheckpointStore(),
        persistEvidence: persistEvidenceInMemory,
        transport: harnessTransport(harness),
      });
      const run = manifest.runs[0];
      if (run === undefined) throw new Error("controlled error run is missing");
      expect(result.summary.integrity).toMatchObject({
        publishable: true,
        failedScenarioSamples: run.warmupRepetitions + run.repetitions,
      });
      expect(result.raw.evidence.every(record =>
        record.kind === "observed" &&
        record.result.sample.outcome.kind === "error"
      )).toBe(true);
    } finally {
      await harness.dispose();
    }
  }, 90_000);

  it("does not overclaim when a resumed run has no free durable capacity", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const manifest = singleRunManifest(
        "p07b_runner_outstanding_resume",
        "local_01_edge",
      );
      const registration = await dispatchJson(
        harness,
        PROBE_CAMPAIGN_ROUTE,
        manifest,
      );
      expect(registration.status).toBe(201);
      const run = manifest.runs[0];
      if (run === undefined) throw new Error("outstanding run is missing");
      const bindings = await harness.bindings();
      const claim = await bindings.PROBE_RUNS.getByName(
        probeRunActorId(run.runId),
      ).claim(ProbePublicSampleRequestV1Schema.make({
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        runId: run.runId,
        sampleOrdinal: ProbeOrdinalSchema.make(0),
      }));
      expect(claim.kind).toBe("claimed");

      const resumed = await runProbeCampaignV1({
        manifest,
        target: localTarget,
        checkpoint: createInMemoryProbeCheckpointStore(),
        persistEvidence: persistEvidenceInMemory,
        transport: harnessTransport(harness),
      });
      expect(resumed.summary.integrity).toMatchObject({
        publishable: false,
        observedSamples: 0,
        abandonedSamples: 1,
        notStartedSamples:
          run.warmupRepetitions + run.repetitions - 1,
      });
      expect(resumed.purgedCampaign.state).toBe("purged");
    } finally {
      await harness.dispose();
    }
  }, 90_000);

  it("rejects a schema-valid external completion receipt for another duration", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const manifest = singleRunManifest(
        "p07b_runner_completion_binding",
        "local_01_edge",
      );
      const checkpoint = createInMemoryProbeCheckpointStore();
      let tamperNextCompletion = true;
      const first = await rejectedRunner(
        runProbeCampaignV1({
          manifest,
          target: localTarget,
          checkpoint,
          persistEvidence: persistEvidenceInMemory,
          transport: harnessTransport(harness, request => {
            if (
              tamperNextCompletion &&
              new URL(request.url).pathname === PROBE_EXTERNAL_COMPLETION_ROUTE
            ) {
              tamperNextCompletion = false;
              return tamperedExternalCompletionResponse(harness, request);
            }
            return undefined;
          }),
        }),
      );
      expect(first).toMatchObject({
        stage: "external-completion",
        retryable: false,
      });
      expect(await campaignState(harness, manifest.campaignId)).toBe("running");

      const resumed = await runProbeCampaignV1({
        manifest,
        target: localTarget,
        checkpoint,
        persistEvidence: persistEvidenceInMemory,
        transport: harnessTransport(harness),
      });
      expect(resumed.summary.integrity.publishable).toBe(true);
      expect(resumed.purgedCampaign.state).toBe("purged");
    } finally {
      await harness.dispose();
    }
  }, 90_000);

  it("rejects a stalled evidence cursor before accumulation or purge", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const manifest = singleRunManifest(
        "p07b_runner_page_binding",
        "local_01_edge",
      );
      const checkpoint = createInMemoryProbeCheckpointStore();
      let tamperNextPage = true;
      const first = await rejectedRunner(
        runProbeCampaignV1({
          manifest,
          target: localTarget,
          checkpoint,
          persistEvidence: persistEvidenceInMemory,
          transport: harnessTransport(harness, request => {
            if (
              tamperNextPage &&
              new URL(request.url).pathname === PROBE_EVIDENCE_PAGE_ROUTE
            ) {
              tamperNextPage = false;
              return stalledEvidencePageResponse(harness, request);
            }
            return undefined;
          }),
        }),
      );
      expect(first).toMatchObject({
        stage: "evidence",
        retryable: false,
      });
      expect(await campaignState(harness, manifest.campaignId)).toBe(
        "evidence-sealed",
      );

      const resumed = await runProbeCampaignV1({
        manifest,
        target: localTarget,
        checkpoint,
        persistEvidence: persistEvidenceInMemory,
        transport: harnessTransport(harness),
      });
      expect(resumed.summary.integrity.publishable).toBe(true);
      expect(resumed.purgedCampaign.state).toBe("purged");
    } finally {
      await harness.dispose();
    }
  }, 90_000);

  it("keeps sealed evidence live when persistence returns a mismatched receipt", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const manifest = singleRunManifest(
        "p07b_runner_persistence_binding",
        "local_01_edge",
      );
      const checkpoint = createInMemoryProbeCheckpointStore();
      const first = await rejectedRunner(
        runProbeCampaignV1({
          manifest,
          target: localTarget,
          checkpoint,
          transport: harnessTransport(harness),
          persistEvidence: async (raw, summary) => {
            const valid = probeEvidencePersistenceReceiptV1(raw, summary);
            return ProbeEvidencePersistenceReceiptV1Schema.make({
              ...valid,
              rawSha256: "0".repeat(64),
            });
          },
        }),
      );
      expect(first).toMatchObject({
        stage: "evidence",
        retryable: false,
      });
      expect(await campaignState(harness, manifest.campaignId)).toBe(
        "evidence-sealed",
      );

      const resumed = await runProbeCampaignV1({
        manifest,
        target: localTarget,
        checkpoint,
        persistEvidence: persistEvidenceInMemory,
        transport: harnessTransport(harness),
      });
      expect(resumed.purgedCampaign.state).toBe("purged");
    } finally {
      await harness.dispose();
    }
  }, 90_000);

  it("exports external-duration-missing evidence after a checkpoint write crash", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const manifest = singleRunManifest(
        "p07b_runner_checkpoint_write_crash",
        "local_01_edge",
      );
      const delegate = createInMemoryProbeCheckpointStore();
      let rejectNextWrite = true;
      const checkpoint = {
        load: delegate.load,
        async record(
          campaignId: Parameters<typeof delegate.record>[0],
          completion: Parameters<typeof delegate.record>[1],
        ) {
          if (rejectNextWrite) {
            rejectNextWrite = false;
            throw new Error("synthetic checkpoint fsync failure");
          }
          await delegate.record(campaignId, completion);
        },
      };
      const first = await rejectedRunner(
        runProbeCampaignV1({
          manifest,
          target: localTarget,
          checkpoint,
          persistEvidence: persistEvidenceInMemory,
          transport: harnessTransport(harness),
        }),
      );
      expect(first).toMatchObject({
        stage: "checkpoint",
        retryable: true,
      });
      expect(await campaignState(harness, manifest.campaignId)).toBe("running");

      const resumed = await runProbeCampaignV1({
        manifest,
        target: localTarget,
        checkpoint,
        persistEvidence: persistEvidenceInMemory,
        transport: harnessTransport(harness),
      });
      expect(resumed.summary.integrity).toMatchObject({
        publishable: false,
        externalDurationMissingSamples: 1,
      });
      expect(resumed.purgedCampaign.state).toBe("purged");
    } finally {
      await harness.dispose();
    }
  }, 90_000);

  it("classifies a wrong-campaign checkpoint as deterministic corruption", async () => {
    const harness = await createRuntimeProbeHarness();
    try {
      const manifest = singleRunManifest(
        "p07b_runner_checkpoint_identity",
        "local_01_edge",
      );
      const checkpoint = {
        async load() {
          return ProbeRunnerCheckpointV1Schema.make({
            version: 1,
            campaignId: ProbeCampaignIdSchema.make(
              "p07b_runner_checkpoint_other",
            ),
            externalCompletions: [],
          });
        },
        async record() {},
      };
      const result = await rejectedRunner(
        runProbeCampaignV1({
          manifest,
          target: localTarget,
          checkpoint,
          persistEvidence: persistEvidenceInMemory,
          transport: harnessTransport(harness),
        }),
      );
      expect(result).toMatchObject({
        stage: "checkpoint",
        retryable: false,
      });
      expect(await campaignState(harness, manifest.campaignId)).toBe("running");
    } finally {
      await harness.dispose();
    }
  }, 90_000);
});

const localTarget = {
  kind: "local-miniflare",
  compatibilityDate: "2026-06-14",
} as const;

async function persistEvidenceInMemory(
  raw: Parameters<typeof probeEvidencePersistenceReceiptV1>[0],
  summary: Parameters<typeof probeEvidencePersistenceReceiptV1>[1],
) {
  return probeEvidencePersistenceReceiptV1(raw, summary);
}

async function rejectedRunner(
  operation: Promise<unknown>,
): Promise<ProbeRunnerError> {
  try {
    await operation;
  } catch (cause) {
    if (cause instanceof ProbeRunnerError) return cause;
    throw cause;
  }
  throw new Error("expected the probe runner operation to fail");
}

function singleRunManifest(campaignId: string, runId: string) {
  const run = PROBE_LOCAL_REHEARSAL_MATRIX_V1.runs.find(
    candidate => candidate.runId === runId,
  );
  if (run === undefined) throw new Error("runner recovery run is missing");
  return ProbeCampaignManifestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    campaignId: ProbeCampaignIdSchema.make(campaignId),
    collectorConcurrency: 1,
    runs: [run],
  });
}

type RequestInterceptor = (
  request: Request,
) => Promise<Response> | undefined;

function harnessTransport(
  harness: RuntimeProbeHarness,
  intercept?: RequestInterceptor,
): ProbeRunnerTransport {
  return {
    origin: "https://probe.test",
    authorization: PROBE_TEST_AUTHORIZATION,
    fetch: async request => {
      const intercepted = intercept?.(request);
      return intercepted === undefined
        ? await dispatchRequest(harness, request)
        : await intercepted;
    },
    now: () => performance.now(),
  };
}

async function campaignState(
  harness: RuntimeProbeHarness,
  campaignId: string,
): Promise<string | undefined> {
  const response = await harness.mf.dispatchFetch(
    `https://probe.test${PROBE_CAMPAIGN_STATUS_ROUTE}`,
    {
      method: "POST",
      headers: {
        authorization: PROBE_TEST_AUTHORIZATION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        protocolVersion: PROBE_PROTOCOL_VERSION_V1,
        campaignId,
      }),
    },
  );
  const value: unknown = JSON.parse(await response.text());
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    typeof value.status !== "object" ||
    value.status === null ||
    !("state" in value.status) ||
    typeof value.status.state !== "string"
  ) {
    return undefined;
  }
  return value.status.state;
}

async function dispatchJson(
  harness: RuntimeProbeHarness,
  path: string,
  body: unknown,
): Promise<Response> {
  const response = await harness.mf.dispatchFetch(`https://probe.test${path}`, {
    method: "POST",
    headers: {
      authorization: PROBE_TEST_AUTHORIZATION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
  });
}

async function dispatchRequest(
  harness: RuntimeProbeHarness,
  request: Request,
): Promise<Response> {
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
}

async function tamperedExternalCompletionResponse(
  harness: RuntimeProbeHarness,
  request: Request,
): Promise<Response> {
  const response = await dispatchRequest(harness, request);
  const receipt = decodeProbeExternalCompletionReceiptV1OrNull(
    JSON.parse(await response.text()),
  );
  if (receipt === null || receipt.kind !== "completed") {
    throw new Error("expected a completed external receipt fixture");
  }
  const spans = receipt.result.sample.spans.map(span =>
    span.name === "external_request" && span.parentSpanId === null
      ? {
          ...span,
          durationMs: ProbeDurationMsSchema.make(span.durationMs + 1),
        }
      : span
  );
  return jsonResponse({
    ...receipt,
    result: {
      ...receipt.result,
      sample: {
        ...receipt.result.sample,
        spans,
      },
    },
  });
}

async function stalledEvidencePageResponse(
  harness: RuntimeProbeHarness,
  request: Request,
): Promise<Response> {
  const response = await dispatchRequest(harness, request);
  const receipt = decodeProbeRunEvidencePageReceiptV1OrNull(
    JSON.parse(await response.text()),
  );
  if (receipt === null || receipt.kind !== "page") {
    throw new Error("expected an evidence page fixture");
  }
  return jsonResponse({
    ...receipt,
    nextCursor: ProbeOrdinalSchema.make(0),
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function failedBodyAfterDispatch(
  harness: RuntimeProbeHarness,
  request: Request,
): Promise<Response> {
  const response = await dispatchRequest(harness, request);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("synthetic response body stream failure"));
    },
  });
  return new Response(body, {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
  });
}
