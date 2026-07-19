import { describe, expect, it } from "vitest";

import {
  probeSyntheticCommitSeq,
  ProbeMockReadResponseV1Schema,
  ProbeSyntheticCursorSchema,
} from "../src/commitProtocol";
import {
  decodeProbeOrdinalEffect,
  decodeProbeRunIdEffect,
  probeAttemptId,
  probeCodeId,
  probeSampleId,
  probeScopeId,
  probeSessionId,
} from "../src/identity";
import {
  decodeProbeFullInvokeSessionFailureV1Effect,
  decodeProbeInvokeFacetExecutionRequestV1OrNull,
  decodeProbeInvokeFacetRequestV1Effect,
  decodeProbeInvokeFacetWorkerResponseV1Effect,
  probeFacetCommitIntentDigest,
  probeInvokeFacetReceiptMatchesRequestV1,
  probeInvokeJournalSealDigest,
  probeInvokeResultDigest,
  probeMockReadRequestFromInvoke,
  ProbeInvokeFacetRequestV1Schema,
} from "../src/invokeProtocol";
import { PROBE_PROTOCOL_VERSION_V1 } from "../src/protocol";
import { runEffectTest, runEffectTestSync } from "./effectTest";

describe("P05 full-invoke protocol", () => {
  it("strictly validates the fixed invoke-v1 identity", async () => {
    const request = invokeRequest();
    const decoded = await runEffectTest(
      decodeProbeInvokeFacetRequestV1Effect(request),
    );

    expect(decoded).toEqual(request);
    await expect(
      runEffectTest(
        decodeProbeInvokeFacetRequestV1Effect({
          ...request,
          unexpected: true,
        }),
      ),
    ).rejects.toBeDefined();
    await expect(
      runEffectTest(
        decodeProbeInvokeFacetRequestV1Effect({
          ...request,
          codeId: "rtp-code-facet-v1-stable",
        }),
      ),
    ).rejects.toBeDefined();
  });

  it("seals the exact payload and logical journal shape", async () => {
    const request = invokeRequest();
    const first = await probeInvokeJournalSealDigest(request);
    const repeated = await probeInvokeJournalSealDigest(request);
    const changedPayload = await probeInvokeJournalSealDigest(
      ProbeInvokeFacetRequestV1Schema.make({
        ...request,
        payload: "xxxxx",
      }),
    );
    const changedEntries = await probeInvokeJournalSealDigest(
      ProbeInvokeFacetRequestV1Schema.make({
        ...request,
        journalEntries: 3,
      }),
    );

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(repeated).toBe(first);
    expect(changedPayload).not.toBe(first);
    expect(changedEntries).not.toBe(first);
  });

  it("requires the mock read to attest the pre-commit synthetic revision", async () => {
    const request = invokeRequest();
    const sealDigest = await probeInvokeJournalSealDigest(request);
    const resultDigest = await probeInvokeResultDigest(request, 0);
    const commitIntentDigest = await probeFacetCommitIntentDigest(request, {
      syntheticRevision: ProbeSyntheticCursorSchema.make(0),
      sealDigest,
      resultDigest,
    });
    const response = {
      ...request,
      payload: undefined,
      payloadBytes: request.payload.length,
      syntheticRevision: 0,
      mockReadDurationMs: 1,
      readMode: "bound-capability",
      outboundReadCalls: 1,
      journalDurationMs: 2,
      sealDigest,
      resultDigest,
      commitIntent: {
        protocolVersion: 1,
        snapshotRevision: 0,
        journalEntries: request.journalEntries,
        journalSealDigest: sealDigest,
        resultDigest,
        digest: commitIntentDigest,
      },
    };
    const { payload: _removedPayload, ...wireResponse } = response;
    const decoded = await runEffectTest(
      decodeProbeInvokeFacetWorkerResponseV1Effect(wireResponse),
    );

    expect(decoded.syntheticRevision).toBe(0);
    await expect(
      runEffectTest(
        decodeProbeInvokeFacetWorkerResponseV1Effect({
          ...wireResponse,
          syntheticRevision: 1,
        }),
      ),
    ).rejects.toBeDefined();
  });

  it("strictly carries completed nested observations for a rejected cursor", async () => {
    const request = invokeRequest(2, "p05_invoke_failure");
    const sealDigest = await probeInvokeJournalSealDigest(request);
    const resultDigest = await probeInvokeResultDigest(request, 2);
    const commitIntentDigest = await probeFacetCommitIntentDigest(request, {
      syntheticRevision: 2,
      sealDigest,
      resultDigest,
    });
    const { payload: _payload, ...identity } = request;
    const facet = {
      ...identity,
      payloadBytes: request.payload.length,
      syntheticRevision: 2,
      mockReadDurationMs: 1,
      readMode: "bound-capability",
      outboundReadCalls: 1,
      journalDurationMs: 2,
      sealDigest,
      resultDigest,
      commitIntent: {
        protocolVersion: 1,
        snapshotRevision: 2,
        journalEntries: request.journalEntries,
        journalSealDigest: sealDigest,
        resultDigest,
        digest: commitIntentDigest,
      },
    } as const;
    const finishRequest = { ...identity, sealDigest } as const;
    const sync = {
      protocolVersion: request.protocolVersion,
      runId: request.runId,
      sampleId: request.sampleId,
      sampleOrdinal: request.sampleOrdinal,
      scopeId: request.scopeId,
      scenario: request.scenario,
      commitSeq: request.commitSeq,
      disposition: "gap",
      previousCursor: 0,
      cursor: 0,
      cursorDurationMs: 3,
    } as const;
    const failure = {
      facet,
      facetDurationMs: 4,
      workerLoaderCallbackRan: true,
      facetStartupCallbackRan: true,
      executorHost: "external-worker",
      readCapabilityCalls: 0,
      sessionMockFinishDurationMs: 5,
      snapshotReadDurationMs: null,
      finish: {
        request: finishRequest,
        mockSyncWakeDurationMs: 6,
        sync,
      },
      error: {
        code: "runtime_failure",
        retryable: false,
        stage: "sync_cursor_io",
      },
    } as const;
    const decoded = await runEffectTest(
      decodeProbeFullInvokeSessionFailureV1Effect(failure),
    );

    expect(decoded.finish.sync.disposition).toBe("gap");
    await expect(
      runEffectTest(
        decodeProbeFullInvokeSessionFailureV1Effect({
          ...failure,
          error: { ...failure.error, stage: "gateway_session_rtt" },
        }),
      ),
    ).rejects.toBeDefined();
    await expect(
      runEffectTest(
        decodeProbeFullInvokeSessionFailureV1Effect({
          ...failure,
          finish: {
            ...failure.finish,
            sync: {
              ...sync,
              disposition: "applied",
              previousCursor: 2,
              cursor: 3,
            },
          },
        }),
      ),
    ).rejects.toBeDefined();
  });

  it("requires an exact snapshot and rejects forged facet commit intent", async () => {
    const request = invokeRequest(
      0,
      "p16_facet_intent",
      "facet_executor_invoke",
    );
    const readRequest = probeMockReadRequestFromInvoke(request);
    const snapshot = ProbeMockReadResponseV1Schema.make({
      ...readRequest,
      syntheticRevision: ProbeSyntheticCursorSchema.make(0),
    });
    expect(decodeProbeInvokeFacetExecutionRequestV1OrNull({
      ...request,
      prefetchedRead: snapshot,
    })).not.toBeNull();
    expect(decodeProbeInvokeFacetExecutionRequestV1OrNull({
      ...request,
      prefetchedRead: null,
    })).toBeNull();

    const sealDigest = await probeInvokeJournalSealDigest(request);
    const resultDigest = await probeInvokeResultDigest(request, 0);
    const commitIntentDigest = await probeFacetCommitIntentDigest(request, {
      syntheticRevision: 0,
      sealDigest,
      resultDigest,
    });
    const response = {
      ...request,
      payload: undefined,
      payloadBytes: request.payload.length,
      syntheticRevision: 0,
      mockReadDurationMs: 1,
      readMode: "prefetched-snapshot" as const,
      outboundReadCalls: 0,
      journalDurationMs: 2,
      sealDigest,
      resultDigest,
      commitIntent: {
        protocolVersion: 1,
        snapshotRevision: 0,
        journalEntries: request.journalEntries,
        journalSealDigest: sealDigest,
        resultDigest,
        digest: commitIntentDigest,
      },
    };
    const { payload: _removedPayload, ...wireResponse } = response;
    const decoded = await runEffectTest(
      decodeProbeInvokeFacetWorkerResponseV1Effect(wireResponse),
    );
    expect(await probeInvokeFacetReceiptMatchesRequestV1(decoded, request))
      .toBe(true);
    expect(await probeInvokeFacetReceiptMatchesRequestV1(
      {
        ...decoded,
        commitIntent: { ...decoded.commitIntent, digest: "0".repeat(64) },
      },
      request,
    )).toBe(false);
  });
});

function invokeRequest(
  sampleOrdinalValue = 0,
  runIdValue = "p05_invoke_protocol",
  scenario:
    | "executor_worker_invoke"
    | "facet_executor_invoke"
    | "full_invoke"
    | "session_executor_invoke" = "full_invoke",
) {
  const runId = runEffectTestSync(
    decodeProbeRunIdEffect(runIdValue),
  );
  const sampleOrdinal = runEffectTestSync(
    decodeProbeOrdinalEffect(sampleOrdinalValue),
  );
  return ProbeInvokeFacetRequestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId,
    sampleId: probeSampleId(runId, sampleOrdinal),
    sampleOrdinal,
    scopeId: probeScopeId(runId),
    scenario,
    commitSeq: probeSyntheticCommitSeq(sampleOrdinal),
    sessionId: probeSessionId(runId, sampleOrdinal),
    sessionMode: "new-session",
    attemptId: probeAttemptId(runId, sampleOrdinal, sampleOrdinal),
    codeMode: "stable",
    codeId: probeCodeId({ mode: "stable", profile: "invoke" }),
    journalEntries: 2,
    payload: "xxxx",
  });
}
