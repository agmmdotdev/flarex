import { Data, Effect } from "effect";
import { logicalTableKey } from "flarex-protocol/internal/logical-schema-candidate";
import { snapshotDecodedProtocolPlainData } from "flarex-protocol/internal/decoded-protocol-snapshot";
import { compileLogicalSourceUniqueConstraints, compileLogicalSourceIndexes, compileLogicalSourceSearches,
  compileLogicalExtensionIndexes,
  type LogicalSourceIndexRequirement, type LogicalSourceSearchRequirement,
  type LogicalSourceUniqueRequirement } from "flarex-protocol/internal/logical-storage-requirements";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { CanonicalSchemaManifestBytesSchema, SchemaManifestSha256Schema, type CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { canonicalizeAppUniqueConstraintPhysicalSpecV1 } from "flarex-protocol/app-unique-constraint-definition";
import type { AppUniqueConstraintSetMemberV1 } from "flarex-protocol/internal/app-unique-constraint-set-v1";
import type { FlarexMetadataDatabase } from "./deployments";
import type { StableTableCatalogTransaction } from "./stableTableCatalog";
import { getStableTableIdentityByValidatedIdEffect } from "./stableTableCatalog";
import { readSchemaVersionArtifactByIdEffect, type SchemaVersionArtifact } from "./schemaVersionArtifacts";
import { readLogicalSchemaAdmissionEvidence } from "./logicalSchemaAdmissionEvidence";
import { lockSchemaManifestBindingDeploymentEffect } from "./schemaManifestTableBindings";
import { ensureStableLogicalIndexIdentityInTransaction } from "./stableLogicalIndexCatalog";
import { prepareSchemaCreationTimeIndexDefinitions, ensureAppCreationTimeIndexDefinitionV1InTransaction,
  prepareOrderedIndexDefinitionBinding, ensureAppDeveloperIndexDefinitionBindingV1InTransaction } from "./appIndexDefinitions";
import { prepareAppUniqueConstraintDefinitionBindingV1Effect, ensureAppUniqueConstraintDefinitionBindingV1InTransaction,
  getAppUniqueConstraintIdentityByNameEffect } from "./appUniqueConstraintDefinitions";

export class LogicalStorageDefinitionError extends Data.TaggedError("LogicalStorageDefinitionError")<{
  readonly reason: "missingSchema" | "tableBindingChanged" | "incompleteBinding" | "uniqueSetMismatch" | "resourceFailure";
  readonly cause?: unknown;
}> {}
type BoundIndex = LogicalSourceIndexRequirement & Readonly<{ tableId: CatalogTableId }>;
type BoundSearch = LogicalSourceSearchRequirement & Readonly<{
  tableId: CatalogTableId; sourceKey: string; sourceSha256: string;
}>;
type BoundConstraint = LogicalSourceUniqueRequirement & Readonly<{ tableId: CatalogTableId }>;
const requirementIssuers = new WeakMap<object, Readonly<{ db: FlarexMetadataDatabase; deploymentId: string; schemaVersionId: CatalogSchemaVersionId }>>();

/** Index and unique requirements for the complete configured source set,
 * including explicit absence. This does not establish foreign-key, value or
 * serving readiness. Per-source preparation cannot substitute for this read. */
export const readLogicalStorageRequirements = Effect.fn("LogicalStorageDefinitions.readRequirements")(function* (
  db: FlarexMetadataDatabase, deploymentId: string, schemaVersionId: CatalogSchemaVersionId,
) {
  const artifact = yield* readSchemaVersionArtifactByIdEffect(db, deploymentId, schemaVersionId);
  if (artifact === null) return yield* Effect.fail(new LogicalStorageDefinitionError({ reason: "missingSchema" }));
  return yield* prepareLogicalStorageRequirementsFromArtifact(db, artifact);
});

/** The artifact reader has already authenticated canonical bytes and digest.
 * Compile the complete topology once in the caller's existing catalog lifetime. */
export const prepareLogicalStorageRequirementsFromArtifact = Effect.fn("LogicalStorageDefinitions.prepareRequirements")(function* (
  db: FlarexMetadataDatabase, artifact: SchemaVersionArtifact,
) {
  const artifactBytes = artifact.manifestBytes.slice();
  const artifactDigest = artifact.manifestSha256.slice();
  const artifactTime = artifact.createdAt.getTime();
  const ownedArtifact: SchemaVersionArtifact = Object.freeze({ ...artifact,
    manifestJson: snapshotDecodedProtocolPlainData(artifact.manifestJson),
    get manifestBytes() { return CanonicalSchemaManifestBytesSchema.make(artifactBytes.slice()); },
    get manifestSha256() { return SchemaManifestSha256Schema.make(artifactDigest.slice()); },
    get createdAt() { return new Date(artifactTime); },
  });
  const { deploymentId } = ownedArtifact;
  const evidence = yield* readLogicalSchemaAdmissionEvidence(ownedArtifact.manifestJson, deploymentId);
  const tableBindings = new Map(evidence.tableBindings.map(binding => [logicalTableKey(binding.table), binding]));
  const ordered: BoundIndex[] = [];
  const search: BoundSearch[] = [];
  const unique: BoundConstraint[] = [];
  for (const source of evidence.candidate.sources) {
    const definitionBindings = new Map(source.bindings.filter(binding => binding.kind === "definition")
      .map(binding => [binding.localName, binding]));
    const bind = <Requirement extends LogicalSourceIndexRequirement | LogicalSourceSearchRequirement | LogicalSourceUniqueRequirement>(requirement: Requirement) => {
      const binding = definitionBindings.get(requirement.localName);
      const table = binding === undefined ? undefined : tableBindings.get(logicalTableKey(binding.table));
      return table === undefined ? Effect.fail(new LogicalStorageDefinitionError({ reason: "incompleteBinding" }))
        : Effect.succeed({ ...requirement, tableId: table.tableId });
    };
    for (const requirement of yield* Effect.fromResult(compileLogicalSourceIndexes(source))) ordered.push(yield* bind(requirement));
    for (const requirement of yield* Effect.fromResult(compileLogicalSourceSearches(source)))
      search.push({ ...yield* bind(requirement), sourceKey: source.key, sourceSha256: source.sourceSha256 });
    for (const requirement of yield* Effect.fromResult(compileLogicalSourceUniqueConstraints(source))) unique.push(yield* bind(requirement));
  }
  for (const requirement of yield* Effect.fromResult(compileLogicalExtensionIndexes(evidence.candidate))) {
    const table = tableBindings.get(logicalTableKey(requirement.table));
    if (table === undefined) return yield* Effect.fail(new LogicalStorageDefinitionError({ reason: "incompleteBinding" }));
    ordered.push({ localName: requirement.localName, descriptor: requirement.descriptor,
      physicalSpec: requirement.physicalSpec, tableId: table.tableId });
  }
  for (const binding of evidence.tableBindings) {
    const current = yield* getStableTableIdentityByValidatedIdEffect(db, { deploymentId, tableId: binding.tableId });
    if (current === null || current.namespace !== binding.table.namespace || current.logicalName !== binding.table.logicalName) {
      return yield* Effect.fail(new LogicalStorageDefinitionError({ reason: "tableBindingChanged" }));
    }
  }
  // Byte/date descendants retain mutable native storage, so the projection
  // lends detached copies while the issuer retains the authenticated originals.
  const requirements = Object.freeze({ artifact: ownedArtifact, evidence: snapshotDecodedProtocolPlainData(evidence),
    ordered: snapshotDecodedProtocolPlainData(ordered), search: snapshotDecodedProtocolPlainData(search),
    unique: snapshotDecodedProtocolPlainData(unique) });
  requirementIssuers.set(requirements, { db, deploymentId, schemaVersionId: ownedArtifact.schemaVersionId });
  return requirements;
});

export type PreparedLogicalStorageRequirements = Effect.Success<ReturnType<typeof prepareLogicalStorageRequirementsFromArtifact>>;
export const requirePreparedLogicalStorageRequirements = Effect.fn("LogicalStorageDefinitions.requireRequirements")(function* (
  db: FlarexMetadataDatabase, deploymentId: string, schemaVersionId: CatalogSchemaVersionId,
  requirements: PreparedLogicalStorageRequirements,
) {
  const issued = requirementIssuers.get(requirements);
  if (issued === undefined || issued.db !== db || issued.deploymentId !== deploymentId || issued.schemaVersionId !== schemaVersionId)
    return yield* Effect.fail(new LogicalStorageDefinitionError({ reason: "incompleteBinding" }));
  return requirements;
});

/** Closure is source-complete, not merely a digest of whichever bindings exist.
 * Call under the existing closure preparation owner; no new settlement path. */
export const verifyLogicalUniqueDefinitionSet = Effect.fn("LogicalStorageDefinitions.verifyUniqueSet")(function* (
  db: FlarexMetadataDatabase, deploymentId: string, schemaVersionId: CatalogSchemaVersionId,
  members: readonly AppUniqueConstraintSetMemberV1[],
) {
  const requirements = yield* readLogicalStorageRequirements(db, deploymentId, schemaVersionId);
  if (members.length !== requirements.unique.length) return yield* Effect.fail(new LogicalStorageDefinitionError({ reason: "uniqueSetMismatch" }));
  for (const declaration of requirements.unique) {
    const identity = yield* getAppUniqueConstraintIdentityByNameEffect(db, { deploymentId, tableId: declaration.tableId, descriptor: declaration.descriptor });
    const member = identity === null ? undefined : members.find(candidate => candidate.logicalUniqueConstraintId === identity.logicalUniqueConstraintId);
    if (member === undefined || member.tableId !== declaration.tableId) return yield* Effect.fail(new LogicalStorageDefinitionError({ reason: "uniqueSetMismatch" }));
    const canonical = yield* Effect.tryPromise({
      try: () => canonicalizeAppUniqueConstraintPhysicalSpecV1(declaration.physicalSpec),
      catch: cause => new LogicalStorageDefinitionError({ reason: "resourceFailure", cause }),
    }).pipe(Effect.catchTag("LogicalStorageDefinitionError", failure =>
      typeof DOMException !== "undefined" && failure.cause instanceof DOMException ? Effect.fail(failure) : Effect.die(failure.cause)));
    if (canonical.sha256Hex !== member.physicalSpecSha256Hex) return yield* Effect.fail(new LogicalStorageDefinitionError({ reason: "uniqueSetMismatch" }));
  }
});

/** The caller owns the catalog transaction. Compile the complete requirement
 * set before its first catalog mutation; do not close readiness or activate. */
export const ensureLogicalStorageDefinitions = Effect.fn("LogicalStorageDefinitions.ensure")(function* (
  tx: StableTableCatalogTransaction, deploymentId: string, schemaVersionId: CatalogSchemaVersionId,
) {
  yield* lockSchemaManifestBindingDeploymentEffect(tx, deploymentId);
  const requirements = yield* readLogicalStorageRequirements(tx, deploymentId, schemaVersionId);
  const intrinsic = yield* prepareSchemaCreationTimeIndexDefinitions(tx, deploymentId, schemaVersionId);
  for (const prepared of intrinsic) yield* ensureAppCreationTimeIndexDefinitionV1InTransaction(tx, prepared);
  const ordered = [];
  for (const declaration of requirements.ordered) {
    const identity = yield* ensureStableLogicalIndexIdentityInTransaction(tx, {
      deploymentId, tableId: declaration.tableId, descriptor: declaration.descriptor,
    });
    const prepared = yield* prepareOrderedIndexDefinitionBinding({ deploymentId, schemaVersionId,
      tableId: declaration.tableId, logicalIndexId: identity.index.logicalIndexId, physicalSpec: declaration.physicalSpec });
    ordered.push(yield* ensureAppDeveloperIndexDefinitionBindingV1InTransaction(tx, prepared));
  }
  const search = [];
  for (const declaration of requirements.search) {
    const identity = yield* ensureStableLogicalIndexIdentityInTransaction(tx, {
      deploymentId, tableId: declaration.tableId, descriptor: declaration.descriptor,
    });
    search.push(Object.freeze({ ...declaration, logicalIndexId: identity.index.logicalIndexId }));
  }
  const unique = [];
  for (const declaration of requirements.unique) {
    const prepared = yield* prepareAppUniqueConstraintDefinitionBindingV1Effect(tx, { deploymentId, schemaVersionId,
      tableId: declaration.tableId, descriptor: declaration.descriptor, physicalSpec: declaration.physicalSpec });
    unique.push(yield* ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, prepared));
  }
  return Object.freeze({ requirements, ordered: Object.freeze(ordered), search: Object.freeze(search),
    unique: Object.freeze(unique) });
});
