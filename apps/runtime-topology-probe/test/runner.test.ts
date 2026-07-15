import { describe, expect, it } from "vitest";

import { probeEvidencePersistenceReceiptV1 } from "../src/evidenceProtocol";
import { PROBE_LOCAL_REHEARSAL_MATRIX_V1 } from "../src/matrix";
import {
  createInMemoryProbeCheckpointStore,
  PROBE_MAX_RUNNER_RESPONSE_BYTES,
  runProbeCampaignV1,
} from "../src/runner";

const localTarget = {
  kind: "local-miniflare",
  compatibilityDate: "2026-06-14",
} as const;

describe("probe matrix runner errors", () => {
  it("preserves the failing transport operation as the error stage", async () => {
    await expect(runProbeCampaignV1({
      manifest: PROBE_LOCAL_REHEARSAL_MATRIX_V1,
      target: localTarget,
      transport: {
        origin: "https://probe.test",
        authorization: "Bearer test-capability",
        fetch: async () => await Promise.reject(new Error("offline")),
        now: () => performance.now(),
      },
      checkpoint: createInMemoryProbeCheckpointStore(),
      persistEvidence: async (raw, summary) =>
        probeEvidencePersistenceReceiptV1(raw, summary),
    })).rejects.toMatchObject({
      _tag: "ProbeRunnerError",
      stage: "campaign-registration",
      retryable: true,
    });
  });

  it("aborts and rejects a transport request at its configured deadline", async () => {
    let observedRequest: Request | undefined;
    await expect(runProbeCampaignV1({
      manifest: PROBE_LOCAL_REHEARSAL_MATRIX_V1,
      target: localTarget,
      transport: {
        origin: "https://probe.test",
        authorization: "Bearer test-capability",
        fetch: request => {
          observedRequest = request;
          return new Promise<Response>(() => {});
        },
        now: () => performance.now(),
      },
      checkpoint: createInMemoryProbeCheckpointStore(),
      requestTimeoutMs: 10,
      persistEvidence: async (raw, summary) =>
        probeEvidencePersistenceReceiptV1(raw, summary),
    })).rejects.toMatchObject({
      _tag: "ProbeRunnerError",
      stage: "campaign-registration",
      retryable: true,
      cause: {
        code: "request-timeout",
        timeoutMs: 10,
      },
    });
    expect(observedRequest?.signal.aborted).toBe(true);
  });

  it("keeps the request deadline active while consuming the response body", async () => {
    let observedRequest: Request | undefined;
    await expect(runProbeCampaignV1({
      manifest: PROBE_LOCAL_REHEARSAL_MATRIX_V1,
      target: localTarget,
      transport: {
        origin: "https://probe.test",
        authorization: "Bearer test-capability",
        fetch: async request => {
          observedRequest = request;
          return new Response(new ReadableStream<Uint8Array>({
            start() {},
          }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        },
        now: () => performance.now(),
      },
      checkpoint: createInMemoryProbeCheckpointStore(),
      requestTimeoutMs: 10,
      persistEvidence: async (raw, summary) =>
        probeEvidencePersistenceReceiptV1(raw, summary),
    })).rejects.toMatchObject({
      _tag: "ProbeRunnerError",
      stage: "campaign-registration",
      retryable: true,
      cause: {
        code: "request-timeout",
        timeoutMs: 10,
      },
    });
    expect(observedRequest?.signal.aborted).toBe(true);
  });

  it("rejects and cancels a response body above the runner byte ceiling", async () => {
    let bodyCancelled = false;
    await expect(runProbeCampaignV1({
      manifest: PROBE_LOCAL_REHEARSAL_MATRIX_V1,
      target: localTarget,
      transport: {
        origin: "https://probe.test",
        authorization: "Bearer test-capability",
        fetch: async () => new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new Uint8Array(PROBE_MAX_RUNNER_RESPONSE_BYTES + 1),
            );
          },
          cancel() {
            bodyCancelled = true;
          },
        }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
        now: () => performance.now(),
      },
      checkpoint: createInMemoryProbeCheckpointStore(),
      persistEvidence: async (raw, summary) =>
        probeEvidencePersistenceReceiptV1(raw, summary),
    })).rejects.toMatchObject({
      _tag: "ProbeRunnerError",
      stage: "campaign-registration",
      retryable: false,
      cause: {
        code: "response-too-large",
        maxResponseBytes: PROBE_MAX_RUNNER_RESPONSE_BYTES,
      },
    });
    expect(bodyCancelled).toBe(true);
  });
});
