import { bytesEqualFullScan, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { and, asc, eq, getTableColumns, getTableName, sql } from "drizzle-orm";
import { Data, Effect, Encoding, Schema } from "effect";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { runEffectTransaction, runEffectTransactionSettlement } from "../../database/effectTransaction";
import { lockSchemaManifestBindingDeploymentEffect } from "../catalog/schemaManifestTableBindings";
import { loadPublishedPhysicalRequirementSnapshotV1 } from "./indexBuildReconciliation";
import { readUniqueMaintenanceRequirements } from "../unique/appUniqueConstraintSetBuildV1";
import {
  readCoherentApplicationActiveHeadForShareInTransactionEffect,
  readApplicationSchemaForHeadForShareInTransactionEffect,
} from "../../application/applicationActiveHeadRead";
import { lockScopeClockForUpdateInTransactionEffect } from "../../scope/scopeClock";
import {
  decodeLegacyIndexMaintenanceEvidenceResult,
  verifyLegacyIndexMaintenanceEvidence,
} from "../../legacy/LegacyIndexMaintenanceEvidence";
import {
  decodeLegacyUniqueMaintenanceEvidenceResult,
  verifyLegacyUniqueMaintenanceEvidence,
} from "../unique/LegacyUniqueMaintenanceEvidence";
import { decodeIndexMaintenanceObligationResult, decodeUniqueMaintenanceObligationEffect,
  type IndexMaintenanceObligation, type UniqueMaintenanceObligation } from "./indexMaintenanceModel";
import { TYPED_MAINTENANCE_STAGE_SQL } from "./indexMaintenanceInstallation";
import { fxSystemIndexBuildStates, fxSystemUniqueConstraintBuilds,
  fxSystemIndexMaintenanceObligations, fxSystemUniqueMaintenanceObligations } from "../../database/schema";

/** The selected conversion supports the exact held predecessor, not arbitrary
 * historical maintained installations. Absent evidence remains absent. */
const predecessorMigrationSha256 = "d3c299e346a6ba77c2244217326df574d5c7ecc42ba2fe1da4d5d6c118697a52";
const predecessorMigrationTime = 1_790_947_700_000n;
const pageSize = 64;
export class TypedMaintenanceMigrationError extends Data.TaggedError("TypedMaintenanceMigrationError")<{
  readonly reason: "storedState" | "unsupportedSource" | "resourceFailure";
  readonly cause?: unknown;
}> {}
const failure = (reason: TypedMaintenanceMigrationError["reason"], cause?: unknown) =>
  new TypedMaintenanceMigrationError({ reason, ...(cause === undefined ? {} : { cause }) });
const driver = <Value>(statement: PromiseLike<Value>) => Effect.uninterruptible(runDrizzleStatementEffect(statement,
  cause => failure("resourceFailure",cause)));
const decodeDriverRows = Schema.decodeUnknownEffect(Schema.Struct({ rows: Schema.Unknown }));
const decodePresence = Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ present: Schema.Boolean, owned: Schema.Boolean })]));
const decodePredecessor = Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ hash: Schema.String,
  createdAt: Schema.String })]));
const inventorySchema = Schema.Struct({ scopeId: ScopeIdSchema, definitionId: Schema.Int,
  activationSequence: Schema.NullOr(Schema.BigInt), legacyBytes: Schema.NullOr(Schema.Uint8Array),
  legacySha256: Schema.NullOr(Schema.Uint8Array) });
type InventoryRow = typeof inventorySchema.Type;
const decodeInventory = Schema.decodeUnknownEffect(Schema.Array(inventorySchema));

const unit = <Value, Failure>(database: FlarexMetadataDatabase,
  body: (tx: FlarexMetadataTransaction) => Effect.Effect<Value,Failure>) =>
  // The owner retains its exact backend and draining fence through each COMMIT.
  // A settlement failure leaves evidence intact. A successor reauthenticates
  // old bytes and exact durable agreement before it can replay this unit.
  Effect.uninterruptible(runEffectTransactionSettlement(callback => database.transaction(callback),
    "Typed maintenance conversion unit rolled back",body,cause => failure("resourceFailure",cause)));

/** Fixed operation inside the existing dedicated maintenance command lane.
 * No raw transaction/callback or new preparation capability escapes this owner. */
export const prepareTypedMaintenanceMigration = Effect.fn("IndexMaintenanceMigration.prepare")(
  function* (database: FlarexMetadataDatabase, controlDb: FlarexMetadataDatabase, schemaName: string,
    journal: Readonly<{ migrationsSchema?: string; migrationsTable?: string }>) {
    const gate = yield* driver(database.execute(sql`select
      pg_catalog.to_regclass(pg_catalog.quote_ident(${schemaName}) || '.fx_system_index_build_state') is not null
      and pg_catalog.to_regclass(pg_catalog.quote_ident(${schemaName}) || '.fx_system_unique_constraint_build') is not null as present,
      exists (select 1 from ${sql.identifier(schemaName)}.fx_system_installation i
        where singleton_id = 1 and state = 'draining' and maintenance_pid = pg_backend_pid()
          and database_name = current_database() and schema_name = current_schema() and schema_name = ${schemaName}
          and maintenance_backend_start = (select backend_start from pg_catalog.pg_stat_activity where pid = pg_backend_pid())) as owned`));
    const observed = yield* decodeDriverRows(gate).pipe(Effect.mapError(cause => failure("storedState",cause)));
    const [presence] = yield* decodePresence(observed.rows).pipe(Effect.mapError(cause => failure("storedState",cause)));
    if (!presence.owned) return yield* Effect.fail(failure("storedState"));
    if (!presence.present) return;
    const legacy = yield* driver(database.execute(sql`select count(*)::integer as count from pg_catalog.pg_attribute a
      where a.attrelid in ((pg_catalog.quote_ident(${schemaName}) || '.' || ${getTableName(fxSystemIndexBuildStates)})::pg_catalog.regclass,
        (pg_catalog.quote_ident(${schemaName}) || '.' || ${getTableName(fxSystemUniqueConstraintBuilds)})::pg_catalog.regclass)
        and a.attname in ('maintenance_bytes','maintenance_sha256') and a.attnum > 0 and not a.attisdropped`));
    const legacyObserved = yield* decodeDriverRows(legacy).pipe(Effect.mapError(cause => failure("storedState",cause)));
    const [legacyCount] = yield* Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ count: Schema.Int })]))(legacyObserved.rows)
      .pipe(Effect.mapError(cause => failure("storedState",cause)));
    if (legacyCount.count === 0) return;
    if (legacyCount.count !== 4) return yield* Effect.fail(failure("storedState"));
    // Staging has no canonical journal entry and never drops retained evidence.
    yield* driver(database.execute(sql.raw(TYPED_MAINTENANCE_STAGE_SQL)));
    let authenticatedPredecessor = false;
    for (const family of ["index","unique"] as const) {
      let cursor: InventoryRow | undefined;
      for (;;) {
        const table = family === "index" ? fxSystemIndexBuildStates : fxSystemUniqueConstraintBuilds;
        const definition = family === "index" ? fxSystemIndexBuildStates.indexDefinitionId : fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId;
        const page = yield* driver(database.select({ scopeId: table.scopeId, definitionId: definition,
          activationSequence: table.maintenanceActivationSequence,
          legacyBytes: sql`"maintenance_bytes"`.mapWith(fxSystemIndexMaintenanceObligations.physicalSpecSha256),
          legacySha256: sql`"maintenance_sha256"`.mapWith(fxSystemIndexMaintenanceObligations.physicalSpecSha256),
        }).from(table).where(cursor === undefined ? undefined : sql`${table.scopeId} > ${cursor.scopeId}
          or (${table.scopeId} = ${cursor.scopeId} and ${definition} > ${cursor.definitionId})`)
          .orderBy(asc(table.scopeId),asc(definition)).limit(pageSize));
        const inventory = yield* decodeInventory(page).pipe(Effect.mapError(cause => failure("storedState",cause)));
        if (inventory.length === 0) break;
        for (const row of inventory) {
          if (row.activationSequence === null) {
            if (row.legacyBytes !== null || row.legacySha256 !== null) return yield* Effect.fail(failure("storedState"));
            continue;
          }
          if (!authenticatedPredecessor) {
            const receipt = yield* driver(database.execute(sql`select hash,created_at::text as "createdAt"
              from ${sql.identifier(journal.migrationsSchema ?? "drizzle")}.${sql.identifier(journal.migrationsTable ?? "__drizzle_migrations")}
              order by created_at desc limit 1`));
            const receiptRows = yield* decodeDriverRows(receipt).pipe(Effect.mapError(cause => failure("storedState",cause)));
            const [latest] = yield* decodePredecessor(receiptRows.rows).pipe(Effect.mapError(cause => failure("unsupportedSource",cause)));
            if (latest.hash !== predecessorMigrationSha256 || latest.createdAt !== predecessorMigrationTime.toString())
              return yield* Effect.fail(failure("unsupportedSource"));
            authenticatedPredecessor = true;
          }
          const deployment = family === "index"
            ? yield* Effect.fromResult(decodeLegacyIndexMaintenanceEvidenceResult(row.activationSequence,row.legacyBytes,row.legacySha256))
              .pipe(Effect.mapError(cause => failure("storedState",cause)))
            : yield* Effect.fromResult(decodeLegacyUniqueMaintenanceEvidenceResult(row.activationSequence,row.legacyBytes,row.legacySha256))
              .pipe(Effect.mapError(cause => failure("storedState",cause)));
          if (deployment === null) return yield* Effect.fail(failure("storedState"));
          const convert: (tx: FlarexMetadataTransaction,catalog: FlarexMetadataTransaction) =>
            Effect.Effect<undefined,ConversionFailure> = (tx,catalog) => family === "index"
              ? convertIndex(tx,controlDb,catalog,row) : convertUnique(tx,controlDb,catalog,row);
          if (controlDb === database) {
            yield* unit(database,tx => lockSchemaManifestBindingDeploymentEffect(tx,deployment.frame.deploymentId).pipe(
              Effect.andThen(() => convert(tx,tx))));
          } else {
            // The genuine external catalog owner holds its deployment lock until
            // this one target unit settles. A drained same-namespace serving
            // handle has no admission and therefore fails closed here.
            yield* runEffectTransaction(callback => controlDb.transaction(callback),
              "Typed maintenance catalog read rolled back",catalog => lockSchemaManifestBindingDeploymentEffect(catalog,deployment.frame.deploymentId).pipe(
                Effect.andThen(() => unit(database,tx => convert(tx,catalog)))),
              cause => failure("resourceFailure",cause));
          }
        }
        cursor = inventory[inventory.length - 1];
      }
    }
  },
);

const authenticateOpening = Effect.fn("IndexMaintenanceMigration.authenticateOpening")(function* (
  tx: FlarexMetadataTransaction, row: InventoryRow,
  frame: { readonly scopeId: string; readonly activationSequence: string; readonly headSha256: string;
    readonly deploymentId: string; readonly schemaVersionId: string; readonly openedCommitSeq: string;
    readonly storageGeneration: string; readonly storageGenerationFence: string; readonly epoch: string },
) {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx,row.scopeId);
  const active = yield* readCoherentApplicationActiveHeadForShareInTransactionEffect(tx,row.scopeId);
  if (active === null) return yield* Effect.fail(failure("storedState"));
  const schema = yield* readApplicationSchemaForHeadForShareInTransactionEffect(tx,active.head);
  if (frame.scopeId !== row.scopeId || frame.activationSequence !== active.head.activationSequence.toString() ||
    frame.headSha256 !== encodeBytesToLowercaseHex(active.head.headSha256) || frame.deploymentId !== schema.deploymentId ||
    frame.schemaVersionId !== schema.schemaVersionId || BigInt(frame.openedCommitSeq) > clock.lastCommitSeq ||
    frame.storageGeneration !== clock.storageGeneration || frame.storageGenerationFence !== clock.storageGenerationFence.toString() || frame.epoch !== clock.epoch)
    return yield* Effect.fail(failure("storedState"));
  return { active,schema };
});
const digestBytes = (value: string) => Effect.fromResult(Encoding.decodeHex(value)).pipe(Effect.mapError(cause => failure("storedState",cause)));

const convertIndex = Effect.fn("IndexMaintenanceMigration.convertIndex")(function* (
  tx: FlarexMetadataTransaction,controlDb: FlarexMetadataDatabase,catalog: FlarexMetadataTransaction,row: InventoryRow,
) {
  const preliminary = yield* Effect.fromResult(decodeLegacyIndexMaintenanceEvidenceResult(row.activationSequence,row.legacyBytes,row.legacySha256))
    .pipe(Effect.mapError(cause => failure("storedState",cause)));
  if (preliminary === null) return yield* Effect.fail(failure("storedState"));
  yield* verifyLegacyIndexMaintenanceEvidence(preliminary).pipe(Effect.mapError(cause =>
    failure(cause.reason === "resourceFailure" ? "resourceFailure" : "storedState",cause)));
  const { active,schema } = yield* authenticateOpening(tx,row,preliminary.frame);
  const [stored] = yield* driver(tx.select({ ...getTableColumns(fxSystemIndexBuildStates),
    legacyBytes: sql`"maintenance_bytes"`.mapWith(fxSystemIndexMaintenanceObligations.physicalSpecSha256),
    legacySha256: sql`"maintenance_sha256"`.mapWith(fxSystemIndexMaintenanceObligations.physicalSpecSha256),
  }).from(fxSystemIndexBuildStates).where(and(eq(fxSystemIndexBuildStates.scopeId,row.scopeId),
    sql`${fxSystemIndexBuildStates.indexDefinitionId} = ${row.definitionId}`)).for("update"));
  if (stored === undefined) return yield* Effect.fail(failure("storedState"));
  const evidence = yield* Effect.fromResult(decodeLegacyIndexMaintenanceEvidenceResult(stored.maintenanceActivationSequence,stored.legacyBytes,stored.legacySha256))
    .pipe(Effect.mapError(cause => failure("storedState",cause)));
  if (evidence === null || !bytesEqualFullScan(evidence.bytes,preliminary.bytes) || !bytesEqualFullScan(evidence.sha256,preliminary.sha256))
    return yield* Effect.fail(failure("storedState"));
  yield* verifyLegacyIndexMaintenanceEvidence(evidence).pipe(Effect.mapError(cause =>
    failure(cause.reason === "resourceFailure" ? "resourceFailure" : "storedState",cause)));
  const frame = evidence.frame;
  const schemaVersionId = yield* Schema.decodeUnknownEffect(CatalogSchemaVersionIdSchema)(frame.schemaVersionId)
    .pipe(Effect.mapError(cause => failure("storedState",cause)));
  const requirements = yield* loadPublishedPhysicalRequirementSnapshotV1(controlDb,
    { deploymentId: frame.deploymentId,schemaVersionId },catalog);
  const definition = requirements?.definitions.find(member => member.indexDefinitionId === frame.indexDefinitionId);
  if (requirements === null || definition === undefined || frame.schemaManifestSha256 !== schema.schemaManifestSha256 ||
    frame.schemaManifestSha256 !== encodeBytesToLowercaseHex(requirements.manifestSha256) || definition.tableId !== frame.tableId ||
    definition.physicalSpecSha256Hex !== frame.physicalSpecSha256Hex || stored.lifecycle !== "enabled" ||
    stored.scopeId !== frame.scopeId || stored.indexDefinitionId !== frame.indexDefinitionId ||
    stored.storageGeneration !== frame.storageGeneration || stored.storageGenerationFence.toString() !== frame.storageGenerationFence ||
    stored.epoch !== frame.epoch || stored.attemptFence.toString() !== frame.attemptFence ||
    stored.coveredThroughCommitSeq?.toString() !== frame.openedCommitSeq || stored.firstReadableCommitSeq?.toString() !== frame.firstReadableCommitSeq)
    return yield* Effect.fail(failure("storedState"));
  const expected = yield* Effect.fromResult(decodeIndexMaintenanceObligationResult({
    scopeId: frame.scopeId,indexDefinitionId: frame.indexDefinitionId,activationSequence: BigInt(frame.activationSequence),
    storageGeneration: frame.storageGeneration,storageGenerationFence: BigInt(frame.storageGenerationFence),epoch: frame.epoch,
    attemptFence: BigInt(frame.attemptFence),openedCommitSeq: BigInt(frame.openedCommitSeq),firstReadableCommitSeq: BigInt(frame.firstReadableCommitSeq),
    tableId: frame.tableId,physicalSpecSha256: yield* digestBytes(frame.physicalSpecSha256Hex),deploymentId: frame.deploymentId,
    schemaVersionId: frame.schemaVersionId,schemaManifestSha256: yield* digestBytes(frame.schemaManifestSha256),
    activationSha256: active.activation.activationSha256,headSha256: yield* digestBytes(frame.headSha256),
  })).pipe(Effect.mapError(cause => failure("storedState",cause)));
  const existing = yield* driver(tx.select().from(fxSystemIndexMaintenanceObligations).where(and(
    eq(fxSystemIndexMaintenanceObligations.scopeId,expected.scopeId),eq(fxSystemIndexMaintenanceObligations.indexDefinitionId,expected.indexDefinitionId),
    eq(fxSystemIndexMaintenanceObligations.activationSequence,expected.activationSequence))));
  if (existing.length > 1) return yield* Effect.fail(failure("storedState"));
  if (existing[0] !== undefined) {
    const actual = yield* Effect.fromResult(decodeIndexMaintenanceObligationResult(existing[0])).pipe(Effect.mapError(cause => failure("storedState",cause)));
    if (!equalOpening(actual,expected) || actual.indexDefinitionId !== expected.indexDefinitionId ||
      actual.firstReadableCommitSeq !== expected.firstReadableCommitSeq || !bytesEqualFullScan(actual.schemaManifestSha256,expected.schemaManifestSha256))
      return yield* Effect.fail(failure("storedState"));
    return;
  }
  yield* driver(tx.insert(fxSystemIndexMaintenanceObligations).values(expected));
});

const convertUnique = Effect.fn("IndexMaintenanceMigration.convertUnique")(function* (
  tx: FlarexMetadataTransaction,controlDb: FlarexMetadataDatabase,catalog: FlarexMetadataTransaction,row: InventoryRow,
) {
  const preliminary = yield* Effect.fromResult(decodeLegacyUniqueMaintenanceEvidenceResult(row.activationSequence,row.legacyBytes,row.legacySha256))
    .pipe(Effect.mapError(cause => failure("storedState",cause)));
  if (preliminary === null) return yield* Effect.fail(failure("storedState"));
  yield* verifyLegacyUniqueMaintenanceEvidence(preliminary).pipe(Effect.mapError(cause =>
    failure(cause.reason === "resourceFailure" ? "resourceFailure" : "storedState",cause)));
  const { active } = yield* authenticateOpening(tx,row,preliminary.frame);
  const [stored] = yield* driver(tx.select({ ...getTableColumns(fxSystemUniqueConstraintBuilds),
    legacyBytes: sql`"maintenance_bytes"`.mapWith(fxSystemUniqueMaintenanceObligations.physicalSpecSha256),
    legacySha256: sql`"maintenance_sha256"`.mapWith(fxSystemUniqueMaintenanceObligations.physicalSpecSha256),
  }).from(fxSystemUniqueConstraintBuilds).where(and(eq(fxSystemUniqueConstraintBuilds.scopeId,row.scopeId),
    sql`${fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId} = ${row.definitionId}`)).for("update"));
  if (stored === undefined) return yield* Effect.fail(failure("storedState"));
  const evidence = yield* Effect.fromResult(decodeLegacyUniqueMaintenanceEvidenceResult(stored.maintenanceActivationSequence,stored.legacyBytes,stored.legacySha256))
    .pipe(Effect.mapError(cause => failure("storedState",cause)));
  if (evidence === null || !bytesEqualFullScan(evidence.bytes,preliminary.bytes) || !bytesEqualFullScan(evidence.sha256,preliminary.sha256))
    return yield* Effect.fail(failure("storedState"));
  yield* verifyLegacyUniqueMaintenanceEvidence(evidence).pipe(Effect.mapError(cause =>
    failure(cause.reason === "resourceFailure" ? "resourceFailure" : "storedState",cause)));
  const frame = evidence.frame;
  const requirements = yield* readUniqueMaintenanceRequirements(controlDb,frame.deploymentId,frame.schemaVersionId,catalog);
  const definition = requirements.members.find(member => member.uniqueConstraintDefinitionId === frame.uniqueConstraintDefinitionId);
  if (definition === undefined || definition.tableId !== frame.tableId || definition.physicalSpecSha256Hex !== frame.physicalSpecSha256Hex ||
    stored.lifecycle !== "enabled" || stored.scopeId !== frame.scopeId || stored.uniqueConstraintDefinitionId !== frame.uniqueConstraintDefinitionId ||
    stored.storageGeneration !== frame.storageGeneration || stored.storageGenerationFence.toString() !== frame.storageGenerationFence ||
    stored.epoch !== frame.epoch || stored.attemptFence.toString() !== frame.attemptFence ||
    stored.coveredThroughCommitSeq?.toString() !== frame.openedCommitSeq || stored.startCommitSeq.toString() !== frame.startCommitSeq)
    return yield* Effect.fail(failure("storedState"));
  const expected = yield* decodeUniqueMaintenanceObligationEffect({
    scopeId: frame.scopeId,uniqueConstraintDefinitionId: frame.uniqueConstraintDefinitionId,activationSequence: BigInt(frame.activationSequence),
    storageGeneration: frame.storageGeneration,storageGenerationFence: BigInt(frame.storageGenerationFence),epoch: frame.epoch,
    attemptFence: BigInt(frame.attemptFence),openedCommitSeq: BigInt(frame.openedCommitSeq),startCommitSeq: BigInt(frame.startCommitSeq),
    tableId: frame.tableId,physicalSpecSha256: yield* digestBytes(frame.physicalSpecSha256Hex),deploymentId: frame.deploymentId,
    schemaVersionId: frame.schemaVersionId,activationSha256: active.activation.activationSha256,headSha256: yield* digestBytes(frame.headSha256),
  }).pipe(Effect.mapError(cause => failure("storedState",cause)));
  const existing = yield* driver(tx.select().from(fxSystemUniqueMaintenanceObligations).where(and(
    eq(fxSystemUniqueMaintenanceObligations.scopeId,expected.scopeId),eq(fxSystemUniqueMaintenanceObligations.uniqueConstraintDefinitionId,expected.uniqueConstraintDefinitionId),
    eq(fxSystemUniqueMaintenanceObligations.activationSequence,expected.activationSequence))));
  if (existing.length > 1) return yield* Effect.fail(failure("storedState"));
  if (existing[0] !== undefined) {
    const actual = yield* decodeUniqueMaintenanceObligationEffect(existing[0]).pipe(Effect.mapError(cause => failure("storedState",cause)));
    if (!equalOpening(actual,expected) || actual.uniqueConstraintDefinitionId !== expected.uniqueConstraintDefinitionId || actual.startCommitSeq !== expected.startCommitSeq)
      return yield* Effect.fail(failure("storedState"));
    return;
  }
  yield* driver(tx.insert(fxSystemUniqueMaintenanceObligations).values(expected));
});

function equalOpening(actual: IndexMaintenanceObligation | UniqueMaintenanceObligation,expected: IndexMaintenanceObligation | UniqueMaintenanceObligation): boolean {
  return actual.scopeId === expected.scopeId && actual.activationSequence === expected.activationSequence &&
    actual.storageGeneration === expected.storageGeneration && actual.storageGenerationFence === expected.storageGenerationFence &&
    actual.epoch === expected.epoch && actual.attemptFence === expected.attemptFence && actual.openedCommitSeq === expected.openedCommitSeq &&
    actual.tableId === expected.tableId && actual.deploymentId === expected.deploymentId && actual.schemaVersionId === expected.schemaVersionId &&
    bytesEqualFullScan(actual.physicalSpecSha256,expected.physicalSpecSha256) && bytesEqualFullScan(actual.activationSha256,expected.activationSha256) &&
    bytesEqualFullScan(actual.headSha256,expected.headSha256);
}
type ConversionFailure = Effect.Error<ReturnType<typeof convertIndex>> | Effect.Error<ReturnType<typeof convertUnique>>;
