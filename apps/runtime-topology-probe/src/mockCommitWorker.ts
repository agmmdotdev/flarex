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
import { ProbeDurationMsSchema } from "./protocol";
import type { ProbeSyncDO } from "./probeSyncDO";

export interface ProbeMockCommitEnv {
  readonly PROBE_SYNC: DurableObjectNamespace<ProbeSyncDO>;
}

export class MockReadEntrypoint extends WorkerEntrypoint<ProbeMockCommitEnv> {
  async read(value: unknown): Promise<ProbeMockReadResponseV1> {
    const request = decodeProbeMockReadRequestV1OrNull(value);
    if (request === null) throw new Error("invalid synthetic mock read");
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
    const mockSyncWakeDurationMs = elapsedSince(startedAt);
    return ProbeMockFinishResponseV1Schema.make({
      request,
      mockSyncWakeDurationMs: ProbeDurationMsSchema.make(
        mockSyncWakeDurationMs,
      ),
      sync: receipt,
    });
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

function elapsedSince(startedAt: number): number {
  const duration = performance.now() - startedAt;
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}
