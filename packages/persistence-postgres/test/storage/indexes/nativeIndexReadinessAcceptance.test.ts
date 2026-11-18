import { setTimeout as delay } from "node:timers/promises";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import { and, eq, sql, getTableName } from "drizzle-orm";
import { Cause, Effect, Exit, Result } from "effect";
import { CatalogIndexDefinitionIdSchema, CatalogTableIdSchema, type CatalogIndexDefinitionId } from "flarex-protocol/catalog";
import { projectScopeIdUuidV1Result, ScopeIdSchema, CommitSeqSchema, StorageGenerationFenceSchema,
  FlarexDbV1StorageGenerationSchema } from "flarex-protocol/storage-authority";
import { IndexBuildAttemptFenceSchema, IndexBuildCursorCodecVersionV1Schema } from "flarex-protocol/index-build-state";
import { AppIndexPhysicalSpecSha256HexV1Schema } from "flarex-protocol/index-definition";
import { describe, expect, it } from "vitest";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import { fxSystemApplicationActiveHeads } from "../../../src/application/applicationActivationSchema";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import { fxSystemIndexBuildStates, fxSystemScopeClocks } from "../../../src/database/schema";
import { lockScopeClockForUpdateInTransactionEffect, lockScopeClockForSnapshotReadInTransactionEffect, lockScopeClockForOrdinaryWriteInTransactionEffect } from "../../../src/scope/scopeClock";
import { captureRequiredIndexReadinessInTransactionEffect, readRequiredIndexBuildProgressInTransactionEffect,
  readIndexCoverageContextInTransactionEffect } from "../../../src/storage/indexes/indexBuildStates";
import { prepareRequiredIndexBuildReadinessAcceptance, prepareRequiredIndexBuildProgressCapture } from "../../../src/storage/indexes/nativeIndexBuildAcceptance";
import { insertCurrentScopeClockFixture } from "../../scope/scopeClockFixture";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { runEffect } from "../../support/effectTestRuntime";
import { createFileScopedPGliteFixture } from "../../support/pgliteTestFixture";
import { useFileScopedPersistence, type WithFileScopedPersistence } from "../../support/fileScopedPersistenceFixture";

const drivers = postgresUrl === null ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

async function inspect(database: FlarexMetadataDatabase) {
  const scopeId = ScopeIdSchema.make("scope_32000000-0000-0000-0000-000000000001");
  await insertCurrentScopeClockFixture(database, { scopeId,
    epoch: "epoch_32000000-0000-0000-0000-000000000002", lastCommitSeq: 10n });
  const definitions = Array.from({ length: 128 }, (_, ordinal) => 128 - ordinal).map(id => ({ indexDefinitionId: CatalogIndexDefinitionIdSchema.make(id),
    tableId: CatalogTableIdSchema.make(1), physicalSpecSha256Hex: AppIndexPhysicalSpecSha256HexV1Schema.make("ab".repeat(32)) }));
  await database.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
    if (clock.storageGeneration !== "flarexdb_v1") throw new Error("Current readiness fixture has another storage generation");
    yield* Effect.promise(() => tx.insert(fxSystemIndexBuildStates).values(definitions.map(definition => ({
      scopeId, indexDefinitionId: definition.indexDefinitionId, storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: clock.storageGenerationFence, epoch: clock.epoch, startCommitSeq: CommitSeqSchema.make(0n),
      coveredThroughCommitSeq: CommitSeqSchema.make(9n), firstReadableCommitSeq: CommitSeqSchema.make(0n), lifecycle: "enabled" as const,
      cursorCodecVersion: IndexBuildCursorCodecVersionV1Schema.make(1), backfillCursorRowId: null, attemptFence: IndexBuildAttemptFenceSchema.make(1n),
    }))));
  })));
  const where = (id: CatalogIndexDefinitionId) => and(eq(fxSystemIndexBuildStates.scopeId, scopeId), eq(fxSystemIndexBuildStates.indexDefinitionId, id));
  const execute = () => database.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
    const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(scopeId));
    const rows = yield* Effect.promise(() => prepareRequiredIndexBuildReadinessAcceptance(tx, clock, definitions, null, scope.scopeUuid));
    const captured = yield* captureRequiredIndexReadinessInTransactionEffect(tx, clock, definitions, null);
    if (captured.availability !== null) return { rows, availability: captured.availability, verdict: null };
    const context = yield* readIndexCoverageContextInTransactionEffect(tx, clock);
    return { rows, availability: null, verdict: yield* Effect.result(captured.acceptCoverage(context)) };
  })));
  const accepted = await execute();
  expect(accepted.rows).toHaveLength(1);
  expect(accepted.rows[0]).toMatchObject({ phase: "coverage", reason: "accepted", ordinal: null });
  expect(Object.values(accepted.rows[0]?.build ?? {}).every(value => value === null)).toBe(true);
  expect(Object.values(accepted.rows[0]?.maintenance ?? {}).every(value => value === null)).toBe(true);
  expect(accepted.verdict).toMatchObject({ _tag: "Success", success: { status: "ready" } });
  const first = definitions[0], later = definitions[1];
  if (first === undefined || later === undefined) throw new Error("Missing ordered readiness fixture");
  const [originalTimestamps] = await database.select({ createdAt: fxSystemIndexBuildStates.createdAt,
    updatedAt: fxSystemIndexBuildStates.updatedAt }).from(fxSystemIndexBuildStates).where(where(first.indexDefinitionId));
  if (originalTimestamps === undefined) throw new Error("Missing native timestamp fixture");
  // Corrupt the actual native mapper output after an authentic writer lock.
  // A forged success header must refuse before touching its unused body.
  const corruptHeader = (getterCause?: Error) => database.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
    const session = tx._.session;
    const original = session.prepareQuery;
    const descriptor = Object.getOwnPropertyDescriptor(session, "prepareQuery");
    Object.defineProperty(session, "prepareQuery", { configurable: true,
      value(...args: Parameters<typeof original>) {
        const prepared = original.call(session, ...args);
        if (prepared.getQuery().sql.includes("needed_tables as materialized")) {
          const execute = prepared.execute.bind(prepared);
          Object.defineProperty(prepared, "execute", { value: async (...bindings: Parameters<typeof execute>) => {
            const rows = await execute(...bindings);
            if (!Array.isArray(rows) || typeof rows[0] !== "object" || rows[0] === null)
              throw new Error("Missing actual native readiness mapper output");
            Object.defineProperty(rows[0], "indexDefinitionId", getterCause === undefined
              ? { value: first.indexDefinitionId }
              : { get() { throw getterCause; } });
            Object.defineProperty(rows[0], "build", { get() { throw new Error("Unused success body accessed"); } });
            return rows;
          } });
        }
        return prepared;
      } });
    try { return yield* Effect.exit(captureRequiredIndexReadinessInTransactionEffect(tx, clock, definitions, null)); }
    finally {
      if (descriptor === undefined) Reflect.deleteProperty(session, "prepareQuery");
      else Object.defineProperty(session, "prepareQuery", descriptor);
    }
  })));
  const forged = await corruptHeader();
  expect(forged).toMatchObject({ _tag: "Failure" });
  if (Exit.isFailure(forged)) {
    expect(Cause.hasDies(forged.cause)).toBe(false);
    expect(Result.getOrThrow(Cause.findError(forged.cause))).toMatchObject({ _tag: "IndexMaintenanceError", reason: "storedState" });
  }
  const headerCause = new Error("Foreign native readiness header getter");
  const abrupt = await corruptHeader(headerCause);
  if (!Exit.isFailure(abrupt)) throw new Error("Throwing native header was accepted");
  expect(Cause.hasDies(abrupt.cause)).toBe(true);
  expect(Result.getOrThrow(Cause.findDefect(abrupt.cause))).toBe(headerCause);
  // Availability is a complete first phase, even when an earlier build is corrupt.
  // PostgreSQL permits infinite timestamptz, while the complete native/runtime
  // acceptance contract requires finite JavaScript dates.
  await database.update(fxSystemIndexBuildStates).set({ createdAt: sql`'infinity'::timestamptz`,
    updatedAt: sql`'infinity'::timestamptz` }).where(where(first.indexDefinitionId));
  await database.update(fxSystemIndexBuildStates).set({ lifecycle: "retiring" }).where(where(later.indexDefinitionId));
  const unavailable = await execute();
  expect(unavailable.rows[0]).toMatchObject({ phase: "availability", reason: "notEnabled", ordinal: "2" });
  expect(unavailable.availability).toMatchObject({ status: "not_ready", reason: "notEnabled", indexDefinitionId: later.indexDefinitionId });
  expect(unavailable.verdict).toBeNull();
  await database.update(fxSystemIndexBuildStates).set({ lifecycle: "enabled", startCommitSeq: CommitSeqSchema.make(11n) }).where(where(later.indexDefinitionId));
  const corrupt = await execute();
  expect(corrupt.rows[0]).toMatchObject({ phase: "coverage", reason: "invalid", ordinal: "1", indexDefinitionId: first.indexDefinitionId });
  const corruptCreatedAt = corrupt.rows[0]?.build.createdAt;
  if (!(corruptCreatedAt instanceof Date)) throw new Error("Refused native timestamp was not mapped through its Date codec");
  expect(Number.isNaN(corruptCreatedAt.getTime())).toBe(true);
  expect(corrupt.verdict).toMatchObject({ _tag: "Failure", failure: { _tag: "IndexBuildStateCorruptionError", indexDefinitionId: first.indexDefinitionId } });
  await database.update(fxSystemIndexBuildStates).set(originalTimestamps).where(where(first.indexDefinitionId));
  const frontier = await execute();
  expect(frontier.rows[0]).toMatchObject({ phase: "coverage", reason: "frontier", ordinal: "2" });
  expect(frontier.verdict).toMatchObject({ _tag: "Failure", failure: { _tag: "IndexBuildStateCorruptionError", indexDefinitionId: later.indexDefinitionId } });
  await database.update(fxSystemIndexBuildStates).set({ startCommitSeq: CommitSeqSchema.make(0n) }).where(where(later.indexDefinitionId));
  await database.update(fxSystemIndexBuildStates).set({ firstReadableCommitSeq: null }).where(where(first.indexDefinitionId));
  const uncovered = await execute();
  expect(uncovered.verdict).toMatchObject({ _tag: "Success", success: { status: "not_ready", reason: "notCovered", indexDefinitionId: first.indexDefinitionId } });
  await database.update(fxSystemIndexBuildStates).set({ firstReadableCommitSeq: CommitSeqSchema.make(0n) }).where(where(first.indexDefinitionId));
  await database.update(fxSystemIndexBuildStates).set({ storageGenerationFence: StorageGenerationFenceSchema.make(2n) }).where(where(later.indexDefinitionId));
  expect((await execute()).availability).toMatchObject({ reason: "stale", indexDefinitionId: later.indexDefinitionId });
  await database.update(fxSystemIndexBuildStates).set({ storageGenerationFence: StorageGenerationFenceSchema.make(1n) }).where(where(later.indexDefinitionId));
  await database.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
    const captured = yield* captureRequiredIndexReadinessInTransactionEffect(tx, clock, definitions, null);
    const context = yield* readIndexCoverageContextInTransactionEffect(tx, clock);
    yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
    expect(yield* Effect.result(captured.acceptCoverage(context))).toMatchObject({ _tag: "Failure",
      failure: { _tag: "IndexMaintenanceError", reason: "storedState" } });
  })));
  await database.delete(fxSystemIndexBuildStates).where(where(first.indexDefinitionId));
  expect((await execute()).availability).toMatchObject({ reason: "missing", indexDefinitionId: first.indexDefinitionId });
}

async function inspectProgress(database: FlarexMetadataDatabase, driver: "pglite" | "postgres", pool?: PostgresFlarexPersistence["pool"]) {
  const scopeId = ScopeIdSchema.make("scope_33000000-0000-0000-0000-000000000001");
  await insertCurrentScopeClockFixture(database, { scopeId,
    epoch: "epoch_33000000-0000-0000-0000-000000000002", lastCommitSeq: 10n });
  const definitions = [3, 2, 1].map(id => ({ indexDefinitionId: CatalogIndexDefinitionIdSchema.make(id),
    tableId: CatalogTableIdSchema.make(1), physicalSpecSha256Hex: AppIndexPhysicalSpecSha256HexV1Schema.make("ab".repeat(32)) }));
  await database.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
    yield* Effect.promise(() => tx.insert(fxSystemIndexBuildStates).values(definitions.map(definition => ({
      scopeId, indexDefinitionId: definition.indexDefinitionId, storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: clock.storageGenerationFence, epoch: clock.epoch, startCommitSeq: CommitSeqSchema.make(0n),
      coveredThroughCommitSeq: CommitSeqSchema.make(10n), firstReadableCommitSeq: CommitSeqSchema.make(0n), lifecycle: "enabled" as const,
      cursorCodecVersion: IndexBuildCursorCodecVersionV1Schema.make(1), backfillCursorRowId: new Uint8Array(16),
      attemptFence: IndexBuildAttemptFenceSchema.make(1n),
    }))));
  })));
  const first = definitions[0], later = definitions[1];
  if (first === undefined || later === undefined) throw new Error("Missing progress fixture");
  const where = (id: CatalogIndexDefinitionId) => and(eq(fxSystemIndexBuildStates.scopeId, scopeId), eq(fxSystemIndexBuildStates.indexDefinitionId, id));
  const mutate = async (change: (rows: unknown[]) => void, afterClock?: () => void, contextCause?: Error) => database.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId);
    const session = tx._.session, original = session.prepareQuery;
    const descriptor = Object.getOwnPropertyDescriptor(session, "prepareQuery");
    Object.defineProperty(session, "prepareQuery", { configurable: true,
      value(...args: Parameters<typeof original>) {
        const prepared = original.call(session, ...args);
        if (prepared.getQuery().sql.includes("progress_locked as materialized")) {
          const execute = prepared.execute.bind(prepared);
          Object.defineProperty(prepared, "execute", { value: async (...bindings: Parameters<typeof execute>) => {
            const rows = await execute(...bindings);
            if (!Array.isArray(rows)) throw new Error("Missing native progress mapper output");
            change(rows); return rows;
          } });
        }
        if (contextCause !== undefined && prepared.getQuery().sql.includes(getTableName(fxSystemApplicationActiveHeads)))
          Object.defineProperty(prepared, "execute", { value: () => Promise.reject(contextCause) });
        return prepared;
      } });
    try {
      return yield* Effect.exit(Effect.gen(function* () {
        const capture = yield* readRequiredIndexBuildProgressInTransactionEffect(tx, clock, definitions);
        if (capture.status !== "ready") return capture;
        const observed = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId);
        yield* capture.decodeIntrinsics;
        afterClock?.();
        const context=yield* readIndexCoverageContextInTransactionEffect(tx,observed);
        return yield* capture.acceptCoverage(context);
      }));
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(session, "prepareQuery");
      else Object.defineProperty(session, "prepareQuery", descriptor);
    }
  })));
  const native = await database.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId);
    const rows = yield* Effect.promise(() => prepareRequiredIndexBuildProgressCapture(tx, clock, definitions));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({reason:"captured",lockedCount:"3",ordinal:null,indexDefinitionId:null});
    expect(Object.values(rows[0]?.rawBuild??{}).every(value=>value===null)).toBe(true);
    expect(Object.values(rows[0]?.rawMaintenance??{}).every(value=>value===null)).toBe(true);
    expect(JSON.parse(rows[0]?.progress??"null")).toEqual([["0","10","0",null,null],["0","10","0",null,null],["0","10","0",null,null]]);
    const empty=yield* readRequiredIndexBuildProgressInTransactionEffect(tx,clock,[]);
    if (empty.status!=="ready") throw new Error("Empty demand was unavailable");
    yield* empty.decodeIntrinsics;
    const context=yield* readIndexCoverageContextInTransactionEffect(tx,clock);
    expect(yield* empty.acceptCoverage(context)).toEqual({status:"ready"});
    return rows;
  })));
  expect(native).toHaveLength(1);
  expect(Exit.isSuccess(await mutate(() => undefined))).toBe(true);
  const setCompactProgress = (rows: unknown[],progress: string) => {
    const header=rows[0];
    if (typeof header!=="object" || header===null) throw new Error("Missing actual compact index header");
    Object.defineProperty(header,"progress",{value:progress});
  };
  const compactMiss=await mutate(rows=>setCompactProgress(rows,JSON.stringify([
    ["0","10",null,null,null],["broken","10","0",null,null],["0","10","0",null,null],
  ])));
  if (!Exit.isSuccess(compactMiss)) throw new Error("Later malformed compact state preempted the first coverage miss");
  expect(compactMiss.value).toEqual({status:"not_ready",reason:"notCovered",indexDefinitionId:first.indexDefinitionId});
  const compactFrontier=await mutate(rows=>setCompactProgress(rows,JSON.stringify([
    ["11","11","0",null,null],["broken","10","0",null,null],["0","10","0",null,null],
  ])));
  if (!Exit.isFailure(compactFrontier)) throw new Error("Compact frontier ahead of the actual clock accepted");
  expect(Result.getOrThrow(Cause.findError(compactFrontier.cause))).toMatchObject({
    _tag:"IndexBuildStateCorruptionError",indexDefinitionId:first.indexDefinitionId,
  });
  const beforeCompactContextCause=new Error("Actual canonical context precedes compact parsing");
  const beforeCompactContext=await mutate(rows=>setCompactProgress(rows,"{"),undefined,beforeCompactContextCause);
  if (!Exit.isFailure(beforeCompactContext)) throw new Error("Canonical context fault accepted");
  expect(Result.getOrThrow(Cause.findError(beforeCompactContext.cause)))
    .toMatchObject({_tag:"IndexMaintenanceError",reason:"resourceFailure"});
  // A duplicate header must refuse without accepting or inspecting its body.
  let bodyTouched = false;
  const duplicate = await mutate(rows => {
    const row = rows[0];
    if (typeof row !== "object" || row === null) throw new Error("Missing actual native row");
    Object.defineProperty(row, "ordinal", { value: "1" });
    Object.defineProperty(row, "rawBuild", { get() { bodyTouched = true; throw new Error("Premature body"); } });
  });
  if (!Exit.isFailure(duplicate)) throw new Error("Duplicate progress ordinal accepted");
  expect(Result.getOrThrow(Cause.findError(duplicate.cause))).toMatchObject({ _tag: "IndexMaintenanceError", reason: "storedState" });
  expect(bodyTouched).toBe(false);
  const headerCause = new Error("Original foreign progress header");
  const header = await mutate(rows => {
    const row = rows[0];
    if (typeof row !== "object" || row === null) throw new Error("Missing actual native row");
    Object.defineProperty(row, "lockedCount", { get() { throw headerCause; } });
  });
  if (!Exit.isFailure(header)) throw new Error("Foreign header accepted");
  expect(Result.getOrThrow(Cause.findDefect(header.cause))).toBe(headerCause);
  const [timestamps] = await database.select({ createdAt: fxSystemIndexBuildStates.createdAt,
    updatedAt: fxSystemIndexBuildStates.updatedAt }).from(fxSystemIndexBuildStates).where(where(first.indexDefinitionId));
  if (timestamps === undefined) throw new Error("Missing actual native dates");
  await database.update(fxSystemIndexBuildStates).set({ createdAt: sql`'infinity'::timestamptz`, updatedAt: sql`'infinity'::timestamptz` }).where(where(first.indexDefinitionId));
  await database.update(fxSystemIndexBuildStates).set({ lifecycle: "retiring" }).where(where(later.indexDefinitionId));
  if (pool !== undefined) {
    // Refusing the first input cannot skip a later ascending lock. Hold the
    // largest identity, then observe the actual blocked native statement.
    const blocker = await pool.connect();
    let reader: Promise<"ready" | "not_ready"> | undefined;
    let readerPid: number | undefined;
    let readerSettled = false, freshClockTouched = false;
    const runProgressLockReader = () => database.transaction(tx => runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId);
      const [session] = yield* Effect.promise(() => tx.select({ pid: sql<number>`pg_backend_pid()::int` })
        .from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, scopeId)).limit(1));
      if (session === undefined) return yield* Effect.die("Missing actual lock reader PID");
      readerPid = session.pid;
      const result = yield* readRequiredIndexBuildProgressInTransactionEffect(tx, clock,
        [...definitions.slice(1),first]);
      if (result.status === "ready") {
        freshClockTouched = true;
        yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId);
      }
      return result.status;
    })));
    try {
      await blocker.query("begin");
      await blocker.query(`select 1 from ${getTableName(fxSystemIndexBuildStates)} where scope_id=$1 and index_definition_id=$2 for update`,
        [scopeId, first.indexDefinitionId]);
      const pid = (await blocker.query<{ pid: number }>("select pg_backend_pid()::int as pid")).rows[0]?.pid;
      if (pid === undefined) throw new Error("Missing actual lock holder PID");
      reader = runProgressLockReader().finally(() => { readerSettled = true; });
      // Observe rejection immediately while the monitor polls. Required awaits
      // still use the original promise and retain its exact rejection.
      void reader.catch(() => undefined);
      const deadline = Date.now() + 5_000;
      let blocked = false;
      while (!blocked && Date.now() < deadline) {
        const observed = await pool.query<{ blocked: boolean }>(`select exists(select 1 from pg_stat_activity
          where pid=$2::int and $1::int=any(pg_blocking_pids(pid))
            and wait_event_type='Lock') as blocked`, [pid, readerPid ?? null]);
        blocked = observed.rows[0]?.blocked === true;
        if (!blocked) await delay(25);
      }
      expect(blocked).toBe(true);
      expect(readerSettled).toBe(false);
      expect(freshClockTouched).toBe(false);
      await blocker.query("rollback");
      expect(await reader).toBe("not_ready");
      expect(freshClockTouched).toBe(false);
    } finally {
      await blocker.query("rollback");
      blocker.release();
      if (reader !== undefined) await reader;
    }
  }
  const unavailable = await mutate(rows => {
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (typeof row !== "object" || row === null) throw new Error("Missing availability row");
    Object.defineProperty(row, "rawBuild", { get() { throw new Error("Availability inspected corruption body"); } });
  });
  expect(Exit.isSuccess(unavailable)).toBe(true);
  if (Exit.isSuccess(unavailable)) expect(unavailable.value).toMatchObject({ reason: "notEnabled", indexDefinitionId: later.indexDefinitionId });
  await database.update(fxSystemIndexBuildStates).set({ lifecycle: "enabled", createdAt: sql`'infinity'::timestamptz`,
    updatedAt: sql`'infinity'::timestamptz` }).where(where(later.indexDefinitionId));
  let contextReached = false;
  const getterCause = new Error("Later invalid build original getter");
  const abrupt = await mutate(rows => {
    setCompactProgress(rows,"{");
    for (const row of rows.slice(1, 3)) {
      if (typeof row !== "object" || row === null || !("rawBuild" in row) || typeof row.rawBuild !== "object" || row.rawBuild === null)
        throw new Error("Missing complete invalid native row");
      if (!("backfillCursorRowId" in row.rawBuild) || !(row.rawBuild.backfillCursorRowId instanceof Uint8Array))
        throw new Error("Missing actual native cursor bytes");
      expect(Array.from(row.rawBuild.backfillCursorRowId)).toEqual(Array.from(new Uint8Array(16)));
      expect("createdAt" in row.rawBuild && row.rawBuild.createdAt instanceof Date && Number.isNaN(row.rawBuild.createdAt.getTime())).toBe(true);
    }
    const row = rows[2];
    if (typeof row !== "object" || row === null || !("rawBuild" in row) || typeof row.rawBuild !== "object" || row.rawBuild === null)
      throw new Error("Missing later invalid native row");
    Object.defineProperty(row.rawBuild, "cursorCodecVersion", { get() { throw getterCause; } });
  }, () => { contextReached = true; });
  if (!Exit.isFailure(abrupt)) throw new Error("Later invalid getter did not fail");
  expect(Result.getOrThrow(Cause.findDefect(abrupt.cause))).toBe(getterCause);
  expect(contextReached).toBe(false);
  const contextCause = new Error("Actual context driver refusal");
  const contextFailure = await mutate(() => undefined, () => { contextReached = true; }, contextCause);
  if (!Exit.isFailure(contextFailure)) throw new Error("Context failure was hidden by build corruption");
  expect(Result.getOrThrow(Cause.findError(contextFailure.cause))).toMatchObject({ _tag: "IndexMaintenanceError", reason: "resourceFailure" });
  expect(contextReached).toBe(true);
  const typed = await mutate(() => undefined, () => { contextReached = true; });
  if (!Exit.isFailure(typed)) throw new Error("Invalid native timestamp accepted");
  expect(Result.getOrThrow(Cause.findError(typed.cause))).toMatchObject({ _tag: "IndexBuildStateCorruptionError", indexDefinitionId: first.indexDefinitionId });
  expect(contextReached).toBe(true);
  await database.update(fxSystemIndexBuildStates).set({ ...timestamps, firstReadableCommitSeq: null }).where(where(first.indexDefinitionId));
  const earlierMiss = await mutate(() => undefined);
  if (!Exit.isSuccess(earlierMiss)) throw new Error("Later typed corruption overtook earlier coverage miss");
  expect(earlierMiss.value).toMatchObject({ reason: "notCovered", indexDefinitionId: first.indexDefinitionId });
  await database.update(fxSystemIndexBuildStates).set({ ...timestamps, firstReadableCommitSeq: CommitSeqSchema.make(0n) }).where(eq(fxSystemIndexBuildStates.scopeId, scopeId));
  // The full-progress capture must not compare against the initial clock.
  // PostgreSQL exercises a distinct concurrent ordinary writer. PGlite has one
  // native transaction, so it explicitly refreshes through the existing strong
  // clock owner after the native fixture advance and capture; a raw SQL update
  // alone cannot replace that transaction's genuine writer observation.
  await database.transaction(tx => runEffect(Effect.gen(function* () {
    const initial = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId);
    const advance = Effect.gen(function* () {
      yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId);
      yield* Effect.promise(() => tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(11n) }).where(eq(fxSystemScopeClocks.scopeId, scopeId)));
      yield* Effect.promise(() => tx.update(fxSystemIndexBuildStates).set({ coveredThroughCommitSeq: CommitSeqSchema.make(11n) }).where(eq(fxSystemIndexBuildStates.scopeId, scopeId)));
    });
    if (driver === "postgres") {
      yield* Effect.promise(() => database.transaction(writerTx => runEffect(Effect.gen(function* () {
        yield* lockScopeClockForOrdinaryWriteInTransactionEffect(writerTx, scopeId);
        yield* Effect.promise(() => writerTx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(11n) }).where(eq(fxSystemScopeClocks.scopeId, scopeId)));
        yield* Effect.promise(() => writerTx.update(fxSystemIndexBuildStates).set({ coveredThroughCommitSeq: CommitSeqSchema.make(11n) }).where(eq(fxSystemIndexBuildStates.scopeId, scopeId)));
      }))));
    } else yield* advance;
    const capture = yield* readRequiredIndexBuildProgressInTransactionEffect(tx, initial, definitions);
    if (capture.status !== "ready") throw new Error("Progress became unavailable");
    if (driver === "pglite") {
      const protectedWriter = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId);
      expect(protectedWriter.lastCommitSeq).toBe(10n);
      const refreshedWriter = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
      expect(refreshedWriter.lastCommitSeq).toBe(11n);
    }
    const fresh = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId);
    expect(initial.lastCommitSeq).toBe(10n); expect(fresh.lastCommitSeq).toBe(11n);
    yield* capture.decodeIntrinsics;
    const context=yield* readIndexCoverageContextInTransactionEffect(tx,fresh);
    expect(yield* capture.acceptCoverage(context)).toEqual({status:"ready"});
  })));
}

describe.each(drivers)("compact native index readiness on %s", { concurrent: false }, driver => {
  const withPersistence: WithFileScopedPersistence<PGliteFlarexPersistence | PostgresFlarexPersistence> = driver === "postgres"
    ? useFileScopedPostgresPersistence()
    : useFileScopedPersistence(() => createFileScopedPGliteFixture(async db => () =>
      db.transaction(async transaction => {
        await transaction.exec(`
          delete from fx_system_index_build_state;
          delete from fx_system_scope_execution_authority;
          delete from fx_system_scope_clock;
        `);
      })));

  it("retains full source coverage, phase ordering, exact refusal and writer lifetime", () => withPersistence(async persistence => {
    expect(await persistence.drizzle.select({ id: fxSystemIndexBuildStates.indexDefinitionId })
      .from(fxSystemIndexBuildStates).limit(1)).toEqual([]);
    await inspect(persistence.drizzle);
  }), 180_000);

  it("preserves separate clock cuts, complete availability and eager defect versus ordered typed refusal", () => withPersistence(async persistence => {
    expect(await persistence.drizzle.select({ id: fxSystemIndexBuildStates.indexDefinitionId })
      .from(fxSystemIndexBuildStates).limit(1)).toEqual([]);
    await inspectProgress(persistence.drizzle, driver, "pool" in persistence ? persistence.pool : undefined);
  }), 180_000);
});
