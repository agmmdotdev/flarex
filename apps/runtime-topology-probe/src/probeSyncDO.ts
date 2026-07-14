import { DurableObject } from "cloudflare:workers";

import {
  decodeProbeSyncControlRequestV1OrNull,
  decodeProbeSyncWakeRequestV1OrNull,
  ProbeSyncControlResponseV1Schema,
  ProbeSyncWakeReceiptV1Schema,
  ProbeSyntheticCursorSchema,
  type ProbeSyncControlResponseV1,
  type ProbeSyncDisposition,
  type ProbeSyncWakeReceiptV1,
  type ProbeSyntheticCursor,
} from "./commitProtocol";
import { copyCloudflareRpcRecord } from "./effectBoundary";
import { ProbeDurationMsSchema } from "./protocol";
import {
  decodeProbeRuntimeRerunResponseV1OrNull,
  decodeProbeSyncRerunRequestV1OrNull,
  ProbeSyncRerunReceiptV1Schema,
  type ProbeRuntimeRerunResponseV1,
  type ProbeSyncRerunReceiptV1,
  type ProbeSyncRerunRequestV1,
} from "./rerunProtocol";
import { ProbeRerunConcurrencyFence } from "./rerunGuards";
import type { ProbeRuntimeRerunCapability } from "./runtimeRerunEntrypoint";

export class ProbeSyncDO extends DurableObject<Record<string, never>> {
  private readonly sql = this.ctx.storage.sql;
  private readonly rerunFence = new ProbeRerunConcurrencyFence();

  constructor(ctx: DurableObjectState, env: Record<string, never>) {
    super(ctx, env);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS probe_sync_cursor (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      cursor INTEGER NOT NULL CHECK (cursor >= 0 AND cursor <= 1000000)
    )`);
    this.sql.exec(
      `INSERT OR IGNORE INTO probe_sync_cursor (singleton, cursor)
       VALUES (1, 0)`,
    );
  }

  async wake(value: unknown): Promise<ProbeSyncWakeReceiptV1> {
    const request = decodeProbeSyncWakeRequestV1OrNull(value);
    if (request === null) throw new Error("invalid synthetic sync wake");
    this.assertScopeIdentity(request.scopeId);

    const startedAt = performance.now();
    const previousCursor = readCursor(this.sql);
    const disposition = classifyWake(previousCursor, request.commitSeq);
    if (disposition === "applied") {
      const updated = this.ctx.storage.transactionSync(() =>
        this.sql.exec<{ cursor: number }>(
          `UPDATE probe_sync_cursor
           SET cursor = ?
           WHERE singleton = 1 AND cursor = ?
           RETURNING cursor`,
          request.commitSeq,
          previousCursor,
        ).one().cursor
      );
      if (updated !== request.commitSeq) {
        throw new Error("synthetic cursor update mismatch");
      }
      await this.ctx.storage.sync();
    }
    const cursor = ProbeSyntheticCursorSchema.make(readCursor(this.sql));
    const cursorDurationMs = elapsedSince(startedAt);
    return ProbeSyncWakeReceiptV1Schema.make({
      protocolVersion: request.protocolVersion,
      runId: request.runId,
      sampleId: request.sampleId,
      sampleOrdinal: request.sampleOrdinal,
      scopeId: request.scopeId,
      scenario: request.scenario,
      commitSeq: request.commitSeq,
      disposition,
      previousCursor,
      cursor,
      cursorDurationMs: ProbeDurationMsSchema.make(cursorDurationMs),
    });
  }

  async control(value: unknown): Promise<ProbeSyncControlResponseV1> {
    const request = decodeProbeSyncControlRequestV1OrNull(value);
    if (request === null) throw new Error("invalid synthetic sync control");
    this.assertScopeIdentity(request.scopeId);
    let cursor: ProbeSyntheticCursor;
    if (request.operation === "reset") {
      cursor = this.ctx.storage.transactionSync(() =>
        ProbeSyntheticCursorSchema.make(
          this.sql.exec<{ cursor: number }>(
            `UPDATE probe_sync_cursor
             SET cursor = 0
             WHERE singleton = 1
             RETURNING cursor`,
          ).one().cursor,
        )
      );
      await this.ctx.storage.sync();
    } else {
      cursor = ProbeSyntheticCursorSchema.make(readCursor(this.sql));
    }
    return ProbeSyncControlResponseV1Schema.make({
      protocolVersion: request.protocolVersion,
      runId: request.runId,
      scopeId: request.scopeId,
      operation: request.operation,
      cursor,
    });
  }

  async rerun(
    value: unknown,
    runtime: ProbeRuntimeRerunCapability,
  ): Promise<ProbeSyncRerunReceiptV1> {
    const request = decodeProbeSyncRerunRequestV1OrNull(value);
    if (request === null) throw new Error("invalid synthetic sync rerun");
    this.assertScopeIdentity(request.scopeId);
    if (typeof runtime?.invoke !== "function") {
      throw new Error("runtime rerun capability unavailable");
    }

    return await this.rerunFence.run(request.sampleId, async () => {
      const cursorBefore = readCursor(this.sql);
      const startedAt = performance.now();
      const rawResponse = await runtime.invoke();
      const response = decodeProbeRuntimeRerunResponseV1OrNull(
        copyCloudflareRpcRecord(rawResponse),
      );
      if (
        response === null ||
        !sameRuntimeRerunResponse(response, request)
      ) {
        throw new Error("invalid synthetic runtime rerun response");
      }
      const syncRuntimeRerunDurationMs = elapsedSince(startedAt);
      const cursorAfter = readCursor(this.sql);
      if (cursorAfter !== cursorBefore) {
        throw new Error("synthetic sync cursor changed during rerun");
      }
      return ProbeSyncRerunReceiptV1Schema.make({
        runtime: response,
        syncRuntimeRerunDurationMs: ProbeDurationMsSchema.make(
          syncRuntimeRerunDurationMs,
        ),
        cursorBefore,
        cursorAfter,
        capabilityCallCount: 1,
        terminalAck: true,
      });
    });
  }

  private assertScopeIdentity(scopeId: string): void {
    if (this.ctx.id.name !== scopeId) {
      throw new Error("synthetic sync scope identity mismatch");
    }
  }
}

function sameRuntimeRerunResponse(
  response: ProbeRuntimeRerunResponseV1,
  request: ProbeSyncRerunRequestV1,
): boolean {
  const facet = response.session.facet;
  return response.terminalAck === true &&
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

function classifyWake(
  cursor: ProbeSyntheticCursor,
  commitSeq: number,
): ProbeSyncDisposition {
  if (commitSeq === cursor + 1) return "applied";
  if (commitSeq === cursor) return "duplicate";
  return commitSeq < cursor ? "stale" : "gap";
}

function readCursor(sql: SqlStorage): ProbeSyntheticCursor {
  return ProbeSyntheticCursorSchema.make(
    sql.exec<{ cursor: number }>(
      `SELECT cursor
       FROM probe_sync_cursor
       WHERE singleton = 1`,
    ).one().cursor,
  );
}

function elapsedSince(startedAt: number): number {
  const duration = performance.now() - startedAt;
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}
