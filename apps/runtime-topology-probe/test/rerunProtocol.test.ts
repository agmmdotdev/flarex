import { describe, expect, it } from "vitest";

import {
  decodeProbeOrdinalEffect,
  decodeProbeRunIdEffect,
  probeAttemptId,
  probeCodeId,
  probeSampleId,
  probeScopeId,
  probeSessionId,
} from "../src/identity";
import { PROBE_PROTOCOL_VERSION_V1 } from "../src/protocol";
import {
  decodeProbeRerunFacetResponseV1Effect,
  decodeProbeRerunSessionResponseV1Effect,
  decodeProbeRuntimeRerunRequestV1Effect,
  decodeProbeRuntimeRerunResponseV1Effect,
  decodeProbeSyncRerunReceiptV1Effect,
  decodeProbeSyncRerunRequestV1Effect,
  probeRerunWorkerCode,
  PROBE_RERUN_WORKER_MAIN_MODULE,
} from "../src/rerunProtocol";
import { runEffectTest, runEffectTestSync } from "./effectTest";

describe("P06 sync-rerun protocol", () => {
  it("requires a fresh session, zero reentry depth, and rerun-v1 code", async () => {
    const request = rerunRequest();
    const runtimeRequest = { ...request, reentryDepth: 1 } as const;

    await expect(
      runEffectTest(decodeProbeSyncRerunRequestV1Effect(request)),
    ).resolves.toEqual(request);
    await expect(
      runEffectTest(
        decodeProbeSyncRerunRequestV1Effect({
          ...request,
          sessionMode: "reuse-session",
        }),
      ),
    ).rejects.toBeDefined();
    await expect(
      runEffectTest(decodeProbeRuntimeRerunRequestV1Effect(runtimeRequest)),
    ).resolves.toEqual(runtimeRequest);
    await expect(
      runEffectTest(
        decodeProbeRuntimeRerunRequestV1Effect({
          ...runtimeRequest,
          reentryDepth: 0,
        }),
      ),
    ).rejects.toBeDefined();
    await expect(
      runEffectTest(
        decodeProbeSyncRerunRequestV1Effect({
          ...request,
          reentryDepth: 1,
        }),
      ),
    ).rejects.toBeDefined();
    await expect(
      runEffectTest(
        decodeProbeSyncRerunRequestV1Effect({
          ...request,
          codeId: "rtp-code-invoke-v1-stable",
        }),
      ),
    ).rejects.toBeDefined();
  });

  it("strictly correlates facet, session, runtime, and terminal receipts", async () => {
    const chain = rerunChain();

    await expect(
      runEffectTest(decodeProbeRerunFacetResponseV1Effect(chain.facet)),
    ).resolves.toEqual(chain.facet);
    await expect(
      runEffectTest(decodeProbeRerunSessionResponseV1Effect(chain.session)),
    ).resolves.toEqual(chain.session);
    await expect(
      runEffectTest(decodeProbeRuntimeRerunResponseV1Effect(chain.runtime)),
    ).resolves.toEqual(chain.runtime);
    await expect(
      runEffectTest(decodeProbeSyncRerunReceiptV1Effect(chain.receipt)),
    ).resolves.toEqual(chain.receipt);
  });

  it("rejects a successful receipt that did not start a fresh attempt facet", async () => {
    const { session } = rerunChain();

    await expect(
      runEffectTest(
        decodeProbeRerunSessionResponseV1Effect({
          ...session,
          workerLoaderCallbackRan: false,
          facetStartupCallbackRan: false,
        }),
      ),
    ).rejects.toBeDefined();
  });

  it("rejects cursor mutation, capability reuse, non-terminal acknowledgement, and excess fields", async () => {
    const { receipt, runtime } = rerunChain();

    await expect(
      runEffectTest(
        decodeProbeSyncRerunReceiptV1Effect({
          ...receipt,
          cursorAfter: 1,
        }),
      ),
    ).rejects.toBeDefined();
    await expect(
      runEffectTest(
        decodeProbeSyncRerunReceiptV1Effect({
          ...receipt,
          capabilityCallCount: 2,
        }),
      ),
    ).rejects.toBeDefined();
    await expect(
      runEffectTest(
        decodeProbeRuntimeRerunResponseV1Effect({
          ...runtime,
          terminalAck: false,
        }),
      ),
    ).rejects.toBeDefined();
    await expect(
      runEffectTest(
        decodeProbeSyncRerunReceiptV1Effect({
          ...receipt,
          unexpected: true,
        }),
      ),
    ).rejects.toBeDefined();
  });

  it("loads a capability-free rerun facet with outbound networking disabled", () => {
    const code = probeRerunWorkerCode();
    const source = code.modules[PROBE_RERUN_WORKER_MAIN_MODULE];

    expect(code.mainModule).toBe(PROBE_RERUN_WORKER_MAIN_MODULE);
    expect(code.env).toEqual({});
    expect(code.globalOutbound).toBeNull();
    expect(code.limits?.subRequests).toBe(0);
    expect(typeof source).toBe("string");
    expect(source).not.toContain("MOCK_READ");
    expect(source).not.toContain("MOCK_FINISH");
    expect(source).not.toContain("PROBE_SYNC");
  });
});

function rerunChain() {
  const rootRequest = rerunRequest();
  const request = { ...rootRequest, reentryDepth: 1 } as const;
  const { payload: _payload, ...identity } = request;
  const facet = {
    ...identity,
    payloadBytes: request.payload.length,
  } as const;
  const session = {
    facet,
    facetDurationMs: 1,
    workerLoaderCallbackRan: true,
    facetStartupCallbackRan: true,
  } as const;
  const runtime = {
    session,
    runtimeSessionDurationMs: 2,
    terminalAck: true,
  } as const;
  return {
    facet,
    session,
    runtime,
    receipt: {
      runtime,
      syncRuntimeRerunDurationMs: 3,
      cursorBefore: 0,
      cursorAfter: 0,
      capabilityCallCount: 1,
      terminalAck: true,
    } as const,
  };
}

function rerunRequest() {
  const runId = runEffectTestSync(decodeProbeRunIdEffect("p06_rerun"));
  const sampleOrdinal = runEffectTestSync(decodeProbeOrdinalEffect(1));
  return {
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId,
    sampleId: probeSampleId(runId, sampleOrdinal),
    sampleOrdinal,
    scopeId: probeScopeId(runId),
    scenario: "sync_rerun",
    sessionId: probeSessionId(runId, sampleOrdinal),
    sessionMode: "new-session",
    attemptId: probeAttemptId(runId, sampleOrdinal, sampleOrdinal),
    codeMode: "stable",
    codeId: probeCodeId({ mode: "stable", profile: "rerun" }),
    reentryDepth: 0,
    payload: "xxxx",
  } as const;
}
