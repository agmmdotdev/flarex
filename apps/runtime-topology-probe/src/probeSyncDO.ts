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
import {
  decodeProbeSyncPurgeRequestV1OrNull,
  ProbeSyncPurgeReceiptV1Schema,
  type ProbeSyncPurgeReceiptV1,
} from "./purgeProtocol";

export class ProbeSyncDO extends DurableObject<Record<string, never>> {
  private readonly sql = this.ctx.storage.sql;
  private readonly rerunFence = new ProbeRerunConcurrencyFence();
  private storageInitialized = true;
  private activeOperations = 0;

  constructor(ctx: DurableObjectState, env: Record<string, never>) {
    super(ctx, env);
    initializeSyncStorage(this.sql);
  }

  async wake(value: unknown): Promise<ProbeSyncWakeReceiptV1> {
    return await this.withActive(async () => {
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
    });
  }

  async control(value: unknown): Promise<ProbeSyncControlResponseV1> {
    return await this.withActive(async () => {
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
    });
  }

  async rerun(
    value: unknown,
    runtime: ProbeRuntimeRerunCapability,
  ): Promise<ProbeSyncRerunReceiptV1> {
    return await this.withActive(async () => {
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
    });
  }

  async purge(value: unknown): Promise<ProbeSyncPurgeReceiptV1> {
    this.ensureStorage();
    const request = decodeProbeSyncPurgeRequestV1OrNull(value);
    if (request === null) throw new Error("invalid synthetic sync purge");
    this.assertScopeIdentity(request.scopeId);
    const canonicalRequest = JSON.stringify(request);
    const completion = readSyncPurgeCompletion(this.sql);
    if (completion !== null) {
      if (completion.request_json !== canonicalRequest) {
        throw new Error("synthetic sync purge request conflicts with completion");
      }
      assertExactSyncPurgeTombstone(this.sql);
      return syncPurgeReceipt(request);
    }
    if (this.activeOperations !== 0) {
      throw new Error("probe sync purge is busy");
    }
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM probe_sync_cursor");
      this.sql.exec(
        `INSERT INTO probe_sync_purge_completion (singleton, request_json)
         VALUES (1, ?)`,
        canonicalRequest,
      );
    });
    assertExactSyncPurgeTombstone(this.sql);
    await this.ctx.storage.sync();
    return syncPurgeReceipt(request);
  }

  private ensureStorage(): void {
    if (this.storageInitialized) return;
    initializeSyncStorage(this.sql);
    this.storageInitialized = true;
  }

  private async withActive<A>(operation: () => Promise<A>): Promise<A> {
    this.ensureStorage();
    if (readSyncPurgeCompletion(this.sql) !== null) {
      throw new Error("synthetic sync purge fence is active");
    }
    this.activeOperations += 1;
    try {
      return await operation();
    } finally {
      this.activeOperations -= 1;
    }
  }

  private assertScopeIdentity(scopeId: string): void {
    if (this.ctx.id.name !== scopeId) {
      throw new Error("synthetic sync scope identity mismatch");
    }
  }
}

function syncPurgeReceipt(
  request: NonNullable<ReturnType<typeof decodeProbeSyncPurgeRequestV1OrNull>>,
): ProbeSyncPurgeReceiptV1 {
  return ProbeSyncPurgeReceiptV1Schema.make({
    protocolVersion: request.protocolVersion,
    kind: "probe-data-cleared",
    scopeId: request.scopeId,
    probeDataCleared: true,
    completionTombstoneRetained: true,
  });
}

function initializeSyncStorage(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS probe_sync_cursor (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    cursor INTEGER NOT NULL CHECK (cursor >= 0 AND cursor <= 1000000)
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS probe_sync_purge_completion (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    request_json TEXT NOT NULL
  )`);
  sql.exec(
    `INSERT OR IGNORE INTO probe_sync_cursor (singleton, cursor)
     SELECT 1, 0
     WHERE NOT EXISTS (
       SELECT 1 FROM probe_sync_purge_completion WHERE singleton = 1
     )`,
  );
}

interface SyncPurgeCompletionRow {
  readonly [key: string]: SqlStorageValue;
  readonly request_json: string;
}

function readSyncPurgeCompletion(sql: SqlStorage): SyncPurgeCompletionRow | null {
  return sql.exec<SyncPurgeCompletionRow>(
    `SELECT request_json FROM probe_sync_purge_completion
     WHERE singleton = 1`,
  ).toArray()[0] ?? null;
}

function assertExactSyncPurgeTombstone(sql: SqlStorage): void {
  const rows = sql.exec<{ cursors: number; tombstones: number }>(
    `SELECT
       (SELECT COUNT(*) FROM probe_sync_cursor) AS cursors,
       (SELECT COUNT(*) FROM probe_sync_purge_completion) AS tombstones`,
  ).one();
  if (rows.cursors !== 0 || rows.tombstones !== 1) {
    throw new Error("synthetic sync purge tombstone is not exact");
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
