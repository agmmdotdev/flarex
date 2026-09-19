import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { CatalogIndexDefinitionId } from "flarex-protocol/catalog";
import type { AppRowTransaction } from "./appRows";
import { loadRelatedPublishedPhysicalRequirementSnapshotV1, MAX_RECONCILED_DEFINITIONS, type PublishedPhysicalRequirementSnapshotV1 } from "./indexBuildReconciliation";
import { AppIndexDefinitionReadPersistenceError, AppSchemaVersionIndexBindingPersistenceError } from "./appIndexDefinitions";
import { SchemaVersionArtifactPersistenceError } from "./schemaVersionArtifacts";
import { runDrizzleStatementEffect } from "./drizzleStatementEffect";
import { decodeIndexBuildStateRowResult, isIndexBuildSnapshotCoveredInTransactionEffect,
  readIndexCoverageContextInTransactionEffect, type IndexBuildStateRecord } from "./indexBuildStates";
import { hashIndexMaintenanceEvidence, indexMaintenanceFrameBytes, IndexMaintenanceError,
  type IndexMaintenanceFrame } from "./indexMaintenanceEvidence";
import { fxSystemIndexBuildStates } from "./schema";
import type { LocatedReadCommittedAttemptTargetV1 } from "./transactionSessionAttemptKernel";
import type { ScopeClockRecord } from "./scopeClock";

/** Called only by activation after issued readiness validation, under its scope clock. */
export const replaceActiveIndexMaintenanceInTransactionEffect = Effect.fn("IndexMaintenance.replaceActive")(
  function* (tx: AppRowTransaction, target: LocatedReadCommittedAttemptTargetV1, clock: ScopeClockRecord, requirements: PublishedPhysicalRequirementSnapshotV1,
    activationSequence: bigint, headSha256: Uint8Array,
    afterWrite?: (point: "maintenanceClosed" | "maintenanceOpened") => void | Promise<void>) {
    const context = yield* readIndexCoverageContextInTransactionEffect(tx, clock);
    let outgoingRequirements: PublishedPhysicalRequirementSnapshotV1 | null = null;
    if (context.active !== null) {
      const schema = context.active.schema;
      if (schema.deploymentId !== requirements.deploymentId) return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
      outgoingRequirements = yield* loadRelatedPublishedPhysicalRequirementSnapshotV1(requirements, schema.schemaVersionId, target, tx)
        .pipe(Effect.mapError(cause => cause instanceof SchemaVersionArtifactPersistenceError ||
          cause instanceof AppIndexDefinitionReadPersistenceError || cause instanceof AppSchemaVersionIndexBindingPersistenceError
          ? new IndexMaintenanceError({ reason: "resourceFailure", cause: cause.cause })
          : new IndexMaintenanceError({ reason: "storedState", cause })));
      if (outgoingRequirements === null || encodeBytesToLowercaseHex(outgoingRequirements.manifestSha256) !== schema.schemaManifestSha256) {
        return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
      }
    }
    const outgoingDefinitions = new Map(outgoingRequirements?.definitions.map(definition => [definition.indexDefinitionId, definition]));
    const outgoing = yield* query(tx.select({ id: fxSystemIndexBuildStates.indexDefinitionId })
      .from(fxSystemIndexBuildStates).where(and(eq(fxSystemIndexBuildStates.scopeId, clock.scopeId),
        isNotNull(fxSystemIndexBuildStates.maintenanceActivationSequence)))
      .limit(MAX_RECONCILED_DEFINITIONS + 1));
    if (outgoing.length > MAX_RECONCILED_DEFINITIONS || requirements.definitions.length > MAX_RECONCILED_DEFINITIONS) {
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    }
    const ids = [...new Set([...outgoing.map(row => row.id), ...requirements.definitions.map(definition => definition.indexDefinitionId)])];
    if (ids.length === 0) return;
    const rows = yield* query(tx.select().from(fxSystemIndexBuildStates).where(and(
      eq(fxSystemIndexBuildStates.scopeId, clock.scopeId), inArray(fxSystemIndexBuildStates.indexDefinitionId, ids),
    )).orderBy(asc(fxSystemIndexBuildStates.indexDefinitionId)).for("update"));
    if (rows.length !== ids.length) return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    const builds = new Map<CatalogIndexDefinitionId, IndexBuildStateRecord>();
    for (const row of rows) {
      const build = yield* Effect.fromResult(decodeIndexBuildStateRowResult(row, clock.scopeId, row.indexDefinitionId))
        .pipe(Effect.mapError(cause => new IndexMaintenanceError({ reason: "storedState", cause })));
      builds.set(build.indexDefinitionId, build);
      if (build.maintenance !== null) {
        const definition = outgoingDefinitions.get(build.indexDefinitionId);
        if (definition === undefined) return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
        const covered = yield* isIndexBuildSnapshotCoveredInTransactionEffect(tx, build, definition, clock.lastCommitSeq, context);
        if (!covered) return yield* Effect.fail(new IndexMaintenanceError({ reason: "unavailable" }));
      }
    }
    // Validate every incoming definition before changing any binding. Shared builds
    // still carry the outgoing head here, which is the authority for their suffix.
    for (const definition of requirements.definitions) {
      const build = builds.get(definition.indexDefinitionId);
      if (build === undefined || !(yield* isIndexBuildSnapshotCoveredInTransactionEffect(
        tx, build, definition, clock.lastCommitSeq, context,
      ))) return yield* Effect.fail(new IndexMaintenanceError({ reason: "unavailable" }));
      if (build.maintenance !== null && build.maintenance.frame.physicalSpecSha256Hex !== definition.physicalSpecSha256Hex) {
        return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
      }
    }
    const incoming = new Map(requirements.definitions.map(definition => [definition.indexDefinitionId, definition]));
    for (const build of builds.values()) {
      const definition = incoming.get(build.indexDefinitionId);
      let bytes: Uint8Array | null = null;
      let sha256: Uint8Array | null = null;
      if (definition !== undefined) {
        if (build.firstReadableCommitSeq === null) return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
        const frame: IndexMaintenanceFrame = {
          format: "flarex.index-maintenance", version: 1, scopeId: build.scopeId,
          storageGeneration: build.storageGeneration, storageGenerationFence: build.storageGenerationFence.toString(), epoch: build.epoch,
          indexDefinitionId: build.indexDefinitionId, tableId: definition.tableId, physicalSpecSha256Hex: definition.physicalSpecSha256Hex,
          deploymentId: requirements.deploymentId, schemaVersionId: requirements.schemaVersionId,
          schemaManifestSha256: encodeBytesToLowercaseHex(requirements.manifestSha256), attemptFence: build.attemptFence.toString(),
          firstReadableCommitSeq: build.firstReadableCommitSeq.toString(), openedCommitSeq: clock.lastCommitSeq.toString(),
          activationSequence: activationSequence.toString(), headSha256: encodeBytesToLowercaseHex(headSha256),
        };
        bytes = indexMaintenanceFrameBytes(frame);
        sha256 = yield* hashIndexMaintenanceEvidence(bytes);
      }
      const updated = yield* query(tx.update(fxSystemIndexBuildStates).set({
        coveredThroughCommitSeq: clock.lastCommitSeq,
        maintenanceActivationSequence: definition === undefined ? null : activationSequence,
        maintenanceBytes: bytes, maintenanceSha256: sha256, updatedAt: sql`clock_timestamp()`,
      }).where(and(eq(fxSystemIndexBuildStates.scopeId, build.scopeId),
        eq(fxSystemIndexBuildStates.indexDefinitionId, build.indexDefinitionId),
        eq(fxSystemIndexBuildStates.attemptFence, build.attemptFence), eq(fxSystemIndexBuildStates.lifecycle, "enabled")))
        .returning({ id: fxSystemIndexBuildStates.indexDefinitionId }));
      if (updated.length !== 1) return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
      if (afterWrite !== undefined) yield* Effect.tryPromise({
        try: async () => { await afterWrite(definition === undefined ? "maintenanceClosed" : "maintenanceOpened"); },
        catch: cause => new IndexMaintenanceError({ reason: "resourceFailure", cause }),
      });
    }
  },
);

function query<A>(promise: PromiseLike<A>): Effect.Effect<A, IndexMaintenanceError> {
  return runDrizzleStatementEffect(promise, cause => new IndexMaintenanceError({ reason: "resourceFailure", cause }));
}
