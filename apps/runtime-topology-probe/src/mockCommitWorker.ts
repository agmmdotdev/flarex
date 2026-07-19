import { WorkerEntrypoint } from "cloudflare:workers";

import {
  decodeProbeMockFinishRequestV1OrNull,
  decodeProbeMockReadRequestV1OrNull,
  decodeProbeSyncWakeReceiptV1OrNull,
  ProbeMockFinishResponseV1Schema,
  ProbeMockReadResponseV1Schema,
  ProbeSyncWakeRequestV1Schema,
  ProbeSyntheticCursorSchema,
  type ProbeMockFinishResponseV1,
  type ProbeMockReadResponseV1,
} from "./commitProtocol";
import { copyCloudflareRpcRecord } from "./effectBoundary";
import { elapsedPerformanceDurationSince } from "./performanceDuration";
import { ProbeDurationMsSchema } from "./protocol";
import type { ProbeSyncDO } from "./probeSyncDO";
import {
  decodeProbeSyncRerunReceiptV1OrNull,
  decodeProbeSyncRerunRequestV1OrNull,
  type ProbeSyncRerunReceiptV1,
  type ProbeSyncRerunRequestV1,
} from "./rerunProtocol";
import type { ProbeRuntimeRerunCapability } from "./runtimeRerunEntrypoint";
import {
  decodeProbeSyncPurgeReceiptV1OrNull,
  decodeProbeSyncPurgeRequestV1OrNull,
  type ProbeSyncPurgeReceiptV1,
} from "./purgeProtocol";

export interface ProbeMockCommitEnv {
  readonly PROBE_SYNC: DurableObjectNamespace<ProbeSyncDO>;
  readonly RUNTIME_TOPOLOGY_PROBE_TEST_MOCK_READ_DELAY_MS?: string;
}

export class MockReadEntrypoint extends WorkerEntrypoint<ProbeMockCommitEnv> {
  async read(value: unknown): Promise<ProbeMockReadResponseV1> {
    const request = decodeProbeMockReadRequestV1OrNull(value);
    if (request === null) throw new Error("invalid synthetic mock read");
    const delayMs = testMockReadDelayMs(this.env);
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    return ProbeMockReadResponseV1Schema.make({
      protocolVersion: request.protocolVersion,
      runId: request.runId,
      sampleId: request.sampleId,
      sampleOrdinal: request.sampleOrdinal,
      scopeId: request.scopeId,
      scenario: request.scenario,
      commitSeq: request.commitSeq,
      sessionId: request.sessionId,
      sessionMode: request.sessionMode,
      attemptId: request.attemptId,
      codeMode: request.codeMode,
      codeId: request.codeId,
      payloadBytes: request.payloadBytes,
      syntheticRevision: ProbeSyntheticCursorSchema.make(
        request.commitSeq - 1,
      ),
    });
  }
}

function testMockReadDelayMs(env: ProbeMockCommitEnv): number {
  const value = env.RUNTIME_TOPOLOGY_PROBE_TEST_MOCK_READ_DELAY_MS;
  if (value === undefined || !/^[1-9][0-9]{0,3}$/.test(value)) return 0;
  const delay = Number(value);
  return delay <= 5_000 ? delay : 0;
}

export class MockFinishEntrypoint extends WorkerEntrypoint<ProbeMockCommitEnv> {
  async finish(value: unknown): Promise<ProbeMockFinishResponseV1> {
    const request = decodeProbeMockFinishRequestV1OrNull(value);
    if (request === null) throw new Error("invalid synthetic mock finish");
    const syncRequest = ProbeSyncWakeRequestV1Schema.make({
      protocolVersion: request.protocolVersion,
      runId: request.runId,
      sampleId: request.sampleId,
      sampleOrdinal: request.sampleOrdinal,
      scopeId: request.scopeId,
      scenario: request.scenario,
      commitSeq: request.commitSeq,
    });
    const sync = this.env.PROBE_SYNC.getByName(request.scopeId);
    const startedAt = performance.now();
    const rawReceipt = await sync.wake(syncRequest);
    const receipt = decodeProbeSyncWakeReceiptV1OrNull(
      copyCloudflareRpcRecord(rawReceipt),
    );
    if (receipt === null) throw new Error("invalid synthetic sync receipt");
    const mockSyncWakeDurationMs = elapsedPerformanceDurationSince(startedAt);
    return ProbeMockFinishResponseV1Schema.make({
      request,
      mockSyncWakeDurationMs: ProbeDurationMsSchema.make(
        mockSyncWakeDurationMs,
      ),
      sync: receipt,
    });
  }
}

export class MockRerunEntrypoint extends WorkerEntrypoint<ProbeMockCommitEnv> {
  async rerun(
    value: unknown,
    runtime: ProbeRuntimeRerunCapability,
  ): Promise<ProbeSyncRerunReceiptV1> {
    const request = decodeProbeSyncRerunRequestV1OrNull(value);
    if (request === null) throw new Error("invalid synthetic mock rerun");
    if (typeof runtime?.invoke !== "function") {
      throw new Error("runtime rerun capability unavailable");
    }
    const sync = this.env.PROBE_SYNC.getByName(request.scopeId);
    const rawReceipt = await sync.rerun(request, runtime);
    const receipt = decodeProbeSyncRerunReceiptV1OrNull(
      copyCloudflareRpcRecord(rawReceipt),
    );
    if (receipt === null || !sameRerunReceipt(receipt, request)) {
      throw new Error("invalid synthetic sync rerun receipt");
    }
    return receipt;
  }
}

export class MockPurgeEntrypoint extends WorkerEntrypoint<ProbeMockCommitEnv> {
  async purge(value: unknown): Promise<ProbeSyncPurgeReceiptV1> {
    const request = decodeProbeSyncPurgeRequestV1OrNull(value);
    if (request === null) throw new Error("invalid synthetic sync purge");
    const rawReceipt = await this.env.PROBE_SYNC.getByName(request.scopeId)
      .purge(request);
    const receipt = decodeProbeSyncPurgeReceiptV1OrNull(
      copyCloudflareRpcRecord(rawReceipt),
    );
    if (
      receipt === null ||
      receipt.scopeId !== request.scopeId ||
      receipt.protocolVersion !== request.protocolVersion ||
      receipt.probeDataCleared !== true ||
      receipt.completionTombstoneRetained !== true
    ) {
      throw new Error("invalid synthetic sync purge receipt");
    }
    return receipt;
  }
}

export default {
  fetch(): Response {
    return new Response("Not Found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  },
} satisfies ExportedHandler<ProbeMockCommitEnv>;

function sameRerunReceipt(
  receipt: ProbeSyncRerunReceiptV1,
  request: ProbeSyncRerunRequestV1,
): boolean {
  const facet = receipt.runtime.session.facet;
  return receipt.terminalAck === true &&
    receipt.capabilityCallCount === 1 &&
    facet.protocolVersion === request.protocolVersion &&
    facet.runId === request.runId &&
    facet.sampleId === request.sampleId &&
    facet.sampleOrdinal === request.sampleOrdinal &&
    facet.scopeId === request.scopeId &&
    facet.scenario === request.scenario &&
    facet.sessionId === request.sessionId &&
    facet.sessionMode === request.sessionMode &&
    facet.attemptId === request.attemptId &&
    facet.codeMode === request.codeMode &&
    facet.codeId === request.codeId &&
    facet.reentryDepth === request.reentryDepth + 1 &&
    facet.payloadBytes === request.payload.length;
}
