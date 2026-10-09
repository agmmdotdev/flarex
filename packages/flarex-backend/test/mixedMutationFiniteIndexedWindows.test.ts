import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { decodeAppRowIdHexV1, appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { FlarexValueSha256V1Schema } from "flarex-protocol/value";
import { fxAppRowRevisions } from "../../persistence-postgres/src/database/schema";
import {
  readFrozenFiniteAttempt,
} from "../../persistence-postgres/src/testing/sessionJournalInspection";
import {
  createMixedMutationPerformanceTrace,
  type MixedMutationPerformanceTrace,
} from "../../persistence-postgres/test/performance/mixedMutationPerformanceTrace";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite"] as const : ["pglite", "postgres"] as const;
const rowIds = [1, 2, 3].map(value => decodeAppRowIdHexV1(value.toString(16).padStart(32, "0")));
const padding = "x".repeat(600 * 1024);
const WindowDocument = Schema.Struct({ name: Schema.String, padding: Schema.String });

async function observePostgresWindows<T>(trace: MixedMutationPerformanceTrace | undefined, id: string,
  observe: (count: number) => void, run: () => Promise<T>): Promise<T> {
  if (trace === undefined) return run();
  const result = await trace.withInvocation({ id, mode: "measured" }, run);
  const records = trace.drainRecords();
  expect(records).toHaveLength(1);
  const record = records[0];
  if (record === undefined) throw new Error("Missing genuine PostgreSQL invocation trace");
  expect(record.lostContextDispatches).toBe(0);
  expect(record.unobservedDispatches).toBe(0);
  expect(record.unknownStatementDispatches).toBe(0);
  observe(record.dispatchGroups.filter(group => group.pool === "target" &&
    group.template?.includes("fx_read_snapshot_rows")).reduce((count, group) => count + group.dispatchCount, 0));
  return result;
}

describe.each(drivers)("finite Application indexed body windows on %s", driver => {
  it("continues selected bodies at its original snapshot and replays without another capture", async () => {
    let observing = false, windows = 0;
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `indexed-windows-${driver}`,
      includeUserNameIndex: true,
      initialApplicationUsers: rowIds.map((rowId, offset) => ({ name: `window-${offset}`, rowId, padding })), hooks: {
        observeSql: (_phase, sql) => { if (observing && sql.includes("fx_read_snapshot_rows")) windows++; },
      } });
    const trace = fixture.currency.resource.kind === "postgres" ? createMixedMutationPerformanceTrace({
      controlPool: fixture.currency.resource.target.pool, targetPool: fixture.currency.resource.target.pool,
    }) : undefined;
    try {
      const table = await Effect.runPromise(fixture.store.resolvePointTableEffect(fixture.persistenceAttempt, "users"));
      const index = await Effect.runPromise(fixture.store.resolveDeveloperIndexEffect(table, "by_name"));
      const request = { kind: "indexRange" as const, syscallSequence: CommitSyscallSequenceV1Schema.make(1n), bounds: {}, limit: 3 };
      observing = true;
      const result = await observePostgresWindows(trace, "indexed-first", count => { windows += count; },
        () => Effect.runPromise(fixture.store.runIndexedQueryEffect(index, request)));
      observing = false;
      expect(result.kind).toBe("completed");
      if (result.kind !== "completed") throw new Error("Expected genuine indexed success");
      expect(result.delivery).toBe("executed");
      expect(result.outcome.isDone).toBe(true);
      expect(result.outcome.documents).toHaveLength(3);
      const expectedPaddingSha256 = createHash("sha256").update(padding).digest("hex");
      for (const [offset, document] of result.outcome.documents.entries()) {
        const fields = Schema.decodeUnknownSync(WindowDocument)(document);
        expect(fields.name).toBe(`window-${offset}`);
        expect(fields.padding.length).toBe(padding.length);
        expect(createHash("sha256").update(fields.padding).digest("hex")).toBe(expectedPaddingSha256);
      }
      // Each 600 KiB body occupies its own bounded 1 MiB transfer window.
      expect(windows).toBe(3);
      observing = true;
      const replay = await observePostgresWindows(trace, "indexed-replay", count => { windows += count; },
        () => Effect.runPromise(fixture.store.runIndexedQueryEffect(index, request)));
      observing = false;
      expect(replay.kind).toBe("completed");
      if (replay.kind !== "completed") throw new Error("Expected genuine replayed index receipt");
      expect(replay.delivery).toBe("replayed");
      expect(createHash("sha256").update(JSON.stringify(replay.outcome)).digest("hex"))
        .toBe(createHash("sha256").update(JSON.stringify(result.outcome)).digest("hex"));
      expect(windows).toBe(3);
      const frozen = readFrozenFiniteAttempt(await Effect.runPromise(fixture.freeze(null)));
      if (frozen === undefined) throw new Error("Missing genuine frozen finite owner");
      expect(frozen.dependencies.filter(dependency => dependency.kind === "appRowPoint" && dependency.observed.kind === "present")).toHaveLength(3);
      expect(frozen.applicationIndexRanges).toHaveLength(1);
      expect(frozen.attemptState.snapshotToken.commitSeq).toBe(fixture.activation.anchor.snapshotToken.commitSeq);
      expect(frozen.operations.filter(operation => operation.kind === "index")).toHaveLength(1);
    } finally { try { trace?.close(); } finally { await fixture.close(); } }
  }, 240_000);

  it("returns the original semantic budget refusal before decoding a later corrupt selected body", async () => {
    let observing = false, windows = 0;
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `indexed-budget-${driver}`,
      includeUserNameIndex: true,
      initialApplicationUsers: rowIds.map((rowId, offset) => ({ name: `window-${offset}`, rowId, padding })), hooks: {
        observeSql: (_phase, sql) => { if (observing && sql.includes("fx_read_snapshot_rows")) windows++; },
      } });
    const trace = fixture.currency.resource.kind === "postgres" ? createMixedMutationPerformanceTrace({
      controlPool: fixture.currency.resource.target.pool, targetPool: fixture.currency.resource.target.pool,
    }) : undefined;
    try {
      const table = await Effect.runPromise(fixture.store.resolvePointTableEffect(fixture.persistenceAttempt, "users"));
      const index = await Effect.runPromise(fixture.store.resolveDeveloperIndexEffect(table, "by_name"));
      for (let sequence = 1; sequence <= 9; sequence++) {
        const result = await Effect.runPromise(fixture.store.runIndexedQueryEffect(index,
          { kind: "indexRange", syscallSequence: CommitSyscallSequenceV1Schema.make(BigInt(sequence)), bounds: {}, limit: 3 }));
        expect(result.kind).toBe("completed");
        if (result.kind !== "completed") throw new Error("Expected page within the original semantic budget");
        expect(result.outcome.documents).toHaveLength(3);
      }
      // The first selected document crosses the existing 16 MiB semantic limit.
      // A later canonical body is corrupt, so decoding it would change the verdict.
      await fixture.currency.persistence.drizzle.update(fxAppRowRevisions).set({ valueSha256: FlarexValueSha256V1Schema.make(new Uint8Array(32)) })
        .where(and(eq(fxAppRowRevisions.scopeUuid, projectScopeIdUuidV1(fixture.selector.scopeId).scopeUuid),
          eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(rowIds[1]!))));
      observing = true;
      const refusal = await observePostgresWindows(trace, "indexed-budget", count => { windows += count; },
        () => Effect.runPromise(fixture.store.runIndexedQueryEffect(index,
          { kind: "indexRange", syscallSequence: CommitSyscallSequenceV1Schema.make(10n), bounds: {}, limit: 3 })));
      observing = false;
      expect(refusal.kind).toBe("rejected");
      if (refusal.kind !== "rejected") throw new Error("Expected the original semantic budget refusal");
      expect(refusal.delivery).toBe("executed");
      expect(refusal.issue).toMatchObject({ reason: "limitExceeded", dimension: "readSemanticBytes", maximum: 1 << 24 });
      expect(windows).toBe(1);
    } finally { try { trace?.close(); } finally { await fixture.close(); } }
  }, 240_000);
});
