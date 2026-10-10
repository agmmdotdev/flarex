import { runEffect } from "../support/effectTestRuntime";
import { fxSystemIndexMaintenanceObligations } from "../../src/database/schema";
import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { CommitSeqSchema, ScopeEpochSchema, ReplacementScopeIdV1Schema, SnapshotTokenSchema,
  StorageGenerationFenceSchema, FlarexDbV1StorageGenerationSchema, projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { CatalogIndexDefinitionIdSchema, CatalogTableIdSchema, CatalogUniqueConstraintDefinitionIdSchema } from "flarex-protocol/catalog";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { IndexBuildAttemptFenceSchema, IndexBuildCursorCodecVersionV1Schema } from "flarex-protocol/index-build-state";
import { AppUniqueConstraintSetBuildAttemptFenceV1Schema } from "flarex-protocol/internal/app-unique-constraint-set-v1";
import { APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1 } from "flarex-protocol/ordered-index";
import { canonicalizeAppIndexPhysicalSpecV1, canonicalAppIndexPhysicalSpecBytesHexV1ToBytes,
  appIndexPhysicalSpecSha256HexV1ToBytes } from "flarex-protocol/index-definition";
import type { FlarexPersistence } from "../../src";
import type { FlarexMetadataDatabase } from "../../src/application/deployments";
import { advanceUnboundUniqueCoverageInTransactionEffect } from "../../src/storage/unique/appUniqueConstraintSetBuildV1";
import { locateAppIndexDefinitionByIdEffect } from "../../src/storage/indexes/appIndexDefinitions";
import { decodeIndexBuildStateRowResult, indexBuildStateSelection, indexMaintenanceBindingPredicate } from "../../src/storage/indexes/indexBuildStates";
import { materializeAcceptedApplicationPublicationRows } from "../../src/storage/materialization/materialization";
import { prepareApplicationDocumentSettlementEffect } from "../../src/storage/materialization/settlementPlan";
import { acceptApplicationPublication } from "../../src/storage/materialization/publicationAcceptance";
import { lockScopeClockForOrdinaryWriteInTransactionEffect } from "../../src/scope/scopeClock";
import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "../../src/installation/installationLifecycle";
import { fxControlIndexDefinitions, fxControlTables, fxSystemIndexBuildStates,
  fxSystemScopeClocks, fxSystemUniqueConstraintBuilds } from "../../src/database/schema";
import { createPGlitePersistence } from "../../src/database/pglite";
import { createPostgresPersistence } from "../../src/database/postgres";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { postgresUrl, withTemporaryPostgresSchema } from "../support/postgresHelpers";
import {
  insertSessionTestScope,
  SESSION_TEST_EPOCH_UUID,
  SESSION_TEST_SCOPE_UUID,
} from "../execution/session/support/sessionStorage";

type TestPersistence = Pick<FlarexPersistence, "query" | "migrate" | "insertDeploymentMetadata" | "insertScopeMetadata"> &
  { readonly drizzle: FlarexMetadataDatabase };

async function proveFencedUniqueCoverageBatch(persistence: TestPersistence) {
  await persistence.migrate();
  await insertSessionTestScope(persistence);
  const scopeId = ReplacementScopeIdV1Schema.make(`scope_${SESSION_TEST_SCOPE_UUID}`);
  const schemaVersionId = CatalogSchemaVersionIdSchema.make("coverage_batch");
  const ids = Array.from({ length: 33 }, (_, ordinal) => CatalogUniqueConstraintDefinitionIdSchema.make(1001 + ordinal));
  await persistence.drizzle.insert(fxSystemUniqueConstraintBuilds).values(ids.map(uniqueConstraintDefinitionId => ({
    scopeId, uniqueConstraintDefinitionId, storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(1n),
    epoch: ScopeEpochSchema.make(`epoch_${SESSION_TEST_EPOCH_UUID}`), startCommitSeq: CommitSeqSchema.make(0n),
    lifecycle: "enabled", coveredThroughCommitSeq: CommitSeqSchema.make(0n),
    attemptFence: AppUniqueConstraintSetBuildAttemptFenceV1Schema.make(1n),
  } satisfies typeof fxSystemUniqueConstraintBuilds.$inferInsert)));
  const selected = async () => (await persistence.drizzle.select().from(fxSystemUniqueConstraintBuilds)
    .orderBy(asc(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId)))
    .map(state => ({ state: { ...state, maintenance: null }, schemaVersionId }));
  const coverage = async () => persistence.drizzle.select().from(fxSystemUniqueConstraintBuilds)
    .where(eq(fxSystemUniqueConstraintBuilds.scopeId, scopeId))
    .orderBy(asc(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId));

  const initial = await selected();
  await persistence.drizzle.transaction(async tx => {
    await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
    try {
      return await Effect.runPromise(advanceUnboundUniqueCoverageInTransactionEffect(tx, initial, CommitSeqSchema.make(1n)));
    } finally { closeInstallationAdmission(tx); }
  });
  expect((await coverage()).map(row => row.coveredThroughCommitSeq)).toEqual(ids.map(() => 1n));

  await persistence.drizzle.update(fxSystemUniqueConstraintBuilds).set({ coveredThroughCommitSeq: CommitSeqSchema.make(0n) })
    .where(eq(fxSystemUniqueConstraintBuilds.scopeId, scopeId));
  const stale = await selected();
  const lastId = ids[32]!;
  await persistence.drizzle.update(fxSystemUniqueConstraintBuilds).set({ attemptFence: AppUniqueConstraintSetBuildAttemptFenceV1Schema.make(2n) })
    .where(and(eq(fxSystemUniqueConstraintBuilds.scopeId, scopeId),
      eq(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId, lastId)));
  await expect(persistence.drizzle.transaction(async tx => {
    await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
    try {
      return await Effect.runPromise(advanceUnboundUniqueCoverageInTransactionEffect(tx, stale, CommitSeqSchema.make(1n)));
    } finally { closeInstallationAdmission(tx); }
  }))
    .rejects.toMatchObject({ reason: "concurrentStateChange" });
  expect((await coverage()).map(row => row.coveredThroughCommitSeq)).toEqual(ids.map(() => 0n));

  const missing = await selected();
  await persistence.drizzle.delete(fxSystemUniqueConstraintBuilds).where(and(
    eq(fxSystemUniqueConstraintBuilds.scopeId, scopeId),
    eq(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId, lastId)));
  await expect(persistence.drizzle.transaction(async tx => {
    await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
    try {
      return await Effect.runPromise(advanceUnboundUniqueCoverageInTransactionEffect(tx, missing, CommitSeqSchema.make(1n)));
    } finally { closeInstallationAdmission(tx); }
  }))
    .rejects.toMatchObject({ reason: "concurrentStateChange" });
  expect((await coverage()).map(row => row.coveredThroughCommitSeq)).toEqual(ids.slice(0, 32).map(() => 0n));
}

async function proveFencedIndexCoverageBatch(persistence: TestPersistence) {
  const scopeId = ReplacementScopeIdV1Schema.make(`scope_${SESSION_TEST_SCOPE_UUID}`);
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make("deployment_coverage_batch");
  const schemaVersionId = CatalogSchemaVersionIdSchema.make("coverage_batch");
  await persistence.insertDeploymentMetadata({ deploymentId, projectId: "project_coverage_batch" });
  await persistence.insertScopeMetadata({ deploymentId, scopeId,
    physicalLocator: { kind: "shared_database", databaseKey: "coverage_batch", schemaName: "public" } });
  const ids = Array.from({ length: 65 }, (_, ordinal) => CatalogIndexDefinitionIdSchema.make(2001 + ordinal));
  const tables = ids.map(id => CatalogTableIdSchema.make(id));
  await persistence.drizzle.insert(fxControlTables).values(tables.map(tableId => ({
    deploymentId, tableId, namespace: "app", logicalName: `table_${tableId}`,
  } satisfies typeof fxControlTables.$inferInsert)));
  const physical = await canonicalizeAppIndexPhysicalSpecV1(APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1);
  await persistence.drizzle.insert(fxControlIndexDefinitions).values(ids.map((indexDefinitionId, ordinal) => ({
    deploymentId, indexDefinitionId, accessKind: "by_creation_time", accessIdentityId: tables[ordinal]!,
    tableId: tables[ordinal]!, logicalIndexId: null, physicalSpecCodecVersion: physical.codecVersion,
    physicalSpecJson: physical.physicalSpec,
    physicalSpecBytes: canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(physical.canonicalBytesHex),
    physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(physical.sha256Hex),
  } satisfies typeof fxControlIndexDefinitions.$inferInsert)));
  await persistence.drizzle.insert(fxSystemIndexBuildStates).values(ids.map(indexDefinitionId => ({
    scopeId, indexDefinitionId, storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(1n),
    epoch: ScopeEpochSchema.make(`epoch_${SESSION_TEST_EPOCH_UUID}`), startCommitSeq: CommitSeqSchema.make(0n),
    lifecycle: "enabled", coveredThroughCommitSeq: CommitSeqSchema.make(0n), firstReadableCommitSeq: CommitSeqSchema.make(0n),
    cursorCodecVersion: IndexBuildCursorCodecVersionV1Schema.make(1), attemptFence: IndexBuildAttemptFenceSchema.make(1n),
  } satisfies typeof fxSystemIndexBuildStates.$inferInsert)));
  await persistence.drizzle.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(1n) })
    .where(eq(fxSystemScopeClocks.scopeId, scopeId));
  const selected = async () => {
    const builds = await persistence.drizzle.select(indexBuildStateSelection()).from(fxSystemIndexBuildStates)
      .leftJoin(fxSystemIndexMaintenanceObligations, indexMaintenanceBindingPredicate())
      .where(eq(fxSystemIndexBuildStates.scopeId, scopeId)).orderBy(asc(fxSystemIndexBuildStates.indexDefinitionId));
    const members = [];
    for (const row of builds) {
      const definition = await Effect.runPromise(locateAppIndexDefinitionByIdEffect(
        persistence.drizzle, scopeId, row.indexDefinitionId));
      if (definition === null) throw new Error("Missing selected index definition");
      const build = await Effect.runPromise(Effect.fromResult(decodeIndexBuildStateRowResult(row, scopeId, row.indexDefinitionId, row.maintenanceObligation)));
      members.push({ definition, build });
    }
    return members;
  };
  const coverage = async () => (await persistence.drizzle.select(indexBuildStateSelection()).from(fxSystemIndexBuildStates)
      .leftJoin(fxSystemIndexMaintenanceObligations, indexMaintenanceBindingPredicate())
    .where(eq(fxSystemIndexBuildStates.scopeId, scopeId)).orderBy(asc(fxSystemIndexBuildStates.indexDefinitionId)))
    .map(row => row.coveredThroughCommitSeq);
  const lastId = ids[64]!;
  const advance = (members: Awaited<ReturnType<typeof selected>>, damage?: "fence" | "missing") => persistence.drizzle.transaction(async tx => {
    await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
    try {
      const clock = await Effect.runPromise(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId));
      const command = {
          authorityPins: { deploymentId, scopeId, schemaVersionId,
            snapshotToken: SnapshotTokenSchema.make({ scopeId, epoch: clock.epoch, commitSeq: clock.lastCommitSeq }) }, rowIntents: [], dependencies: [],
        };
      const intrinsic=members.map(member=>member.definition);
      const settlement=await runEffect(prepareApplicationDocumentSettlementEffect(command,[],[],[],null,intrinsic));
      const accepted=await runEffect(acceptApplicationPublication(tx,{clock:{record:clock,scopeUuid:projectScopeIdUuidV1(scopeId).scopeUuid},
        settlement,intrinsic,developer:[],unique:[],relations:null,indexRanges:[],relationDependencies:[],candidate:false,deadline:null,oldestAvailableCommitSeq:0n}));
      const complete = await runEffect(materializeAcceptedApplicationPublicationRows(tx, {
        accepted,commitSeq: CommitSeqSchema.make(2n),publicationProfile: "sourceBound", options: {}, deferCoverage: true,
      }));
      if (complete === undefined) throw new Error("Expected deferred coverage completion");
      expect((await tx.select().from(fxSystemIndexBuildStates)).map(row => row.coveredThroughCommitSeq))
        .toEqual(ids.map(() => 1n));
      // Damage only after the real materializer has checked and lowered the
      // baseline, so the final member refuses inside coverage completion.
      const last = and(eq(fxSystemIndexBuildStates.scopeId, scopeId), eq(fxSystemIndexBuildStates.indexDefinitionId, lastId));
      if (damage === "fence") await tx.update(fxSystemIndexBuildStates)
        .set({ attemptFence: IndexBuildAttemptFenceSchema.make(2n) }).where(last);
      if (damage === "missing") await tx.delete(fxSystemIndexBuildStates).where(last);
      await runEffect(complete);
    } finally { closeInstallationAdmission(tx); }
  });
  await advance(await selected());
  expect(await coverage()).toEqual(ids.map(() => 2n));
  await persistence.drizzle.update(fxSystemIndexBuildStates).set({ coveredThroughCommitSeq: CommitSeqSchema.make(0n) })
    .where(eq(fxSystemIndexBuildStates.scopeId, scopeId));
  const stale = await selected();
  await expect(advance(stale, "fence")).rejects.toMatchObject({ reason: "developerIndexBuildInvalid" });
  expect(await coverage()).toEqual(ids.map(() => 0n));
  const missing = await selected();
  await expect(advance(missing, "missing")).rejects.toMatchObject({ reason: "developerIndexBuildInvalid" });
  expect(await coverage()).toEqual(ids.map(() => 0n));
}

describe("selected publication coverage batches", () => {
  it("advances bounded index/unique batches and rolls back a stale or missing fenced member on PGlite", async () => {
    const db = newTestPGlite();
    try {
      const persistence = await createPGlitePersistence({ db });
      await proveFencedUniqueCoverageBatch(persistence);
      await proveFencedIndexCoverageBatch(persistence);
    } finally {
      await db.close();
    }
  }, 60_000);

  it.skipIf(postgresUrl === null)("proves the same fenced batch on ordinary PostgreSQL", async () => {
    await withTemporaryPostgresSchema(async options => {
      const persistence = await createPostgresPersistence(options);
      try {
        await proveFencedUniqueCoverageBatch(persistence);
        await proveFencedIndexCoverageBatch(persistence);
      } finally {
        await persistence.close();
      }
    });
  }, 60_000);
});
