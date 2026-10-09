import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import type { CatalogIndexDefinitionId } from "flarex-protocol/catalog";
import type { AppRowTransaction } from "../documents/appRows";
import { MAX_RECONCILED_DEFINITIONS, type PublishedPhysicalRequirementSnapshotV1, type ReadRelatedPublishedPhysicalRequirements } from "./indexBuildReconciliation";
import { AppIndexDefinitionReadPersistenceError, AppSchemaVersionIndexBindingPersistenceError } from "./appIndexDefinitions";
import { SchemaVersionArtifactPersistenceError } from "../catalog/schemaVersionArtifacts";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { decodeIndexBuildStateRowResult, isIndexBuildSnapshotCoveredInTransactionEffect,
  readIndexCoverageContextInTransactionEffect, type IndexBuildStateRecord } from "./indexBuildStates";
import { indexBuildStateSelection, indexMaintenanceBindingPredicate } from "./indexBuildStates";
import { IndexMaintenanceError } from "./indexMaintenanceModel";
import { applicationDomainFailureDetail } from "../materialization/domainApplication";
import { fxSystemApplicationActivations, fxSystemApplicationActiveHeads } from "../../application/applicationActivationSchema";
import { isRetryableSqlTransactionCause } from "../../database/locatedReadCommittedEffect";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { fxSystemApplicationReadinessV1, fxSystemIndexBuildStates, fxSystemIndexMaintenanceObligations } from "../../database/schema";
import type { ScopeClockRecord } from "../../scope/scopeClock";

const decodePublisherCounts = Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({
  closedCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  openedCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})]));
const decodePublisherRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Struct({
  domain: Schema.Literal("index"), reason: Schema.Literals(["storedState", "unavailable"]),
})), { onExcessProperty: "error" });

/** Called only by activation after issued readiness validation, under its scope clock. */
export const replaceActiveIndexMaintenanceInTransactionEffect = Effect.fn("IndexMaintenance.replaceActive")(
  function* (tx: AppRowTransaction, readRelatedRequirements: ReadRelatedPublishedPhysicalRequirements, clock: ScopeClockRecord, requirements: PublishedPhysicalRequirementSnapshotV1,
    activationSequence: bigint, activationSha256: Uint8Array, headSha256: Uint8Array) {
    const context = yield* readIndexCoverageContextInTransactionEffect(tx, clock);
    let outgoingRequirements: PublishedPhysicalRequirementSnapshotV1 | null = null;
    if (context.active !== null) {
      const schema = context.active.schema;
      if (schema.deploymentId !== requirements.deploymentId) return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
      outgoingRequirements = yield* readRelatedRequirements(schema.schemaVersionId)
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
    const rows = ids.length === 0 ? [] : yield* query(tx.select(indexBuildStateSelection()).from(fxSystemIndexBuildStates)
      .leftJoin(fxSystemIndexMaintenanceObligations, indexMaintenanceBindingPredicate()).where(and(
      eq(fxSystemIndexBuildStates.scopeId, clock.scopeId), inArray(fxSystemIndexBuildStates.indexDefinitionId, ids),
    )).orderBy(asc(fxSystemIndexBuildStates.indexDefinitionId)).for("update", { of: fxSystemIndexBuildStates }));
    if (rows.length !== ids.length) return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    const builds = new Map<CatalogIndexDefinitionId, IndexBuildStateRecord>();
    for (const row of rows) {
      const build = yield* Effect.fromResult(decodeIndexBuildStateRowResult(row, clock.scopeId, row.indexDefinitionId, row.maintenanceObligation))
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
      if (build.maintenance !== null && encodeBytesToLowercaseHex(build.maintenance.physicalSpecSha256) !== definition.physicalSpecSha256Hex) {
        return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
      }
    }
    const written = yield* runDrizzleStatementEffect(tx.select({ closedCount: sql<number>`written.closed_count`,
      openedCount: sql<number>`written.opened_count` }).from(sql`fx_replace_active_index_maintenance(
        ${clock.scopeId}::text,
        ${sql.param(context.active?.head.activationSequence ?? null, fxSystemApplicationActivations.activationSequence)}::bigint,
        ${sql.param(context.active?.head.headSha256 ?? null, fxSystemApplicationActiveHeads.headSha256)}::bytea,
        ${sql.param(activationSequence, fxSystemApplicationActivations.activationSequence)}::bigint,
        ${sql.param(activationSha256, fxSystemApplicationActivations.activationSha256)}::bytea,
        ${sql.param(headSha256, fxSystemApplicationActiveHeads.headSha256)}::bytea,
        ${outgoingRequirements?.deploymentId ?? null}::text, ${outgoingRequirements?.schemaVersionId ?? null}::text,
        ${sql.param(outgoingRequirements?.manifestSha256 ?? null, fxSystemApplicationReadinessV1.schemaManifestSha256)}::bytea,
        ${indexMaintenanceMembers(outgoingRequirements)}::jsonb, ${requirements.deploymentId}::text, ${requirements.schemaVersionId}::text,
        ${sql.param(requirements.manifestSha256, fxSystemApplicationReadinessV1.schemaManifestSha256)}::bytea,
        ${indexMaintenanceMembers(requirements)}::jsonb) as written`), publisherFailure);
    const [counts] = yield* decodePublisherCounts(written).pipe(Effect.mapError(cause => new IndexMaintenanceError({ reason: "storedState", cause })));
    if (counts.openedCount !== requirements.definitions.length || counts.closedCount + counts.openedCount !== builds.size)
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    return counts;
  },
);

function indexMaintenanceMembers(snapshot: PublishedPhysicalRequirementSnapshotV1 | null): string {
  return JSON.stringify((snapshot?.definitions ?? [])
    .toSorted((left, right) => left.indexDefinitionId - right.indexDefinitionId).map(definition => ({
      definitionId: definition.indexDefinitionId, tableId: definition.tableId, physicalSpecSha256: definition.physicalSpecSha256Hex,
    })));
}

function query<A>(promise: PromiseLike<A>): Effect.Effect<A, IndexMaintenanceError> {
  return runDrizzleStatementEffect(promise, cause => new IndexMaintenanceError({ reason: "resourceFailure", cause }));
}

function publisherFailure(cause: unknown): IndexMaintenanceError {
  const detail = applicationDomainFailureDetail(cause, "fx_replace_active_index_maintenance");
  if (detail !== null) return Result.match(decodePublisherRefusal(detail), {
    onFailure: () => new IndexMaintenanceError({ reason: "resourceFailure", cause }),
    onSuccess: refusal => new IndexMaintenanceError({ reason: refusal.reason, cause }),
  });
  const provider = cause instanceof DrizzleQueryError ? cause.cause : cause;
  return new IndexMaintenanceError({ reason: "resourceFailure", retryable: isRetryableSqlTransactionCause(provider), cause });
}
