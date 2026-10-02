import type { ApplicationManifestWithRelations } from "@flarex/analysis/application-analysis";
import { payloadUniqueDeclarations } from "@flarex/analysis/internal/application-write-policy";
import { Effect } from "effect";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  canonicalizeAppUniqueConstraintPhysicalSpecV1,
  lowerLogicalDocumentUniqueConstraint,
} from "flarex-protocol/app-unique-constraint-definition";
import { MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1 } from "flarex-protocol/internal/app-unique-constraint-set-v1";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  ensureAppUniqueConstraintDefinitionBindingV1InTransaction,
  listAppUniqueConstraintDefinitionSetMembersV1Effect,
  prepareAppUniqueConstraintDefinitionBindingV1Effect,
  type PrepareAppUniqueConstraintDefinitionBindingV1Input,
  type PrepareAppUniqueConstraintDefinitionBindingV1Error,
  type EnsureAppUniqueConstraintDefinitionBindingV1Error,
  type ReadAppUniqueConstraintDefinitionV1Error,
} from "../appUniqueConstraintDefinitions";
import type { ApplicationSchemaTableBinding } from "../applicationSchemaAuthority";
import type { FlarexMetadataDatabase } from "../deployments";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { runEffectTransaction } from "../effectTransaction";
import type { StableTableCatalogTransaction } from "../stableTableCatalog";
import { ApplicationWriteOwnershipError } from "./Model";

type BoundSchema = Readonly<{
  deploymentId: string;
  schemaVersionId: CatalogSchemaVersionId;
  tables: ReadonlyArray<ApplicationSchemaTableBinding>;
}>;
// Table-local identity derives from the full ordered selection, independently
// of declaration order and without truncating user field names.

/** Only the authenticated publication/readiness owners supply this manifest/binding pair. */
const declarations = Effect.fn("ApplicationUniqueDeclarations.lower")(function* (
  manifest: ApplicationManifestWithRelations,
  bound: BoundSchema,
) {
  const plans: PrepareAppUniqueConstraintDefinitionBindingV1Input[] = [];
  if (manifest.version === 2) return plans;
  for (const configured of manifest.schema.writePolicies.configuration.tables) {
    const table = bound.tables.find(candidate => candidate.logicalName === configured.logicalTableName);
    if (table === undefined) return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" }));
    const constraints = yield* payloadUniqueDeclarations(configured).pipe(
        Effect.mapError(cause => new ApplicationWriteOwnershipError({
          reason: cause.reason === "digestUnavailable" ? "resourceFailure" : "invalidEvidence", cause,
        })));
    for (const constraint of constraints) {
      plans.push({ deploymentId: bound.deploymentId, schemaVersionId: bound.schemaVersionId,
        tableId: table.tableId, descriptor: constraint.descriptor, physicalSpec: lowerLogicalDocumentUniqueConstraint(constraint) });
    }
  }
  return plans;
});

/** Schema publication already owns this transaction and its deployment catalog lock. */
export const prepareApplicationUniqueDeclarationsInTransaction = Effect.fn("ApplicationUniqueDeclarations.prepareInTransaction")(
  function* (tx: StableTableCatalogTransaction, manifest: ApplicationManifestWithRelations, bound: BoundSchema) {
    const plans = yield* declarations(manifest, bound);
    for (const plan of plans) {
      const prepared = yield* prepareAppUniqueConstraintDefinitionBindingV1Effect(tx, plan).pipe(
        Effect.mapError(projectFailure));
      yield* ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, prepared).pipe(
        Effect.mapError(projectFailure));
    }
  },
);

/** Correlate the whole prepared set for managed tables, including declared absence. */
export const applicationUniqueDeclarationsMatch = Effect.fn("ApplicationUniqueDeclarations.match")(
  function* (db: FlarexMetadataDatabase, manifest: ApplicationManifestWithRelations, bound: BoundSchema,
    reader?: FlarexMetadataTransaction) {
    if (manifest.version === 2) return true;
    const plans = yield* declarations(manifest, bound);
    const managed = new Set<CatalogTableId>(bound.tables.filter(table =>
      manifest.schema.writePolicies.configuration.tables.some(configured => configured.logicalTableName === table.logicalName)
    ).map(table => table.tableId));
    const members = yield* (reader !== undefined ? listAppUniqueConstraintDefinitionSetMembersV1Effect(reader, bound.deploymentId,
      bound.schemaVersionId, MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1).pipe(Effect.mapError(projectFailure)) :
      runEffectTransaction<Effect.Success<ReturnType<typeof listAppUniqueConstraintDefinitionSetMembersV1Effect>>,
      ApplicationWriteOwnershipError, ApplicationWriteOwnershipError, FlarexMetadataTransaction>(
      callback => db.transaction(callback),
      "Application unique declaration acquisition rolled back",
      tx => listAppUniqueConstraintDefinitionSetMembersV1Effect(tx, bound.deploymentId,
        bound.schemaVersionId, MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1).pipe(Effect.mapError(projectFailure)),
      cause => new ApplicationWriteOwnershipError({ reason: "resourceFailure", cause }),
    ));
    const actual = members.filter(member => managed.has(member.tableId));
    if (actual.length !== plans.length) return false;
    for (const plan of plans) {
      const canonical = yield* Effect.tryPromise({
        try: () => canonicalizeAppUniqueConstraintPhysicalSpecV1(plan.physicalSpec),
        catch: cause => new ApplicationWriteOwnershipError({ reason: "resourceFailure", cause }),
      }).pipe(Effect.catchTag("ApplicationWriteOwnershipError", failure =>
        typeof DOMException !== "undefined" && failure.cause instanceof DOMException
          ? Effect.fail(failure) : Effect.die(failure.cause)));
      if (actual.filter(member => member.tableId === plan.tableId && member.physicalSpecSha256Hex === canonical.sha256Hex).length !== 1) return false;
    }
    return true;
  },
);

function projectFailure(cause: PrepareAppUniqueConstraintDefinitionBindingV1Error |
  EnsureAppUniqueConstraintDefinitionBindingV1Error | ReadAppUniqueConstraintDefinitionV1Error) {
  return new ApplicationWriteOwnershipError({
    reason: cause._tag === "AppUniqueConstraintCatalogPersistenceError" || cause._tag === "SchemaVersionArtifactPersistenceError" ||
      cause._tag === "SchemaManifestTableBindingPersistenceError" || cause._tag === "AppUniqueConstraintDefinitionPreparationError"
      ? "resourceFailure" : "invalidEvidence", cause,
  });
}
