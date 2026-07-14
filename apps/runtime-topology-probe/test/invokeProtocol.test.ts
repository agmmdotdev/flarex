import { describe, expect, it } from "vitest";

import { probeSyntheticCommitSeq } from "../src/commitProtocol";
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
  decodeProbeInvokeFacetRequestV1Effect,
  decodeProbeInvokeFacetWorkerResponseV1Effect,
  probeInvokeJournalSealDigest,
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
    const response = {
      ...request,
      payload: undefined,
      payloadBytes: request.payload.length,
      syntheticRevision: 0,
      mockReadDurationMs: 1,
      journalDurationMs: 2,
      sealDigest,
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
    const { payload: _payload, ...identity } = request;
    const facet = {
      ...identity,
      payloadBytes: request.payload.length,
      syntheticRevision: 2,
      mockReadDurationMs: 1,
      journalDurationMs: 2,
      sealDigest,
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
      sessionMockFinishDurationMs: 5,
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
});

function invokeRequest(
  sampleOrdinalValue = 0,
  runIdValue = "p05_invoke_protocol",
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
    scenario: "full_invoke",
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
