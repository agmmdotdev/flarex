import { Effect, Schema } from "effect";
import { eq } from "drizzle-orm";
import { expect, vi } from "vitest";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogIndexId, decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, ScopeEpochSchema, ScopeIdSchema, projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { FlarexPersistence } from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction } from "../src/appRows";
import { prepareLogicalSearchBuild } from "../src/logicalSearchBuild";
import { readIndexCoverageContextInTransactionEffect, readIndexCoverageTableFrontiersInTransactionEffect, type IndexCoverageContext } from "../src/indexBuildStates";
import { fxSystemScopeClocks, fxSystemSearchBuildStates } from "../src/schema";
import { getScopeClock } from "../src/scopeClock";
import type { TrustedScopeAuthority } from "../src/scopeAuthorityResolution";

// The control-catalog preparation is isolated here so this scenario exercises
// the target-local SQL with arbitrary selected definitions, independent of a
// framework's source names. Connected compiled-source proofs run separately.
const selected = vi.hoisted(() => [
  { tableId: 11, logicalIndexId: 101, kind: "jsonContainment", sourceSha256: "a".repeat(64) },
  { tableId: 11, logicalIndexId: 102, kind: "text", sourceSha256: "a".repeat(64) },
  { tableId: 12, logicalIndexId: 103, kind: "text", sourceSha256: "b".repeat(64) },
  { tableId: 13, logicalIndexId: 104, kind: "jsonContainment", sourceSha256: "c".repeat(64) },
  ...Array.from({ length: 66 }, (_, index) => ({
    tableId: 11 + index % 3,
    logicalIndexId: 105 + index,
    kind: index % 2 === 0 ? "text" : "jsonContainment",
    sourceSha256: ["a", "b", "c"][index % 3]!.repeat(64),
  })),
]);

vi.mock("../src/logicalStorageDefinitions", async importOriginal => {
  const { Effect } = await import("effect");
  const original = await importOriginal<typeof import("../src/logicalStorageDefinitions")>();
  return { ...original, readLogicalStorageRequirements: () => Effect.succeed({ search: selected.map(definition => ({
    ...definition, descriptor: { id: definition.logicalIndexId },
  })) }) };
});
vi.mock("../src/stableLogicalIndexCatalog", async importOriginal => {
  const { Effect } = await import("effect");
  const original = await importOriginal<typeof import("../src/stableLogicalIndexCatalog")>();
  return { ...original, getStableLogicalIndexIdentityByNameEffect: (_db: unknown, input: { descriptor: { id: number } }) =>
    Effect.succeed({ logicalIndexId: input.descriptor.id }) };
});

const scopeId = ScopeIdSchema.make("scope_66100000-0000-0000-0000-000000000001");
const epoch = ScopeEpochSchema.make("epoch_66100000-0000-0000-0000-000000000002");
const schemaVersionId = decodeCatalogSchemaVersionId("search_batch_neutral");

interface InspectCounts { states: number; physical: number; frontiers: number }
const decodeFrontierDriverResponse = Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(Schema.Unknown) }));

/** Observe target-local statement categories without replacing their results. */
function observeTransaction(tx: FlarexMetadataTransaction, counts: InspectCounts,
  failFrontiers = false, corruptFrontierOrdinal?: number): FlarexMetadataTransaction {
  return new Proxy(tx, {
    get(target, property, receiver) {
      if (property === "select") return (fields?: Record<string, unknown>) => {
        if (fields !== undefined && "sourceSha256" in fields) counts.states++;
        if (fields !== undefined && "jsonReady" in fields) counts.physical++;
        return fields === undefined ? target.select() : target.select(fields as never);
      };
      if (property === "execute") return (statement: Parameters<typeof target.execute>[0]) => {
        counts.frontiers++;
        if (failFrontiers) return Promise.reject(new Error("Later frontier query must not run"));
        const query = target.execute(statement);
        if (corruptFrontierOrdinal === undefined) return query;
        // Corrupt only one actual driver field. The real frontier decoder and
        // issuer retain the per-table failure; no readiness verdict is mocked.
        return query.then(result => {
          const response = decodeFrontierDriverResponse(result);
          return { ...response, rows: response.rows.map((row, ordinal) => ordinal === corruptFrontierOrdinal
            ? { ordinal, commitSeqText: "not-an-integer" } : row) };
        });
      };
      return Reflect.get(target, property, receiver);
    },
  });
}

/** Same multi-table, multi-descriptor serving/refusal witness on both drivers. */
export async function verifyLogicalSearchBuildBatch(
  persistence: Pick<FlarexPersistence, "query">,
  db: FlarexMetadataDatabase,
) {
  await persistence.query(
    "insert into fx_system_scope_clock (scope_id, storage_generation, epoch) values ($1, 'flarexdb_v1', $2)",
    [scopeId, epoch],
  );
  const clock = await getScopeClock(db, scopeId);
  if (clock === null) throw new Error("Missing search fixture clock");
  const authority: TrustedScopeAuthority = {
    deploymentId: "neutral_search_deployment", scopeId,
    physicalLocator: { kind: "shared_database", databaseKey: "search-batch", schemaName: "public" },
    storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence,
    epoch: clock.epoch, lastCommitSeq: clock.lastCommitSeq,
  };
  const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
  await db.insert(fxSystemSearchBuildStates).values(selected.map(definition => ({
    scopeUuid, tableId: decodeCatalogTableId(definition.tableId),
    logicalIndexId: decodeCatalogIndexId(definition.logicalIndexId),
    sourceSha256: definition.sourceSha256, lifecycle: "ready" as const,
    coveredThroughCommitSeq: CommitSeqSchema.make(0n),
  })));
  const build = await Effect.runPromise(prepareLogicalSearchBuild(db, authority.deploymentId, schemaVersionId, { kind: "fresh" }));
  expect(build.definitionCount).toBe(70);
  const inspect = (atClock = clock, failFrontiers = false, coverage?: IndexCoverageContext) => {
    const counts: InspectCounts = { states: 0, physical: 0, frontiers: 0 };
    return db.transaction(async tx => ({
      verdict: await Effect.runPromise(build.inspect(observeTransaction(tx, counts, failFrontiers), authority, atClock, coverage)),
      counts,
    }));
  };
  const initial = await inspect();
  expect(initial.verdict).toEqual({ status: "ready", definitionCount: 70 });
  expect(initial.counts).toEqual({ states: 2, physical: 1, frontiers: 1 });
  let foreignCoverage: IndexCoverageContext | undefined;
  await db.transaction(async tx => {
    const counts: InspectCounts = { states: 0, physical: 0, frontiers: 0 };
    const observed = observeTransaction(tx, counts);
    const coverage = await Effect.runPromise(readIndexCoverageContextInTransactionEffect(observed, clock));
    foreignCoverage = coverage;
    await Effect.runPromise(readIndexCoverageTableFrontiersInTransactionEffect(observed, coverage,
      [11, 12, 13].map(value => decodeCatalogTableId(value))));
    const beforeSearch = counts.frontiers;
    expect(await Effect.runPromise(build.inspect(observed, authority, clock, coverage)))
      .toEqual({ status: "ready", definitionCount: 70 });
    expect(counts.frontiers).toBe(beforeSearch);
    const beforeChangedClock = counts.frontiers;
    expect(await Effect.runPromise(build.inspect(observed, authority,
      { ...clock, updatedAt: new Date(clock.updatedAt.getTime() + 1) }, coverage)))
      .toEqual({ status: "ready", definitionCount: 70 });
    expect(counts.frontiers).toBe(beforeChangedClock + 1);
    // A legitimate proof lacking one selected table cannot lend a partial map.
    const partial = await Effect.runPromise(readIndexCoverageContextInTransactionEffect(observed, clock));
    await Effect.runPromise(readIndexCoverageTableFrontiersInTransactionEffect(observed, partial,
      [decodeCatalogTableId(11)]));
    const beforePartial = counts.frontiers;
    expect(await Effect.runPromise(build.inspect(observed, authority, clock, partial)))
      .toEqual({ status: "ready", definitionCount: 70 });
    expect(counts.frontiers).toBe(beforePartial + 1);
  });
  await db.transaction(async tx => {
    const counts: InspectCounts = { states: 0, physical: 0, frontiers: 0 };
    const verdict = await Effect.runPromise(Effect.result(build.inspect(observeTransaction(tx, counts), authority, clock, foreignCoverage)));
    expect(verdict).toMatchObject({ _tag: "Failure", failure: { reason: "statementFailure" } });
    expect(counts).toEqual({ states: 1, physical: 1, frontiers: 0 });
  });
  const inspectPrefetchedCorruptFrontier = (tableIds = [11, 12, 13]) => db.transaction(async tx => {
    const counts: InspectCounts = { states: 0, physical: 0, frontiers: 0 };
    const observed = observeTransaction(tx, counts, false, 2);
    const coverage = await Effect.runPromise(readIndexCoverageContextInTransactionEffect(observed, clock));
    await Effect.runPromise(readIndexCoverageTableFrontiersInTransactionEffect(observed, coverage,
      [11, 12, 13].map(value => decodeCatalogTableId(value))));
    expect(counts.frontiers).toBe(1);
    const beforeSearch = { ...counts };
    const verdict = await Effect.runPromise(Effect.result(build.selectTables(tableIds.map(value => decodeCatalogTableId(value)))
      .inspectSelected(observed, authority, clock, coverage)));
    return { verdict, counts: { states: counts.states - beforeSearch.states,
      physical: counts.physical - beforeSearch.physical, frontiers: counts.frontiers - beforeSearch.frontiers } };
  });
  const corruptLater = await inspectPrefetchedCorruptFrontier();
  expect(corruptLater.verdict).toMatchObject({ _tag: "Failure", failure: { reason: "statementFailure" } });
  expect(corruptLater.counts).toEqual({ states: 1, physical: 1, frontiers: 0 });
  // The same prefetched corrupt table does not contaminate another selection.
  expect((await inspectPrefetchedCorruptFrontier([11])).verdict)
    .toMatchObject({ _tag: "Success", success: { status: "ready", definitionCount: 24 } });
  const selectedTable = build.selectTables([decodeCatalogTableId(11)]);
  const inspectSelected = () => db.transaction(tx => Effect.runPromise(selectedTable.inspectSelected(tx, authority, clock)));
  expect(await inspectSelected()).toEqual({ status: "ready", definitionCount: 24 });
  // A selected mutable miss is distinct from unrelated mutable state. Both
  // selections still authenticate their actual live physical GIN facts.
  const unrelated = await db.select().from(fxSystemSearchBuildStates)
    .where(eq(fxSystemSearchBuildStates.logicalIndexId, decodeCatalogIndexId(103)));
  await db.delete(fxSystemSearchBuildStates).where(eq(fxSystemSearchBuildStates.logicalIndexId, decodeCatalogIndexId(103)));
  expect(await inspectSelected()).toEqual({ status: "ready", definitionCount: 24 });
  expect((await inspect()).verdict).toEqual({ status: "not_ready", reason: "uncovered" });
  await db.insert(fxSystemSearchBuildStates).values(unrelated);

  // A later transaction must reject a changed physical identity even when the
  // same prepared source selection and coverage rows are reused.
  await persistence.query("alter index fx_app_search_entry_current_lookup_gin rename to fx_test_changed_search_gin");
  try {
    expect((await inspect()).verdict).toEqual({ status: "not_ready", reason: "uncovered" });
    expect(await inspectSelected()).toEqual({ status: "not_ready", reason: "uncovered" });
    const physicalBeforeCorruption = await inspectPrefetchedCorruptFrontier();
    expect(physicalBeforeCorruption.verdict).toMatchObject({ _tag: "Success", success: { status: "not_ready", reason: "uncovered" } });
    expect(physicalBeforeCorruption.counts).toEqual({ states: 1, physical: 1, frontiers: 0 });
    await persistence.query(`create index fx_app_search_entry_current_lookup_gin
      on fx_app_search_entry_current using gin
        (scope_uuid public.uuid_ops, logical_index_id public.int4_ops, field_id public.gin_trgm_ops)`);
    expect((await inspect()).verdict).toEqual({ status: "not_ready", reason: "uncovered" });
    expect(await inspectSelected()).toEqual({ status: "not_ready", reason: "uncovered" });
  } finally {
    await persistence.query("drop index if exists fx_app_search_entry_current_lookup_gin");
    await persistence.query("alter index fx_test_changed_search_gin rename to fx_app_search_entry_current_lookup_gin");
  }
  expect((await inspect()).verdict).toEqual({ status: "ready", definitionCount: 70 });

  // A same-name JSON index with a different operator class is not the
  // declared containment path, even though it remains a valid GIN index.
  await persistence.query("alter index fx_app_json_entry_current_lookup_gin rename to fx_test_changed_json_gin");
  try {
    await persistence.query(`create index fx_app_json_entry_current_lookup_gin
      on fx_app_json_entry_current using gin
        (scope_uuid public.uuid_ops, logical_index_id public.int4_ops, value_json jsonb_ops)`);
    expect((await inspect()).verdict).toEqual({ status: "not_ready", reason: "uncovered" });
    expect(await inspectSelected()).toEqual({ status: "not_ready", reason: "uncovered" });
  } finally {
    await persistence.query("drop index if exists fx_app_json_entry_current_lookup_gin");
    await persistence.query("alter index fx_test_changed_json_gin rename to fx_app_json_entry_current_lookup_gin");
  }
  expect((await inspect()).verdict).toEqual({ status: "ready", definitionCount: 70 });

  await db.delete(fxSystemSearchBuildStates).where(eq(fxSystemSearchBuildStates.logicalIndexId, decodeCatalogIndexId(102)));
  expect((await inspect()).verdict).toEqual({ status: "not_ready", reason: "uncovered" });
  expect(await inspectSelected()).toEqual({ status: "not_ready", reason: "uncovered" });
  await db.insert(fxSystemSearchBuildStates).values({
    scopeUuid, tableId: decodeCatalogTableId(11), logicalIndexId: decodeCatalogIndexId(102),
    sourceSha256: "d".repeat(64), lifecycle: "ready",
    coveredThroughCommitSeq: CommitSeqSchema.make(0n),
  });
  expect((await inspect()).verdict).toEqual({ status: "not_ready", reason: "uncovered" });
  await db.update(fxSystemSearchBuildStates).set({ sourceSha256: "a".repeat(64) })
    .where(eq(fxSystemSearchBuildStates.logicalIndexId, decodeCatalogIndexId(102)));

  const tableId = decodeCatalogTableId(13);
  const rowId = decodeAppRowIdHexV1("11".repeat(16));
  const creationTime = decodeAppCreationTimeV1(1);
  const document = await canonicalizeAppDocumentV1({ tableId, rowId, creationTime, fields: { title: "later" } });
  await db.transaction(async tx => {
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live", scopeId, tableId, rowId, writeEpoch: epoch,
      commitSeq: CommitSeqSchema.make(1n), prevCommitSeq: null, schemaVersionId,
      creationTime, value: { codecVersion: document.codecVersion, valueJson: document.valueJson,
        canonicalBytes: document.canonicalBytes, sha256: document.sha256 },
    });
    await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(1n) })
      .where(eq(fxSystemScopeClocks.scopeId, scopeId));
  });
  expect((await inspect()).verdict).toEqual({ status: "not_ready", reason: "uncovered" });
  await db.update(fxSystemSearchBuildStates).set({ coveredThroughCommitSeq: CommitSeqSchema.make(1n) })
    .where(eq(fxSystemSearchBuildStates.tableId, decodeCatalogTableId(13)));
  expect((await inspect(await getScopeClock(db, scopeId) ?? clock)).verdict)
    .toEqual({ status: "ready", definitionCount: 70 });

  // A known first-member refusal must finish before the later physical and
  // frontier statements, even when those statements would fail if reached.
  await db.delete(fxSystemSearchBuildStates).where(eq(fxSystemSearchBuildStates.logicalIndexId, decodeCatalogIndexId(101)));
  const missingFirst = await inspect(await getScopeClock(db, scopeId) ?? clock, true, foreignCoverage);
  expect(missingFirst.verdict).toEqual({ status: "not_ready", reason: "uncovered" });
  expect(missingFirst.counts).toEqual({ states: 1, physical: 0, frontiers: 0 });
  // An already-gathered later failure must not precede missing first state.
  const missingBeforeCorruption = await inspectPrefetchedCorruptFrontier();
  expect(missingBeforeCorruption.verdict).toMatchObject({ _tag: "Success", success: { status: "not_ready", reason: "uncovered" } });
  expect(missingBeforeCorruption.counts).toEqual({ states: 1, physical: 0, frontiers: 0 });
}
