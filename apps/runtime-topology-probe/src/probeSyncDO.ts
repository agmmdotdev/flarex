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
import { ProbeDurationMsSchema } from "./protocol";

export class ProbeSyncDO extends DurableObject<Record<string, never>> {
  private readonly sql = this.ctx.storage.sql;

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

  private assertScopeIdentity(scopeId: string): void {
    if (this.ctx.id.name !== scopeId) {
      throw new Error("synthetic sync scope identity mismatch");
    }
  }
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
