import { describe, expect, it } from "vitest";

import {
  decodeProbeMockFinishRequestV1Effect,
  decodeProbeMockFinishResponseV1Effect,
  decodeProbeMockReadRequestV1Effect,
  decodeProbeSyncControlRequestV1Effect,
  decodeProbeSyncControlResponseV1Effect,
  decodeProbeSyncWakeRequestV1Effect,
  decodeProbeSyncWakeReceiptV1Effect,
} from "../src/commitProtocol";
import { copyCloudflareRpcRecord } from "../src/effectBoundary";
import { runEffectTest } from "./effectTest";

const validAppliedReceipt = {
  protocolVersion: 1,
  runId: "p05_finish_protocol",
  sampleId: "rtp-sample-p05_finish_protocol-0",
  sampleOrdinal: 0,
  scopeId: "rtp-scope-p05_finish_protocol",
  scenario: "commit_wake",
  commitSeq: 1,
  disposition: "applied",
  previousCursor: 0,
  cursor: 1,
  cursorDurationMs: 2,
} as const;

describe("P05 synthetic commit protocol", () => {
  it("strictly decodes a valid applied sync receipt", async () => {
    const decoded = await runEffectTest(
      decodeProbeSyncWakeReceiptV1Effect(validAppliedReceipt),
    );

    expect(decoded).toEqual(validAppliedReceipt);
  });

  it.each([
    ["duplicate", 0, 1, 1],
    ["stale", 0, 2, 2],
    ["gap", 2, 1, 1],
  ] as const)(
    "strictly decodes a valid %s sync receipt",
    async (disposition, sampleOrdinal, previousCursor, cursor) => {
      const decoded = await runEffectTest(
        decodeProbeSyncWakeReceiptV1Effect({
          ...validAppliedReceipt,
          sampleId:
            `rtp-sample-p05_finish_protocol-${sampleOrdinal}`,
          sampleOrdinal,
          commitSeq: sampleOrdinal + 1,
          disposition,
          previousCursor,
          cursor,
        }),
      );

      expect(decoded.disposition).toBe(disposition);
      expect(decoded.cursor).toBe(cursor);
    },
  );

  it.each([
    ["applied", { previousCursor: 0, cursor: 0, commitSeq: 1 }],
    ["duplicate", { previousCursor: 1, cursor: 2, commitSeq: 1 }],
    ["stale", { previousCursor: 1, cursor: 1, commitSeq: 1 }],
    ["gap", { previousCursor: 0, cursor: 0, commitSeq: 1 }],
  ] as const)(
    "rejects an invalid %s cursor relationship",
    async (disposition, values) => {
      await expect(
        runEffectTest(
          decodeProbeSyncWakeReceiptV1Effect({
            ...validAppliedReceipt,
            ...values,
            disposition,
          }),
        ),
      ).rejects.toBeDefined();
    },
  );

  it("rejects excess receipt fields", async () => {
    await expect(
      runEffectTest(
        decodeProbeSyncWakeReceiptV1Effect({
          ...validAppliedReceipt,
          unexpected: true,
        }),
      ),
    ).rejects.toBeDefined();
  });

  it("removes only Cloudflare RPC transport symbols before strict decoding", async () => {
    const rpcValue = { ...validAppliedReceipt, unexpected: true };
    Object.defineProperty(rpcValue, Symbol.dispose, {
      enumerable: false,
      value() {},
    });

    const copied = copyCloudflareRpcRecord(rpcValue);
    if (typeof copied !== "object" || copied === null) {
      throw new Error("RPC record copy did not return an object");
    }
    expect(Reflect.ownKeys(copied)).not.toContain(Symbol.dispose);
    expect(copied).toHaveProperty("unexpected", true);
    await expect(
      runEffectTest(decodeProbeSyncWakeReceiptV1Effect(copied)),
    ).rejects.toBeDefined();
  });

  it("allows mock reads only for an exact full-invoke identity", async () => {
    const request = {
      ...fullInvokeRuntimeIdentity(),
      payloadBytes: 4,
    } as const;
    const decoded = await runEffectTest(
      decodeProbeMockReadRequestV1Effect(request),
    );

    expect(decoded).toEqual(request);
    await expect(
      runEffectTest(
        decodeProbeMockReadRequestV1Effect({
          ...request,
          scenario: "commit_wake",
        }),
      ),
    ).rejects.toBeDefined();
  });

  it("strictly separates direct-wake and full-invoke finish contracts", async () => {
    const direct = await runEffectTest(
      decodeProbeMockFinishRequestV1Effect({
        protocolVersion: 1,
        runId: "p05_finish_contract",
        sampleId: "rtp-sample-p05_finish_contract-0",
        sampleOrdinal: 0,
        scopeId: "rtp-scope-p05_finish_contract",
        scenario: "commit_wake",
        commitSeq: 1,
      }),
    );
    const full = await runEffectTest(
      decodeProbeMockFinishRequestV1Effect({
        ...fullInvokeRuntimeIdentity("p05_full_finish_contract"),
        journalEntries: 1,
        sealDigest: "0".repeat(64),
        snapshotRevision: 0,
        resultDigest: "1".repeat(64),
        commitIntentDigest: "2".repeat(64),
      }),
    );

    expect(direct.scenario).toBe("commit_wake");
    expect(full.scenario).toBe("full_invoke");
    await expect(
      runEffectTest(
        decodeProbeMockFinishRequestV1Effect({
          ...direct,
          sessionId: "rtp-session-p05_finish_contract-0",
        }),
      ),
    ).rejects.toBeDefined();
  });

  it("rejects a mock-finish response whose sync receipt changes identity", async () => {
    const request = {
      protocolVersion: 1,
      runId: "p05_finish_response",
      sampleId: "rtp-sample-p05_finish_response-0",
      sampleOrdinal: 0,
      scopeId: "rtp-scope-p05_finish_response",
      scenario: "commit_wake",
      commitSeq: 1,
    } as const;
    await expect(
      runEffectTest(
        decodeProbeMockFinishResponseV1Effect({
          request,
          commitAuthority: "mock",
          finishDisposition: "committed",
          commitTransactionDurationMs: 0,
          outcomeResolutionDurationMs: 0,
          syncWakeDurationMs: 1,
          sync: {
            ...validAppliedReceipt,
            runId: "p05_other_response",
            sampleId: "rtp-sample-p05_other_response-0",
            scopeId: "rtp-scope-p05_other_response",
          },
        }),
      ),
    ).rejects.toBeDefined();
  });

  it("binds finish authority and transaction timing to the scenario", async () => {
    const runId = "p28_postgres_authority";
    const request = {
      protocolVersion: 1,
      runId,
      sampleId: `rtp-sample-${runId}-0`,
      sampleOrdinal: 0,
      scopeId: `rtp-scope-${runId}`,
      scenario: "facet_finalizer_postgres_warm_invoke",
      commitSeq: 1,
      sessionId: `rtp-session-${runId}-0`,
      sessionMode: "reuse-session",
      attemptId: `rtp-attempt-${runId}-0-0`,
      codeMode: "stable",
      codeId: "rtp-code-invoke-finalizer-postgres-warm-v2-stable",
      journalEntries: 1,
      sealDigest: "0".repeat(64),
      snapshotRevision: 0,
      resultDigest: "1".repeat(64),
      commitIntentDigest: "2".repeat(64),
    } as const;
    const response = {
      request,
      commitAuthority: "postgres",
      finishDisposition: "committed",
      commitTransactionDurationMs: 4,
      outcomeResolutionDurationMs: 0,
      syncWakeDurationMs: 2,
      sync: {
        ...validAppliedReceipt,
        runId,
        sampleId: request.sampleId,
        scopeId: request.scopeId,
        scenario: request.scenario,
      },
    } as const;

    await expect(runEffectTest(decodeProbeMockFinishResponseV1Effect(response)))
      .resolves.toEqual(response);
    await expect(runEffectTest(decodeProbeMockFinishResponseV1Effect({
      ...response,
      commitAuthority: "mock",
      finishDisposition: "committed",
      commitTransactionDurationMs: 0,
      outcomeResolutionDurationMs: 0,
    }))).rejects.toBeDefined();
    await expect(runEffectTest(decodeProbeMockFinishResponseV1Effect({
      ...response,
      request: { ...request, scenario: "facet_finalizer_warm_invoke" },
      sync: { ...response.sync, scenario: "facet_finalizer_warm_invoke" },
    }))).rejects.toBeDefined();
  });

  it("strictly validates sync wake and control boundaries", async () => {
    const wake = {
      protocolVersion: 1,
      runId: "p05_sync_contract",
      sampleId: "rtp-sample-p05_sync_contract-0",
      sampleOrdinal: 0,
      scopeId: "rtp-scope-p05_sync_contract",
      scenario: "commit_wake",
      commitSeq: 1,
    } as const;
    const control = {
      protocolVersion: 1,
      runId: wake.runId,
      scopeId: wake.scopeId,
      operation: "read",
    } as const;

    await expect(
      runEffectTest(decodeProbeSyncWakeRequestV1Effect(wake)),
    ).resolves.toEqual(wake);
    await expect(
      runEffectTest(decodeProbeSyncControlRequestV1Effect(control)),
    ).resolves.toEqual(control);
    await expect(
      runEffectTest(
        decodeProbeSyncControlResponseV1Effect({ ...control, cursor: 0 }),
      ),
    ).resolves.toEqual({ ...control, cursor: 0 });
    await expect(
      runEffectTest(
        decodeProbeSyncWakeRequestV1Effect({
          ...wake,
          sampleId: "rtp-sample-p05_sync_contract-1",
        }),
      ),
    ).rejects.toBeDefined();
    await expect(
      runEffectTest(
        decodeProbeSyncControlRequestV1Effect({
          ...control,
          scopeId: "rtp-scope-wrong",
        }),
      ),
    ).rejects.toBeDefined();
    await expect(
      runEffectTest(
        decodeProbeSyncControlResponseV1Effect({
          ...control,
          cursor: 0,
          unexpected: true,
        }),
      ),
    ).rejects.toBeDefined();
  });
});

function fullInvokeRuntimeIdentity(
  runId = "p05_mock_read_contract",
) {
  return {
    protocolVersion: 1,
    runId,
    sampleId: `rtp-sample-${runId}-0`,
    sampleOrdinal: 0,
    scopeId: `rtp-scope-${runId}`,
    scenario: "full_invoke",
    commitSeq: 1,
    sessionId: `rtp-session-${runId}-0`,
    sessionMode: "new-session",
    attemptId: `rtp-attempt-${runId}-0-0`,
    codeMode: "stable",
    codeId: "rtp-code-invoke-v2-stable",
  } as const;
}
