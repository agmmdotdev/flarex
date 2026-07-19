import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeProbeFacetInvokeRequestV1Effect,
  decodeProbeFacetLifecycleRequestV1Effect,
  decodeProbeFacetLifecycleSessionResponseV1Effect,
  probeFacetJournalSealDigest,
  probeFacetReceiptMatchesRequest,
  probeFacetWorkerCode,
  PROBE_FACET_WORKER_MAIN_MODULE,
  ProbeFacetInvokeRequestV1Schema,
  ProbeFacetSessionResponseV1Schema,
  ProbeFacetWorkerResponseV1Schema,
} from "../src/facetProtocol";
import {
  decodeProbeOrdinalEffect,
  decodeProbeRunIdEffect,
  probeAttemptId,
  probeCodeId,
  probeSampleId,
  probeSessionId,
} from "../src/identity";
import {
  PROBE_PROTOCOL_VERSION_V1,
  ProbeDurationMsSchema,
} from "../src/protocol";

const runId = Effect.runSync(decodeProbeRunIdEffect("p04_protocol"));
const zero = Effect.runSync(decodeProbeOrdinalEffect(0));

describe("Durable Object facet protocol", () => {
  it("binds the invocation to run, session, attempt, and facet code identity", () => {
    const decoded = Effect.runSync(
      decodeProbeFacetInvokeRequestV1Effect(facetRequest()),
    );
    expect(decoded.sessionId).toBe("rtp-session-p04_protocol-0");
    expect(decoded.attemptId).toBe("rtp-attempt-p04_protocol-0-1");
    expect(decoded.codeId).toBe("rtp-code-facet-v2-stable");
  });

  it.each([
    ["cross-run sample", { sampleId: "rtp-sample-other-1" }],
    ["cross-session", { sessionId: "rtp-session-p04_protocol-1" }],
    ["cross-attempt", { attemptId: "rtp-attempt-p04_protocol-1-1" }],
    ["wrong code profile", { codeId: "rtp-code-direct-v2-stable" }],
    ["excess field", { extra: true }],
  ])("rejects %s input", (_, override) => {
    const failure = Effect.runSync(
      Effect.flip(
        decodeProbeFacetInvokeRequestV1Effect({
          ...facetRequest(),
          ...override,
        }),
      ),
    );
    expect(failure.boundary).toBe("invoke-request");
  });

  it("rejects echo journals and accepts the bounded journal maxima", () => {
    const echoFailure = Effect.runSync(
      Effect.flip(
        decodeProbeFacetInvokeRequestV1Effect({
          ...facetRequest({ scenario: "facet_echo", journalEntries: 0 }),
          journalEntries: 1,
        }),
      ),
    );
    const maximum = Effect.runSync(
      decodeProbeFacetInvokeRequestV1Effect(
        facetRequest({
          journalEntries: 256,
          payload: "x".repeat(65_536),
        }),
      ),
    );
    expect(echoFailure.boundary).toBe("invoke-request");
    expect(maximum.journalEntries).toBe(256);
    expect(maximum.payload).toHaveLength(65_536);
  });

  it("computes a host-verifiable seal that changes with content, count, and attempt", async () => {
    const request = ProbeFacetInvokeRequestV1Schema.make(facetRequest());
    const baseline = await probeFacetJournalSealDigest(request);
    const payloadChange = await probeFacetJournalSealDigest(
      ProbeFacetInvokeRequestV1Schema.make(facetRequest({ payload: "xxxxx" })),
    );
    const countChange = await probeFacetJournalSealDigest(
      ProbeFacetInvokeRequestV1Schema.make(
        facetRequest({ journalEntries: 3 }),
      ),
    );
    const attemptChange = await probeFacetJournalSealDigest(
      ProbeFacetInvokeRequestV1Schema.make(facetRequest({ ordinal: 2 })),
    );

    expect(baseline).toBe(
      "2ade5f78c1bbd929048088096c69f288d98b57eb1744fc17a6a9274b5eb5ec4e",
    );
    expect(new Set([baseline, payloadChange, countChange, attemptChange]).size)
      .toBe(4);
  });

  it("correlates worker and session receipts with their exact request", async () => {
    const request = ProbeFacetInvokeRequestV1Schema.make(facetRequest());
    const { payload: _payload, ...identity } = request;
    const receipt = {
      ...identity,
      payloadBytes: request.payload.length,
      journalDurationMs: ProbeDurationMsSchema.make(1),
      sealDigest: await probeFacetJournalSealDigest(request),
    };
    const workerReceipt = ProbeFacetWorkerResponseV1Schema.make(receipt);
    const sessionReceipt = ProbeFacetSessionResponseV1Schema.make({
      ...receipt,
      facetDurationMs: ProbeDurationMsSchema.make(2),
      workerLoaderCallbackRan: true,
      facetStartupCallbackRan: true,
    });

    await expect(
      probeFacetReceiptMatchesRequest(workerReceipt, request),
    ).resolves.toBe(true);
    await expect(
      probeFacetReceiptMatchesRequest(sessionReceipt, request),
    ).resolves.toBe(true);
    await expect(
      probeFacetReceiptMatchesRequest(
        ProbeFacetWorkerResponseV1Schema.make({
          ...receipt,
          payloadBytes: request.payload.length + 1,
        }),
        request,
      ),
    ).resolves.toBe(false);
    await expect(
      probeFacetReceiptMatchesRequest(
        ProbeFacetWorkerResponseV1Schema.make({
          ...receipt,
          sealDigest: "0".repeat(64),
        }),
        request,
      ),
    ).resolves.toBe(false);
  });

  it("keeps lifecycle controls canonical and attempt-bound", () => {
    const request = facetRequest({ scenario: "facet_echo", journalEntries: 0 });
    const decoded = Effect.runSync(
      decodeProbeFacetLifecycleRequestV1Effect({
        protocolVersion: request.protocolVersion,
        runId: request.runId,
        sampleId: request.sampleId,
        sampleOrdinal: request.sampleOrdinal,
        scenario: request.scenario,
        sessionId: request.sessionId,
        sessionMode: request.sessionMode,
        attemptId: request.attemptId,
        codeMode: request.codeMode,
        codeId: request.codeId,
        journalEntries: request.journalEntries,
        operation: "append",
      }),
    );
    expect(decoded.operation).toBe("append");
  });

  it("rejects a lifecycle response with non-canonical journal dimensions", () => {
    const request = facetRequest({ journalEntries: 1 });
    const failure = Effect.runSync(
      Effect.flip(
        decodeProbeFacetLifecycleSessionResponseV1Effect({
          protocolVersion: request.protocolVersion,
          runId: request.runId,
          sampleId: request.sampleId,
          sampleOrdinal: request.sampleOrdinal,
          scenario: request.scenario,
          sessionId: request.sessionId,
          sessionMode: request.sessionMode,
          attemptId: request.attemptId,
          codeMode: request.codeMode,
          codeId: request.codeId,
          journalEntries: request.journalEntries,
          operation: "read",
          value: 0,
          workerLoaderCallbackRan: false,
          facetStartupCallbackRan: false,
        }),
      ),
    );
    expect(failure.boundary).toBe("lifecycle-session-response");
  });

  it("loads fixed facet source with isolated SQLite and no injected capability", () => {
    const code = probeFacetWorkerCode();
    const source = code.modules[PROBE_FACET_WORKER_MAIN_MODULE];
    expect(source).toContain("this.ctx.id.toString() !== value.attemptId");
    expect(source).toContain("payload TEXT NOT NULL");
    expect(source).toContain("await this.ctx.storage.sync()");
    expect(source).not.toContain("probe-session.internal");
    expect(code.env).toBeUndefined();
    expect(code.globalOutbound).toBeNull();
    expect(code.limits).toEqual({ cpuMs: 50, subRequests: 2 });
  });
});

interface FacetRequestOverrides {
  readonly journalEntries?: number;
  readonly ordinal?: number;
  readonly payload?: string;
  readonly scenario?: "facet_echo" | "facet_journal";
}

function facetRequest(overrides: FacetRequestOverrides = {}) {
  const sampleOrdinal = Effect.runSync(
    decodeProbeOrdinalEffect(overrides.ordinal ?? 1),
  );
  const scenario = overrides.scenario ?? "facet_journal";
  return {
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId,
    sampleId: probeSampleId(runId, sampleOrdinal),
    sampleOrdinal,
    scenario,
    sessionId: probeSessionId(runId, zero),
    sessionMode: "reuse-session" as const,
    attemptId: probeAttemptId(runId, zero, sampleOrdinal),
    codeMode: "stable" as const,
    codeId: probeCodeId({ mode: "stable", profile: "facet" }),
    journalEntries: overrides.journalEntries ?? (scenario === "facet_echo" ? 0 : 2),
    payload: overrides.payload ?? "xxxx",
  };
}
