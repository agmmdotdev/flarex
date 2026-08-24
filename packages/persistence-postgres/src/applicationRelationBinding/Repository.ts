import {
  canonicalizeApplicationManifestV2,
  type ApplicationManifestV2,
} from "@flarex/analysis/application-analysis";
import { applicationSchemaPublicationFrameV2 } from
  "@flarex/analysis/internal/application-publication-v2";
import {
  bytesEqual,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { AppSchemaCatalogCompilationErrorV1 } from
  "flarex-protocol/app-schema-catalog";
import {
  CatalogEdgeDefinitionIdSchema,
  CatalogRelationIdSchema,
  MAX_CATALOG_EDGE_DEFINITION_ID,
  MAX_CATALOG_RELATION_ID,
  type CatalogEdgeDefinitionId,
  type CatalogRelationId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  canonicalizeApplicationManifestSchemaBinding,
  canonicalizeApplicationSchemaBindingV2,
  canonicalizePhysicalEdgeDefinition,
  canonicalizeSemanticRelationDefinition,
  type ApplicationSchemaBindingV2,
  type ApplicationSchemaEdgeDefinitionV2,
  type ApplicationSchemaRelationBindingV2,
  type ApplicationSchemaSemanticDefinitionV2,
  type CanonicalApplicationManifestSchemaBindingV1,
  type CanonicalApplicationSchemaBindingV2,
  type CanonicalPhysicalEdgeDefinitionV1,
  type CanonicalSemanticRelationDefinitionV1,
} from "flarex-protocol/internal/application-schema-binding";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  MAX_CATALOG_SCHEMA_VERSION,
  type CatalogSchemaVersion,
  type CatalogSchemaVersionId,
  type SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";

import {
  getPreparedAppSchemaPublicationV1StateResult,
  prepareAppSchemaPublicationV1Effect,
  type PrepareAppSchemaPublicationV1Error,
  type PreparedAppSchemaPublicationV1,
} from "../appSchemaPublicationPreparation";
import {
  publishPreparedAppSchemaV1InTransactionEffect,
  type PublishPreparedAppSchemaV1InTransactionError,
} from "../appSchemaPublicationTransaction";
import {
  applicationSchemaPublicationInputResult,
  projectBoundApplicationSchemaResult,
} from "../applicationSchemaProjection";
import type { FlarexMetadataDatabase } from "../deployments";
import { runEffectTransaction } from "../effectTransaction";
import { hasExactOwnDataKeys } from "../exactOwnDataKeys";
import {
  deployments,
  fxControlApplicationManifestSchemaBindings,
  fxControlApplicationSchemaAuthoritiesV1,
  fxControlBoundApplicationSchemas,
  fxControlEdgeDefinitions,
  fxControlRelations,
  fxControlSchemaVersionRelationBindings,
  fxControlSchemaVersions,
} from "../schema";
import { SchemaManifestAppSchemaBindingPlanStaleError } from
  "../schemaManifestAppSchemaBindings";
import { lockSchemaManifestBindingDeploymentEffect } from
  "../schemaManifestTableBindings";
import {
  getSchemaVersionArtifactByIdEffect,
  getPreparedSchemaVersionArtifactEvidenceResult,
  type ReadSchemaVersionArtifactError,
} from "../schemaVersionArtifacts";
import {
  StableTableCatalogDeploymentNotFoundError,
  type StableTableCatalogTransaction,
} from "../stableTableCatalog";
import {
  ApplicationRelationBindingError,
  type ApplicationRelationBindingPublication,
  type LocatedApplicationRelationBinding,
  type PublishApplicationRelationBindingInput,
  ReadApplicationRelationBindingError,
  type RelationEvolutionDecision,
} from "./Model";
import {
  classifyRelationCompatibility,
  makePhysicalEdgeDefinition,
} from "./Policy";

const MAX_PUBLICATION_ATTEMPTS = 3;
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const decodeCatalogSchemaVersionIdResult = Schema.decodeUnknownResult(
  CatalogSchemaVersionIdSchema,
);

export interface ApplicationRelationBindingRepository {
  readonly db: FlarexMetadataDatabase;
  runTransaction<Value>(
    run: (tx: StableTableCatalogTransaction) => Promise<Value>,
  ): Promise<Value>;
}

interface PublicationSource {
  readonly deploymentId: string;
  readonly manifest: ApplicationManifestV2;
  readonly manifestSha256: string;
  readonly manifestSha256Bytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
  readonly applicationSchemaSha256: string;
  readonly applicationSchemaSha256Bytes: Uint8Array;
  readonly applicationSchemaFrameBytes: Uint8Array;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly decisions: ReadonlyArray<RelationEvolutionDecision>;
}

interface VersionObservation {
  readonly active: number;
  readonly catalog: number;
  readonly reserved: number;
  readonly selected: CatalogSchemaVersion;
}

interface CatalogHighWaterObservation {
  readonly relationId: CatalogRelationId | null;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId | null;
}

interface OriginObservation {
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly relationOrdinal: number;
  readonly binding: ApplicationSchemaRelationBindingV2;
  readonly rootBindingBytes: Uint8Array;
  readonly rootApplicationSchemaFrameBytes: Uint8Array;
  readonly rootBoundPublicationSha256: Uint8Array;
  readonly relationId: CatalogRelationId;
  readonly semanticDefinitionSha256: Uint8Array;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly physicalDefinitionJson: CanonicalPhysicalEdgeDefinitionV1["definition"];
  readonly physicalDefinitionBytes: Uint8Array;
  readonly physicalDefinitionSha256: Uint8Array;
  readonly semanticDefinition: CanonicalSemanticRelationDefinitionV1["definition"];
}

interface PlannedRelation {
  readonly binding: ApplicationSchemaRelationBindingV2;
  readonly semantic: CanonicalSemanticRelationDefinitionV1;
  readonly physical: CanonicalPhysicalEdgeDefinitionV1;
  readonly insertRelation: boolean;
  readonly insertPhysical: boolean;
  readonly origin: OriginObservation | null;
}

interface ExistingPublicationPlan {
  readonly kind: "existing";
  readonly source: PublicationSource;
  readonly bound: CanonicalApplicationSchemaBindingV2;
  readonly schemaManifestSha256: Uint8Array;
  readonly schemaArtifactManifestBytes: Uint8Array;
  readonly schemaArtifactManifestJson: unknown;
  readonly edgeEvidence: ReadonlyMap<
    CatalogEdgeDefinitionId,
    CanonicalPhysicalEdgeDefinitionV1
  >;
  readonly manifestBinding: CanonicalApplicationManifestSchemaBindingV1;
}

interface CreatePublicationPlan {
  readonly kind: "create";
  readonly source: PublicationSource;
  readonly versionObservation: VersionObservation;
  readonly highWater: CatalogHighWaterObservation;
  readonly schemaVersion: CatalogSchemaVersion;
  readonly basePublication: PreparedAppSchemaPublicationV1;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
  readonly schemaManifestSha256: Uint8Array;
  readonly relations: ReadonlyArray<PlannedRelation>;
  readonly bound: CanonicalApplicationSchemaBindingV2;
  readonly manifestBinding: CanonicalApplicationManifestSchemaBindingV1;
}

type PublicationPlan = ExistingPublicationPlan | CreatePublicationPlan;

class RelationBindingPlanStaleError extends Error {
  readonly _tag = "RelationBindingPlanStaleError" as const;
}

/**
 * Bind one durable relation-bearing analysis artifact to stable system-core
 * identities. This service intentionally stops before readiness, activation,
 * edge storage, runtime reads, and any public application API.
 */
export const publishApplicationRelationBindingEffect = Effect.fn(
  "ApplicationRelationBinding.publish",
)(function* (
  repository: ApplicationRelationBindingRepository,
  input: PublishApplicationRelationBindingInput,
): Effect.fn.Return<
  ApplicationRelationBindingPublication,
  ApplicationRelationBindingError
> {
  const source = yield* prepareSourceEffect(input);
  return yield* runAttemptsEffect(repository, source, 1);
});

/**
 * Private C09 locator for the complete immutable R02 root. The control-catalog
 * coordinates are locators only: retained canonical evidence and every
 * normalized relation/physical row are revalidated before returning.
 */
export const locateApplicationRelationBindingForCommitEffect = Effect.fn(
  "ApplicationRelationBinding.locateForCommit",
)(function* (
  db: FlarexMetadataDatabase,
  input: Readonly<{
    readonly deploymentId: string;
    readonly schemaVersionId: CatalogSchemaVersionId;
  }>,
): Effect.fn.Return<
  LocatedApplicationRelationBinding | null,
  ReadApplicationRelationBindingError
> {
  if (
    !isNonBlankString(input.deploymentId) ||
    input.deploymentId.includes("\0")
  ) {
    return yield* relationBindingReadFailure("invalidInput");
  }
  const schemaVersionId = yield* Effect.fromResult(
    decodeCatalogSchemaVersionIdResult(input.schemaVersionId).pipe(
      Result.mapError((cause) => relationBindingReadFailureValue(
        "invalidInput",
        cause,
      )),
    ),
  );
  const rows = yield* relationBindingReadQueryEffect(() => db.select().from(
    fxControlBoundApplicationSchemas,
  ).where(and(
    eq(
      fxControlBoundApplicationSchemas.deploymentId,
      input.deploymentId,
    ),
    eq(
      fxControlBoundApplicationSchemas.schemaVersionId,
      schemaVersionId,
    ),
  )).limit(2));
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    return yield* relationBindingReadFailure("storedState");
  }
  const row = rows[0];
  if (row === undefined) {
    return yield* relationBindingReadFailure("storedState");
  }
  const decoded = yield* decodeStoredBoundRowEffect(row).pipe(
    Effect.mapError(mapApplicationRelationBindingReadError),
  );
  if (
    decoded.bound.binding.deploymentId !== input.deploymentId ||
    decoded.bound.binding.schemaVersionId !== schemaVersionId
  ) {
    return yield* relationBindingReadFailure("storedState");
  }
  const artifact = yield* getSchemaVersionArtifactByIdEffect(
    db,
    input.deploymentId,
    schemaVersionId,
  ).pipe(
    Effect.mapError((cause) => mapApplicationRelationBindingReadError(
      mapSchemaArtifactReadError(cause),
    )),
  );
  if (
    artifact === null ||
    artifact.version !== decoded.bound.binding.schemaVersion ||
    !bytesEqual(artifact.manifestSha256, decoded.schemaManifestSha256)
  ) {
    return yield* relationBindingReadFailure("storedState");
  }
  yield* validateLocatedRelationBindingCatalogEffect(
    db,
    decoded.bound,
  );
  return Object.freeze({
    deploymentId: input.deploymentId,
    schemaVersionId,
    binding: decoded.bound.binding,
    applicationSchemaSha256: copyBytes(row.applicationSchemaSha256),
    schemaManifestSha256: copyBytes(decoded.schemaManifestSha256),
    boundPublicationSha256: copyBytes(row.boundPublicationSha256),
  } satisfies LocatedApplicationRelationBinding);
});

function runAttemptsEffect(
  repository: ApplicationRelationBindingRepository,
  source: PublicationSource,
  attempt: number,
): Effect.Effect<
  ApplicationRelationBindingPublication,
  ApplicationRelationBindingError
> {
  return preparePlanEffect(repository.db, source).pipe(
    Effect.flatMap(plan => runPlanTransactionEffect(repository, plan)),
    Effect.catchTag("RelationBindingPlanStaleError", cause =>
      attempt < MAX_PUBLICATION_ATTEMPTS
        ? runAttemptsEffect(repository, source, attempt + 1)
        : bindingFailure(
            "retryExhausted",
            "The relation-binding plan remained stale after three attempts.",
            cause,
          )),
  );
}

const prepareSourceEffect = Effect.fn(
  "ApplicationRelationBinding.prepareSource",
)(function* (
  input: PublishApplicationRelationBindingInput,
): Effect.fn.Return<PublicationSource, ApplicationRelationBindingError> {
  if (
    !isNonBlankString(input.deploymentId) ||
    input.deploymentId.includes("\0")
  ) {
    return yield* bindingFailure("invalidDeployment");
  }
  if (!LOWERCASE_SHA256.test(input.manifestSha256)) {
    return yield* bindingFailure("manifestDigestMismatch");
  }
  const canonicalManifest = yield* Effect.fromResult(
    canonicalizeApplicationManifestV2(input.manifest).pipe(
      Result.mapError(cause => bindingFailureValue(
        "invalidManifest",
        "Expected a canonical Application Manifest V2.",
        cause,
      )),
    ),
  );
  const manifestBytes = copyBytes(canonicalManifest.canonicalBytes);
  const manifestSha256Bytes = yield* sha256Effect(manifestBytes);
  const manifestSha256 = encodeBytesToLowercaseHex(manifestSha256Bytes);
  if (manifestSha256 !== input.manifestSha256) {
    return yield* bindingFailure("manifestDigestMismatch");
  }
  const applicationSchemaFrame = yield* Effect.fromResult(
    applicationSchemaPublicationFrameV2(canonicalManifest.manifest).pipe(
      Result.mapError(cause => bindingFailureValue(
        "invalidManifest",
        "The Application Manifest V2 schema frame is invalid.",
        cause,
      )),
    ),
  );
  const applicationSchemaFrameBytes = copyBytes(applicationSchemaFrame);
  const applicationSchemaSha256Bytes = yield* sha256Effect(
    applicationSchemaFrameBytes,
  );
  const applicationSchemaSha256 = encodeBytesToLowercaseHex(
    applicationSchemaSha256Bytes,
  );
  const schemaVersionId = yield* Effect.fromResult(
    decodeCatalogSchemaVersionIdResult(
      `application_${applicationSchemaSha256}`,
    ).pipe(Result.mapError(cause => bindingFailureValue(
      "invalidManifest",
      "The derived application schema identity is invalid.",
      cause,
    ))),
  );
  const decisions = yield* Effect.fromResult(snapshotDecisionsResult(
    input.decisions,
    canonicalManifest.manifest.schema.relations.length,
  ));
  return Object.freeze({
    deploymentId: input.deploymentId,
    manifest: canonicalManifest.manifest,
    manifestSha256,
    manifestSha256Bytes,
    manifestBytes,
    applicationSchemaSha256,
    applicationSchemaSha256Bytes,
    applicationSchemaFrameBytes,
    schemaVersionId,
    decisions,
  });
});

const preparePlanEffect = Effect.fn(
  "ApplicationRelationBinding.preparePlan",
)(function* (
  db: FlarexMetadataDatabase,
  source: PublicationSource,
): Effect.fn.Return<PublicationPlan, ApplicationRelationBindingError> {
  const existing = yield* readBoundByApplicationSchemaEffect(db, source);
  if (existing !== null) {
    yield* Effect.fromResult(requireExactDecisionsResult(
      source.decisions,
      existing.bound.binding.relationBindings,
    ));
    const manifestBinding = yield* prepareManifestBindingEffect(
      source,
      existing.bound,
    );
    const edgeEvidence = yield* prepareEdgeEvidenceEffect(existing.bound);
    return Object.freeze({
      kind: "existing" as const,
      source,
      bound: existing.bound,
      schemaManifestSha256: existing.schemaManifestSha256,
      schemaArtifactManifestBytes: existing.schemaArtifactManifestBytes,
      schemaArtifactManifestJson: existing.schemaArtifactManifestJson,
      edgeEvidence,
      manifestBinding,
    });
  }

  const versionObservation = yield* readVersionObservationEffect(
    db,
    source.deploymentId,
  );
  const schemaVersion = versionObservation.selected;
  const publicationInput = yield* Effect.fromResult(
    applicationSchemaPublicationInputResult(
      source.deploymentId,
      source.schemaVersionId,
      schemaVersion,
      source.manifest.schema,
    ).pipe(Result.mapError(cause => bindingFailureValue(
      "invalidManifest",
      "The analyzed table/index schema cannot be published.",
      cause,
    ))),
  );
  const basePublication = yield* prepareAppSchemaPublicationV1Effect(
    db,
    publicationInput,
  ).pipe(Effect.mapError(mapBasePublicationPreparationError));
  const baseState = yield* Effect.fromResult(
    getPreparedAppSchemaPublicationV1StateResult(basePublication).pipe(
      Result.mapError(cause => bindingFailureValue(
        "storedState",
        "The table/index publication token lost its prepared state.",
        cause,
      )),
    ),
  );
  const artifactEvidence = yield* Effect.fromResult(
    getPreparedSchemaVersionArtifactEvidenceResult(baseState.artifact).pipe(
      Result.mapError(cause => bindingFailureValue(
        "storedState",
        "The schema artifact token lost its prepared evidence.",
        cause,
      )),
    ),
  );
  const schemaManifest = baseState.logicalBindings.manifest;
  const schemaManifestSha256 = artifactEvidence.manifestSha256;
  const projection = yield* Effect.fromResult(
    projectBoundApplicationSchemaResult(
      source.manifest.schema,
      schemaManifest,
    ).pipe(Result.mapError(cause => bindingFailureValue(
      "bindingConflict",
      "The stable table/index projection disagrees with analysis.",
      cause,
    ))),
  );
  const highWater = yield* readCatalogHighWaterEffect(
    db,
    source.deploymentId,
  );
  const origins = yield* loadOriginsEffect(db, source);
  const relations = yield* planRelationsEffect(
    source,
    projection.tables,
    highWater,
    origins,
  );
  const bound = yield* canonicalizeApplicationSchemaBindingV2({
    format: "flarex.application-schema-binding",
    version: 2,
    deploymentId: source.deploymentId,
    applicationSchemaSha256: source.applicationSchemaSha256,
    schemaVersionId: source.schemaVersionId,
    schemaVersion,
    schemaManifestSha256: encodeBytesToLowercaseHex(schemaManifestSha256),
    tables: projection.tables,
    indexes: projection.indexes,
    relationBindings: relations.map(relation => relation.binding),
    semanticDefinitions: relations
      .map(relation => ({
        relationId: relation.binding.relationId,
        semanticDefinitionSha256: relation.semantic.sha256Hex,
        definition: relation.semantic.definition,
      } satisfies ApplicationSchemaSemanticDefinitionV2))
      .toSorted((left, right) => left.relationId - right.relationId),
    edgeDefinitions: relations
      .map(relation => ({
        edgeDefinitionId: relation.binding.edgeDefinitionId,
        edgeDefinitionSha256: relation.physical.sha256Hex,
        definition: relation.physical.definition,
      } satisfies ApplicationSchemaEdgeDefinitionV2))
      .toSorted((left, right) =>
        left.edgeDefinitionId - right.edgeDefinitionId
      ),
  }).pipe(Effect.mapError(cause => bindingFailureValue(
    "bindingConflict",
    "The complete relation binding is internally inconsistent.",
    cause,
  )));
  const manifestBinding = yield* prepareManifestBindingEffect(source, bound);
  return Object.freeze({
    kind: "create" as const,
    source,
    versionObservation,
    highWater,
    schemaVersion,
    basePublication,
    schemaManifest,
    schemaManifestSha256,
    relations,
    bound,
    manifestBinding,
  });
});

const planRelationsEffect = Effect.fn(
  "ApplicationRelationBinding.planRelations",
)(function* (
  source: PublicationSource,
  tables: ReadonlyArray<{
    readonly applicationTableId: number;
    readonly logicalName: string;
    readonly tableId: CatalogTableId;
  }>,
  highWater: CatalogHighWaterObservation,
  origins: ReadonlyMap<string, OriginObservation>,
): Effect.fn.Return<
  ReadonlyArray<PlannedRelation>,
  ApplicationRelationBindingError
> {
  let nextRelationId = highWater.relationId ?? 0;
  let nextEdgeDefinitionId = highWater.edgeDefinitionId ?? 0;
  const selectedRelationIds = new Set<number>();
  const planned: PlannedRelation[] = [];

  for (
    let index = 0;
    index < source.manifest.schema.relations.length;
    index += 1
  ) {
    const analyzed = source.manifest.schema.relations[index];
    const decision = source.decisions[index];
    if (analyzed === undefined || decision === undefined) {
      return yield* bindingFailure(
        "invalidEvolution",
        "The evolution plan is not dense in relation-ordinal order.",
      );
    }
    const sourceTable = tables[analyzed.sourceTableOrdinal - 1];
    const targetTable = tables[analyzed.targetTableOrdinal - 1];
    if (
      sourceTable === undefined || targetTable === undefined ||
      sourceTable.applicationTableId !== analyzed.sourceTableOrdinal ||
      targetTable.applicationTableId !== analyzed.targetTableOrdinal
    ) {
      return yield* bindingFailure(
        "invalidManifest",
        "A relation table ordinal did not resolve to its stable table binding.",
      );
    }

    let relationId: CatalogRelationId;
    let edgeDefinitionId: CatalogEdgeDefinitionId;
    let insertRelation: boolean;
    let insertPhysical: boolean;
    let origin: OriginObservation | null;
    let evolution: ApplicationSchemaRelationBindingV2["evolution"];
    if (decision.evolution.kind === "new") {
      nextRelationId = yield* nextCatalogIdEffect(
        nextRelationId,
        MAX_CATALOG_RELATION_ID,
        "relationIdExhausted",
      );
      nextEdgeDefinitionId = yield* nextCatalogIdEffect(
        nextEdgeDefinitionId,
        MAX_CATALOG_EDGE_DEFINITION_ID,
        "edgeDefinitionIdExhausted",
      );
      relationId = CatalogRelationIdSchema.make(nextRelationId);
      edgeDefinitionId = CatalogEdgeDefinitionIdSchema.make(
        nextEdgeDefinitionId,
      );
      insertRelation = true;
      insertPhysical = true;
      origin = null;
      evolution = Object.freeze({ kind: "new" as const });
    } else {
      origin = origins.get(originKey(
        decision.evolution.fromSchemaVersionId,
        decision.evolution.fromRelationOrdinal,
      )) ?? null;
      if (origin === null) {
        return yield* bindingFailure(
          "missingOrigin",
          `Missing prior relation ${decision.evolution.fromSchemaVersionId}/${decision.evolution.fromRelationOrdinal}.`,
        );
      }
      // Classification is mandatory even when only physical reuse changes the
      // persistence plan. V1 codec changes are rejected by manifest decoding.
      const compatibility = classifyRelationCompatibility(
        origin.semanticDefinition.declaration,
        analyzed.declaration,
      );
      evolution = Object.freeze({
        ...decision.evolution,
        compatibility,
      });
      relationId = origin.relationId;
      insertRelation = false;
      if (decision.evolution.physical === "reuse") {
        edgeDefinitionId = origin.edgeDefinitionId;
        insertPhysical = false;
      } else {
        nextEdgeDefinitionId = yield* nextCatalogIdEffect(
          nextEdgeDefinitionId,
          MAX_CATALOG_EDGE_DEFINITION_ID,
          "edgeDefinitionIdExhausted",
        );
        edgeDefinitionId = CatalogEdgeDefinitionIdSchema.make(
          nextEdgeDefinitionId,
        );
        insertPhysical = true;
      }
    }
    if (selectedRelationIds.has(relationId)) {
      return yield* bindingFailure(
        "invalidEvolution",
        "Two current relations cannot preserve the same stable relation identity.",
      );
    }
    selectedRelationIds.add(relationId);

    const semantic = yield* canonicalizeSemanticRelationDefinition({
      format: "flarex.semantic-relation-definition",
      version: 1,
      applicationSchemaSha256: source.applicationSchemaSha256,
      relationId,
      sourceTableId: sourceTable.tableId,
      targetTableId: targetTable.tableId,
      declaration: analyzed.declaration,
    }).pipe(Effect.mapError(cause => bindingFailureValue(
      "bindingConflict",
      `Relation ${analyzed.relationOrdinal} semantic definition is invalid.`,
      cause,
    )));
    const physical = yield* canonicalizePhysicalEdgeDefinition(
      makePhysicalEdgeDefinition(
        sourceTable.tableId,
        targetTable.tableId,
        analyzed.declaration,
      ),
    ).pipe(Effect.mapError(cause => bindingFailureValue(
      "bindingConflict",
      `Relation ${analyzed.relationOrdinal} physical definition is invalid.`,
      cause,
    )));
    if (origin !== null && decision.evolution.kind === "preserve") {
      const physicalBytesMatch = bytesEqual(
        physical.canonicalBytes,
        origin.physicalDefinitionBytes,
      );
      if (decision.evolution.physical === "reuse" && !physicalBytesMatch) {
        return yield* bindingFailure(
          "physicalReuseMismatch",
          `Relation ${analyzed.relationOrdinal} requested physical reuse with different canonical bytes.`,
        );
      }
      if (decision.evolution.physical === "replace" && physicalBytesMatch) {
        return yield* bindingFailure(
          "physicalReplacementMatch",
          `Relation ${analyzed.relationOrdinal} requested an identical physical replacement.`,
        );
      }
    }
    planned.push(Object.freeze({
      binding: Object.freeze({
        relationOrdinal: analyzed.relationOrdinal,
        sourceTableOrdinal: analyzed.sourceTableOrdinal,
        targetTableOrdinal: analyzed.targetTableOrdinal,
        relationId,
        sourceTableId: sourceTable.tableId,
        targetTableId: targetTable.tableId,
        semanticDefinitionSha256: semantic.sha256Hex,
        edgeDefinitionId,
        evolution,
      }),
      semantic,
      physical,
      insertRelation,
      insertPhysical,
      origin,
    }));
  }
  return Object.freeze(planned);
});

function nextCatalogIdEffect(
  current: number,
  maximum: number,
  reason: "relationIdExhausted" | "edgeDefinitionIdExhausted",
): Effect.Effect<number, ApplicationRelationBindingError> {
  if (!Number.isSafeInteger(current) || current < 0 || current >= maximum) {
    return bindingFailure(reason);
  }
  return Effect.succeed(current + 1);
}

interface DecodedBoundRoot {
  readonly bound: CanonicalApplicationSchemaBindingV2;
  readonly schemaManifestSha256: Uint8Array;
  readonly applicationSchemaFrameBytes: Uint8Array;
}

interface StoredBoundSchema extends DecodedBoundRoot {
  readonly schemaArtifactManifestBytes: Uint8Array;
  readonly schemaArtifactManifestJson: unknown;
}

const readBoundByApplicationSchemaEffect = Effect.fn(
  "ApplicationRelationBinding.readBoundBySchema",
)(function* (
  db: FlarexMetadataDatabase,
  source: PublicationSource,
): Effect.fn.Return<
  StoredBoundSchema | null,
  ApplicationRelationBindingError
> {
  const rows = yield* relationQueryEffect(() => db.select().from(
    fxControlBoundApplicationSchemas,
  ).where(and(
    eq(fxControlBoundApplicationSchemas.deploymentId, source.deploymentId),
    eq(
      fxControlBoundApplicationSchemas.applicationSchemaSha256,
      source.applicationSchemaSha256Bytes,
    ),
  )).limit(2));
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    return yield* bindingFailure("storedState");
  }
  const decoded = yield* decodeStoredBoundRowEffect(rows[0]);
  if (
    decoded.bound.binding.applicationSchemaSha256 !==
      source.applicationSchemaSha256 ||
    decoded.bound.binding.schemaVersionId !== source.schemaVersionId
  ) {
    return yield* bindingFailure(
      "storedState",
      "The stored bound-schema root disagrees with its schema identity.",
    );
  }
  if (!bytesEqual(
    decoded.applicationSchemaFrameBytes,
    source.applicationSchemaFrameBytes,
  )) {
    return yield* bindingFailure(
      "bindingConflict",
      "The application-schema digest is already bound to different canonical schema bytes.",
    );
  }
  const artifact = yield* getSchemaVersionArtifactByIdEffect(
    db,
    source.deploymentId,
    decoded.bound.binding.schemaVersionId,
  ).pipe(Effect.mapError(mapSchemaArtifactReadError));
  if (
    artifact === null ||
    artifact.version !== decoded.bound.binding.schemaVersion ||
    !bytesEqual(artifact.manifestSha256, decoded.schemaManifestSha256)
  ) {
    return yield* bindingFailure(
      "storedState",
      "The reusable bound schema lost its exact base schema artifact.",
    );
  }
  return Object.freeze({
    ...decoded,
    schemaArtifactManifestBytes: copyBytes(artifact.manifestBytes),
    schemaArtifactManifestJson: artifact.manifestJson,
  });
});

const decodeStoredBoundRowEffect = Effect.fn(
  "ApplicationRelationBinding.decodeStoredBoundRow",
)(function* (
  row: typeof fxControlBoundApplicationSchemas.$inferSelect,
): Effect.fn.Return<DecodedBoundRoot, ApplicationRelationBindingError> {
  if (
    row.bindingCodecVersion !== 2 ||
    !isUint8ArrayWithByteLength(row.applicationSchemaSha256, 32) ||
    !isUint8Array(row.applicationSchemaFrameBytes) ||
    !isUint8ArrayWithByteLength(row.schemaManifestSha256, 32) ||
    !isUint8ArrayWithByteLength(row.boundPublicationSha256, 32) ||
    !isUint8Array(row.bindingBytes)
  ) {
    return yield* bindingFailure("storedState");
  }
  const applicationSchemaFrameSha256 = yield* sha256Effect(
    row.applicationSchemaFrameBytes,
  );
  if (!bytesEqual(
    applicationSchemaFrameSha256,
    row.applicationSchemaSha256,
  )) {
    return yield* bindingFailure(
      "storedState",
      "The stored application-schema frame does not match its digest.",
    );
  }
  const bound = yield* canonicalizeApplicationSchemaBindingV2(
    row.bindingJson,
  ).pipe(Effect.mapError(cause => bindingFailureValue(
    "storedState",
    "The stored bound-schema JSON is invalid.",
    cause,
  )));
  if (
    bound.binding.deploymentId !== row.deploymentId ||
    bound.binding.schemaVersionId !== row.schemaVersionId ||
    bound.binding.schemaVersion !== row.schemaVersion ||
    bound.binding.applicationSchemaSha256 !==
      encodeBytesToLowercaseHex(row.applicationSchemaSha256) ||
    bound.binding.schemaManifestSha256 !==
      encodeBytesToLowercaseHex(row.schemaManifestSha256) ||
    bound.sha256Hex !== encodeBytesToLowercaseHex(
      row.boundPublicationSha256,
    ) ||
    !bytesEqual(bound.canonicalBytes, row.bindingBytes)
  ) {
    return yield* bindingFailure(
      "storedState",
      "The stored bound-schema bytes, digest, and projection disagree.",
    );
  }
  return Object.freeze({
    bound,
    schemaManifestSha256: copyBytes(row.schemaManifestSha256),
    applicationSchemaFrameBytes: copyBytes(row.applicationSchemaFrameBytes),
  });
});

const prepareManifestBindingEffect = Effect.fn(
  "ApplicationRelationBinding.prepareManifestBinding",
)(function* (
  source: PublicationSource,
  bound: CanonicalApplicationSchemaBindingV2,
): Effect.fn.Return<
  CanonicalApplicationManifestSchemaBindingV1,
  ApplicationRelationBindingError
> {
  return yield* canonicalizeApplicationManifestSchemaBinding({
    format: "flarex.application-manifest-schema-binding",
    version: 1,
    deploymentId: source.deploymentId,
    applicationManifestSha256: source.manifestSha256,
    applicationSchemaSha256: source.applicationSchemaSha256,
    schemaVersionId: bound.binding.schemaVersionId,
    schemaVersion: bound.binding.schemaVersion,
    boundPublicationSha256: bound.sha256Hex,
  }).pipe(Effect.mapError(cause => bindingFailureValue(
    "bindingConflict",
    "The manifest-to-bound-schema commitment is invalid.",
    cause,
  )));
});

const prepareEdgeEvidenceEffect = Effect.fn(
  "ApplicationRelationBinding.prepareEdgeEvidence",
)(function* (
  bound: CanonicalApplicationSchemaBindingV2,
): Effect.fn.Return<
  ReadonlyMap<CatalogEdgeDefinitionId, CanonicalPhysicalEdgeDefinitionV1>,
  ApplicationRelationBindingError
> {
  const evidence = new Map<
    CatalogEdgeDefinitionId,
    CanonicalPhysicalEdgeDefinitionV1
  >();
  for (const edge of bound.binding.edgeDefinitions) {
    const canonical = yield* canonicalizePhysicalEdgeDefinition(
      edge.definition,
    ).pipe(Effect.mapError(cause => bindingFailureValue(
      "storedState",
      "The stored bound schema contains invalid edge evidence.",
      cause,
    )));
    if (
      canonical.sha256Hex !== edge.edgeDefinitionSha256 ||
      evidence.has(edge.edgeDefinitionId)
    ) {
      return yield* bindingFailure("storedState");
    }
    evidence.set(edge.edgeDefinitionId, canonical);
  }
  return evidence;
});

const validateLocatedRelationBindingCatalogEffect = Effect.fn(
  "ApplicationRelationBinding.validateLocatedCommitCatalog",
)(function* (
  db: FlarexMetadataDatabase,
  bound: CanonicalApplicationSchemaBindingV2,
): Effect.fn.Return<void, ReadApplicationRelationBindingError> {
  const relationRows = yield* relationBindingReadQueryEffect(() => db.select()
    .from(fxControlSchemaVersionRelationBindings)
    .where(and(
      eq(
        fxControlSchemaVersionRelationBindings.deploymentId,
        bound.binding.deploymentId,
      ),
      eq(
        fxControlSchemaVersionRelationBindings.schemaVersionId,
        bound.binding.schemaVersionId,
      ),
    ))
    .limit(bound.binding.relationBindings.length + 1));
  if (relationRows.length !== bound.binding.relationBindings.length) {
    return yield* relationBindingReadFailure("storedState");
  }
  const relationsByOrdinal = new Map(relationRows.map((row) => [
    row.relationOrdinal,
    row,
  ] as const));
  if (relationsByOrdinal.size !== relationRows.length) {
    return yield* relationBindingReadFailure("storedState");
  }
  for (const expected of bound.binding.relationBindings) {
    const row = relationsByOrdinal.get(expected.relationOrdinal);
    if (
      row === undefined ||
      row.deploymentId !== bound.binding.deploymentId ||
      row.schemaVersionId !== bound.binding.schemaVersionId ||
      !relationBindingRowMatches(row, expected)
    ) {
      return yield* relationBindingReadFailure("storedState");
    }
  }

  const edgeEvidence = yield* prepareEdgeEvidenceEffect(bound).pipe(
    Effect.mapError(mapApplicationRelationBindingReadError),
  );
  const relationByEdgeDefinitionId = new Map(
    bound.binding.relationBindings.map((relation) => [
      relation.edgeDefinitionId,
      relation,
    ] as const),
  );
  if (
    relationByEdgeDefinitionId.size !==
      bound.binding.relationBindings.length
  ) {
    return yield* relationBindingReadFailure("storedState");
  }
  const relationIds = bound.binding.relationBindings.map(
    (relation) => relation.relationId,
  );
  const stableRelationRows = yield* relationBindingReadQueryEffect(() =>
    db.select().from(fxControlRelations).where(and(
      eq(
        fxControlRelations.deploymentId,
        bound.binding.deploymentId,
      ),
      inArray(fxControlRelations.relationId, relationIds),
    )).limit(relationIds.length + 1)
  );
  if (stableRelationRows.length !== relationIds.length) {
    return yield* relationBindingReadFailure("storedState");
  }
  const stableRelationsById = new Map(stableRelationRows.map((row) => [
    row.relationId,
    row,
  ] as const));
  if (stableRelationsById.size !== stableRelationRows.length) {
    return yield* relationBindingReadFailure("storedState");
  }
  for (const relation of bound.binding.relationBindings) {
    const row = stableRelationsById.get(relation.relationId);
    if (
      row === undefined ||
      row.deploymentId !== bound.binding.deploymentId ||
      !isNonBlankString(row.createdBySchemaVersionId) ||
      (
        relation.evolution.kind === "new" &&
        row.createdBySchemaVersionId !== bound.binding.schemaVersionId
      )
    ) {
      return yield* relationBindingReadFailure("storedState");
    }
  }
  const edgeDefinitionIds = bound.binding.edgeDefinitions.map(
    (edge) => edge.edgeDefinitionId,
  );
  const edgeRows = yield* relationBindingReadQueryEffect(() => db.select()
    .from(fxControlEdgeDefinitions)
    .where(and(
      eq(
        fxControlEdgeDefinitions.deploymentId,
        bound.binding.deploymentId,
      ),
      inArray(
        fxControlEdgeDefinitions.edgeDefinitionId,
        edgeDefinitionIds,
      ),
    ))
    .limit(edgeDefinitionIds.length + 1));
  if (edgeRows.length !== edgeDefinitionIds.length) {
    return yield* relationBindingReadFailure("storedState");
  }
  const edgesById = new Map(edgeRows.map((row) => [
    row.edgeDefinitionId,
    row,
  ] as const));
  if (edgesById.size !== edgeRows.length) {
    return yield* relationBindingReadFailure("storedState");
  }
  for (const expected of bound.binding.edgeDefinitions) {
    const row = edgesById.get(expected.edgeDefinitionId);
    const canonical = edgeEvidence.get(expected.edgeDefinitionId);
    const relation = relationByEdgeDefinitionId.get(
      expected.edgeDefinitionId,
    );
    if (
      row === undefined || canonical === undefined || relation === undefined ||
      row.deploymentId !== bound.binding.deploymentId ||
      row.relationId !== relation.relationId ||
      !isNonBlankString(row.createdBySchemaVersionId) ||
      row.physicalDefinitionCodecVersion !== 1 ||
      !isUint8Array(row.physicalDefinitionBytes) ||
      !bytesEqual(row.physicalDefinitionBytes, canonical.canonicalBytes) ||
      !storedDigestEquals(
        row.physicalDefinitionSha256,
        expected.edgeDefinitionSha256,
      ) ||
      !jsonValuesEqual(row.physicalDefinitionJson, expected.definition)
    ) {
      return yield* relationBindingReadFailure("storedState");
    }
    if (
      (
        relation.evolution.kind === "new" ||
        relation.evolution.physical === "replace"
      ) &&
      row.createdBySchemaVersionId !== bound.binding.schemaVersionId
    ) {
      return yield* relationBindingReadFailure("storedState");
    }
  }
});

const loadOriginsEffect = Effect.fn(
  "ApplicationRelationBinding.loadOrigins",
)(function* (
  db: FlarexMetadataDatabase,
  source: PublicationSource,
): Effect.fn.Return<
  ReadonlyMap<string, OriginObservation>,
  ApplicationRelationBindingError
> {
  const preserved = source.decisions.filter(decision =>
    decision.evolution.kind === "preserve"
  );
  if (preserved.length === 0) return new Map();
  for (const decision of preserved) {
    if (
      decision.evolution.kind === "preserve" &&
      decision.evolution.fromSchemaVersionId === source.schemaVersionId
    ) {
      return yield* bindingFailure(
        "invalidEvolution",
        "A new schema cannot preserve a relation from itself.",
      );
    }
  }
  const schemaVersionIds = [...new Set(preserved.map(decision =>
    decision.evolution.kind === "preserve"
      ? decision.evolution.fromSchemaVersionId
      : source.schemaVersionId
  ))];
  const rootRows = yield* relationQueryEffect(() => db.select().from(
    fxControlBoundApplicationSchemas,
  ).where(and(
    eq(fxControlBoundApplicationSchemas.deploymentId, source.deploymentId),
    inArray(
      fxControlBoundApplicationSchemas.schemaVersionId,
      schemaVersionIds,
    ),
  )));
  const roots = new Map<CatalogSchemaVersionId, DecodedBoundRoot>();
  for (const row of rootRows) {
    const decoded = yield* decodeStoredBoundRowEffect(row);
    if (roots.has(row.schemaVersionId)) {
      return yield* bindingFailure("storedState");
    }
    roots.set(row.schemaVersionId, decoded);
  }
  if (roots.size !== schemaVersionIds.length) {
    return yield* bindingFailure(
      "missingOrigin",
      "At least one prior relation schema does not exist.",
    );
  }

  const coordinatePredicate = or(...preserved.map(decision => {
    if (decision.evolution.kind !== "preserve") {
      throw new Error("Filtered evolution decision changed kind.");
    }
    return and(
      eq(
        fxControlSchemaVersionRelationBindings.schemaVersionId,
        decision.evolution.fromSchemaVersionId,
      ),
      eq(
        fxControlSchemaVersionRelationBindings.relationOrdinal,
        decision.evolution.fromRelationOrdinal,
      ),
    );
  }));
  if (coordinatePredicate === undefined) {
    return yield* bindingFailure("invalidEvolution");
  }
  const relationRows = yield* relationQueryEffect(() => db.select().from(
    fxControlSchemaVersionRelationBindings,
  ).where(and(
    eq(
      fxControlSchemaVersionRelationBindings.deploymentId,
      source.deploymentId,
    ),
    coordinatePredicate,
  )));
  const relationRowsByKey = new Map<string,
    typeof fxControlSchemaVersionRelationBindings.$inferSelect
  >();
  for (const row of relationRows) {
    const key = originKey(row.schemaVersionId, row.relationOrdinal);
    if (relationRowsByKey.has(key)) {
      return yield* bindingFailure("storedState");
    }
    relationRowsByKey.set(key, row);
  }
  const edgeDefinitionIds = [...new Set(relationRows.map(row =>
    row.edgeDefinitionId
  ))];
  if (edgeDefinitionIds.length === 0) {
    return yield* bindingFailure("missingOrigin");
  }
  const edgeRows = yield* relationQueryEffect(() => db.select().from(
    fxControlEdgeDefinitions,
  ).where(and(
    eq(fxControlEdgeDefinitions.deploymentId, source.deploymentId),
    inArray(fxControlEdgeDefinitions.edgeDefinitionId, edgeDefinitionIds),
  )));
  const edgeRowsById = new Map<CatalogEdgeDefinitionId,
    typeof fxControlEdgeDefinitions.$inferSelect
  >();
  for (const row of edgeRows) {
    if (edgeRowsById.has(row.edgeDefinitionId)) {
      return yield* bindingFailure("storedState");
    }
    edgeRowsById.set(row.edgeDefinitionId, row);
  }

  const origins = new Map<string, OriginObservation>();
  for (const decision of preserved) {
    if (decision.evolution.kind !== "preserve") {
      return yield* bindingFailure("invalidEvolution");
    }
    const key = originKey(
      decision.evolution.fromSchemaVersionId,
      decision.evolution.fromRelationOrdinal,
    );
    if (origins.has(key)) continue;
    const root = roots.get(decision.evolution.fromSchemaVersionId);
    const relationRow = relationRowsByKey.get(key);
    if (root === undefined || relationRow === undefined) {
      return yield* bindingFailure(
        "missingOrigin",
        `Missing prior relation ${key}.`,
      );
    }
    const relationBinding = root.bound.binding.relationBindings[
      decision.evolution.fromRelationOrdinal - 1
    ];
    const semantic = relationBinding === undefined
      ? undefined
      : root.bound.binding.semanticDefinitions.find(item =>
        item.relationId === relationBinding.relationId
      );
    const edge = relationBinding === undefined
      ? undefined
      : root.bound.binding.edgeDefinitions.find(item =>
        item.edgeDefinitionId === relationBinding.edgeDefinitionId
      );
    const edgeRow = edge === undefined
      ? undefined
      : edgeRowsById.get(edge.edgeDefinitionId);
    if (
      relationBinding === undefined ||
      relationBinding.relationOrdinal !==
        decision.evolution.fromRelationOrdinal ||
      semantic === undefined || edge === undefined || edgeRow === undefined ||
      relationRow.relationId !== relationBinding.relationId ||
      relationRow.edgeDefinitionId !== relationBinding.edgeDefinitionId ||
      edgeRow.relationId !== relationBinding.relationId ||
      !storedDigestEquals(
        relationRow.semanticDefinitionSha256,
        relationBinding.semanticDefinitionSha256,
      ) ||
      !storedDigestEquals(
        edgeRow.physicalDefinitionSha256,
        edge.edgeDefinitionSha256,
      ) ||
      !isUint8Array(edgeRow.physicalDefinitionBytes) ||
      !bytesEqual(
        edgeRow.physicalDefinitionBytes,
        yield* canonicalEdgeBytesEffect(edge.definition),
      )
    ) {
      return yield* bindingFailure(
        "storedState",
        `Prior relation ${key} disagrees with its bound publication.`,
      );
    }
    const canonicalPhysical = yield* canonicalizePhysicalEdgeDefinition(
      edgeRow.physicalDefinitionJson,
    ).pipe(Effect.mapError(cause => bindingFailureValue(
      "storedState",
      `Prior relation ${key} has an invalid physical definition.`,
      cause,
    )));
    if (
      canonicalPhysical.sha256Hex !== edge.edgeDefinitionSha256 ||
      !bytesEqual(
        canonicalPhysical.canonicalBytes,
        edgeRow.physicalDefinitionBytes,
      )
    ) {
      return yield* bindingFailure("storedState");
    }
    origins.set(key, Object.freeze({
      schemaVersionId: decision.evolution.fromSchemaVersionId,
      relationOrdinal: decision.evolution.fromRelationOrdinal,
      binding: relationBinding,
      rootBindingBytes: copyBytes(root.bound.canonicalBytes),
      rootApplicationSchemaFrameBytes: copyBytes(
        root.applicationSchemaFrameBytes,
      ),
      rootBoundPublicationSha256: lowercaseHexToBytes(root.bound.sha256Hex),
      relationId: relationBinding.relationId,
      semanticDefinitionSha256: lowercaseHexToBytes(
        relationBinding.semanticDefinitionSha256,
      ),
      edgeDefinitionId: relationBinding.edgeDefinitionId,
      physicalDefinitionJson: canonicalPhysical.definition,
      physicalDefinitionBytes: copyBytes(canonicalPhysical.canonicalBytes),
      physicalDefinitionSha256: lowercaseHexToBytes(
        canonicalPhysical.sha256Hex,
      ),
      semanticDefinition: semantic.definition,
    }));
  }
  return origins;
});

const canonicalEdgeBytesEffect = Effect.fn(function* (
  definition: ApplicationSchemaEdgeDefinitionV2["definition"],
): Effect.fn.Return<Uint8Array, ApplicationRelationBindingError> {
  const canonical = yield* canonicalizePhysicalEdgeDefinition(
    definition,
  ).pipe(Effect.mapError(cause => bindingFailureValue(
    "storedState",
    "A prior bound publication contains an invalid physical definition.",
    cause,
  )));
  return canonical.canonicalBytes;
});

const readVersionObservationEffect = Effect.fn(
  "ApplicationRelationBinding.readVersionObservation",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
): Effect.fn.Return<VersionObservation, ApplicationRelationBindingError> {
  const deploymentRows = yield* relationQueryEffect(() => db.select({
    activeSchemaVersion: deployments.activeSchemaVersion,
  }).from(deployments).where(eq(
    deployments.deploymentId,
    deploymentId,
  )).limit(2));
  if (deploymentRows.length !== 1) {
    return yield* bindingFailure("invalidDeployment");
  }
  const catalogRows = yield* relationQueryEffect(() => db.select({
    version: fxControlSchemaVersions.version,
  }).from(fxControlSchemaVersions).where(eq(
    fxControlSchemaVersions.deploymentId,
    deploymentId,
  )).orderBy(desc(fxControlSchemaVersions.version)).limit(1));
  const reservationRows = yield* relationQueryEffect(() => db.select({
    version: fxControlApplicationSchemaAuthoritiesV1.schemaVersion,
  }).from(fxControlApplicationSchemaAuthoritiesV1).where(eq(
    fxControlApplicationSchemaAuthoritiesV1.deploymentId,
    deploymentId,
  )).orderBy(desc(
    fxControlApplicationSchemaAuthoritiesV1.schemaVersion,
  )).limit(1));
  const active = yield* nonnegativeVersionEffect(
    deploymentRows[0]?.activeSchemaVersion,
  );
  const catalog = yield* nonnegativeVersionEffect(
    catalogRows[0]?.version ?? 0,
  );
  const reserved = yield* nonnegativeVersionEffect(
    reservationRows[0]?.version ?? 0,
  );
  const maximum = Math.max(active, catalog, reserved);
  if (maximum >= MAX_CATALOG_SCHEMA_VERSION) {
    return yield* bindingFailure("schemaVersionExhausted");
  }
  return Object.freeze({
    active,
    catalog,
    reserved,
    selected: CatalogSchemaVersionSchema.make(maximum + 1),
  });
});

const readCatalogHighWaterEffect = Effect.fn(
  "ApplicationRelationBinding.readCatalogHighWater",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
): Effect.fn.Return<
  CatalogHighWaterObservation,
  ApplicationRelationBindingError
> {
  const relationRows = yield* relationQueryEffect(() => db.select({
    relationId: fxControlRelations.relationId,
  }).from(fxControlRelations).where(eq(
    fxControlRelations.deploymentId,
    deploymentId,
  )).orderBy(desc(fxControlRelations.relationId)).limit(1));
  const edgeRows = yield* relationQueryEffect(() => db.select({
    edgeDefinitionId: fxControlEdgeDefinitions.edgeDefinitionId,
  }).from(fxControlEdgeDefinitions).where(eq(
    fxControlEdgeDefinitions.deploymentId,
    deploymentId,
  )).orderBy(desc(fxControlEdgeDefinitions.edgeDefinitionId)).limit(1));
  return Object.freeze({
    relationId: yield* decodeOptionalRelationIdEffect(
      relationRows[0]?.relationId,
    ),
    edgeDefinitionId: yield* decodeOptionalEdgeDefinitionIdEffect(
      edgeRows[0]?.edgeDefinitionId,
    ),
  });
});

function snapshotDecisionsResult(
  input: ReadonlyArray<RelationEvolutionDecision>,
  relationCount: number,
): Result.Result<
  ReadonlyArray<RelationEvolutionDecision>,
  ApplicationRelationBindingError
> {
  return Result.gen(function* () {
    if (!Array.isArray(input) || input.length !== relationCount) {
      return yield* Result.fail(bindingFailureValue(
        "invalidEvolution",
        "Expected one evolution decision per relation.",
      ));
    }
    const decisions: Array<RelationEvolutionDecision> = [];
    for (let index = 0; index < input.length; index += 1) {
      const decisionInput = input[index];
      if (
        !hasExactOwnDataKeys(
          decisionInput,
          ["relationOrdinal", "evolution"],
        ) ||
        decisionInput.relationOrdinal !== index + 1 ||
        !Number.isSafeInteger(decisionInput.relationOrdinal)
      ) {
        return yield* Result.fail(bindingFailureValue(
          "invalidEvolution",
          "Evolution decisions must be dense and ordered.",
        ));
      }
      const relationOrdinal = decisionInput.relationOrdinal;
      const evolutionInput: unknown = decisionInput.evolution;
      if (
        hasExactOwnDataKeys(evolutionInput, ["kind"]) &&
        evolutionInput.kind === "new"
      ) {
        decisions.push(Object.freeze({
          relationOrdinal,
          evolution: Object.freeze({ kind: "new" as const }),
        } satisfies RelationEvolutionDecision));
        continue;
      }
      if (
        !hasExactOwnDataKeys(evolutionInput, [
          "kind",
          "fromSchemaVersionId",
          "fromRelationOrdinal",
          "physical",
        ]) ||
        evolutionInput.kind !== "preserve" ||
        typeof evolutionInput.fromRelationOrdinal !== "number" ||
        !Number.isSafeInteger(evolutionInput.fromRelationOrdinal) ||
        evolutionInput.fromRelationOrdinal < 1 ||
        (evolutionInput.physical !== "reuse" &&
          evolutionInput.physical !== "replace")
      ) {
        return yield* Result.fail(bindingFailureValue(
          "invalidEvolution",
          "Preserved evolution decision is invalid.",
        ));
      }
      const fromSchemaVersionId = yield* decodeCatalogSchemaVersionIdResult(
        evolutionInput.fromSchemaVersionId,
      ).pipe(Result.mapError(cause => bindingFailureValue(
        "invalidEvolution",
        "Preserved evolution origin schema identity is invalid.",
        cause,
      )));
      decisions.push(Object.freeze({
        relationOrdinal,
        evolution: Object.freeze({
          kind: "preserve" as const,
          fromSchemaVersionId,
          fromRelationOrdinal: evolutionInput.fromRelationOrdinal,
          physical: evolutionInput.physical,
        }),
      } satisfies RelationEvolutionDecision));
    }
    return Object.freeze(decisions);
  });
}

function requireExactDecisionsResult(
  decisions: ReadonlyArray<RelationEvolutionDecision>,
  bindings: ReadonlyArray<ApplicationSchemaRelationBindingV2>,
): Result.Result<void, ApplicationRelationBindingError> {
  if (decisions.length !== bindings.length) {
    return Result.fail(bindingFailureValue("bindingConflict"));
  }
  for (let index = 0; index < decisions.length; index += 1) {
    const decision = decisions[index];
    const binding = bindings[index];
    if (
      decision === undefined || binding === undefined ||
      decision.relationOrdinal !== binding.relationOrdinal ||
      !evolutionsEqual(decision.evolution, binding.evolution)
    ) {
      return Result.fail(bindingFailureValue(
        "bindingConflict",
        "A replay supplied different relation evolution evidence.",
      ));
    }
  }
  return Result.succeed(undefined);
}

function evolutionsEqual(
  left: RelationEvolutionDecision["evolution"],
  right: ApplicationSchemaRelationBindingV2["evolution"],
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "new" && right.kind === "new") return true;
  return left.kind === "preserve" && right.kind === "preserve" &&
    left.fromSchemaVersionId === right.fromSchemaVersionId &&
    left.fromRelationOrdinal === right.fromRelationOrdinal &&
    left.physical === right.physical;
}

function runPlanTransactionEffect(
  repository: ApplicationRelationBindingRepository,
  plan: PublicationPlan,
): Effect.Effect<
  ApplicationRelationBindingPublication,
  ApplicationRelationBindingError | RelationBindingPlanStaleError
> {
  return runEffectTransaction<
    ApplicationRelationBindingPublication,
    ApplicationRelationBindingError | RelationBindingPlanStaleError,
    ApplicationRelationBindingError,
    StableTableCatalogTransaction
  >(
    callback => repository.runTransaction(callback),
    "Application relation-binding Effect work failed; roll back the transaction.",
    tx => plan.kind === "existing"
      ? publishExistingPlanInTransactionEffect(tx, plan)
      : publishCreatePlanInTransactionEffect(tx, plan),
    cause => bindingFailureValue(
      "resourceFailure",
      "The relation-binding transaction could not settle.",
      cause,
    ),
  );
}

const publishExistingPlanInTransactionEffect = Effect.fn(
  "ApplicationRelationBinding.publishExistingInTransaction",
)(function* (
  tx: StableTableCatalogTransaction,
  plan: ExistingPublicationPlan,
): Effect.fn.Return<
  ApplicationRelationBindingPublication,
  ApplicationRelationBindingError | RelationBindingPlanStaleError
> {
  yield* lockDeploymentEffect(tx, plan.source.deploymentId);
  const rows = yield* relationQueryEffect(() => tx.select().from(
    fxControlBoundApplicationSchemas,
  ).where(and(
    eq(
      fxControlBoundApplicationSchemas.deploymentId,
      plan.source.deploymentId,
    ),
    eq(
      fxControlBoundApplicationSchemas.applicationSchemaSha256,
      plan.source.applicationSchemaSha256Bytes,
    ),
  )).limit(2).for("update"));
  if (rows.length !== 1) {
    return yield* Effect.fail(new RelationBindingPlanStaleError());
  }
  if (!boundRowMatchesPlan(
    rows[0],
    plan.bound,
    plan.schemaManifestSha256,
    plan.source.applicationSchemaFrameBytes,
  )) {
    return yield* bindingFailure(
      "storedState",
      "The reusable bound schema changed or is corrupt.",
    );
  }
  yield* verifyExistingProjectionInTransactionEffect(tx, plan);
  yield* ensureManifestBindingInTransactionEffect(
    tx,
    plan.source,
    plan.manifestBinding,
  );
  return publicationResult("existing", plan.bound, plan.manifestBinding);
});

const publishCreatePlanInTransactionEffect = Effect.fn(
  "ApplicationRelationBinding.publishCreateInTransaction",
)(function* (
  tx: StableTableCatalogTransaction,
  plan: CreatePublicationPlan,
): Effect.fn.Return<
  ApplicationRelationBindingPublication,
  ApplicationRelationBindingError | RelationBindingPlanStaleError
> {
  yield* lockDeploymentEffect(tx, plan.source.deploymentId);
  const existingRoot = yield* relationQueryEffect(() => tx.select({
    schemaVersionId: fxControlBoundApplicationSchemas.schemaVersionId,
  }).from(fxControlBoundApplicationSchemas).where(and(
    eq(
      fxControlBoundApplicationSchemas.deploymentId,
      plan.source.deploymentId,
    ),
    eq(
      fxControlBoundApplicationSchemas.applicationSchemaSha256,
      plan.source.applicationSchemaSha256Bytes,
    ),
  )).limit(1).for("update"));
  if (existingRoot.length !== 0) {
    return yield* Effect.fail(new RelationBindingPlanStaleError());
  }
  const currentVersion = yield* readVersionObservationEffect(
    tx,
    plan.source.deploymentId,
  );
  const currentHighWater = yield* readCatalogHighWaterEffect(
    tx,
    plan.source.deploymentId,
  );
  if (
    !versionObservationsEqual(currentVersion, plan.versionObservation) ||
    !catalogHighWatersEqual(currentHighWater, plan.highWater)
  ) {
    return yield* Effect.fail(new RelationBindingPlanStaleError());
  }
  yield* revalidateOriginsInTransactionEffect(tx, plan);

  const published = yield* publishPreparedAppSchemaV1InTransactionEffect(
    tx,
    plan.basePublication,
  ).pipe(Effect.mapError(mapBasePublicationTransactionError));
  if (
    published.artifact.deploymentId !== plan.source.deploymentId ||
    published.artifact.schemaVersionId !== plan.source.schemaVersionId ||
    published.artifact.version !== plan.schemaVersion ||
    !bytesEqual(
      published.artifact.manifestSha256,
      plan.schemaManifestSha256,
    ) ||
    !jsonValuesEqual(published.manifest, plan.schemaManifest)
  ) {
    return yield* bindingFailure(
      "bindingConflict",
      "The table/index publication returned contradictory artifact evidence.",
    );
  }

  const newRelations = plan.relations.filter(relation =>
    relation.insertRelation
  );
  if (newRelations.length > 0) {
    yield* relationQueryEffect(() => tx.insert(fxControlRelations).values(
      newRelations.map(relation => ({
        deploymentId: plan.source.deploymentId,
        relationId: relation.binding.relationId,
        createdBySchemaVersionId: plan.source.schemaVersionId,
      })),
    ));
  }
  const newPhysicalDefinitions = plan.relations.filter(relation =>
    relation.insertPhysical
  );
  if (newPhysicalDefinitions.length > 0) {
    yield* relationQueryEffect(() => tx.insert(
      fxControlEdgeDefinitions,
    ).values(newPhysicalDefinitions.map(relation => ({
      deploymentId: plan.source.deploymentId,
      edgeDefinitionId: relation.binding.edgeDefinitionId,
      relationId: relation.binding.relationId,
      createdBySchemaVersionId: plan.source.schemaVersionId,
      physicalDefinitionCodecVersion: 1 as const,
      physicalDefinitionJson: relation.physical.definition,
      physicalDefinitionBytes: relation.physical.canonicalBytes,
      physicalDefinitionSha256: lowercaseHexToBytes(
        relation.physical.sha256Hex,
      ),
    }))));
  }
  yield* relationQueryEffect(() => tx.insert(
    fxControlSchemaVersionRelationBindings,
  ).values(plan.relations.map(relation => ({
    deploymentId: plan.source.deploymentId,
    schemaVersionId: plan.source.schemaVersionId,
    relationOrdinal: relation.binding.relationOrdinal,
    relationId: relation.binding.relationId,
    sourceTableId: relation.binding.sourceTableId,
    targetTableId: relation.binding.targetTableId,
    semanticDefinitionSha256: lowercaseHexToBytes(
      relation.binding.semanticDefinitionSha256,
    ),
    edgeDefinitionId: relation.binding.edgeDefinitionId,
    evolutionKind: relation.binding.evolution.kind,
    originSchemaVersionId: relation.binding.evolution.kind === "new"
      ? null
      : relation.binding.evolution.fromSchemaVersionId,
    originRelationOrdinal: relation.binding.evolution.kind === "new"
      ? null
      : relation.binding.evolution.fromRelationOrdinal,
    physicalEvolution: relation.binding.evolution.kind === "new"
      ? "new" as const
      : relation.binding.evolution.physical,
    requiredForActivation: true as const,
  }))));
  yield* relationQueryEffect(() => tx.insert(
    fxControlBoundApplicationSchemas,
  ).values({
    deploymentId: plan.source.deploymentId,
    applicationSchemaSha256: plan.source.applicationSchemaSha256Bytes,
    applicationSchemaFrameBytes: plan.source.applicationSchemaFrameBytes,
    schemaVersionId: plan.source.schemaVersionId,
    schemaVersion: plan.schemaVersion,
    schemaManifestSha256: plan.schemaManifestSha256,
    bindingCodecVersion: 2,
    bindingJson: plan.bound.binding,
    bindingBytes: plan.bound.canonicalBytes,
    boundPublicationSha256: lowercaseHexToBytes(plan.bound.sha256Hex),
  }));
  yield* ensureManifestBindingInTransactionEffect(
    tx,
    plan.source,
    plan.manifestBinding,
  );
  yield* verifyCreateProjectionInTransactionEffect(tx, plan);
  return publicationResult("created", plan.bound, plan.manifestBinding);
});

const lockDeploymentEffect = Effect.fn(
  "ApplicationRelationBinding.lockDeployment",
)(function* (
  tx: StableTableCatalogTransaction,
  deploymentId: string,
): Effect.fn.Return<void, ApplicationRelationBindingError> {
  yield* lockSchemaManifestBindingDeploymentEffect(
    tx,
    deploymentId,
  ).pipe(Effect.mapError(cause => cause instanceof
      StableTableCatalogDeploymentNotFoundError
    ? bindingFailureValue("invalidDeployment", undefined, cause)
    : bindingFailureValue(
        "resourceFailure",
        "The shared schema-publication deployment lock failed.",
        cause,
      )));
});

const ensureManifestBindingInTransactionEffect = Effect.fn(
  "ApplicationRelationBinding.ensureManifestBinding",
)(function* (
  tx: StableTableCatalogTransaction,
  source: PublicationSource,
  canonical: CanonicalApplicationManifestSchemaBindingV1,
): Effect.fn.Return<void, ApplicationRelationBindingError> {
  yield* relationQueryEffect(() => tx.insert(
    fxControlApplicationManifestSchemaBindings,
  ).values({
    deploymentId: source.deploymentId,
    applicationManifestSha256: source.manifestSha256Bytes,
    applicationManifestBytes: source.manifestBytes,
    applicationSchemaSha256: source.applicationSchemaSha256Bytes,
    schemaVersionId: canonical.binding.schemaVersionId,
    schemaVersion: canonical.binding.schemaVersion,
    boundPublicationSha256: lowercaseHexToBytes(
      canonical.binding.boundPublicationSha256,
    ),
    bindingSha256: lowercaseHexToBytes(canonical.sha256Hex),
    bindingBytes: canonical.canonicalBytes,
  }).onConflictDoNothing({
    target: [
      fxControlApplicationManifestSchemaBindings.deploymentId,
      fxControlApplicationManifestSchemaBindings.applicationManifestSha256,
    ],
  }));
  const rows = yield* relationQueryEffect(() => tx.select().from(
    fxControlApplicationManifestSchemaBindings,
  ).where(and(
    eq(
      fxControlApplicationManifestSchemaBindings.deploymentId,
      source.deploymentId,
    ),
    eq(
      fxControlApplicationManifestSchemaBindings.applicationManifestSha256,
      source.manifestSha256Bytes,
    ),
  )).limit(2).for("update"));
  if (rows.length !== 1 || !manifestBindingRowMatches(
    rows[0],
    source,
    canonical,
  )) {
    return yield* bindingFailure(
      "bindingConflict",
      "The analyzed manifest is already pinned to different schema evidence.",
    );
  }
});

const verifyExistingProjectionInTransactionEffect = Effect.fn(
  "ApplicationRelationBinding.verifyExistingProjection",
)(function* (
  tx: StableTableCatalogTransaction,
  plan: ExistingPublicationPlan,
): Effect.fn.Return<void, ApplicationRelationBindingError> {
  const artifactRows = yield* relationQueryEffect(() => tx.select().from(
    fxControlSchemaVersions,
  ).where(and(
    eq(fxControlSchemaVersions.deploymentId, plan.source.deploymentId),
    eq(
      fxControlSchemaVersions.schemaVersionId,
      plan.bound.binding.schemaVersionId,
    ),
  )).limit(2).for("update"));
  const artifact = artifactRows[0];
  if (
    artifactRows.length !== 1 || artifact === undefined ||
    artifact.version !== plan.bound.binding.schemaVersion ||
    artifact.manifestCodecVersion !== 1 ||
    !isUint8Array(artifact.manifestBytes) ||
    !bytesEqual(
      artifact.manifestBytes,
      plan.schemaArtifactManifestBytes,
    ) ||
    !isUint8ArrayWithByteLength(artifact.manifestSha256, 32) ||
    !bytesEqual(artifact.manifestSha256, plan.schemaManifestSha256) ||
    !jsonValuesEqual(
      artifact.manifestJson,
      plan.schemaArtifactManifestJson,
    )
  ) {
    return yield* bindingFailure(
      "storedState",
      "The existing bound schema base artifact changed or is corrupt.",
    );
  }

  const bindingRows = yield* relationQueryEffect(() => tx.select().from(
    fxControlSchemaVersionRelationBindings,
  ).where(and(
    eq(
      fxControlSchemaVersionRelationBindings.deploymentId,
      plan.source.deploymentId,
    ),
    eq(
      fxControlSchemaVersionRelationBindings.schemaVersionId,
      plan.bound.binding.schemaVersionId,
    ),
  )).orderBy(
    fxControlSchemaVersionRelationBindings.relationOrdinal,
  ).for("update"));
  if (bindingRows.length !== plan.bound.binding.relationBindings.length) {
    return yield* bindingFailure("storedState");
  }
  for (
    let index = 0;
    index < plan.bound.binding.relationBindings.length;
    index += 1
  ) {
    const expected = plan.bound.binding.relationBindings[index];
    const actual = bindingRows[index];
    if (
      expected === undefined || actual === undefined ||
      !relationBindingRowMatches(actual, expected)
    ) {
      return yield* bindingFailure("storedState");
    }
  }
  yield* verifyStableRelationRowsInTransactionEffect(
    tx,
    plan.source.deploymentId,
    plan.bound.binding,
  );

  const edgeIds = plan.bound.binding.edgeDefinitions.map(edge =>
    edge.edgeDefinitionId
  );
  const edgeRows = yield* relationQueryEffect(() => tx.select().from(
    fxControlEdgeDefinitions,
  ).where(and(
    eq(fxControlEdgeDefinitions.deploymentId, plan.source.deploymentId),
    inArray(fxControlEdgeDefinitions.edgeDefinitionId, edgeIds),
  )).for("update"));
  if (edgeRows.length !== edgeIds.length) {
    return yield* bindingFailure("storedState");
  }
  const edgeRowsById = new Map(edgeRows.map(row => [
    row.edgeDefinitionId,
    row,
  ] as const));
  for (const expected of plan.bound.binding.edgeDefinitions) {
    const row = edgeRowsById.get(expected.edgeDefinitionId);
    const evidence = plan.edgeEvidence.get(expected.edgeDefinitionId);
    const relation = plan.bound.binding.relationBindings.find(binding =>
      binding.edgeDefinitionId === expected.edgeDefinitionId
    );
    if (
      row === undefined || evidence === undefined || relation === undefined ||
      row.relationId !== relation.relationId ||
      row.physicalDefinitionCodecVersion !== 1 ||
      !isUint8Array(row.physicalDefinitionBytes) ||
      !bytesEqual(row.physicalDefinitionBytes, evidence.canonicalBytes) ||
      !isUint8ArrayWithByteLength(row.physicalDefinitionSha256, 32) ||
      encodeBytesToLowercaseHex(row.physicalDefinitionSha256) !==
        expected.edgeDefinitionSha256 ||
      !jsonValuesEqual(row.physicalDefinitionJson, expected.definition) ||
      !isNonBlankString(row.createdBySchemaVersionId)
    ) {
      return yield* bindingFailure("storedState");
    }
    if (
      (relation.evolution.kind === "new" ||
        relation.evolution.physical === "replace") &&
      row.createdBySchemaVersionId !== plan.bound.binding.schemaVersionId
    ) {
      return yield* bindingFailure("storedState");
    }
  }
});

const verifyStableRelationRowsInTransactionEffect = Effect.fn(
  "ApplicationRelationBinding.verifyStableRelations",
)(function* (
  tx: StableTableCatalogTransaction,
  deploymentId: string,
  bound: ApplicationSchemaBindingV2,
): Effect.fn.Return<void, ApplicationRelationBindingError> {
  const relationIds = bound.relationBindings.map(binding =>
    binding.relationId
  );
  const rows = yield* relationQueryEffect(() => tx.select().from(
    fxControlRelations,
  ).where(and(
    eq(fxControlRelations.deploymentId, deploymentId),
    inArray(fxControlRelations.relationId, relationIds),
  )).for("update"));
  if (rows.length !== relationIds.length) {
    return yield* bindingFailure("storedState");
  }
  const rowsById = new Map(rows.map(row => [row.relationId, row] as const));
  for (const binding of bound.relationBindings) {
    const row = rowsById.get(binding.relationId);
    if (
      row === undefined || !isNonBlankString(row.createdBySchemaVersionId) ||
      (binding.evolution.kind === "new" &&
        row.createdBySchemaVersionId !== bound.schemaVersionId)
    ) {
      return yield* bindingFailure("storedState");
    }
  }
});

const verifyCreateProjectionInTransactionEffect = Effect.fn(
  "ApplicationRelationBinding.verifyCreateProjection",
)(function* (
  tx: StableTableCatalogTransaction,
  plan: CreatePublicationPlan,
): Effect.fn.Return<void, ApplicationRelationBindingError> {
  const rootRows = yield* relationQueryEffect(() => tx.select().from(
    fxControlBoundApplicationSchemas,
  ).where(and(
    eq(
      fxControlBoundApplicationSchemas.deploymentId,
      plan.source.deploymentId,
    ),
    eq(
      fxControlBoundApplicationSchemas.applicationSchemaSha256,
      plan.source.applicationSchemaSha256Bytes,
    ),
  )).limit(2).for("update"));
  if (
    rootRows.length !== 1 ||
    !boundRowMatchesPlan(
      rootRows[0],
      plan.bound,
      plan.schemaManifestSha256,
      plan.source.applicationSchemaFrameBytes,
    )
  ) {
    return yield* bindingFailure("storedState");
  }
  const relationRows = yield* relationQueryEffect(() => tx.select().from(
    fxControlSchemaVersionRelationBindings,
  ).where(and(
    eq(
      fxControlSchemaVersionRelationBindings.deploymentId,
      plan.source.deploymentId,
    ),
    eq(
      fxControlSchemaVersionRelationBindings.schemaVersionId,
      plan.source.schemaVersionId,
    ),
  )).orderBy(
    fxControlSchemaVersionRelationBindings.relationOrdinal,
  ).for("update"));
  if (relationRows.length !== plan.relations.length) {
    return yield* bindingFailure("storedState");
  }
  for (let index = 0; index < plan.relations.length; index += 1) {
    const expected = plan.relations[index];
    const actual = relationRows[index];
    if (
      expected === undefined || actual === undefined ||
      !relationBindingRowMatches(actual, expected.binding)
    ) {
      return yield* bindingFailure("storedState");
    }
  }
  yield* verifyStableRelationRowsInTransactionEffect(
    tx,
    plan.source.deploymentId,
    plan.bound.binding,
  );
  const edgeIds = plan.relations.map(relation =>
    relation.binding.edgeDefinitionId
  );
  const edgeRows = yield* relationQueryEffect(() => tx.select().from(
    fxControlEdgeDefinitions,
  ).where(and(
    eq(fxControlEdgeDefinitions.deploymentId, plan.source.deploymentId),
    inArray(fxControlEdgeDefinitions.edgeDefinitionId, edgeIds),
  )).for("update"));
  if (edgeRows.length !== edgeIds.length) {
    return yield* bindingFailure("storedState");
  }
  const edgesById = new Map(edgeRows.map(row => [
    row.edgeDefinitionId,
    row,
  ] as const));
  for (const relation of plan.relations) {
    const row = edgesById.get(relation.binding.edgeDefinitionId);
    if (
      row === undefined || row.relationId !== relation.binding.relationId ||
      row.physicalDefinitionCodecVersion !== 1 ||
      !isNonBlankString(row.createdBySchemaVersionId) ||
      (relation.insertPhysical &&
        row.createdBySchemaVersionId !== plan.source.schemaVersionId) ||
      !isUint8Array(row.physicalDefinitionBytes) ||
      !isUint8ArrayWithByteLength(row.physicalDefinitionSha256, 32) ||
      !bytesEqual(row.physicalDefinitionBytes, relation.physical.canonicalBytes) ||
      encodeBytesToLowercaseHex(row.physicalDefinitionSha256) !==
        relation.physical.sha256Hex ||
      !jsonValuesEqual(
        row.physicalDefinitionJson,
        relation.physical.definition,
      )
    ) {
      return yield* bindingFailure("storedState");
    }
  }
});

const revalidateOriginsInTransactionEffect = Effect.fn(
  "ApplicationRelationBinding.revalidateOrigins",
)(function* (
  tx: StableTableCatalogTransaction,
  plan: CreatePublicationPlan,
): Effect.fn.Return<
  void,
  ApplicationRelationBindingError | RelationBindingPlanStaleError
> {
  const originsByKey = new Map<string, OriginObservation>();
  for (const relation of plan.relations) {
    if (relation.origin !== null) {
      originsByKey.set(
        originKey(
          relation.origin.schemaVersionId,
          relation.origin.relationOrdinal,
        ),
        relation.origin,
      );
    }
  }
  const origins = [...originsByKey.values()];
  if (origins.length === 0) return;

  const schemaVersionIds = [...new Set(origins.map(origin =>
    origin.schemaVersionId
  ))];
  const rootRows = yield* relationQueryEffect(() => tx.select().from(
    fxControlBoundApplicationSchemas,
  ).where(and(
    eq(
      fxControlBoundApplicationSchemas.deploymentId,
      plan.source.deploymentId,
    ),
    inArray(
      fxControlBoundApplicationSchemas.schemaVersionId,
      schemaVersionIds,
    ),
  )).for("update"));
  const rootsByVersion = new Map(rootRows.map(row => [
    row.schemaVersionId,
    row,
  ] as const));
  if (rootsByVersion.size !== schemaVersionIds.length) {
    return yield* Effect.fail(new RelationBindingPlanStaleError());
  }

  const coordinatePredicate = or(...origins.map(origin => and(
    eq(
      fxControlSchemaVersionRelationBindings.schemaVersionId,
      origin.schemaVersionId,
    ),
    eq(
      fxControlSchemaVersionRelationBindings.relationOrdinal,
      origin.relationOrdinal,
    ),
  )));
  if (coordinatePredicate === undefined) {
    return yield* bindingFailure("storedState");
  }
  const relationRows = yield* relationQueryEffect(() => tx.select().from(
    fxControlSchemaVersionRelationBindings,
  ).where(and(
    eq(
      fxControlSchemaVersionRelationBindings.deploymentId,
      plan.source.deploymentId,
    ),
    coordinatePredicate,
  )).for("update"));
  const relationsByKey = new Map(relationRows.map(row => [
    originKey(row.schemaVersionId, row.relationOrdinal),
    row,
  ] as const));
  const edgeDefinitionIds = origins.map(origin => origin.edgeDefinitionId);
  const edgeRows = yield* relationQueryEffect(() => tx.select().from(
    fxControlEdgeDefinitions,
  ).where(and(
    eq(fxControlEdgeDefinitions.deploymentId, plan.source.deploymentId),
    inArray(
      fxControlEdgeDefinitions.edgeDefinitionId,
      edgeDefinitionIds,
    ),
  )).for("update"));
  const edgesById = new Map(edgeRows.map(row => [
    row.edgeDefinitionId,
    row,
  ] as const));

  for (const origin of origins) {
    const root = rootsByVersion.get(origin.schemaVersionId);
    const relation = relationsByKey.get(originKey(
      origin.schemaVersionId,
      origin.relationOrdinal,
    ));
    const edge = edgesById.get(origin.edgeDefinitionId);
    if (
      root === undefined || relation === undefined || edge === undefined ||
      !isUint8Array(root.bindingBytes) ||
      !isUint8Array(root.applicationSchemaFrameBytes) ||
      !isUint8ArrayWithByteLength(root.boundPublicationSha256, 32) ||
      !bytesEqual(root.bindingBytes, origin.rootBindingBytes) ||
      !bytesEqual(
        root.applicationSchemaFrameBytes,
        origin.rootApplicationSchemaFrameBytes,
      ) ||
      !bytesEqual(
        root.boundPublicationSha256,
        origin.rootBoundPublicationSha256,
      ) ||
      !relationBindingRowMatches(relation, origin.binding) ||
      edge.relationId !== origin.relationId ||
      edge.physicalDefinitionCodecVersion !== 1 ||
      !isUint8Array(edge.physicalDefinitionBytes) ||
      !isUint8ArrayWithByteLength(edge.physicalDefinitionSha256, 32) ||
      !bytesEqual(
        edge.physicalDefinitionBytes,
        origin.physicalDefinitionBytes,
      ) ||
      !bytesEqual(
        edge.physicalDefinitionSha256,
        origin.physicalDefinitionSha256,
      ) ||
      !jsonValuesEqual(
        edge.physicalDefinitionJson,
        origin.physicalDefinitionJson,
      )
    ) {
      return yield* Effect.fail(new RelationBindingPlanStaleError());
    }
  }
});

function boundRowMatchesPlan(
  row: typeof fxControlBoundApplicationSchemas.$inferSelect,
  bound: CanonicalApplicationSchemaBindingV2,
  schemaManifestSha256: Uint8Array,
  applicationSchemaFrameBytes: Uint8Array,
): boolean {
  return row.deploymentId === bound.binding.deploymentId &&
    row.schemaVersionId === bound.binding.schemaVersionId &&
    row.schemaVersion === bound.binding.schemaVersion &&
    row.bindingCodecVersion === 2 &&
    isUint8ArrayWithByteLength(row.applicationSchemaSha256, 32) &&
    encodeBytesToLowercaseHex(row.applicationSchemaSha256) ===
      bound.binding.applicationSchemaSha256 &&
    isUint8Array(row.applicationSchemaFrameBytes) &&
    bytesEqual(row.applicationSchemaFrameBytes, applicationSchemaFrameBytes) &&
    isUint8ArrayWithByteLength(row.schemaManifestSha256, 32) &&
    bytesEqual(row.schemaManifestSha256, schemaManifestSha256) &&
    encodeBytesToLowercaseHex(row.schemaManifestSha256) ===
      bound.binding.schemaManifestSha256 &&
    isUint8Array(row.bindingBytes) &&
    bytesEqual(row.bindingBytes, bound.canonicalBytes) &&
    isUint8ArrayWithByteLength(row.boundPublicationSha256, 32) &&
    encodeBytesToLowercaseHex(row.boundPublicationSha256) ===
      bound.sha256Hex &&
    jsonValuesEqual(row.bindingJson, bound.binding);
}

function manifestBindingRowMatches(
  row: typeof fxControlApplicationManifestSchemaBindings.$inferSelect,
  source: PublicationSource,
  canonical: CanonicalApplicationManifestSchemaBindingV1,
): boolean {
  return row.deploymentId === source.deploymentId &&
    row.schemaVersionId === canonical.binding.schemaVersionId &&
    row.schemaVersion === canonical.binding.schemaVersion &&
    isUint8ArrayWithByteLength(row.applicationManifestSha256, 32) &&
    bytesEqual(row.applicationManifestSha256, source.manifestSha256Bytes) &&
    isUint8Array(row.applicationManifestBytes) &&
    bytesEqual(row.applicationManifestBytes, source.manifestBytes) &&
    isUint8ArrayWithByteLength(row.applicationSchemaSha256, 32) &&
    bytesEqual(
      row.applicationSchemaSha256,
      source.applicationSchemaSha256Bytes,
    ) &&
    isUint8ArrayWithByteLength(row.boundPublicationSha256, 32) &&
    encodeBytesToLowercaseHex(row.boundPublicationSha256) ===
      canonical.binding.boundPublicationSha256 &&
    isUint8ArrayWithByteLength(row.bindingSha256, 32) &&
    encodeBytesToLowercaseHex(row.bindingSha256) === canonical.sha256Hex &&
    isUint8Array(row.bindingBytes) &&
    bytesEqual(row.bindingBytes, canonical.canonicalBytes);
}

function relationBindingRowMatches(
  row: typeof fxControlSchemaVersionRelationBindings.$inferSelect,
  binding: ApplicationSchemaRelationBindingV2,
): boolean {
  const evolutionMatches = binding.evolution.kind === "new"
    ? row.evolutionKind === "new" &&
      row.originSchemaVersionId === null &&
      row.originRelationOrdinal === null &&
      row.physicalEvolution === "new"
    : row.evolutionKind === "preserve" &&
      row.originSchemaVersionId === binding.evolution.fromSchemaVersionId &&
      row.originRelationOrdinal === binding.evolution.fromRelationOrdinal &&
      row.physicalEvolution === binding.evolution.physical;
  return row.schemaVersionId.length > 0 &&
    row.relationOrdinal === binding.relationOrdinal &&
    row.relationId === binding.relationId &&
    row.sourceTableId === binding.sourceTableId &&
    row.targetTableId === binding.targetTableId &&
    storedDigestEquals(
      row.semanticDefinitionSha256,
      binding.semanticDefinitionSha256,
    ) &&
    row.edgeDefinitionId === binding.edgeDefinitionId &&
    row.requiredForActivation === true &&
    evolutionMatches;
}

function publicationResult(
  status: "created" | "existing",
  bound: CanonicalApplicationSchemaBindingV2,
  manifestBinding: CanonicalApplicationManifestSchemaBindingV1,
): ApplicationRelationBindingPublication {
  return Object.freeze({
    status,
    binding: bound.binding,
    boundPublicationSha256: bound.sha256Hex,
    manifestBinding: manifestBinding.binding,
    manifestSchemaBindingSha256: manifestBinding.sha256Hex,
  });
}

function versionObservationsEqual(
  left: VersionObservation,
  right: VersionObservation,
): boolean {
  return left.active === right.active &&
    left.catalog === right.catalog &&
    left.reserved === right.reserved &&
    left.selected === right.selected;
}

function catalogHighWatersEqual(
  left: CatalogHighWaterObservation,
  right: CatalogHighWaterObservation,
): boolean {
  return left.relationId === right.relationId &&
    left.edgeDefinitionId === right.edgeDefinitionId;
}

function originKey(
  schemaVersionId: CatalogSchemaVersionId,
  relationOrdinal: number,
): string {
  return `${schemaVersionId}\0${relationOrdinal}`;
}

function storedDigestEquals(value: unknown, expectedHex: string): boolean {
  return isUint8ArrayWithByteLength(value, 32) &&
    encodeBytesToLowercaseHex(value) === expectedHex;
}

function lowercaseHexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonValuesEqual(value, right[index]));
  }
  if (!isNonArrayRecord(left) || !isNonArrayRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every(key => Object.hasOwn(right, key) &&
      jsonValuesEqual(left[key], right[key]));
}

function mapBasePublicationPreparationError(
  cause: PrepareAppSchemaPublicationV1Error,
): ApplicationRelationBindingError {
  const detail = "The table/index catalog projection could not be prepared.";
  if (cause instanceof AppSchemaCatalogCompilationErrorV1) {
    return bindingFailureValue("invalidManifest", detail, cause);
  }
  switch (cause._tag) {
    case "InvalidAppSchemaPublicationV1InputError":
      return bindingFailureValue(
        cause.issue.reason === "invalidField" &&
            cause.issue.field === "deploymentId"
          ? "invalidDeployment"
          : "invalidManifest",
        detail,
        cause,
      );
    case "InvalidSchemaManifestAppSchemaBindingInputError":
      return bindingFailureValue(
        cause.issue.reason === "invalidDeploymentId"
          ? "invalidDeployment"
          : "invalidManifest",
        detail,
        cause,
      );
    case "InvalidSchemaManifestTableBindingInputError":
      return bindingFailureValue(
        cause.issue.reason === "invalidDeploymentId"
          ? "invalidDeployment"
          : "invalidManifest",
        detail,
        cause,
      );
    case "InvalidSchemaVersionArtifactInputError":
      return bindingFailureValue(
        cause.field === "deploymentId"
          ? "invalidDeployment"
          : "invalidManifest",
        detail,
        cause,
      );
    case "AppSchemaPublicationV1QuotaExceededError":
      return bindingFailureValue("invalidManifest", detail, cause);
    case "StableTableCatalogDeploymentNotFoundError":
      return bindingFailureValue("invalidDeployment", detail, cause);
    case "SchemaManifestTableBindingCorruptionError":
    case "StableTableCatalogCorruptionError":
    case "StableLogicalIndexCatalogCorruptionError":
      return bindingFailureValue("storedState", detail, cause);
    case "StableTableCatalogIdExhaustedError":
    case "StableLogicalIndexCatalogIdExhaustedError":
      return bindingFailureValue("bindingConflict", detail, cause);
    case "SchemaVersionArtifactPreparationError":
    case "SchemaManifestTableBindingPersistenceError":
    case "StableTableCatalogAllocationPersistenceError":
    case "SchemaManifestAppSchemaBindingPersistenceError":
    case "StableLogicalIndexCatalogAllocationPersistenceError":
      return bindingFailureValue("resourceFailure", detail, cause);
  }
  return unreachableError(cause);
}

function mapSchemaArtifactReadError(
  cause: ReadSchemaVersionArtifactError,
): ApplicationRelationBindingError {
  const detail =
    "The reusable bound schema references an invalid base schema artifact.";
  switch (cause._tag) {
    case "InvalidSchemaVersionArtifactInputError":
      return bindingFailureValue(
        cause.field === "deploymentId" ? "invalidDeployment" : "storedState",
        detail,
        cause,
      );
    case "SchemaVersionArtifactPersistenceError":
      return bindingFailureValue("resourceFailure", detail, cause);
    case "SchemaVersionArtifactCorruptionError":
      return bindingFailureValue("storedState", detail, cause);
  }
  return unreachableError(cause);
}

function mapBasePublicationTransactionError(
  cause: PublishPreparedAppSchemaV1InTransactionError,
): ApplicationRelationBindingError | RelationBindingPlanStaleError {
  if (cause instanceof SchemaManifestAppSchemaBindingPlanStaleError) {
    return new RelationBindingPlanStaleError();
  }
  const detail = "The table/index catalog publication failed.";
  switch (cause._tag) {
    case "StableTableCatalogDeploymentNotFoundError":
    case "SchemaVersionArtifactDeploymentNotFoundError":
      return bindingFailureValue("invalidDeployment", detail, cause);
    case "SchemaManifestTableBindingCorruptionError":
    case "StableTableCatalogCorruptionError":
    case "StableLogicalIndexCatalogCorruptionError":
    case "AppIndexDefinitionCatalogCorruptionError":
    case "SchemaVersionArtifactCorruptionError":
      return bindingFailureValue("storedState", detail, cause);
    case "SchemaManifestTableBindingPersistenceError":
    case "StableTableCatalogAllocationPersistenceError":
    case "SchemaManifestAppSchemaBindingPersistenceError":
    case "StableLogicalIndexCatalogAllocationPersistenceError":
    case "SchemaVersionArtifactPersistenceError":
    case "AppCreationTimeIndexDefinitionPersistenceError":
    case "StableTableIdentityPersistenceError":
    case "AppDeveloperIndexDefinitionPersistenceError":
    case "AppSchemaVersionIndexBindingPersistenceError":
      return bindingFailureValue("resourceFailure", detail, cause);
    case "AppIndexDefinitionIdExhaustedError":
    case "SchemaVersionArtifactConflictError":
    case "SchemaManifestChecksumCollisionError":
    case "AppIndexDefinitionChecksumCollisionError":
    case "AppCreationTimeIndexDefinitionChecksumCollisionError":
    case "AppSchemaVersionIndexBindingConflictError":
    case "AppCreationTimeIndexDefinitionParentError":
    case "AppIndexDefinitionParentError":
    case "AppSchemaPublicationV1ProjectionError":
    case "InvalidAppIndexDefinitionBindingInputError":
    case "InvalidPreparedAppSchemaPublicationV1Error":
    case "InvalidPreparedSchemaManifestAppSchemaBindingsError":
    case "InvalidPreparedAppCreationTimeIndexDefinitionError":
    case "InvalidPreparedAppIndexDefinitionBindingError":
    case "InvalidPreparedSchemaVersionArtifactError":
    case "AppCreationTimeIndexDefinitionRequirementError":
    case "AppDeveloperIndexDefinitionRequirementError":
      return bindingFailureValue("bindingConflict", detail, cause);
  }
  return unreachableError(cause);
}

function unreachableError(value: never): never {
  throw new TypeError("Unexpected relation-binding dependency error.", {
    cause: value,
  });
}

function nonnegativeVersionEffect(
  value: unknown,
): Effect.Effect<number, ApplicationRelationBindingError> {
  return typeof value === "number" && Number.isSafeInteger(value) &&
      value >= 0 && value <= MAX_CATALOG_SCHEMA_VERSION
    ? Effect.succeed(value)
    : bindingFailure("storedState");
}

function decodeOptionalRelationIdEffect(
  value: unknown,
): Effect.Effect<CatalogRelationId | null, ApplicationRelationBindingError> {
  if (value === undefined) return Effect.succeed(null);
  return Effect.fromResult(
    Schema.decodeUnknownResult(CatalogRelationIdSchema)(value).pipe(
      Result.mapError(cause => bindingFailureValue(
        "storedState",
        "The relation catalog high-water mark is invalid.",
        cause,
      )),
    ),
  );
}

function decodeOptionalEdgeDefinitionIdEffect(
  value: unknown,
): Effect.Effect<
  CatalogEdgeDefinitionId | null,
  ApplicationRelationBindingError
> {
  if (value === undefined) return Effect.succeed(null);
  return Effect.fromResult(
    Schema.decodeUnknownResult(CatalogEdgeDefinitionIdSchema)(value).pipe(
      Result.mapError(cause => bindingFailureValue(
        "storedState",
        "The edge-definition catalog high-water mark is invalid.",
        cause,
      )),
    ),
  );
}

function relationQueryEffect<A>(
  query: () => PromiseLike<A>,
): Effect.Effect<A, ApplicationRelationBindingError> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: async () => await query(),
    catch: cause => bindingFailureValue(
      "resourceFailure",
      "A relation-binding database operation failed.",
      cause,
    ),
  }));
}

function relationBindingReadQueryEffect<A>(
  query: () => PromiseLike<A>,
): Effect.Effect<A, ReadApplicationRelationBindingError> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: async () => await query(),
    catch: (cause) => relationBindingReadFailureValue(
      "resourceFailure",
      cause,
    ),
  }));
}

function mapApplicationRelationBindingReadError(
  cause: ApplicationRelationBindingError,
): ReadApplicationRelationBindingError {
  return relationBindingReadFailureValue(
    cause.reason === "resourceFailure" ? "resourceFailure" : "storedState",
    cause,
  );
}

function relationBindingReadFailure(
  reason: ReadApplicationRelationBindingError["reason"],
  cause?: unknown,
): Effect.Effect<never, ReadApplicationRelationBindingError> {
  return Effect.fail(relationBindingReadFailureValue(reason, cause));
}

function relationBindingReadFailureValue(
  reason: ReadApplicationRelationBindingError["reason"],
  cause?: unknown,
): ReadApplicationRelationBindingError {
  return new ReadApplicationRelationBindingError({
    operation: "locateCommitBinding",
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function sha256Effect(
  bytes: Uint8Array,
): Effect.Effect<Uint8Array, ApplicationRelationBindingError> {
  return Effect.tryPromise({
    try: async () => new Uint8Array(await globalThis.crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(bytes),
    )),
    catch: cause => bindingFailureValue(
      "resourceFailure",
      "SHA-256 is unavailable for relation-binding preparation.",
      cause,
    ),
  });
}

function bindingFailure(
  reason: ApplicationRelationBindingError["reason"],
  detail?: string,
  cause?: unknown,
): Effect.Effect<never, ApplicationRelationBindingError> {
  return Effect.fail(bindingFailureValue(reason, detail, cause));
}

function bindingFailureValue(
  reason: ApplicationRelationBindingError["reason"],
  detail?: string,
  cause?: unknown,
  retryable = false,
): ApplicationRelationBindingError {
  return new ApplicationRelationBindingError({
    operation: "publish",
    reason,
    retryable,
    ...(detail === undefined ? {} : { detail }),
    ...(cause === undefined ? {} : { cause }),
  });
}
