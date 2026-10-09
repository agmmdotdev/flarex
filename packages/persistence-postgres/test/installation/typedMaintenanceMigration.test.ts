import { readFile } from "node:fs/promises";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { sql } from "drizzle-orm";
import { migrate as migratePGlite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePostgres } from "drizzle-orm/node-postgres/migrator";
import { Schema } from "effect";
import { expect, it, vi } from "vitest";
import type { FlarexMetadataDatabase } from "../../src/application/deployments";
import { createPGlitePersistence } from "../../src/database/pglite";
import { createPostgresPersistence } from "../../src/database/postgres";
import { prepareTypedMaintenanceMigration } from "../../src/storage/indexes/indexMaintenanceMigration";
import { verifyInstallationWriterProtection } from "../../src/installation/installationLifecycle";
import { INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS } from "../../src/storage/indexes/indexMaintenanceInstallation";
import { fxAppRowCurrent,fxAppRowRevisions,fxSystemScopeClocks,
  fxSystemIndexMaintenanceObligations,fxSystemUniqueMaintenanceObligations } from "../../src/database/schema";
import { fxSystemApplicationActivations,fxSystemApplicationActiveHeads } from "../../src/application/applicationActivationSchema";
import { fxSystemApplicationReadiness } from "../../src/application/relations/applicationRelationSchema";
import { LegacyIndexMaintenanceFrameSchema, legacyIndexMaintenanceFrameBytes, hashLegacyIndexMaintenanceEvidence } from "../../src/legacy/LegacyIndexMaintenanceEvidence";
import { LegacyUniqueMaintenanceFrameSchema,legacyUniqueMaintenanceFrameBytes,hashLegacyUniqueMaintenanceEvidence } from "../../src/storage/unique/LegacyUniqueMaintenanceEvidence";
import type { ApplicationNativeMutationPersistence } from "../application/applicationNativeMutationTestFixture";
import { relationReadinessFixture,prepareReadinessEvidence } from "../application/relations/applicationRelationReadinessFixture";
import { makeDrizzleCopyFixture, injectMigrationFailure, restoreMigrationFile, type DrizzleCopyFixture } from "../support/migrationFixtureSupport";
import { postgresUrl, withTemporaryPostgresSchema } from "../support/postgresHelpers";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { runEffect } from "../support/effectTestRuntime";

/** Reuse a real published/activated Application opening. Only its private
 * physical maintenance representation and receipt are placed at predecessor135;
 * actual head, schema, requirement closure and business rows remain genuine. */
async function predecessorFixture(target: ApplicationNativeMutationPersistence,
  fixture: DrizzleCopyFixture, journalSchema: string) {
  const expected = await target.drizzle.select().from(fxSystemIndexMaintenanceObligations)
    .orderBy(fxSystemIndexMaintenanceObligations.scopeId,fxSystemIndexMaintenanceObligations.indexDefinitionId);
  const expectedUnique = await target.drizzle.select().from(fxSystemUniqueMaintenanceObligations)
    .orderBy(fxSystemUniqueMaintenanceObligations.scopeId,fxSystemUniqueMaintenanceObligations.uniqueConstraintDefinitionId);
  expect(expected.length).toBeGreaterThan(0);
  expect(expectedUnique.length).toBeGreaterThan(0);
  for (const table of ["fx_system_index_build_state","fx_system_unique_constraint_build"]) {
    await target.query(`alter table ${table} add column maintenance_bytes bytea, add column maintenance_sha256 bytea`);
  }
  const legacy = [];
  for (const opening of expected) {
    const frame = Schema.decodeUnknownSync(LegacyIndexMaintenanceFrameSchema)({
      format: "flarex.index-maintenance",version: 1,scopeId: opening.scopeId,
      storageGeneration: opening.storageGeneration,storageGenerationFence: opening.storageGenerationFence.toString(),epoch: opening.epoch,
      indexDefinitionId: opening.indexDefinitionId,tableId: opening.tableId,physicalSpecSha256Hex: encodeBytesToLowercaseHex(opening.physicalSpecSha256),
      deploymentId: opening.deploymentId,schemaVersionId: opening.schemaVersionId,schemaManifestSha256: encodeBytesToLowercaseHex(opening.schemaManifestSha256),
      attemptFence: opening.attemptFence.toString(),firstReadableCommitSeq: opening.firstReadableCommitSeq.toString(),
      openedCommitSeq: opening.openedCommitSeq.toString(),activationSequence: opening.activationSequence.toString(),headSha256: encodeBytesToLowercaseHex(opening.headSha256),
    });
    const bytes = legacyIndexMaintenanceFrameBytes(frame);
    const hash = await runEffect(hashLegacyIndexMaintenanceEvidence(bytes));
    await target.query("update fx_system_index_build_state set maintenance_bytes=$1,maintenance_sha256=$2 where scope_id=$3 and index_definition_id=$4",
      [bytes,hash,opening.scopeId,opening.indexDefinitionId]);
    legacy.push({ opening,frame,bytes,hash });
  }
  const legacyUnique = [];
  for (const opening of expectedUnique) {
    const frame = Schema.decodeUnknownSync(LegacyUniqueMaintenanceFrameSchema)({
      format: "flarex.unique-maintenance",version: 1,scopeId: opening.scopeId,
      storageGeneration: opening.storageGeneration,storageGenerationFence: opening.storageGenerationFence.toString(),epoch: opening.epoch,
      uniqueConstraintDefinitionId: opening.uniqueConstraintDefinitionId,tableId: opening.tableId,
      physicalSpecSha256Hex: encodeBytesToLowercaseHex(opening.physicalSpecSha256),deploymentId: opening.deploymentId,schemaVersionId: opening.schemaVersionId,
      attemptFence: opening.attemptFence.toString(),startCommitSeq: opening.startCommitSeq.toString(),
      openedCommitSeq: opening.openedCommitSeq.toString(),activationSequence: opening.activationSequence.toString(),headSha256: encodeBytesToLowercaseHex(opening.headSha256),
    });
    const bytes = legacyUniqueMaintenanceFrameBytes(frame);
    const hash = await runEffect(hashLegacyUniqueMaintenanceEvidence(bytes));
    await target.query("update fx_system_unique_constraint_build set maintenance_bytes=$1,maintenance_sha256=$2 where scope_id=$3 and unique_constraint_definition_id=$4",
      [bytes,hash,opening.scopeId,opening.uniqueConstraintDefinitionId]);
    legacyUnique.push({ opening,frame,bytes,hash });
  }
  await target.query("alter table fx_system_index_build_state drop constraint fx_index_build_maintenance_opening_fk");
  await target.query("alter table fx_system_unique_constraint_build drop constraint fx_unique_build_maintenance_opening_fk");
  await target.query("drop table fx_system_index_maintenance_obligation");
  await target.query("drop table fx_system_unique_maintenance_obligation");
  for (const operation of INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS)
    await target.query(`drop function ${operation.name}(${operation.signature})`);
  // Restoring the predecessor receipt must use the very backend that owns this
  // fixture's drain marker, including when normal preparation uses a pool.
  await target.drizzle.transaction(async tx => {
    await tx.execute(sql`update fx_system_installation set state='draining',maintenance_owner=gen_random_uuid(),
      maintenance_pid=pg_backend_pid(),maintenance_backend_start=(select backend_start from pg_stat_activity where pid=pg_backend_pid())`);
    await tx.execute(sql`delete from ${sql.identifier(journalSchema)}.__drizzle_migrations where created_at=1790947800000`);
  });
  const source = await readFile(`${fixture.currentMigrationsFolder}/0135_frozen_settlement_acceptance.sql`);
  const sourceSha = await runEffect(hashLegacyIndexMaintenanceEvidence(source));
  expect((await target.query(`select hash from "${journalSchema}".__drizzle_migrations order by created_at desc limit 1`)).rows)
    .toEqual([{ hash: encodeBytesToLowercaseHex(sourceSha) }]);
  return { expected,expectedUnique,legacy,legacyUnique };
}

async function verifyConversion(target: ApplicationNativeMutationPersistence, control: FlarexMetadataDatabase,
  fixture: DrizzleCopyFixture, journalSchema: string, finish: () => Promise<void>) {
  const { expected,expectedUnique,legacy,legacyUnique } = await predecessorFixture(target,fixture,journalSchema);
  const schema = (await target.query<{ schema: string }>("select current_schema() as schema")).rows[0]?.schema;
  if (schema === undefined) throw new Error("Missing target namespace");
  const convert = () => runEffect(prepareTypedMaintenanceMigration(target.drizzle,control,schema,{ migrationsSchema: journalSchema }));
  const actualTransaction = target.drizzle.transaction.bind(target.drizzle);
  const rollback = vi.spyOn(target.drizzle,"transaction").mockImplementationOnce((callback,options) =>
    actualTransaction(async tx => { await callback(tx); throw new Error("typed conversion precommit rollback"); },options));
  try { await expect(convert()).rejects.toMatchObject({ reason: "resourceFailure" }); }
  finally { rollback.mockRestore(); }
  expect(await target.drizzle.select().from(fxSystemIndexMaintenanceObligations)).toEqual([]);

  // A client error after durable COMMIT cannot justify replaying an INSERT.
  const uncertain = vi.spyOn(target.drizzle,"transaction").mockImplementationOnce((callback,options) =>
    actualTransaction(callback,options).then(() => { throw new Error("typed conversion committed response lost"); }));
  try { await expect(convert()).rejects.toMatchObject({ reason: "resourceFailure" }); }
  finally { uncertain.mockRestore(); }
  const committed = await target.drizzle.select().from(fxSystemIndexMaintenanceObligations);
  expect(committed).toHaveLength(1);
  const first = legacy[0];
  if (first === undefined) throw new Error("Missing genuine legacy opening");
  // Existing typed presence must never bypass strict retained-byte agreement.
  const wrong = legacyIndexMaintenanceFrameBytes(Schema.decodeUnknownSync(LegacyIndexMaintenanceFrameSchema)(
    { ...first.frame,tableId: first.frame.tableId + 1 }));
  await target.query("update fx_system_index_build_state set maintenance_bytes=$1,maintenance_sha256=$2 where scope_id=$3 and index_definition_id=$4",
    [wrong,await runEffect(hashLegacyIndexMaintenanceEvidence(wrong)),first.opening.scopeId,first.opening.indexDefinitionId]);
  await expect(convert()).rejects.toMatchObject({ reason: "storedState" });
  expect(await target.drizzle.select().from(fxSystemIndexMaintenanceObligations)).toEqual(committed);
  await target.query("update fx_system_index_build_state set maintenance_bytes=$1,maintenance_sha256=$2 where scope_id=$3 and index_definition_id=$4",
    [first.bytes,first.hash,first.opening.scopeId,first.opening.indexDefinitionId]);
  await convert();
  await convert();
  expect(await target.drizzle.select().from(fxSystemIndexMaintenanceObligations)
    .orderBy(fxSystemIndexMaintenanceObligations.scopeId,fxSystemIndexMaintenanceObligations.indexDefinitionId)).toEqual(expected);
  expect(await target.drizzle.select().from(fxSystemUniqueMaintenanceObligations)
    .orderBy(fxSystemUniqueMaintenanceObligations.scopeId,fxSystemUniqueMaintenanceObligations.uniqueConstraintDefinitionId)).toEqual(expectedUnique);
  const firstUnique = legacyUnique[0];
  if (firstUnique === undefined) throw new Error("Missing genuine unique legacy opening");
  const wrongUnique = legacyUniqueMaintenanceFrameBytes(Schema.decodeUnknownSync(LegacyUniqueMaintenanceFrameSchema)(
    { ...firstUnique.frame,tableId: firstUnique.frame.tableId + 1 }));
  await target.query("update fx_system_unique_constraint_build set maintenance_bytes=$1,maintenance_sha256=$2 where scope_id=$3 and unique_constraint_definition_id=$4",
    [wrongUnique,await runEffect(hashLegacyUniqueMaintenanceEvidence(wrongUnique)),firstUnique.opening.scopeId,firstUnique.opening.uniqueConstraintDefinitionId]);
  await expect(convert()).rejects.toMatchObject({ reason: "storedState" });
  await expect(finish()).rejects.toMatchObject({ cause: { code: "55000",message: "Typed maintenance conversion is incomplete" } });
  expect(await target.drizzle.select().from(fxSystemUniqueMaintenanceObligations)
    .orderBy(fxSystemUniqueMaintenanceObligations.scopeId,fxSystemUniqueMaintenanceObligations.uniqueConstraintDefinitionId)).toEqual(expectedUnique);
  await target.query("update fx_system_unique_constraint_build set maintenance_bytes=$1,maintenance_sha256=$2 where scope_id=$3 and unique_constraint_definition_id=$4",
    [firstUnique.bytes,firstUnique.hash,firstUnique.opening.scopeId,firstUnique.opening.uniqueConstraintDefinitionId]);
  await convert();
  const retained = (await target.query("select scope_id,index_definition_id,maintenance_bytes,maintenance_sha256 from fx_system_index_build_state where maintenance_activation_sequence is not null order by scope_id,index_definition_id")).rows;
  const retainedUnique = (await target.query("select scope_id,unique_constraint_definition_id,maintenance_bytes,maintenance_sha256 from fx_system_unique_constraint_build where maintenance_activation_sequence is not null order by scope_id,unique_constraint_definition_id")).rows;
  await injectMigrationFailure(fixture.migrationPath,"typed_maintenance_final_deliberate_missing_table");
  await expect(finish()).rejects.toThrow(/typed_maintenance_final_deliberate_missing_table/);
  expect((await target.query("select scope_id,index_definition_id,maintenance_bytes,maintenance_sha256 from fx_system_index_build_state where maintenance_activation_sequence is not null order by scope_id,index_definition_id")).rows).toEqual(retained);
  expect((await target.query("select scope_id,unique_constraint_definition_id,maintenance_bytes,maintenance_sha256 from fx_system_unique_constraint_build where maintenance_activation_sequence is not null order by scope_id,unique_constraint_definition_id")).rows).toEqual(retainedUnique);
  await restoreMigrationFile(fixture.migrationPath,fixture.currentMigrationsFolder);
  await convert();
  await finish();
  await runEffect(verifyInstallationWriterProtection(target.drizzle,schema,{ schemaName: journalSchema,tableName: "__drizzle_migrations" }));
  expect((await target.query("select column_name from information_schema.columns where table_schema=current_schema() and table_name in ('fx_system_index_build_state','fx_system_unique_constraint_build') and column_name in ('maintenance_bytes','maintenance_sha256')")).rows).toEqual([]);
  expect(await target.drizzle.select().from(fxSystemIndexMaintenanceObligations)
    .orderBy(fxSystemIndexMaintenanceObligations.scopeId,fxSystemIndexMaintenanceObligations.indexDefinitionId)).toEqual(expected);
  expect(await target.drizzle.select().from(fxSystemUniqueMaintenanceObligations)
    .orderBy(fxSystemUniqueMaintenanceObligations.scopeId,fxSystemUniqueMaintenanceObligations.uniqueConstraintDefinitionId)).toEqual(expectedUnique);
}

async function verifyPublicMigration(target: ApplicationNativeMutationPersistence, fixture: DrizzleCopyFixture,journalSchema: string) {
  const { expected,expectedUnique } = await predecessorFixture(target,fixture,journalSchema);
  const businessState = async () => ({
    heads: await target.drizzle.select().from(fxSystemApplicationActiveHeads).orderBy(fxSystemApplicationActiveHeads.scopeId),
    activations: await target.drizzle.select().from(fxSystemApplicationActivations)
      .orderBy(fxSystemApplicationActivations.scopeId,fxSystemApplicationActivations.activationSequence),
    readiness: await target.drizzle.select().from(fxSystemApplicationReadiness)
      .orderBy(fxSystemApplicationReadiness.scopeId,fxSystemApplicationReadiness.revisionId),
    clocks: await target.drizzle.select().from(fxSystemScopeClocks).orderBy(fxSystemScopeClocks.scopeId),
    rows: await target.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.scopeUuid,fxAppRowCurrent.tableId,fxAppRowCurrent.rowId),
    revisions: await target.drizzle.select().from(fxAppRowRevisions)
      .orderBy(fxAppRowRevisions.scopeUuid,fxAppRowRevisions.tableId,fxAppRowRevisions.rowId,fxAppRowRevisions.commitSeq),
  });
  const before = await businessState();
  expect(before.heads).toHaveLength(1);
  expect(before.activations).toHaveLength(1);
  expect(before.readiness.length).toBeGreaterThan(0);
  const retained = (await target.query("select scope_id,index_definition_id,maintenance_bytes,maintenance_sha256 from fx_system_index_build_state where maintenance_activation_sequence is not null order by scope_id,index_definition_id")).rows;
  const retainedUnique = (await target.query("select scope_id,unique_constraint_definition_id,maintenance_bytes,maintenance_sha256 from fx_system_unique_constraint_build where maintenance_activation_sequence is not null order by scope_id,unique_constraint_definition_id")).rows;
  const receipts = () => target.query<{ hash: string;createdAt: string }>(`select hash,created_at::text as "createdAt"
    from "${journalSchema.replaceAll('"','""')}".__drizzle_migrations order by created_at`);
  const originalReceipts = (await receipts()).rows;

  // Public maintenance owns its actual backend and must retain completed stage
  // units while a failed final journal transaction keeps installation drained.
  await injectMigrationFailure(fixture.migrationPath,"typed_maintenance_public_final_deliberate_missing_table");
  await expect(target.migrate()).rejects.toMatchObject({
    _tag: "InstallationLifecycleError",reason: "resourceFailure",
    cause: { cause: { code: "42P01",message: expect.stringContaining("typed_maintenance_public_final_deliberate_missing_table") } },
  });
  expect((await target.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
  expect((await receipts()).rows).toEqual(originalReceipts);
  expect(await businessState()).toEqual(before);
  expect((await target.query("select scope_id,index_definition_id,maintenance_bytes,maintenance_sha256 from fx_system_index_build_state where maintenance_activation_sequence is not null order by scope_id,index_definition_id")).rows).toEqual(retained);
  expect((await target.query("select scope_id,unique_constraint_definition_id,maintenance_bytes,maintenance_sha256 from fx_system_unique_constraint_build where maintenance_activation_sequence is not null order by scope_id,unique_constraint_definition_id")).rows).toEqual(retainedUnique);
  expect(await target.drizzle.select().from(fxSystemIndexMaintenanceObligations)
    .orderBy(fxSystemIndexMaintenanceObligations.scopeId,fxSystemIndexMaintenanceObligations.indexDefinitionId)).toEqual(expected);
  expect(await target.drizzle.select().from(fxSystemUniqueMaintenanceObligations)
    .orderBy(fxSystemUniqueMaintenanceObligations.scopeId,fxSystemUniqueMaintenanceObligations.uniqueConstraintDefinitionId)).toEqual(expectedUnique);

  await restoreMigrationFile(fixture.migrationPath,fixture.currentMigrationsFolder);
  await target.migrate();
  await target.migrate();
  expect((await target.query("select state,maintenance_owner,maintenance_pid,maintenance_backend_start from fx_system_installation")).rows)
    .toEqual([{ state: "active",maintenance_owner: null,maintenance_pid: null,maintenance_backend_start: null }]);
  expect(await businessState()).toEqual(before);
  const finalReceipts = (await receipts()).rows;
  expect(finalReceipts.slice(0,-1)).toEqual(originalReceipts);
  expect(finalReceipts.at(-1)).toEqual({ hash: encodeBytesToLowercaseHex(await runEffect(
    hashLegacyIndexMaintenanceEvidence(await readFile(fixture.migrationPath)))),createdAt: "1790947800000" });
  expect((await target.query("select column_name from information_schema.columns where table_schema=current_schema() and table_name in ('fx_system_index_build_state','fx_system_unique_constraint_build') and column_name in ('maintenance_bytes','maintenance_sha256')")).rows).toEqual([]);
  expect(await target.drizzle.select().from(fxSystemIndexMaintenanceObligations)
    .orderBy(fxSystemIndexMaintenanceObligations.scopeId,fxSystemIndexMaintenanceObligations.indexDefinitionId)).toEqual(expected);
  expect(await target.drizzle.select().from(fxSystemUniqueMaintenanceObligations)
    .orderBy(fxSystemUniqueMaintenanceObligations.scopeId,fxSystemUniqueMaintenanceObligations.uniqueConstraintDefinitionId)).toEqual(expectedUnique);
}

it("authenticates source135 conversion, resolves unknown COMMIT, and retains evidence through final rollback (PGlite)", async () => {
  const fixture = await makeDrizzleCopyFixture("typed-maintenance-predecessor","pglite","0136_typed_maintenance_obligations.sql");
  const controlDb = newTestPGlite(); const targetDb = newTestPGlite();
  try {
    const control = await createPGlitePersistence({ db: controlDb });
    const target = await createPGlitePersistence({ db: targetDb,migrationsFolder: fixture.migrationsFolder });
    await control.migrate(); await target.migrate();
    const app = await relationReadinessFixture({ persistence: target,controlPersistence: control,writePolicy: true,
      cmsFields: [{ name: "title",kind: "text",unique: true }],activationProfile: { kind: "fullProof" } });
    await prepareReadinessEvidence(app);
    expect((await runEffect(app.fold.settle(app.input))).status).toBe("ready");
    expect((await runEffect(app.relationActivation.activate({ revisionId: app.input.revisionId,expectedActiveHead: null }))).status).toBe("activated");
    await verifyConversion(target,control.drizzle,fixture,"drizzle",() => migratePGlite(target.drizzle,{ migrationsFolder: fixture.migrationsFolder }));
  } finally { await Promise.all([targetDb.close(),controlDb.close(),fixture.cleanup()]); }
}, 60_000);

it("public migrate converts genuine source135 ordered and unique obligations before final attestation and reopen (PGlite)", async () => {
  const fixture = await makeDrizzleCopyFixture("typed-maintenance-public","pglite","0136_typed_maintenance_obligations.sql");
  const controlDb = newTestPGlite(); const targetDb = newTestPGlite();
  try {
    const control = await createPGlitePersistence({ db: controlDb });
    const target = await createPGlitePersistence({ db: targetDb,migrationsFolder: fixture.migrationsFolder,immutableCatalog: control.drizzle });
    await control.migrate(); await target.migrate();
    const app = await relationReadinessFixture({ persistence: target,controlPersistence: control,writePolicy: true,
      cmsFields: [{ name: "title",kind: "text",unique: true }],activationProfile: { kind: "fullProof" } });
    await prepareReadinessEvidence(app);
    expect((await runEffect(app.fold.settle(app.input))).status).toBe("ready");
    expect((await runEffect(app.relationActivation.activate({ revisionId: app.input.revisionId,expectedActiveHead: null }))).status).toBe("activated");
    await verifyPublicMigration(target,fixture,"drizzle");
  } finally { await Promise.all([targetDb.close(),controlDb.close(),fixture.cleanup()]); }
}, 60_000);

it.skipIf(postgresUrl === null)("public migrate converts genuine source135 ordered and unique obligations before final attestation and reopen (PostgreSQL)", async () => {
  const fixture = await makeDrizzleCopyFixture("typed-maintenance-public","postgres","0136_typed_maintenance_obligations.sql");
  try {
    await withTemporaryPostgresSchema(controlOptions => withTemporaryPostgresSchema(async targetOptions => {
      const control = await createPostgresPersistence(controlOptions);
      const target = await createPostgresPersistence({ ...targetOptions,poolConfig: { ...targetOptions.poolConfig,max: 1 },
        migrationsFolder: fixture.migrationsFolder,immutableCatalog: control.drizzle });
      try {
        expect((await target.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
        await control.migrate(); await target.migrate();
        const app = await relationReadinessFixture({ persistence: target,controlPersistence: control,writePolicy: true,
          cmsFields: [{ name: "title",kind: "text",unique: true }],activationProfile: { kind: "fullProof" } });
        await prepareReadinessEvidence(app);
        expect((await runEffect(app.fold.settle(app.input))).status).toBe("ready");
        expect((await runEffect(app.relationActivation.activate({ revisionId: app.input.revisionId,expectedActiveHead: null }))).status).toBe("activated");
        await verifyPublicMigration(target,fixture,targetOptions.migrationsSchema);
      } finally { await Promise.all([target.close(),control.close()]); }
    }));
  } finally { await fixture.cleanup(); }
}, 60_000);

it.skipIf(postgresUrl === null)("authenticates source135 conversion, resolves unknown COMMIT, and retains evidence through final rollback (PostgreSQL)", async () => {
  const fixture = await makeDrizzleCopyFixture("typed-maintenance-predecessor","postgres","0136_typed_maintenance_obligations.sql");
  try {
    await withTemporaryPostgresSchema(controlOptions => withTemporaryPostgresSchema(async targetOptions => {
      const control = await createPostgresPersistence(controlOptions);
      const target = await createPostgresPersistence({ ...targetOptions,poolConfig: { ...targetOptions.poolConfig,max: 1 },migrationsFolder: fixture.migrationsFolder });
      try {
        expect((await target.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
        await control.migrate(); await target.migrate();
        const app = await relationReadinessFixture({ persistence: target,controlPersistence: control,writePolicy: true,
          cmsFields: [{ name: "title",kind: "text",unique: true }],activationProfile: { kind: "fullProof" } });
        await prepareReadinessEvidence(app);
        expect((await runEffect(app.fold.settle(app.input))).status).toBe("ready");
        expect((await runEffect(app.relationActivation.activate({ revisionId: app.input.revisionId,expectedActiveHead: null }))).status).toBe("activated");
        await verifyConversion(target,control.drizzle,fixture,targetOptions.migrationsSchema,() => migratePostgres(target.drizzle,
          { migrationsFolder: fixture.migrationsFolder,migrationsSchema: targetOptions.migrationsSchema }));
      } finally { await Promise.all([target.close(),control.close()]); }
    }));
  } finally { await fixture.cleanup(); }
}, 60_000);

it.skipIf(postgresUrl === null)("public migrate defaults to its genuine colocated catalog on the dedicated maintenance backend (PostgreSQL)", async () => {
  const fixture = await makeDrizzleCopyFixture("typed-maintenance-public-colocated","postgres","0136_typed_maintenance_obligations.sql");
  try {
    await withTemporaryPostgresSchema(async options => {
      const target = await createPostgresPersistence({ ...options,poolConfig: { ...options.poolConfig,max: 2 },
        migrationsFolder: fixture.migrationsFolder });
      try {
        expect((await target.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
        await target.migrate();
        const app = await relationReadinessFixture({ persistence: target,controlPersistence: target,writePolicy: true,
          cmsFields: [{ name: "title",kind: "text",unique: true }],activationProfile: { kind: "fullProof" } });
        await prepareReadinessEvidence(app);
        expect((await runEffect(app.fold.settle(app.input))).status).toBe("ready");
        expect((await runEffect(app.relationActivation.activate({ revisionId: app.input.revisionId,expectedActiveHead: null }))).status).toBe("activated");
        await verifyPublicMigration(target,fixture,options.migrationsSchema);
      } finally { await target.close(); }
    });
  } finally { await fixture.cleanup(); }
}, 60_000);
