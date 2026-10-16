import { and, eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Result } from "effect";
import { CatalogIndexDefinitionIdSchema, CatalogTableIdSchema, type CatalogIndexDefinitionId } from "flarex-protocol/catalog";
import { IndexBuildAttemptFenceSchema, IndexBuildCursorCodecVersionV1Schema } from "flarex-protocol/index-build-state";
import { CommitSeqSchema, FlarexDbV1StorageGenerationSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import { createPGlitePersistence } from "../../../src/database/pglite";
import { fxSystemIndexBuildStates } from "../../../src/database/schema";
import { lockScopeClockForUpdateInTransactionEffect } from "../../../src/scope/scopeClock";
import { acceptSelectedIndexBuildLocksInTransactionEffect } from "../../../src/storage/indexes/indexBuildStates";
import { prepareSelectedIndexBuildLockAcceptance } from "../../../src/storage/indexes/nativeIndexBuildAcceptance";
import { insertCurrentScopeClockFixture } from "../../scope/scopeClockFixture";
import { postgresUrl, withTemporaryPostgresPersistence } from "../../support/postgresHelpers";
import { newTestPGlite } from "../../support/pgliteSearchExtensions";
import { migratedPGliteDataDir } from "../../support/pgliteTestFixture";

const drivers = postgresUrl === null ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

async function inspect(database: FlarexMetadataDatabase) {
  const scopeId = ScopeIdSchema.make("scope_11111111-1111-4111-8111-111111111111");
  await insertCurrentScopeClockFixture(database, { scopeId,
    epoch: "epoch_22222222-2222-4222-8222-222222222222", lastCommitSeq: 10n });
  const definitions = [2, 1].map(id => ({ indexDefinitionId: CatalogIndexDefinitionIdSchema.make(id),
    access: { kind: "by_creation_time" as const, tableId: CatalogTableIdSchema.make(1) } }));
  await database.transaction(tx => Effect.runPromise(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
    expect(clock.storageGeneration).toBe("flarexdb_v1");
    yield* Effect.promise(() => tx.insert(fxSystemIndexBuildStates).values(definitions.map(definition => ({
      scopeId: clock.scopeId, indexDefinitionId: definition.indexDefinitionId,
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"), storageGenerationFence: clock.storageGenerationFence,
      epoch: clock.epoch, startCommitSeq: CommitSeqSchema.make(0n), coveredThroughCommitSeq: CommitSeqSchema.make(10n),
      firstReadableCommitSeq: CommitSeqSchema.make(0n), lifecycle: "enabled" as const, cursorCodecVersion: IndexBuildCursorCodecVersionV1Schema.make(1),
      backfillCursorRowId: null, attemptFence: IndexBuildAttemptFenceSchema.make(1n),
    }))));
  })));
  const execute = () => database.transaction(tx => Effect.runPromise(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
    const rows = yield* Effect.promise(() => prepareSelectedIndexBuildLockAcceptance(tx, clock, definitions, "input"));
    return { rows, verdict: yield* acceptSelectedIndexBuildLocksInTransactionEffect(tx, clock, definitions, "input").pipe(Effect.result) };
  })));
  const accepted = await execute();
  expect(accepted.verdict).toMatchObject({ _tag: "Success" });
  expect(accepted.rows).toHaveLength(1);
  expect(accepted.rows[0]?.reason).toBe("accepted");
  expect(accepted.rows[0]?.ordinal).toBeNull();
  expect(Object.values(accepted.rows[0]?.build ?? {})).toEqual(expect.arrayContaining([null]));
  expect(Object.values(accepted.rows[0]?.build ?? {}).every(value => value === null)).toBe(true);
  expect(Object.values(accepted.rows[0]?.maintenance ?? {}).every(value => value === null)).toBe(true);

  const first = definitions[0], second = definitions[1];
  if (first === undefined || second === undefined) throw new Error("Missing ordered native build fixture");
  const corruptHeader = (getterCause?: Error) => database.transaction(tx => Effect.runPromise(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
    const session = tx._.session;
    const original = session.prepareQuery;
    const descriptor = Object.getOwnPropertyDescriptor(session, "prepareQuery");
    Object.defineProperty(session, "prepareQuery", { configurable: true,
      value(...args: Parameters<typeof original>) {
        const prepared = original.call(session, ...args);
        if (prepared.getQuery().sql.includes("for share of build_row")) {
          const execute = prepared.execute.bind(prepared);
          Object.defineProperty(prepared, "execute", { value: async (...bindings: Parameters<typeof execute>) => {
            const rows = await execute(...bindings);
            if (!Array.isArray(rows) || typeof rows[0] !== "object" || rows[0] === null)
              throw new Error("Missing actual native settlement mapper output");
            Object.defineProperty(rows[0], "indexDefinitionId", getterCause === undefined
              ? { value: first.indexDefinitionId } : { get() { throw getterCause; } });
            Object.defineProperty(rows[0], "build", { get() { throw new Error("Unused success body accessed"); } });
            return rows;
          } });
        }
        return prepared;
      } });
    try { return yield* Effect.exit(acceptSelectedIndexBuildLocksInTransactionEffect(tx, clock, definitions, "input")); }
    finally {
      if (descriptor === undefined) Reflect.deleteProperty(session, "prepareQuery");
      else Object.defineProperty(session, "prepareQuery", descriptor);
    }
  })));
  const forged = await corruptHeader();
  if (!Exit.isFailure(forged)) throw new Error("Forged native settlement header was accepted");
  expect(Cause.hasDies(forged.cause)).toBe(false);
  expect(Result.getOrThrow(Cause.findError(forged.cause))).toMatchObject({ _tag: "IndexMaintenanceError", reason: "storedState" });
  const headerCause = new Error("Foreign native settlement header getter");
  const abrupt = await corruptHeader(headerCause);
  if (!Exit.isFailure(abrupt)) throw new Error("Throwing native settlement header was accepted");
  expect(Cause.hasDies(abrupt.cause)).toBe(true);
  expect(Result.getOrThrow(Cause.findDefect(abrupt.cause))).toBe(headerCause);
  const where = (id: CatalogIndexDefinitionId) => and(eq(fxSystemIndexBuildStates.scopeId, scopeId), eq(fxSystemIndexBuildStates.indexDefinitionId, id));
  // This corruption is in the first input member, despite ascending lock order
  // elsewhere. The exact original decoder must refuse before a later frontier.
  const [originalTimestamps] = await database.select({
    createdAt: fxSystemIndexBuildStates.createdAt,
    updatedAt: fxSystemIndexBuildStates.updatedAt,
  }).from(fxSystemIndexBuildStates).where(where(first.indexDefinitionId));
  if (originalTimestamps === undefined) throw new Error("Missing native build timestamps");
  await database.update(fxSystemIndexBuildStates).set({
    createdAt: sql`'infinity'::timestamptz`,
    updatedAt: sql`'infinity'::timestamptz`,
  }).where(where(first.indexDefinitionId));
  await database.update(fxSystemIndexBuildStates).set({ startCommitSeq: CommitSeqSchema.make(11n) }).where(where(second.indexDefinitionId));
  const corrupt = await execute();
  expect(corrupt.rows).toHaveLength(1);
  expect(corrupt.rows[0]).toMatchObject({ reason: "invalid", ordinal: "1", indexDefinitionId: first.indexDefinitionId,
    build: { lifecycle: "enabled" } });
  expect(corrupt.verdict).toMatchObject({ _tag: "Failure", failure: { _tag: "IndexBuildStateCorruptionError",
    indexDefinitionId: first.indexDefinitionId } });
  await database.update(fxSystemIndexBuildStates).set({
    ...originalTimestamps, lifecycle: "retiring",
  }).where(where(first.indexDefinitionId));
  const unavailable = await execute();
  expect(unavailable.rows[0]).toMatchObject({ reason: "unavailable", ordinal: "1" });
  expect(unavailable.verdict).toMatchObject({ _tag: "Failure", failure: { _tag: "IndexMaintenanceError", reason: "storedState" } });
  expect(Result.isFailure(unavailable.verdict)).toBe(true);
}

describe.each(drivers)("compact native settlement build acceptance on %s", driver => {
  it("returns one small success and retains the original ordered native corruption/refusal", async () => {
    if (driver === "postgres") return withTemporaryPostgresPersistence(persistence => inspect(persistence.drizzle));
    const client = newTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
    try {
      const persistence = await createPGlitePersistence({ db: client });
      await inspect(persistence.drizzle);
    }
    finally { await client.close(); }
  }, 180_000);
});
