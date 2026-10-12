import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Effect, Result, Schema } from "effect";
import { sql } from "drizzle-orm";
import { logicalTableKey } from "flarex-protocol/internal/logical-schema-candidate";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { bindingError, type DataBindingError } from "../../installation/frameworkSchema/binding/errors";
import { loadPublishedPhysicalRequirementSnapshotV1, IndexBuildReconciliationCatalogV1Error,
  type PublishedPhysicalRequirementSnapshotV1 } from "./indexBuildReconciliation";
import { SchemaVersionArtifactPersistenceError } from "../catalog/schemaVersionArtifacts";
import { AppIndexDefinitionReadPersistenceError, AppSchemaVersionIndexBindingPersistenceError } from "./appIndexDefinitions";
import { readUniqueMaintenanceRequirements } from "../unique/appUniqueConstraintSetBuildV1";
import { applicationDomainFailureDetail } from "../materialization/domainApplication";
import { isRetryableSqlTransactionCause } from "../../database/locatedReadCommittedEffect";
import { DrizzleQueryError } from "drizzle-orm/errors";

export interface BindingMaintenanceMember {
  readonly definitionId: number;
  readonly tableId: CatalogTableId;
  readonly physicalSpecSha256: string;
}
export interface BindingMaintenanceRequirements {
  readonly deploymentId: string;
  readonly schemaVersionId: string | null;
  readonly manifestSha256: string | null;
  readonly indexes: readonly BindingMaintenanceMember[];
  readonly unique: readonly BindingMaintenanceMember[];
}
const maintenanceMember = (definitionId: number, tableId: CatalogTableId, physicalSpecSha256: string) =>
  Object.freeze({ definitionId, tableId, physicalSpecSha256 });

/** Complete catalog requirements select only framework definition tables.
 * Application definitions and framework views retain their original writer. */
export function selectBindingMaintenanceRequirements(snapshot: PublishedPhysicalRequirementSnapshotV1,
  unique: Effect.Success<ReturnType<typeof readUniqueMaintenanceRequirements>>): Result.Result<BindingMaintenanceRequirements, DataBindingError> {
  const logical = snapshot.logicalRequirements;
  if (snapshot.manifest.kind !== "logicalSchemaCandidate" || logical === undefined ||
    unique.closure.schemaVersionId !== snapshot.schemaVersionId)
    return Result.fail(bindingError("storedCorruption"));
  const byKey = new Map(logical.evidence.tableBindings.map(binding => [logicalTableKey(binding.table), binding.tableId]));
  const tables = new Set<CatalogTableId>();
  for (const source of logical.evidence.candidate.sources) {
    if (source.owner === "application") continue;
    for (const binding of source.bindings) {
      if (binding.kind !== "definition") continue;
      const tableId = byKey.get(logicalTableKey(binding.table));
      if (tableId === undefined) return Result.fail(bindingError("storedCorruption"));
      tables.add(tableId);
    }
  }
  return Result.succeed(Object.freeze({ deploymentId: snapshot.deploymentId, schemaVersionId: snapshot.schemaVersionId,
    manifestSha256: encodeBytesToLowercaseHex(snapshot.manifestSha256),
    indexes: Object.freeze(snapshot.definitions.filter(definition => tables.has(definition.tableId))
      .map(definition => maintenanceMember(definition.indexDefinitionId,definition.tableId,definition.physicalSpecSha256Hex))
      .toSorted((left,right) => left.definitionId-right.definitionId)),
    unique: Object.freeze(unique.members.filter(definition => tables.has(definition.tableId))
      .map(definition => maintenanceMember(definition.uniqueConstraintDefinitionId,definition.tableId,definition.physicalSpecSha256Hex))
      .toSorted((left,right) => left.definitionId-right.definitionId)) }));
}

export const readBindingMaintenanceRequirements = Effect.fn("BindingMaintenance.readRequirements")(
  function* (controlDb: FlarexMetadataDatabase, deploymentId: string,
    logical: Readonly<{ schemaVersionId: string; manifestSha256: string }> | null,
    reader?: FlarexMetadataTransaction): Effect.fn.Return<BindingMaintenanceRequirements, DataBindingError> {
    if (logical === null) return Object.freeze({ deploymentId, schemaVersionId: null, manifestSha256: null,
      indexes: Object.freeze([]), unique: Object.freeze([]) });
    const schemaVersionId = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(logical.schemaVersionId)
      .pipe(Effect.mapError(cause => bindingError("storedCorruption",cause)));
    // The catalog API owns its branded schema decoder; the existing unique
    // owner validates the identical closed schema before projection.
    const unique = yield* readUniqueMaintenanceRequirements(controlDb,deploymentId,schemaVersionId,reader)
      .pipe(Effect.mapError(cause => bindingError(cause.reason === "resourceFailure" ? "resourceFailure" : "storedCorruption",cause)));
    const snapshot = yield* loadPublishedPhysicalRequirementSnapshotV1(controlDb,
      { deploymentId, schemaVersionId: unique.closure.schemaVersionId },reader)
      .pipe(Effect.mapError(cause => bindingError(cause instanceof SchemaVersionArtifactPersistenceError ||
        cause instanceof AppIndexDefinitionReadPersistenceError || cause instanceof AppSchemaVersionIndexBindingPersistenceError ||
        (cause instanceof IndexBuildReconciliationCatalogV1Error && cause.reason === "resourceFailure")
        ? "resourceFailure" : "storedCorruption",cause)));
    if (snapshot === null || encodeBytesToLowercaseHex(snapshot.manifestSha256)!==logical.manifestSha256)
      return yield* Effect.fail(bindingError("storedCorruption"));
    return yield* Effect.fromResult(selectBindingMaintenanceRequirements(snapshot,unique));
  },
);

export interface BindingMaintenanceActivation {
  readonly scopeId: string;
  readonly expectedHead: Readonly<{ sequence: string; sha256: string }> | null;
  readonly sequence: string;
  readonly activationSha256: string;
  readonly headSha256: string;
  readonly candidateSha256: string;
}
const decodeCounts = Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({
  closedCount: Schema.Number.check(Schema.isInt(),Schema.isGreaterThanOrEqualTo(0)),
  openedCount: Schema.Number.check(Schema.isInt(),Schema.isGreaterThanOrEqualTo(0)),
})]));
const decodeRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Struct({
  domain: Schema.Literals(["index","unique"]),reason: Schema.Literals(["storedState","unavailable"]),
})),{ onExcessProperty: "error" });

/** Captured binding activation and full catalog acceptance precede this call.
 * The fixed privileged owner alone may mutate protected maintenance columns. */
export const replaceBindingMaintenanceInTransaction = Effect.fn("BindingMaintenance.replace")(
  function* (tx: FlarexMetadataTransaction, pins: BindingMaintenanceActivation,
    outgoing: BindingMaintenanceRequirements | null, incoming: BindingMaintenanceRequirements) {
    if (incoming.schemaVersionId === null && (outgoing === null || outgoing.schemaVersionId === null)) return;
    const apply = (domain: "index" | "unique") => {
      const name = `fx_replace_binding_${domain}_maintenance`;
      const members = (value: BindingMaintenanceRequirements | null) =>
        JSON.stringify(value === null ? [] : domain === "index" ? value.indexes : value.unique);
      const statement = domain === "index" ? sql`fx_replace_binding_index_maintenance` : sql`fx_replace_binding_unique_maintenance`;
      return runDrizzleStatementEffect(tx.select({ closedCount: sql<number>`written.closed_count`,
        openedCount: sql<number>`written.opened_count` }).from(sql`${statement}(
          ${pins.scopeId}::text,${pins.expectedHead?.sequence ?? null}::bigint,${pins.expectedHead?.sha256 ?? null}::text,
          ${pins.sequence}::bigint,${pins.activationSha256}::text,${pins.headSha256}::text,${pins.candidateSha256}::text,
          ${outgoing?.deploymentId ?? null}::text,${outgoing?.schemaVersionId ?? null}::text,${outgoing?.manifestSha256 ?? null}::text,${members(outgoing)}::jsonb,
          ${incoming.deploymentId}::text,${incoming.schemaVersionId}::text,${incoming.manifestSha256}::text,${members(incoming)}::jsonb) as written`),
        cause => {
          const detail = applicationDomainFailureDetail(cause,name);
          if (detail !== null) return Result.match(decodeRefusal(detail),{
            onFailure: () => bindingError("resourceFailure",cause),
            onSuccess: refusal => bindingError(refusal.reason === "unavailable" ? "logicalSchemaNotReady" : "storedCorruption",cause),
          });
          const provider = cause instanceof DrizzleQueryError ? cause.cause : cause;
          return bindingError(isRetryableSqlTransactionCause(provider) ? "concurrentHead" : "resourceFailure",cause);
        }).pipe(Effect.flatMap(rows => decodeCounts(rows).pipe(Effect.mapError(cause => bindingError("storedCorruption",cause)))));
    };
    const [indexes] = yield* apply("index");
    const [unique] = yield* apply("unique");
    if (indexes.openedCount>incoming.indexes.length || indexes.closedCount>(outgoing?.indexes.length ?? 0) ||
      unique.openedCount>incoming.unique.length || unique.closedCount>(outgoing?.unique.length ?? 0))
      return yield* Effect.fail(bindingError("storedCorruption"));
    return Object.freeze({ indexes,unique });
  },
);
