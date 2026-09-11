import type { ApplicationManifestWithRelations } from "@flarex/analysis/application-analysis";
import { Effect, Result } from "effect";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  APP_UNIQUE_KEY_CODEC_IDENTITY_V1, APP_UNIQUE_KEY_CODEC_VERSION_V1,
  canonicalizeAppUniqueConstraintPhysicalSpecV1,
  decodeAppUniqueConstraintPhysicalSpecV1Result,
} from "flarex-protocol/app-unique-constraint-definition";
import { MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1 } from "flarex-protocol/internal/app-unique-constraint-set-v1";
import { SchemaManifestAppIndexDescriptorSchema, type CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
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
import type { StableTableCatalogTransaction } from "../stableTableCatalog";
import { ApplicationWriteOwnershipError } from "./Model";

type BoundSchema = Readonly<{
  deploymentId: string;
  schemaVersionId: CatalogSchemaVersionId;
  tables: ReadonlyArray<ApplicationSchemaTableBinding>;
}>;
// Logical identity is table-scoped and the admitted policy permits only one
// unique constraint per managed table. Field identity belongs to the physical
// spec, so no user field name is truncated or prefixed into a catalog identifier.
const descriptor = SchemaManifestAppIndexDescriptorSchema.make("payload_unique");

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
    for (const field of configured.fields) {
      if (field.kind === "relationship" || field.unique !== true) continue;
      const physicalSpec = yield* Effect.fromResult(decodeAppUniqueConstraintPhysicalSpecV1Result({
        kind: "appUniqueConstraint", specVersion: 1, orderedFields: [field.name], sparse: false,
        localePolicy: { kind: "none" }, keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
        keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
      }).pipe(Result.mapError(cause => new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause }))));
      plans.push({ deploymentId: bound.deploymentId, schemaVersionId: bound.schemaVersionId,
        tableId: table.tableId, descriptor, physicalSpec });
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
  function* (db: FlarexMetadataDatabase, manifest: ApplicationManifestWithRelations, bound: BoundSchema) {
    if (manifest.version === 2) return true;
    const plans = yield* declarations(manifest, bound);
    const managed = new Set<CatalogTableId>(bound.tables.filter(table =>
      manifest.schema.writePolicies.configuration.tables.some(configured => configured.logicalTableName === table.logicalName)
    ).map(table => table.tableId));
    const members = yield* listAppUniqueConstraintDefinitionSetMembersV1Effect(db, bound.deploymentId,
      bound.schemaVersionId, MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1).pipe(Effect.mapError(projectFailure));
    const actual = members.filter(member => managed.has(member.tableId));
    if (actual.length !== plans.length) return false;
    for (const plan of plans) {
      const canonical = yield* Effect.tryPromise({
        try: () => canonicalizeAppUniqueConstraintPhysicalSpecV1(plan.physicalSpec),
        catch: cause => new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause }),
      });
      if (actual.filter(member => member.tableId === plan.tableId && member.physicalSpecSha256Hex === canonical.sha256Hex).length !== 1) return false;
    }
    return true;
  },
);

function projectFailure(cause: PrepareAppUniqueConstraintDefinitionBindingV1Error |
  EnsureAppUniqueConstraintDefinitionBindingV1Error | ReadAppUniqueConstraintDefinitionV1Error) {
  return new ApplicationWriteOwnershipError({
    reason: cause._tag === "AppUniqueConstraintCatalogPersistenceError" || cause._tag === "SchemaVersionArtifactPersistenceError" ||
      cause._tag === "SchemaManifestTableBindingPersistenceError" ? "resourceFailure" : "invalidEvidence", cause,
  });
}
