import {
  bytesEqualFullScan as bytesEqual,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  sql,
} from "drizzle-orm";
import { Cause, Effect, Exit, Result, Schema } from "effect";

import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytesResult,
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdentityV1Result,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  CatalogEdgeDefinitionIdSchema,
  type CatalogEdgeDefinitionId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  canonicalizePhysicalEdgeDefinition,
} from "flarex-protocol/internal/application-schema-binding";
import {
  RelationOccurrenceSha256,
  RelationOccurrenceSha256Error,
  type RelationOccurrenceSha256Api,
} from "flarex-protocol/internal/relation-occurrence-v1";
import { encodeCanonicalJson, type JsonObject } from "flarex-protocol/json";
import {
  CatalogSchemaVersionIdSchema,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  projectScopeEpochUuidV1Result,
  projectScopeIdUuidV1Result,
  FlarexDbV1StorageGenerationSchema,
  type CommitSeq,
  type FlarexDbV1StorageGeneration,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
  type TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";

import {
  applyApplicationRelationCommitEdgesInTransactionEffect,
  type ApplicationRelationCommitPort,
  ApplicationRelationCommitCorruptionError,
  ApplicationRelationCommitResourceExhaustionError,
  ApplicationRelationConstraintError,
  ApplicationRelationTargetNotLiveError,
  hasApplicationRelationCommitAuthorityForControlDb,
  hasLocatedApplicationRelationDefinitionSetAuthority,
  type LocatedApplicationRelationDefinition,
  type LocatedApplicationRelationDefinitionSet,
  prepareApplicationRelationDefinitionBuildResult,
  type PreparedApplicationRelationCommit,
} from "../applicationRelationCommit";
import {
  APP_RELATION_EDGE_BUILD_MAXIMUM_SOURCE_OCCURRENCES,
  cleanAppRelationEdgeDefinitionPageInTransactionEffect,
  readAppRelationEdgeBuildEndpointPresenceInTransactionEffect,
  readAppRelationEdgeBuildEndpointVersionsInTransactionEffect,
  readAppRelationEdgeBuildPageInTransactionEffect,
  readAppRelationEdgeBuildSourceInTransactionEffect,
  readAppRelationEdgeBuildVersionPageInTransactionEffect,
  verifyAppRelationEdgeBuildRowEffect,
  verifyAppRelationEdgeCurrentRowEffect,
  type AppRelationEdgeBuildFrontier,
  type AppRelationEdgeBuildVersionFrontier,
  type AppRelationEdgeStorageAction,
  type StoredAppRelationEdge,
} from "../appRelationEdges";
import {
  readLiveAppRowsAtSnapshotInTransactionEffect,
  type AppRowTransaction,
  type LiveAppRowRevisionV1,
} from "../appRows";
import type { FlarexMetadataDatabase } from "../deployments";
import { databaseTimestampFromUnknown } from "../databaseTimestamp";
import { hasExactOwnDataKeys } from "../exactOwnDataKeys";
import {
  lockScopeClockForUpdateInTransactionEffect,
  type ScopeClockRecord,
} from "../scopeClock";
import {
  hasApplicationRelationServingInspectorAuthority,
  inspectApplicationRelationServingDefinitionInTransactionEffect,
  type ApplicationRelationServingInspector,
  type InspectApplicationRelationServingError,
} from "../applicationRelationServing";
import {
  captureTrustedScopeAuthorityResolutionPorts,
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityResolutionPorts,
} from "../scopeAuthorityResolution";
import {
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxSystemEdgeDefinitionBuilds,
  fxSystemEdgeDefinitionReadiness,
  fxSystemScopeClocks,
} from "../schema";
import { runLocatedReadCommittedEffect } from "../locatedReadCommittedEffect";
import {
  isLocatedReadCommittedAttemptTargetV1,
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
  type RunLocatedReadCommittedTransactionV1,
} from "../transactionSessionAttemptKernel";
import {
  APPLICATION_RELATION_BUILD_CURSOR_CODEC_VERSION,
  APPLICATION_RELATION_BUILD_SOURCE_PAGE_SIZE,
  APPLICATION_RELATION_READINESS_RECEIPT_CODEC_VERSION,
  APPLICATION_RELATION_READINESS_RECEIPT_MAXIMUM_BYTES,
} from "./Constants";
import {
  type ApplicationRelationBuildAttemptFence,
  ApplicationRelationBuildCorruptionError,
  ApplicationRelationBuildDecisionUncertainError,
  ApplicationRelationBuildEnabledDefinitionError,
  type ApplicationRelationBuildError,
  type ApplicationRelationBuildInput,
  type ApplicationRelationBuildLifecycle,
  ApplicationRelationBuildMismatchError,
  type ApplicationRelationBuildMutationTransactionError,
  type ApplicationRelationBuildOptions,
  ApplicationRelationBuildPersistenceError,
  type ApplicationRelationBuildPort,
  type ApplicationRelationBuildReadinessReference,
  type ApplicationRelationBuildReadinessValidationError,
  ApplicationRelationBuildServingDefinitionError,
  type ApplicationRelationBuildStepResult,
  type ApplicationRelationBuildTransactionError,
  type ApplicationRelationSemanticValidationPageResult,
  type ApplicationRelationSemanticValidationProgress,
  ApplicationRelationBuildStaleAuthorityError,
  ApplicationRelationBuildUnavailableError,
  type ApplicationRelationReadinessEvidence,
  type ApplicationRelationReadinessReceipt,
  InvalidApplicationRelationBuildInputError,
} from "./Model";

const INPUT_KEYS = Object.freeze([
  "deploymentId",
  "schemaVersionId",
  "edgeDefinitionId",
] as const);
const MAX_BIGINT = 9_223_372_036_854_775_807n;
const TEXT_ENCODER = new TextEncoder();

const decodeSchemaVersionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogSchemaVersionIdSchema),
);
const decodeEdgeDefinitionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogEdgeDefinitionIdSchema),
);
const decodeDeploymentIdResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionGrantDeploymentIdV1Schema),
);
const FLAREXDB_V1_STORAGE_GENERATION =
  FlarexDbV1StorageGenerationSchema.make("flarexdb_v1");

export interface LocatedApplicationRelationBuildTarget
  extends LocatedReadCommittedAttemptTargetV1 {}

interface ApplicationRelationBuildPortState {
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedApplicationRelationBuildTarget
  >;
  readonly relationCommit: ApplicationRelationCommitPort;
  readonly servingInspector: ApplicationRelationServingInspector;
  readonly occurrenceSha256: RelationOccurrenceSha256Api;
}

const applicationRelationBuildPortStates = new WeakMap<
  object,
  ApplicationRelationBuildPortState
>();
const applicationRelationReadinessEvidenceStates = new WeakMap<
  object,
  ApplicationRelationBuildPortState
>();

interface LocatedBuildDefinition {
  readonly definitions: LocatedApplicationRelationDefinitionSet;
  readonly definition: LocatedApplicationRelationDefinition;
  readonly physicalDefinitionSha256: Uint8Array;
  readonly semanticDefinitionSha256: Uint8Array;
}

interface ApplicationRelationBuildHead {
  readonly scopeId: ScopeId;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly deploymentId: string;
  readonly relationId: LocatedApplicationRelationDefinition["binding"]["relationId"];
  readonly sourceTableId: LocatedApplicationRelationDefinition["binding"]["sourceTableId"];
  readonly targetTableId: LocatedApplicationRelationDefinition["binding"]["targetTableId"];
  readonly semanticDefinitionSha256: Uint8Array;
  readonly physicalDefinitionSha256: Uint8Array;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: TrustedScopeAuthority["storageGenerationFence"];
  readonly epoch: TrustedScopeAuthority["epoch"];
  readonly frontierCommitSeq: CommitSeq;
  readonly attemptFence: ApplicationRelationBuildAttemptFence;
  readonly lifecycle: ApplicationRelationBuildLifecycle;
  readonly sourceCursorRowId: AppRowIdHexV1 | null;
  readonly edgeCursor: AppRelationEdgeBuildFrontier | null;
  readonly versionCursor: AppRelationEdgeBuildVersionFrontier | null;
  readonly processedSourceCount: bigint;
  readonly validatedSourceCount: bigint;
  readonly validatedEdgeCount: bigint;
  readonly validatedVersionCount: bigint;
  readonly readinessSha256: Uint8Array | null;
}

interface DecodedBuildInput {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
}

type BuildTransactionFailure =
  ApplicationRelationBuildMutationTransactionError;

export function createApplicationRelationBuildPort(
  controlDb: FlarexMetadataDatabase,
  authority: TrustedScopeAuthorityResolutionPorts<
    LocatedApplicationRelationBuildTarget
  >,
  relationCommit: ApplicationRelationCommitPort,
  servingInspector: ApplicationRelationServingInspector,
): ApplicationRelationBuildPort {
  const capturedAuthority = captureTrustedScopeAuthorityResolutionPorts(
    authority,
  );
  let port: ApplicationRelationBuildPort;
  port = Object.freeze({
    advance: (input: ApplicationRelationBuildInput, options = {}) =>
      advanceApplicationRelationBuildEffect(port, input, options),
    restart: (input: ApplicationRelationBuildInput, options = {}) =>
      restartApplicationRelationBuildEffect(port, input, options),
    readiness: (input: ApplicationRelationBuildInput) =>
      readApplicationRelationReadinessEffect(port, input),
  });
  if (hasApplicationRelationCommitAuthorityForControlDb(
    relationCommit,
    controlDb,
  ) && hasApplicationRelationServingInspectorAuthority(servingInspector)) {
    applicationRelationBuildPortStates.set(port, Object.freeze({
      controlDb,
      authority: capturedAuthority,
      relationCommit,
      servingInspector,
      occurrenceSha256: webCryptoRelationOccurrenceSha256,
    }));
  }
  return port;
}

export function hasApplicationRelationBuildAuthority(
  value: unknown,
): value is ApplicationRelationBuildPort {
  return typeof value === "object" && value !== null &&
    applicationRelationBuildPortStates.has(value);
}

/** Exact same-factory composition check for the E01-B readiness owner. */
export function hasApplicationRelationBuildAuthorityForComposition(
  value: unknown,
  controlDb: FlarexMetadataDatabase,
  relationCommit: ApplicationRelationCommitPort,
): value is ApplicationRelationBuildPort {
  if (typeof value !== "object" || value === null) return false;
  const state = applicationRelationBuildPortStates.get(value);
  return state?.controlDb === controlDb &&
    state.relationCommit === relationCommit;
}

export function hasApplicationRelationReadinessEvidenceAuthority(
  port: ApplicationRelationBuildPort,
  evidence: unknown,
): evidence is ApplicationRelationReadinessEvidence {
  if (typeof evidence !== "object" || evidence === null) return false;
  const state = applicationRelationBuildPortStates.get(port);
  return state !== undefined &&
    applicationRelationReadinessEvidenceStates.get(evidence) === state;
}

const advanceApplicationRelationBuildEffect = Effect.fn(
  "ApplicationRelationBuild.advance",
)(function* (
  port: ApplicationRelationBuildPort,
  input: unknown,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<ApplicationRelationBuildStepResult, ApplicationRelationBuildError> {
  const state = yield* requirePortState(port);
  const decoded = yield* Effect.fromResult(decodeInputResult(input));
  const located = yield* locateBuildContext(state, decoded);
  return yield* runBuildTransaction(
    located.target,
    located.authority,
    located.definition,
    state,
    options,
    "advance",
  );
});

const restartApplicationRelationBuildEffect = Effect.fn(
  "ApplicationRelationBuild.restart",
)(function* (
  port: ApplicationRelationBuildPort,
  input: unknown,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<ApplicationRelationBuildStepResult, ApplicationRelationBuildError> {
  const state = yield* requirePortState(port);
  const decoded = yield* Effect.fromResult(decodeInputResult(input));
  const located = yield* locateBuildContext(state, decoded);
  return yield* runBuildTransaction(
    located.target,
    located.authority,
    located.definition,
    state,
    options,
    "restart",
  );
});

const readApplicationRelationReadinessEffect = Effect.fn(
  "ApplicationRelationBuild.readiness",
)(function* (
  port: ApplicationRelationBuildPort,
  input: unknown,
): Effect.fn.Return<
  ApplicationRelationReadinessEvidence | null,
  ApplicationRelationBuildError
> {
  const state = yield* requirePortState(port);
  const decoded = yield* Effect.fromResult(decodeInputResult(input));
  const located = yield* locateBuildContext(state, decoded);
  const evidence = yield* runReadinessTransaction(
    located.target,
    located.authority,
    located.definition,
  );
  if (evidence !== null) {
    applicationRelationReadinessEvidenceStates.set(evidence, state);
  }
  return evidence;
});

function requirePortState(
  port: ApplicationRelationBuildPort,
): Effect.Effect<
  ApplicationRelationBuildPortState,
  ApplicationRelationBuildUnavailableError
> {
  const state = applicationRelationBuildPortStates.get(port);
  return state === undefined
    ? Effect.fail(new ApplicationRelationBuildUnavailableError({
      reason: "compositionMissing",
    }))
    : Effect.succeed(state);
}

const locateBuildContext = Effect.fn(
  "ApplicationRelationBuild.locateContext",
)(function* (
  state: ApplicationRelationBuildPortState,
  input: DecodedBuildInput,
): Effect.fn.Return<
  Readonly<{
    readonly target: LocatedApplicationRelationBuildTarget;
    readonly authority: TrustedScopeAuthority;
    readonly definition: LocatedBuildDefinition;
  }>,
  ApplicationRelationBuildError
> {
  const locatedAuthority = yield* resolveLocatedTrustedScopeAuthorityEffect(
    input.deploymentId,
    state.authority,
  );
  const definitions = yield* state.relationCommit.locate({
    deploymentId: input.deploymentId,
    schemaVersionId: input.schemaVersionId,
  });
  if (definitions === null) {
    return yield* Effect.fail(new ApplicationRelationBuildUnavailableError({
      reason: "bindingUnavailable",
    }));
  }
  const matches = definitions.definitions.filter((definition) =>
    definition.edge.edgeDefinitionId === input.edgeDefinitionId
  );
  const definition = matches[0];
  if (definition === undefined || matches.length !== 1) {
    return yield* Effect.fail(new ApplicationRelationBuildUnavailableError({
      reason: "definitionUnavailable",
    }));
  }
  const canonicalPhysical = yield* canonicalizePhysicalEdgeDefinition(
    definition.edge.physical,
  );
  const target = yield* Effect.try({
    try: () =>
      isLocatedReadCommittedAttemptTargetV1(locatedAuthority.target)
        ? locatedAuthority.target
        : null,
    catch: (cause) => new ApplicationRelationBuildPersistenceError({
      operation: "resolveTargetCapability",
      retryable: false,
      cause,
    }),
  });
  if (target === null) {
    return yield* Effect.fail(new ApplicationRelationBuildUnavailableError({
      reason: "targetCapabilityMissing",
    }));
  }
  const locatedDefinition = Object.freeze({
    definitions,
    definition,
    physicalDefinitionSha256: lowercaseHexToBytes(
      canonicalPhysical.sha256Hex,
    ),
    semanticDefinitionSha256: lowercaseHexToBytes(
      definition.binding.semanticDefinitionSha256,
    ),
  });
  return Object.freeze({
    target,
    authority: locatedAuthority.authority,
    definition: locatedDefinition,
  });
});

function decodeInputResult(
  input: unknown,
): Result.Result<DecodedBuildInput, InvalidApplicationRelationBuildInputError> {
  return Result.gen(function* () {
    if (!hasExactOwnDataKeys(input, INPUT_KEYS)) {
      return yield* Result.fail(new InvalidApplicationRelationBuildInputError({
        reason: "invalidInputShape",
      }));
    }
    const deploymentId = yield* decodeDeploymentIdResult(
      input.deploymentId,
    ).pipe(Result.mapError(() =>
      new InvalidApplicationRelationBuildInputError({
        reason: "invalidDeploymentId",
      })
    ));
    const schemaVersionId = yield* decodeSchemaVersionIdResult(
      input.schemaVersionId,
    ).pipe(Result.mapError(() =>
      new InvalidApplicationRelationBuildInputError({
        reason: "invalidSchemaVersionId",
      })
    ));
    const edgeDefinitionId = yield* decodeEdgeDefinitionIdResult(
      input.edgeDefinitionId,
    ).pipe(Result.mapError(() =>
      new InvalidApplicationRelationBuildInputError({
        reason: "invalidEdgeDefinitionId",
      })
    ));
    return Object.freeze({
      deploymentId,
      schemaVersionId,
      edgeDefinitionId,
    });
  });
}

const runBuildTransaction = Effect.fn(
  "ApplicationRelationBuild.runTransaction",
)(function* (
  target: LocatedApplicationRelationBuildTarget,
  authority: TrustedScopeAuthority,
  definition: LocatedBuildDefinition,
  state: ApplicationRelationBuildPortState,
  options: ApplicationRelationBuildOptions,
  operation: "advance" | "restart",
): Effect.fn.Return<ApplicationRelationBuildStepResult, ApplicationRelationBuildError> {
  return yield* runTargetTransaction(
    target,
    authority.scopeId,
    definition.definition.edge.edgeDefinitionId,
    (tx) => buildInTransaction(
      tx,
      authority,
      definition,
      state,
      options,
      operation,
    ),
  );
});

const runReadinessTransaction = Effect.fn(
  "ApplicationRelationBuild.runReadinessTransaction",
)(function* (
  target: LocatedApplicationRelationBuildTarget,
  authority: TrustedScopeAuthority,
  definition: LocatedBuildDefinition,
): Effect.fn.Return<
  ApplicationRelationReadinessEvidence | null,
  ApplicationRelationBuildError
> {
  return yield* runTargetTransaction(
    target,
    authority.scopeId,
    definition.definition.edge.edgeDefinitionId,
    (tx) => readinessInTransaction(tx, authority, definition),
  );
});

/**
 * Revalidates one E01-A receipt inside a caller-owned target transaction.
 * The caller must already hold the scope-clock UPDATE lock represented by
 * `clock`; this facet never opens a transaction or acquires a second lock.
 */
export const validateApplicationRelationBuildReadinessInTransactionEffect =
  Effect.fn(
    "ApplicationRelationBuild.validateReadinessInTransaction",
  )(function* (
    port: ApplicationRelationBuildPort,
    tx: AppRowTransaction,
    authority: TrustedScopeAuthority,
    clock: ScopeClockRecord,
    definitions: LocatedApplicationRelationDefinitionSet,
    edgeDefinitionId: CatalogEdgeDefinitionId,
  ): Effect.fn.Return<
    ApplicationRelationReadinessEvidence | null,
    ApplicationRelationBuildReadinessValidationError
  > {
    const state = yield* requirePortState(port);
    if (clock.scopeId !== authority.scopeId) {
      return yield* Effect.fail(new ApplicationRelationBuildUnavailableError({
        reason: "compositionMissing",
      }));
    }
    const located = yield* locateAuthorizedBuildDefinition(
      state,
      authority,
      definitions,
      edgeDefinitionId,
    );
    const evidence = yield* validateReadinessUnderLockedClock(
      tx,
      authority,
      clock,
      located,
    );
    if (evidence !== null) {
      applicationRelationReadinessEvidenceStates.set(evidence, state);
    }
    return evidence;
  });

/**
 * Authenticates an enabled historical E01-A receipt for semantic-reuse
 * lineage. Unlike the direct-current facet above, this deliberately validates
 * the receipt at its own recorded authority and frontier.
 */
export const validateHistoricalApplicationRelationBuildReadinessInTransactionEffect =
  Effect.fn(
    "ApplicationRelationBuild.validateHistoricalReadinessInTransaction",
  )(function* (
    port: ApplicationRelationBuildPort,
    tx: AppRowTransaction,
    authority: TrustedScopeAuthority,
    definitions: LocatedApplicationRelationDefinitionSet,
    edgeDefinitionId: CatalogEdgeDefinitionId,
  ): Effect.fn.Return<
    ApplicationRelationReadinessEvidence | null,
    ApplicationRelationBuildReadinessValidationError
  > {
    const state = yield* requirePortState(port);
    const located = yield* locateAuthorizedBuildDefinition(
      state,
      authority,
      definitions,
      edgeDefinitionId,
    );
    const evidence = yield* validateStoredReadinessForLocatedDefinition(
      tx,
      authority.scopeId,
      located,
    );
    if (evidence !== null) {
      applicationRelationReadinessEvidenceStates.set(evidence, state);
    }
    return evidence;
  });

/**
 * Revalidates one exact immutable E01-A receipt reference retained by a
 * semantic-readiness receipt. This facet deliberately does not require the
 * physical build head to still select that historical attempt.
 */
export const validateReferencedApplicationRelationBuildReadinessInTransactionEffect =
  Effect.fn(
    "ApplicationRelationBuild.validateReferencedReadinessInTransaction",
  )(function* (
    port: ApplicationRelationBuildPort,
    tx: AppRowTransaction,
    authority: TrustedScopeAuthority,
    reference: ApplicationRelationBuildReadinessReference,
  ): Effect.fn.Return<
    ApplicationRelationReadinessEvidence | null,
    ApplicationRelationBuildReadinessValidationError
  > {
    const state = yield* requirePortState(port);
    if (!readinessReferenceMatchesAuthority(reference, authority)) {
      return yield* Effect.fail(new ApplicationRelationBuildUnavailableError({
        reason: "compositionMissing",
      }));
    }
    const rows = yield* queryEffect(
      "readReceipt",
      tx.select().from(fxSystemEdgeDefinitionReadiness).where(and(
        eq(fxSystemEdgeDefinitionReadiness.scopeId, reference.scopeId),
        eq(
          fxSystemEdgeDefinitionReadiness.edgeDefinitionId,
          reference.edgeDefinitionId,
        ),
        eq(
          fxSystemEdgeDefinitionReadiness.attemptFence,
          reference.attemptFence,
        ),
      )).limit(1),
    );
    const row = rows[0];
    if (row === undefined) return null;
    const head = yield* Effect.fromResult(
      buildHeadFromReadinessRowResult(row),
    );
    const evidence = yield* verifyReceiptRowEffect(head, row);
    if (
      head.scopeId !== reference.scopeId ||
      head.deploymentId !== reference.deploymentId ||
      head.relationId !== reference.relationId ||
      head.edgeDefinitionId !== reference.edgeDefinitionId ||
      head.sourceTableId !== reference.sourceTableId ||
      head.targetTableId !== reference.targetTableId ||
      !bytesEqual(
        head.physicalDefinitionSha256,
        reference.physicalDefinitionSha256,
      ) ||
      head.storageGeneration !== reference.storageGeneration ||
      head.storageGenerationFence !== reference.storageGenerationFence ||
      head.epoch !== reference.epoch ||
      head.frontierCommitSeq !== reference.frontierCommitSeq ||
      head.attemptFence !== reference.attemptFence ||
      !bytesEqual(evidence.sha256, reference.readinessSha256)
    ) {
      return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
        reason: "receiptEvidence",
      }));
    }
    applicationRelationReadinessEvidenceStates.set(evidence, state);
    return evidence;
  });

/**
 * Requires the mutable E01-A head to keep selecting one exact authenticated
 * receipt while the caller holds the scope-clock lock. A historical receipt
 * remains valid evidence, but it is not authority to scan sidecars while the
 * selected physical attempt is being rebuilt or has moved.
 */
export const validateCurrentApplicationRelationBuildProjectionReferenceInTransactionEffect =
  Effect.fn(
    "ApplicationRelationBuild.validateCurrentProjectionReferenceInTransaction",
  )(function* (
    port: ApplicationRelationBuildPort,
    tx: AppRowTransaction,
    authority: TrustedScopeAuthority,
    clock: ScopeClockRecord,
    reference: ApplicationRelationBuildReadinessReference,
  ): Effect.fn.Return<
    ApplicationRelationReadinessEvidence | null,
    ApplicationRelationBuildReadinessValidationError
  > {
    const state = yield* requirePortState(port);
    if (
      clock.scopeId !== authority.scopeId ||
      !readinessReferenceMatchesAuthority(reference, authority)
    ) {
      return yield* Effect.fail(new ApplicationRelationBuildUnavailableError({
        reason: "compositionMissing",
      }));
    }
    if (
      reference.storageGeneration !== clock.storageGeneration ||
      reference.storageGenerationFence !== clock.storageGenerationFence ||
      reference.epoch !== clock.epoch ||
      reference.frontierCommitSeq > clock.lastCommitSeq
    ) {
      return null;
    }
    const head = yield* readBuildHeadForUpdateEffect(
      tx,
      reference.scopeId,
      reference.edgeDefinitionId,
    );
    if (
      head === null ||
      head.lifecycle !== "enabled" ||
      head.readinessSha256 === null ||
      !headMatchesAuthority(head, clock) ||
      head.attemptFence !== reference.attemptFence ||
      !bytesEqual(head.readinessSha256, reference.readinessSha256)
    ) {
      return null;
    }
    if (
      head.scopeId !== reference.scopeId ||
      head.deploymentId !== reference.deploymentId ||
      head.relationId !== reference.relationId ||
      head.edgeDefinitionId !== reference.edgeDefinitionId ||
      head.sourceTableId !== reference.sourceTableId ||
      head.targetTableId !== reference.targetTableId ||
      !bytesEqual(
        head.physicalDefinitionSha256,
        reference.physicalDefinitionSha256,
      ) ||
      head.storageGeneration !== reference.storageGeneration ||
      head.storageGenerationFence !== reference.storageGenerationFence ||
      head.epoch !== reference.epoch ||
      head.frontierCommitSeq !== reference.frontierCommitSeq
    ) {
      return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
        reason: "receiptEvidence",
      }));
    }
    const row = yield* readReceiptRowEffect(tx, head);
    if (row === null) {
      return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
        reason: "receiptEvidence",
      }));
    }
    const evidence = yield* verifyReceiptRowEffect(head, row);
    if (!bytesEqual(evidence.sha256, reference.readinessSha256)) {
      return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
        reason: "receiptEvidence",
      }));
    }
    applicationRelationReadinessEvidenceStates.set(evidence, state);
    return evidence;
  });

function readinessReferenceMatchesAuthority(
  reference: ApplicationRelationBuildReadinessReference,
  authority: TrustedScopeAuthority,
): boolean {
  return reference.scopeId === authority.scopeId &&
    reference.deploymentId === authority.deploymentId &&
    isUint8ArrayWithByteLength(reference.physicalDefinitionSha256, 32) &&
    isUint8ArrayWithByteLength(reference.readinessSha256, 32) &&
    reference.attemptFence >= 1n &&
    reference.frontierCommitSeq >= 0n;
}

const locateAuthorizedBuildDefinition = Effect.fn(
  "ApplicationRelationBuild.locateAuthorizedDefinition",
)(function* (
  state: ApplicationRelationBuildPortState,
  authority: TrustedScopeAuthority,
  definitions: LocatedApplicationRelationDefinitionSet,
  edgeDefinitionId: CatalogEdgeDefinitionId,
): Effect.fn.Return<
  LocatedBuildDefinition,
  ApplicationRelationBuildReadinessValidationError
> {
  if (
    !hasLocatedApplicationRelationDefinitionSetAuthority(
      state.relationCommit,
      definitions,
    ) || definitions.deploymentId !== authority.deploymentId
  ) {
    return yield* Effect.fail(new ApplicationRelationBuildUnavailableError({
      reason: "compositionMissing",
    }));
  }
  const matches = definitions.definitions.filter((definition) =>
    definition.edge.edgeDefinitionId === edgeDefinitionId
  );
  const definition = matches[0];
  if (definition === undefined || matches.length !== 1) {
    return yield* Effect.fail(new ApplicationRelationBuildUnavailableError({
      reason: "definitionUnavailable",
    }));
  }
  const canonicalPhysical = yield* canonicalizePhysicalEdgeDefinition(
    definition.edge.physical,
  );
  return Object.freeze({
    definitions,
    definition,
    physicalDefinitionSha256: lowercaseHexToBytes(
      canonicalPhysical.sha256Hex,
    ),
    semanticDefinitionSha256: lowercaseHexToBytes(
      definition.binding.semanticDefinitionSha256,
    ),
  });
});

class ApplicationRelationBuildTargetInvocationFailure extends Error {
  readonly name = "ApplicationRelationBuildTargetInvocationFailure";

  constructor(readonly invocationCause: unknown) {
    super("E01 relation build target transaction invocation failed.", {
      cause: invocationCause,
    });
  }
}

const runTargetTransaction = Effect.fn(
  "ApplicationRelationBuild.runTargetTransaction",
)(function* <Value>(
  target: LocatedApplicationRelationBuildTarget,
  scopeId: ScopeId,
  edgeDefinitionId: CatalogEdgeDefinitionId,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, BuildTransactionFailure>,
): Effect.fn.Return<Value, ApplicationRelationBuildError> {
  const exit = yield* Effect.exit(runLocatedReadCommittedEffect(
    guardTargetTransactionInvocation(target),
    {
      rollbackMessage: "E01 relation build transaction rolled back.",
      cleanupDefect: (cause) => new ApplicationRelationBuildPersistenceError({
        operation: "targetTransaction",
        retryable: true,
        cause,
      }),
    },
    work,
  ));
  if (Exit.isSuccess(exit)) return exit.value;
  const onlyReason = exit.cause.reasons.length === 1
    ? exit.cause.reasons[0]
    : undefined;
  if (
    onlyReason !== undefined && Cause.isDieReason(onlyReason) &&
    onlyReason.defect instanceof ApplicationRelationBuildTargetInvocationFailure
  ) {
    return yield* Effect.fail(new ApplicationRelationBuildPersistenceError({
      operation: "targetTransaction",
      retryable: false,
      cause: onlyReason.defect.invocationCause,
    }));
  }
  if (
    onlyReason !== undefined && Cause.isFailReason(onlyReason) &&
    onlyReason.error instanceof LocatedReadCommittedTransactionFailureV1 &&
    onlyReason.error.issue.kind === "decisionUncertain"
  ) {
    return yield* Effect.fail(
      new ApplicationRelationBuildDecisionUncertainError({
        scopeId,
        edgeDefinitionId,
        cause: onlyReason.error,
      }),
    );
  }
  if (
    onlyReason !== undefined && Cause.isFailReason(onlyReason) &&
    onlyReason.error instanceof LocatedReadCommittedTransactionFailureV1
  ) {
    return yield* Effect.fail(new ApplicationRelationBuildPersistenceError({
      operation: "targetTransaction",
      retryable: true,
      cause: onlyReason.error,
    }));
  }
  // SAFETY: the bridge's remaining typed failures come from `work`, whose
  // BuildTransactionFailure channel is a subset of this public error union;
  // any combined cleanup defect remains intact in the same Cause.
  return yield* Effect.failCause(exit.cause as Cause.Cause<
    ApplicationRelationBuildError
  >);
});

function guardTargetTransactionInvocation(
  target: LocatedApplicationRelationBuildTarget,
): LocatedReadCommittedAttemptTargetV1 {
  const guardedRun: RunLocatedReadCommittedTransactionV1 = <Value>(
    work: (tx: AppRowTransaction) => Promise<Value>,
  ): Promise<Value> => {
    let started: Promise<Value>;
    try {
      started = target[RUN_LOCATED_READ_COMMITTED_V1](work);
    } catch (cause) {
      return Promise.reject(
        new ApplicationRelationBuildTargetInvocationFailure(cause),
      );
    }
    return Promise.resolve(started).catch((cause: unknown) => {
      if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
        throw cause;
      }
      throw new ApplicationRelationBuildTargetInvocationFailure(cause);
    });
  };
  return Object.freeze({
    physicalLocator: target.physicalLocator,
    getCurrentClock: (scopeId: ScopeId) => target.getCurrentClock(scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: guardedRun,
  });
}

const buildInTransaction = Effect.fn(
  "ApplicationRelationBuild.buildInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  located: LocatedBuildDefinition,
  port: ApplicationRelationBuildPortState,
  options: ApplicationRelationBuildOptions,
  operation: "advance" | "restart",
): Effect.fn.Return<ApplicationRelationBuildStepResult, BuildTransactionFailure> {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* runFault(options, "afterScopeClockLock");
  yield* Effect.fromResult(requireCurrentAuthorityResult(
    authority,
    located.definition.edge.edgeDefinitionId,
    clock,
  ));
  const existing = yield* readBuildHeadForUpdateEffect(
    tx,
    authority.scopeId,
    located.definition.edge.edgeDefinitionId,
  );
  if (existing === null) {
    yield* requireDefinitionNotServingInTransaction(
      tx,
      authority,
      clock,
      located.definition.edge.edgeDefinitionId,
      port,
    );
    const initialized = yield* insertBuildHeadEffect(
      tx,
      authority,
      clock,
      located,
    );
    return stepResult(initialized, "initialized");
  }
  yield* Effect.fromResult(requireImmutableDefinitionResult(existing, located));
  const bindingMoved = !headMatchesBinding(existing, located);
  const authorityMoved = !headMatchesAuthority(existing, clock);
  const frontierMoved = existing.frontierCommitSeq !== clock.lastCommitSeq;
  if (existing.lifecycle === "enabled" && bindingMoved) {
    return yield* Effect.fail(
      new ApplicationRelationBuildEnabledDefinitionError({
        scopeId: existing.scopeId,
        edgeDefinitionId: existing.edgeDefinitionId,
        reason: "bindingMoved",
      }),
    );
  }
  if (
    operation === "restart" || bindingMoved || authorityMoved ||
    frontierMoved
  ) {
    yield* requireDefinitionNotServingInTransaction(
      tx,
      authority,
      clock,
      located.definition.edge.edgeDefinitionId,
      port,
    );
    const restarted = yield* restartBuildHeadEffect(
      tx,
      existing,
      authority,
      clock,
      located,
      options,
    );
    return stepResult(restarted, "restarted");
  }
  if (existing.lifecycle === "enabled") {
    return stepResult(existing, "replayed");
  }
  switch (existing.lifecycle) {
    case "cleaning":
      yield* requireDefinitionNotServingInTransaction(
        tx,
        authority,
        clock,
        located.definition.edge.edgeDefinitionId,
        port,
      );
      return yield* cleanDefinitionPage(
        tx,
        existing,
        located,
        options,
      );
    case "backfilling":
      return yield* backfillSourcePage(
        tx,
        existing,
        located,
        port,
        options,
      );
    case "validating_sources":
      return yield* validateSourcePage(
        tx,
        existing,
        located,
        port,
        options,
      );
    case "validating_edges":
      return yield* validateEdgePage(
        tx,
        existing,
        located,
        port,
        options,
      );
    case "validating_versions":
      return yield* validateVersionPage(
        tx,
        existing,
        located,
        options,
      );
  }
});

const requireDefinitionNotServingInTransaction = Effect.fn(
  "ApplicationRelationBuild.requireDefinitionNotServingInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
  edgeDefinitionId: CatalogEdgeDefinitionId,
  state: ApplicationRelationBuildPortState,
): Effect.fn.Return<
  void,
  | InspectApplicationRelationServingError
  | ApplicationRelationBuildServingDefinitionError
> {
  const inspection = yield*
    inspectApplicationRelationServingDefinitionInTransactionEffect(
      state.servingInspector,
      tx,
      {
        authority,
        clock,
        edgeDefinitionId,
      },
    );
  if (inspection.status === "serving") {
    return yield* Effect.fail(
      new ApplicationRelationBuildServingDefinitionError({
        scopeId: authority.scopeId,
        edgeDefinitionId,
        activeRevisionId: inspection.activeRevisionId,
      }),
    );
  }
});

const cleanDefinitionPage = Effect.fn(
  "ApplicationRelationBuild.cleanDefinitionPage",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  located: LocatedBuildDefinition,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<ApplicationRelationBuildStepResult, BuildTransactionFailure> {
  const cleaned = yield* cleanAppRelationEdgeDefinitionPageInTransactionEffect(
    tx,
    {
      scopeId: head.scopeId,
      definition: located.definition.edge,
    },
  );
  yield* runFault(options, "afterCleanup");
  const updated = yield* updateBuildHeadEffect(
    tx,
    head,
    cleaned.exhausted
      ? {
        lifecycle: "backfilling",
        sourceCursorRowId: null,
      }
      : {},
    options,
  );
  return stepResult(updated, "advanced", {
    deletedEdges: cleaned.deletedEdges,
    deletedVersions: cleaned.deletedVersions,
  });
});

const backfillSourcePage = Effect.fn(
  "ApplicationRelationBuild.backfillSourcePage",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  located: LocatedBuildDefinition,
  port: ApplicationRelationBuildPortState,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<ApplicationRelationBuildStepResult, BuildTransactionFailure> {
  const candidates = yield* readSourcePointerPageEffect(
    tx,
    head,
    located.definition.binding.sourceTableId,
    head.sourceCursorRowId,
  );
  const page = candidates;
  const expectedPage = yield* prepareExpectedSourcePageEffect(
    tx,
    head,
    located,
    page,
    true,
    options,
  );
  let liveSourceCount = 0n;
  for (const expected of expectedPage) {
    if (expected.current.kind !== "live") continue;
    liveSourceCount += 1n;
    if (expected.prepared.actions.length !== 0) {
      yield* applyApplicationRelationCommitEdgesInTransactionEffect(
        port.relationCommit,
        tx,
        {
          scopeId: head.scopeId,
          schemaVersionId: located.definitions.schemaVersionId,
          commitSeq: head.frontierCommitSeq,
          prepared: expected.prepared,
        },
      );
    }
    yield* runFault(options, "afterBackfillRow");
  }
  const exhausted = candidates.length < APPLICATION_RELATION_BUILD_SOURCE_PAGE_SIZE;
  const last = page.at(-1) ?? head.sourceCursorRowId;
  const updated = yield* updateBuildHeadEffect(
    tx,
    head,
    {
      lifecycle: exhausted ? "validating_sources" : "backfilling",
      sourceCursorRowId: exhausted ? null : last,
      processedSourceCount: head.processedSourceCount + liveSourceCount,
    },
    options,
  );
  return stepResult(updated, "advanced", {
    processedSourceRows: page.length,
  });
});

const validateSourcePage = Effect.fn(
  "ApplicationRelationBuild.validateSourcePage",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  located: LocatedBuildDefinition,
  port: ApplicationRelationBuildPortState,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<ApplicationRelationBuildStepResult, BuildTransactionFailure> {
  const candidates = yield* readSourceValidationPageEffect(
    tx,
    head,
    located.definition,
  );
  const page = candidates;
  const expectedPage = yield* prepareExpectedSourcePageEffect(
    tx,
    head,
    located,
    page,
    true,
    options,
  );
  let liveSourceCount = 0n;
  for (const expected of expectedPage) {
    const rowId = expected.rowId;
    const stored = yield* readAppRelationEdgeBuildSourceInTransactionEffect(
      tx,
      {
        scopeId: head.scopeId,
        definition: located.definition.edge,
        sourceRowId: rowId,
      },
    );
    if (expected.current.kind === "live") liveSourceCount += 1n;
    yield* validateExactSourceContentsEffect(
      head,
      expected.prepared,
      stored,
      port,
      rowId,
      { kind: "freshBuild" },
    );
    yield* runFault(options, "afterValidationRow");
  }
  const exhausted = candidates.length < APPLICATION_RELATION_BUILD_SOURCE_PAGE_SIZE;
  const nextValidatedSourceCount = head.validatedSourceCount + liveSourceCount;
  if (exhausted && nextValidatedSourceCount !== head.processedSourceCount) {
    return yield* Effect.fail(new ApplicationRelationBuildMismatchError({
      scopeId: head.scopeId,
      edgeDefinitionId: head.edgeDefinitionId,
      lifecycle: "validating_sources",
      reason: "sourceCount",
    }));
  }
  const last = page.at(-1) ?? head.sourceCursorRowId;
  const updated = yield* updateBuildHeadEffect(
    tx,
    head,
    {
      lifecycle: exhausted ? "validating_edges" : "validating_sources",
      sourceCursorRowId: exhausted ? null : last,
      validatedSourceCount: nextValidatedSourceCount,
    },
    options,
  );
  return stepResult(updated, "advanced", {
    processedSourceRows: page.length,
  });
});

const validateEdgePage = Effect.fn(
  "ApplicationRelationBuild.validateEdgePage",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  located: LocatedBuildDefinition,
  port: ApplicationRelationBuildPortState,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<ApplicationRelationBuildStepResult, BuildTransactionFailure> {
  const page = yield* readAppRelationEdgeBuildPageInTransactionEffect(tx, {
    scopeId: head.scopeId,
    definition: located.definition.edge,
    after: head.edgeCursor,
  });
  const sourceRowIds = Object.freeze(Array.from(new Set(
    page.edges.map((edge) => edge.sourceRowId),
  )));
  const expectedPage = yield* prepareExpectedSourcePageEffect(
    tx,
    head,
    located,
    sourceRowIds,
    false,
    options,
  );
  const bySource = new Map<AppRowIdHexV1, ReadonlyArray<
    Extract<AppRelationEdgeStorageAction, { readonly kind: "put" }>
  >>();
  for (const expected of expectedPage) {
    if (expected.current.kind !== "live") {
      return yield* edgeMismatch(head, expected.rowId, "edgeContents");
    }
    bySource.set(
      expected.rowId,
      yield* Effect.fromResult(
        putActionsResult(expected.prepared.actions).pipe(
          Result.mapError((cause) =>
            new ApplicationRelationBuildCorruptionError({
              reason: "storedHead",
              cause,
            })
          ),
        ),
      ),
    );
  }
  const matchedEdges: Array<Readonly<{
    readonly edge: StoredAppRelationEdge;
    readonly expected: Extract<
      AppRelationEdgeStorageAction,
      { readonly kind: "put" }
    >;
  }>> = [];
  for (const edge of page.edges) {
    const expectedActions = bySource.get(edge.sourceRowId);
    if (expectedActions === undefined) {
      return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
        reason: "storedHead",
      }));
    }
    const targetId = appDocumentIdV1FromRowIdentity({
      tableId: edge.targetTableId,
      rowId: edge.targetRowId,
    });
    const expected = expectedActions.find((action) =>
      action.occurrence.targetDocumentId === targetId
    );
    if (expected === undefined) {
      return yield* edgeMismatch(head, edge.sourceRowId, "edgeContents");
    }
    matchedEdges.push(Object.freeze({ edge, expected }));
  }
  yield* validateTargetRowIdsAtFrontierEffect(
    tx,
    head,
    located.definition.binding.targetTableId,
    Object.freeze(Array.from(new Set(
      matchedEdges.map(({ edge }) => edge.targetRowId),
    ))),
    options,
  );
  const endpointRequests = edgeEndpointRequests(page.edges);
  if (endpointRequests.length !== 0) {
    observeBuildQuery(
      options,
      "readEdgeEndpointVersionsBatch",
      endpointRequests.length,
    );
  }
  const endpointVersions = yield*
    readAppRelationEdgeBuildEndpointVersionsInTransactionEffect(tx, {
      scopeId: head.scopeId,
      definition: located.definition.edge,
      endpoints: endpointRequests,
    });
  const versionByEndpoint = new Map(endpointVersions.map((version) => [
    endpointKey(version.direction, version.endpointRowId),
    version.lastChangedCommitSeq,
  ]));
  const epochProjection = yield* Effect.fromResult(
    projectScopeEpochUuidV1Result(head.epoch).pipe(
      Result.mapError((cause) => new ApplicationRelationBuildCorruptionError({
        reason: "storedHead",
        cause,
      })),
    ),
  );
  for (const { edge, expected } of matchedEdges) {
    yield* verifyAppRelationEdgeBuildRowEffect({
      stored: edge,
      expected,
      frontierCommitSeq: head.frontierCommitSeq,
      writeEpochUuid: epochProjection.epochUuid,
    }).pipe(Effect.provideService(
      RelationOccurrenceSha256,
      port.occurrenceSha256,
    ));
    const outgoing = versionByEndpoint.get(endpointKey(
      "outgoing",
      edge.sourceRowId,
    ));
    const incoming = versionByEndpoint.get(endpointKey(
      "incoming",
      edge.targetRowId,
    ));
    if (
      outgoing !== head.frontierCommitSeq ||
      incoming !== head.frontierCommitSeq
    ) {
      return yield* edgeMismatch(
        head,
        edge.sourceRowId,
        "edgeEndpointVersion",
      );
    }
    yield* runFault(options, "afterValidationRow");
  }
  const nextCount = head.validatedEdgeCount + BigInt(page.edges.length);
  const updated = yield* updateBuildHeadEffect(
    tx,
    head,
    {
      lifecycle: page.exhausted
        ? "validating_versions"
        : "validating_edges",
      edgeCursor: page.exhausted ? null : page.nextFrontier,
      validatedEdgeCount: nextCount,
    },
    options,
  );
  return stepResult(updated, "advanced", {
    processedEdges: page.edges.length,
  });
});

const validateVersionPage = Effect.fn(
  "ApplicationRelationBuild.validateVersionPage",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  located: LocatedBuildDefinition,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<ApplicationRelationBuildStepResult, BuildTransactionFailure> {
  const page = yield* readAppRelationEdgeBuildVersionPageInTransactionEffect(
    tx,
    {
      scopeId: head.scopeId,
      definition: located.definition.edge,
      after: head.versionCursor,
    },
  );
  if (page.versions.length !== 0) {
    observeBuildQuery(
      options,
      "readVersionEndpointPresenceBatch",
      page.versions.length,
    );
  }
  const endpointPresence = yield*
    readAppRelationEdgeBuildEndpointPresenceInTransactionEffect(tx, {
      scopeId: head.scopeId,
      definition: located.definition.edge,
      endpoints: page.versions,
    });
  if (endpointPresence.length !== page.versions.length) {
    return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
      reason: "storedHead",
    }));
  }
  for (let index = 0; index < page.versions.length; index += 1) {
    const version = page.versions[index];
    if (version === undefined) {
      return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
        reason: "storedHead",
      }));
    }
    if (version.lastChangedCommitSeq !== head.frontierCommitSeq) {
      return yield* Effect.fail(new ApplicationRelationBuildMismatchError({
        scopeId: head.scopeId,
        edgeDefinitionId: head.edgeDefinitionId,
        lifecycle: "validating_versions",
        reason: "versionValue",
        rowId: version.endpointRowId,
      }));
    }
    if (endpointPresence[index] !== true) {
      return yield* Effect.fail(new ApplicationRelationBuildMismatchError({
        scopeId: head.scopeId,
        edgeDefinitionId: head.edgeDefinitionId,
        lifecycle: "validating_versions",
        reason: "orphanVersion",
        rowId: version.endpointRowId,
      }));
    }
    yield* runFault(options, "afterValidationRow");
  }
  const nextCount = head.validatedVersionCount + BigInt(page.versions.length);
  if (!page.exhausted) {
    const updated = yield* updateBuildHeadEffect(
      tx,
      head,
      {
        lifecycle: "validating_versions",
        versionCursor: page.nextFrontier,
        validatedVersionCount: nextCount,
      },
      options,
    );
    return stepResult(updated, "advanced", {
      processedVersions: page.versions.length,
    });
  }
  const enabled = yield* settleReadinessEffect(
    tx,
    { ...head, validatedVersionCount: nextCount },
    options,
  );
  return stepResult(enabled, "enabled", {
    processedVersions: page.versions.length,
  });
});

/**
 * Advances one validation-only semantic-reuse page inside the caller's locked
 * target transaction. This operation reads current rows and S12 projections;
 * it has no cleaning, backfill, edge-write, or version-write path.
 */
export const validateApplicationRelationSemanticPageInTransactionEffect =
  Effect.fn(
    "ApplicationRelationBuild.validateSemanticPageInTransaction",
  )(function* (
    port: ApplicationRelationBuildPort,
    tx: AppRowTransaction,
    authority: TrustedScopeAuthority,
    clock: ScopeClockRecord,
    definitions: LocatedApplicationRelationDefinitionSet,
    edgeDefinitionId: CatalogEdgeDefinitionId,
    progress: ApplicationRelationSemanticValidationProgress,
    options: ApplicationRelationBuildOptions = {},
  ): Effect.fn.Return<
    ApplicationRelationSemanticValidationPageResult,
    ApplicationRelationBuildTransactionError
  > {
    const state = yield* requirePortState(port);
    if (clock.scopeId !== authority.scopeId) {
      return yield* Effect.fail(new ApplicationRelationBuildUnavailableError({
        reason: "compositionMissing",
      }));
    }
    const located = yield* locateAuthorizedBuildDefinition(
      state,
      authority,
      definitions,
      edgeDefinitionId,
    );
    yield* Effect.fromResult(requireCurrentAuthorityResult(
      authority,
      edgeDefinitionId,
      clock,
    ));
    if (
      progress.relationOrdinal !==
        located.definition.binding.relationOrdinal ||
      progress.rootFrontierCommitSeq > clock.lastCommitSeq ||
      progress.frontierCommitSeq !== clock.lastCommitSeq ||
      progress.attemptFence < 1n ||
      !semanticProgressMatchesLifecycle(progress)
    ) {
      return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
        reason: "storedHead",
      }));
    }
    const head: ApplicationRelationBuildHead = Object.freeze({
      scopeId: authority.scopeId,
      edgeDefinitionId,
      deploymentId: definitions.deploymentId,
      relationId: located.definition.binding.relationId,
      sourceTableId: located.definition.binding.sourceTableId,
      targetTableId: located.definition.binding.targetTableId,
      semanticDefinitionSha256: located.semanticDefinitionSha256,
      physicalDefinitionSha256: located.physicalDefinitionSha256,
      storageGeneration: FLAREXDB_V1_STORAGE_GENERATION,
      storageGenerationFence: clock.storageGenerationFence,
      epoch: clock.epoch,
      frontierCommitSeq: clock.lastCommitSeq,
      attemptFence: progress.attemptFence,
      lifecycle: progress.lifecycle,
      sourceCursorRowId: progress.sourceCursorRowId,
      edgeCursor: progress.edgeCursor,
      versionCursor: progress.versionCursor,
      processedSourceCount: progress.validatedSourceCount,
      validatedSourceCount: progress.validatedSourceCount,
      validatedEdgeCount: progress.validatedEdgeCount,
      validatedVersionCount: progress.validatedVersionCount,
      readinessSha256: null,
    });
    switch (progress.lifecycle) {
      case "validating_sources":
        return yield* validateSemanticSourcePage(
          tx,
          head,
          located,
          state,
          progress,
          options,
        );
      case "validating_edges":
        return yield* validateSemanticEdgePage(
          tx,
          head,
          located,
          state,
          progress,
          options,
        );
      case "validating_versions":
        return yield* validateSemanticVersionPage(
          tx,
          head,
          located,
          progress,
          options,
        );
    }
  });

const validateSemanticSourcePage = Effect.fn(
  "ApplicationRelationBuild.validateSemanticSourcePage",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  located: LocatedBuildDefinition,
  port: ApplicationRelationBuildPortState,
  progress: ApplicationRelationSemanticValidationProgress,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<
  ApplicationRelationSemanticValidationPageResult,
  ApplicationRelationBuildTransactionError
> {
  const candidates = yield* readSourceValidationPageEffect(
    tx,
    head,
    located.definition,
  );
  const expectedPage = yield* prepareExpectedSourcePageEffect(
    tx,
    head,
    located,
    candidates,
    true,
    options,
  );
  let liveSourceCount = 0n;
  for (const expected of expectedPage) {
    const stored = yield* readAppRelationEdgeBuildSourceInTransactionEffect(
      tx,
      {
        scopeId: head.scopeId,
        definition: located.definition.edge,
        sourceRowId: expected.rowId,
      },
    );
    if (expected.current.kind === "live") liveSourceCount += 1n;
    yield* validateExactSourceContentsEffect(
      head,
      expected.prepared,
      stored,
      port,
      expected.rowId,
      {
        kind: "semanticCurrent",
        rootFrontierCommitSeq: progress.rootFrontierCommitSeq,
      },
    );
    yield* runFault(options, "afterValidationRow");
  }
  const exhausted = candidates.length < APPLICATION_RELATION_BUILD_SOURCE_PAGE_SIZE;
  return semanticPageResult(progress, head.frontierCommitSeq, {
    lifecycle: exhausted ? "validating_edges" : "validating_sources",
    sourceCursorRowId: exhausted
      ? null
      : candidates.at(-1) ?? progress.sourceCursorRowId,
    validatedSourceCount:
      progress.validatedSourceCount + liveSourceCount,
    processedSourceRows: candidates.length,
  });
});

const validateSemanticEdgePage = Effect.fn(
  "ApplicationRelationBuild.validateSemanticEdgePage",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  located: LocatedBuildDefinition,
  port: ApplicationRelationBuildPortState,
  progress: ApplicationRelationSemanticValidationProgress,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<
  ApplicationRelationSemanticValidationPageResult,
  ApplicationRelationBuildTransactionError
> {
  const page = yield* readAppRelationEdgeBuildPageInTransactionEffect(tx, {
    scopeId: head.scopeId,
    definition: located.definition.edge,
    after: progress.edgeCursor,
  });
  const sourceRowIds = Object.freeze(Array.from(new Set(
    page.edges.map((edge) => edge.sourceRowId),
  )));
  const expectedPage = yield* prepareExpectedSourcePageEffect(
    tx,
    head,
    located,
    sourceRowIds,
    false,
    options,
  );
  const bySource = new Map<AppRowIdHexV1, ReadonlyArray<
    Extract<AppRelationEdgeStorageAction, { readonly kind: "put" }>
  >>();
  for (const expected of expectedPage) {
    if (expected.current.kind !== "live") {
      return yield* edgeMismatch(head, expected.rowId, "edgeContents");
    }
    bySource.set(
      expected.rowId,
      yield* Effect.fromResult(
        putActionsResult(expected.prepared.actions).pipe(
          Result.mapError((cause) =>
            new ApplicationRelationBuildCorruptionError({
              reason: "storedHead",
              cause,
            })
          ),
        ),
      ),
    );
  }
  const matchedEdges: Array<Readonly<{
    readonly edge: StoredAppRelationEdge;
    readonly expected: Extract<
      AppRelationEdgeStorageAction,
      { readonly kind: "put" }
    >;
  }>> = [];
  for (const edge of page.edges) {
    const expectedActions = bySource.get(edge.sourceRowId);
    if (expectedActions === undefined) {
      return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
        reason: "storedHead",
      }));
    }
    const targetId = appDocumentIdV1FromRowIdentity({
      tableId: edge.targetTableId,
      rowId: edge.targetRowId,
    });
    const expected = expectedActions.find((action) =>
      action.occurrence.targetDocumentId === targetId
    );
    if (expected === undefined) {
      return yield* edgeMismatch(head, edge.sourceRowId, "edgeContents");
    }
    matchedEdges.push(Object.freeze({ edge, expected }));
  }
  yield* validateTargetRowIdsAtFrontierEffect(
    tx,
    head,
    located.definition.binding.targetTableId,
    Object.freeze(Array.from(new Set(
      matchedEdges.map(({ edge }) => edge.targetRowId),
    ))),
    options,
  );
  const endpointRequests = edgeEndpointRequests(page.edges);
  if (endpointRequests.length !== 0) {
    observeBuildQuery(
      options,
      "readEdgeEndpointVersionsBatch",
      endpointRequests.length,
    );
  }
  const endpointVersions = yield*
    readAppRelationEdgeBuildEndpointVersionsInTransactionEffect(tx, {
      scopeId: head.scopeId,
      definition: located.definition.edge,
      endpoints: endpointRequests,
    });
  const versionByEndpoint = new Map(endpointVersions.map((version) => [
    endpointKey(version.direction, version.endpointRowId),
    version.lastChangedCommitSeq,
  ]));
  const epochProjection = yield* Effect.fromResult(
    projectScopeEpochUuidV1Result(head.epoch).pipe(
      Result.mapError((cause) => new ApplicationRelationBuildCorruptionError({
        reason: "storedHead",
        cause,
      })),
    ),
  );
  for (const { edge, expected } of matchedEdges) {
    yield* verifyAppRelationEdgeCurrentRowEffect({
      stored: edge,
      expected,
      rootFrontierCommitSeq: progress.rootFrontierCommitSeq,
      currentFrontierCommitSeq: head.frontierCommitSeq,
      writeEpochUuid: epochProjection.epochUuid,
    }).pipe(Effect.provideService(
      RelationOccurrenceSha256,
      port.occurrenceSha256,
    ));
    const outgoing = versionByEndpoint.get(endpointKey(
      "outgoing",
      edge.sourceRowId,
    ));
    const incoming = versionByEndpoint.get(endpointKey(
      "incoming",
      edge.targetRowId,
    ));
    const minimumVersion = edge.commitSeq > progress.rootFrontierCommitSeq
      ? edge.commitSeq
      : progress.rootFrontierCommitSeq;
    if (
      outgoing === undefined || incoming === undefined ||
      outgoing < minimumVersion || outgoing > head.frontierCommitSeq ||
      incoming < minimumVersion || incoming > head.frontierCommitSeq
    ) {
      return yield* edgeMismatch(
        head,
        edge.sourceRowId,
        "edgeEndpointVersion",
      );
    }
    yield* runFault(options, "afterValidationRow");
  }
  return semanticPageResult(progress, head.frontierCommitSeq, {
    lifecycle: page.exhausted
      ? "validating_versions"
      : "validating_edges",
    edgeCursor: page.exhausted ? null : page.nextFrontier,
    validatedEdgeCount:
      progress.validatedEdgeCount + BigInt(page.edges.length),
    processedEdges: page.edges.length,
  });
});

const validateSemanticVersionPage = Effect.fn(
  "ApplicationRelationBuild.validateSemanticVersionPage",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  located: LocatedBuildDefinition,
  progress: ApplicationRelationSemanticValidationProgress,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<
  ApplicationRelationSemanticValidationPageResult,
  ApplicationRelationBuildTransactionError
> {
  const page = yield* readAppRelationEdgeBuildVersionPageInTransactionEffect(
    tx,
    {
      scopeId: head.scopeId,
      definition: located.definition.edge,
      after: progress.versionCursor,
    },
  );
  for (const version of page.versions) {
    if (
      version.lastChangedCommitSeq < progress.rootFrontierCommitSeq ||
      version.lastChangedCommitSeq > head.frontierCommitSeq
    ) {
      return yield* Effect.fail(new ApplicationRelationBuildMismatchError({
        scopeId: head.scopeId,
        edgeDefinitionId: head.edgeDefinitionId,
        lifecycle: "validating_versions",
        reason: "versionValue",
        rowId: version.endpointRowId,
      }));
    }
    yield* runFault(options, "afterValidationRow");
  }
  return semanticPageResult(progress, head.frontierCommitSeq, {
    lifecycle: page.exhausted ? "ready" : "validating_versions",
    versionCursor: page.exhausted ? null : page.nextFrontier,
    validatedVersionCount:
      progress.validatedVersionCount + BigInt(page.versions.length),
    processedVersions: page.versions.length,
  });
});

const readBuildHeadForUpdateEffect = Effect.fn(
  "ApplicationRelationBuild.readHeadForUpdate",
)(function* (
  tx: AppRowTransaction,
  scopeId: ScopeId,
  edgeDefinitionId: CatalogEdgeDefinitionId,
): Effect.fn.Return<
  ApplicationRelationBuildHead | null,
  ApplicationRelationBuildPersistenceError | ApplicationRelationBuildCorruptionError
> {
  const rows = yield* queryEffect(
    "readHead",
    tx.select().from(fxSystemEdgeDefinitionBuilds).where(and(
      eq(fxSystemEdgeDefinitionBuilds.scopeId, scopeId),
      eq(fxSystemEdgeDefinitionBuilds.edgeDefinitionId, edgeDefinitionId),
    )).limit(1).for("update"),
  );
  const row = rows[0];
  return row === undefined
    ? null
    : yield* Effect.fromResult(decodeBuildHeadResult(row));
});

const insertBuildHeadEffect = Effect.fn(
  "ApplicationRelationBuild.insertHead",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
  located: LocatedBuildDefinition,
): Effect.fn.Return<
  ApplicationRelationBuildHead,
  ApplicationRelationBuildPersistenceError | ApplicationRelationBuildCorruptionError
> {
  const definition = located.definition;
  const rows = yield* queryEffect(
    "insertHead",
    tx.insert(fxSystemEdgeDefinitionBuilds).values({
      scopeId: authority.scopeId,
      edgeDefinitionId: definition.edge.edgeDefinitionId,
      deploymentId: authority.deploymentId,
      relationId: definition.binding.relationId,
      sourceTableId: definition.binding.sourceTableId,
      targetTableId: definition.binding.targetTableId,
      semanticDefinitionSha256: copyBytes(located.semanticDefinitionSha256),
      physicalDefinitionSha256: copyBytes(located.physicalDefinitionSha256),
      storageGeneration: FLAREXDB_V1_STORAGE_GENERATION,
      storageGenerationFence: clock.storageGenerationFence,
      epoch: clock.epoch,
      frontierCommitSeq: clock.lastCommitSeq,
      attemptFence: 1n,
      lifecycle: "cleaning",
      cursorCodecVersion: APPLICATION_RELATION_BUILD_CURSOR_CODEC_VERSION,
      sourceCursorRowId: null,
      edgeCursorSourceRowId: null,
      edgeCursorTargetRowId: null,
      versionCursorDirection: null,
      versionCursorEndpointRowId: null,
      processedSourceCount: 0n,
      validatedSourceCount: 0n,
      validatedEdgeCount: 0n,
      validatedVersionCount: 0n,
      readinessSha256: null,
    }).onConflictDoNothing().returning(),
  );
  const row = rows[0];
  if (row === undefined) {
    return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
      reason: "concurrentStateChange",
    }));
  }
  return yield* Effect.fromResult(decodeBuildHeadResult(row));
});

const restartBuildHeadEffect = Effect.fn(
  "ApplicationRelationBuild.restartHead",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
  located: LocatedBuildDefinition,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<
  ApplicationRelationBuildHead,
  ApplicationRelationBuildPersistenceError | ApplicationRelationBuildCorruptionError
> {
  if (head.attemptFence >= MAX_BIGINT) {
    return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
      reason: "attemptFenceExhausted",
    }));
  }
  const rows = yield* queryEffect(
    "updateHead",
    tx.update(fxSystemEdgeDefinitionBuilds).set({
      deploymentId: authority.deploymentId,
      relationId: located.definition.binding.relationId,
      sourceTableId: located.definition.binding.sourceTableId,
      targetTableId: located.definition.binding.targetTableId,
      semanticDefinitionSha256: copyBytes(located.semanticDefinitionSha256),
      physicalDefinitionSha256: copyBytes(located.physicalDefinitionSha256),
      storageGeneration: FLAREXDB_V1_STORAGE_GENERATION,
      storageGenerationFence: clock.storageGenerationFence,
      epoch: clock.epoch,
      frontierCommitSeq: clock.lastCommitSeq,
      attemptFence: head.attemptFence + 1n,
      lifecycle: "cleaning",
      sourceCursorRowId: null,
      edgeCursorSourceRowId: null,
      edgeCursorTargetRowId: null,
      versionCursorDirection: null,
      versionCursorEndpointRowId: null,
      processedSourceCount: 0n,
      validatedSourceCount: 0n,
      validatedEdgeCount: 0n,
      validatedVersionCount: 0n,
      readinessSha256: null,
      updatedAt: sql`clock_timestamp()`,
    }).where(and(
      eq(fxSystemEdgeDefinitionBuilds.scopeId, head.scopeId),
      eq(
        fxSystemEdgeDefinitionBuilds.edgeDefinitionId,
        head.edgeDefinitionId,
      ),
      eq(fxSystemEdgeDefinitionBuilds.attemptFence, head.attemptFence),
      eq(fxSystemEdgeDefinitionBuilds.lifecycle, head.lifecycle),
    )).returning(),
  );
  const row = rows[0];
  if (row === undefined || rows.length !== 1) {
    return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
      reason: "concurrentStateChange",
    }));
  }
  yield* runFault(options, "afterLifecycleTransition");
  return yield* Effect.fromResult(decodeBuildHeadResult(row));
});

interface BuildHeadUpdate {
  readonly lifecycle?: ApplicationRelationBuildLifecycle;
  readonly sourceCursorRowId?: AppRowIdHexV1 | null;
  readonly edgeCursor?: AppRelationEdgeBuildFrontier | null;
  readonly versionCursor?: AppRelationEdgeBuildVersionFrontier | null;
  readonly processedSourceCount?: bigint;
  readonly validatedSourceCount?: bigint;
  readonly validatedEdgeCount?: bigint;
  readonly validatedVersionCount?: bigint;
  readonly readinessSha256?: Uint8Array | null;
}

const updateBuildHeadEffect = Effect.fn(
  "ApplicationRelationBuild.updateHead",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  update: BuildHeadUpdate,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<
  ApplicationRelationBuildHead,
  ApplicationRelationBuildPersistenceError | ApplicationRelationBuildCorruptionError
> {
  const sourceCursor = update.sourceCursorRowId === undefined
    ? head.sourceCursorRowId
    : update.sourceCursorRowId;
  const edgeCursor = update.edgeCursor === undefined
    ? head.edgeCursor
    : update.edgeCursor;
  const versionCursor = update.versionCursor === undefined
    ? head.versionCursor
    : update.versionCursor;
  const rows = yield* queryEffect(
    "updateHead",
    tx.update(fxSystemEdgeDefinitionBuilds).set({
      lifecycle: update.lifecycle ?? head.lifecycle,
      sourceCursorRowId: sourceCursor === null
        ? null
        : appRowIdHexV1ToBytes(sourceCursor),
      edgeCursorSourceRowId: edgeCursor === null
        ? null
        : appRowIdHexV1ToBytes(edgeCursor.sourceRowId),
      edgeCursorTargetRowId: edgeCursor === null
        ? null
        : appRowIdHexV1ToBytes(edgeCursor.targetRowId),
      versionCursorDirection: versionCursor?.direction ?? null,
      versionCursorEndpointRowId: versionCursor === null
        ? null
        : appRowIdHexV1ToBytes(versionCursor.endpointRowId),
      processedSourceCount:
        update.processedSourceCount ?? head.processedSourceCount,
      validatedSourceCount:
        update.validatedSourceCount ?? head.validatedSourceCount,
      validatedEdgeCount:
        update.validatedEdgeCount ?? head.validatedEdgeCount,
      validatedVersionCount:
        update.validatedVersionCount ?? head.validatedVersionCount,
      readinessSha256: update.readinessSha256 === undefined
        ? head.readinessSha256
        : update.readinessSha256,
      updatedAt: sql`clock_timestamp()`,
    }).where(and(
      eq(fxSystemEdgeDefinitionBuilds.scopeId, head.scopeId),
      eq(
        fxSystemEdgeDefinitionBuilds.edgeDefinitionId,
        head.edgeDefinitionId,
      ),
      eq(fxSystemEdgeDefinitionBuilds.attemptFence, head.attemptFence),
      eq(fxSystemEdgeDefinitionBuilds.lifecycle, head.lifecycle),
    )).returning(),
  );
  const row = rows[0];
  if (row === undefined || rows.length !== 1) {
    return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
      reason: "concurrentStateChange",
    }));
  }
  yield* runFault(options, "afterLifecycleTransition");
  return yield* Effect.fromResult(decodeBuildHeadResult(row));
});

function decodeBuildHeadResult(
  row: typeof fxSystemEdgeDefinitionBuilds.$inferSelect,
): Result.Result<
  ApplicationRelationBuildHead,
  ApplicationRelationBuildCorruptionError
> {
  return Result.gen(function* () {
    if (
      !isNonBlankString(row.scopeId) ||
      !isNonBlankString(row.deploymentId) ||
      !isUint8ArrayWithByteLength(row.semanticDefinitionSha256, 32) ||
      !isUint8ArrayWithByteLength(row.physicalDefinitionSha256, 32) ||
      row.attemptFence < 1n ||
      row.frontierCommitSeq < 0n ||
      row.processedSourceCount < 0n ||
      row.validatedSourceCount < 0n ||
      row.validatedEdgeCount < 0n ||
      row.validatedVersionCount < 0n ||
      !isBuildLifecycle(row.lifecycle) ||
      row.cursorCodecVersion !==
        APPLICATION_RELATION_BUILD_CURSOR_CODEC_VERSION
    ) {
      return yield* corruptHead();
    }
    const sourceCursorRowId = yield* decodeNullableRowIdResult(
      row.sourceCursorRowId,
    );
    const edgeSource = yield* decodeNullableRowIdResult(
      row.edgeCursorSourceRowId,
    );
    const edgeTarget = yield* decodeNullableRowIdResult(
      row.edgeCursorTargetRowId,
    );
    const versionEndpoint = yield* decodeNullableRowIdResult(
      row.versionCursorEndpointRowId,
    );
    const edgeCursor = edgeSource === null || edgeTarget === null
      ? null
      : Object.freeze({
        sourceRowId: edgeSource,
        targetRowId: edgeTarget,
      });
    const versionCursor =
      row.versionCursorDirection === null || versionEndpoint === null
        ? null
        : Object.freeze({
          direction: row.versionCursorDirection,
          endpointRowId: versionEndpoint,
        });
    if (
      (edgeSource === null) !== (edgeTarget === null) ||
      (row.versionCursorDirection === null) !==
        (versionEndpoint === null) ||
      (
        row.versionCursorDirection !== null &&
        row.versionCursorDirection !== "incoming" &&
        row.versionCursorDirection !== "outgoing"
      ) ||
      (
        row.lifecycle === "enabled" &&
        !isUint8ArrayWithByteLength(row.readinessSha256, 32)
      ) ||
      (
        row.lifecycle !== "enabled" &&
        row.readinessSha256 !== null
      ) ||
      !buildHeadProgressMatchesLifecycle({
        lifecycle: row.lifecycle,
        sourceCursorRowId,
        edgeCursor,
        versionCursor,
        processedSourceCount: row.processedSourceCount,
        validatedSourceCount: row.validatedSourceCount,
        validatedEdgeCount: row.validatedEdgeCount,
        validatedVersionCount: row.validatedVersionCount,
      })
    ) {
      return yield* corruptHead();
    }
    return Object.freeze({
      scopeId: row.scopeId,
      edgeDefinitionId: row.edgeDefinitionId,
      deploymentId: row.deploymentId,
      relationId: row.relationId,
      sourceTableId: row.sourceTableId,
      targetTableId: row.targetTableId,
      semanticDefinitionSha256: copyBytes(row.semanticDefinitionSha256),
      physicalDefinitionSha256: copyBytes(row.physicalDefinitionSha256),
      storageGeneration: row.storageGeneration,
      storageGenerationFence: row.storageGenerationFence,
      epoch: row.epoch,
      frontierCommitSeq: row.frontierCommitSeq,
      attemptFence: row.attemptFence,
      lifecycle: row.lifecycle,
      sourceCursorRowId,
      edgeCursor,
      versionCursor,
      processedSourceCount: row.processedSourceCount,
      validatedSourceCount: row.validatedSourceCount,
      validatedEdgeCount: row.validatedEdgeCount,
      validatedVersionCount: row.validatedVersionCount,
      readinessSha256: row.readinessSha256 === null
        ? null
        : copyBytes(row.readinessSha256),
    });
  });
}

const readSourcePointerPageEffect = Effect.fn(
  "ApplicationRelationBuild.readSourcePointerPage",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  tableId: LocatedApplicationRelationDefinition["binding"]["sourceTableId"],
  after: AppRowIdHexV1 | null,
): Effect.fn.Return<
  ReadonlyArray<AppRowIdHexV1>,
  ApplicationRelationBuildPersistenceError | ApplicationRelationBuildCorruptionError
> {
  const scope = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(head.scopeId).pipe(
      Result.mapError((cause) => new ApplicationRelationBuildCorruptionError({
        reason: "invalidRowIdentity",
        cause,
      })),
    ),
  );
  const rows = yield* queryEffect(
    "readSourcePage",
    tx.select({ rowId: fxAppRowCurrent.rowId })
      .from(fxAppRowCurrent)
      .where(and(
        eq(fxAppRowCurrent.scopeUuid, scope.scopeUuid),
        eq(fxAppRowCurrent.tableId, tableId),
        ...(after === null
          ? []
          : [gt(fxAppRowCurrent.rowId, appRowIdHexV1ToBytes(after))]),
      ))
      .orderBy(asc(fxAppRowCurrent.rowId))
      .limit(APPLICATION_RELATION_BUILD_SOURCE_PAGE_SIZE),
  );
  return yield* decodeRowIds(rows.map((row) => row.rowId));
});

const readSourceValidationPageEffect = Effect.fn(
  "ApplicationRelationBuild.readSourceValidationPage",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  definition: LocatedApplicationRelationDefinition,
): Effect.fn.Return<
  ReadonlyArray<AppRowIdHexV1>,
  ApplicationRelationBuildPersistenceError | ApplicationRelationBuildCorruptionError
> {
  const scope = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(head.scopeId).pipe(
      Result.mapError((cause) => new ApplicationRelationBuildCorruptionError({
        reason: "invalidRowIdentity",
        cause,
      })),
    ),
  );
  const afterBytes = head.sourceCursorRowId === null
    ? null
    : appRowIdHexV1ToBytes(head.sourceCursorRowId);
  const sourceRows = yield* queryEffect(
    "readSourcePage",
    tx.select({ rowId: fxAppRowCurrent.rowId })
      .from(fxAppRowCurrent)
      .where(and(
        eq(fxAppRowCurrent.scopeUuid, scope.scopeUuid),
        eq(fxAppRowCurrent.tableId, definition.binding.sourceTableId),
        ...(afterBytes === null
          ? []
          : [gt(fxAppRowCurrent.rowId, afterBytes)]),
      ))
      .orderBy(asc(fxAppRowCurrent.rowId))
      .limit(APPLICATION_RELATION_BUILD_SOURCE_PAGE_SIZE),
  );
  return yield* decodeRowIds(sourceRows.map((row) => row.rowId));
});

type ExpectedSourceCurrent =
  | Readonly<{
      readonly kind: "live";
      readonly document: LiveAppRowRevisionV1["document"];
    }>
  | Readonly<{ readonly kind: "notLive" }>;

interface ExpectedSource {
  readonly rowId: AppRowIdHexV1;
  readonly current: ExpectedSourceCurrent;
  readonly prepared: PreparedApplicationRelationCommit;
}

type CurrentRowStatus =
  | Readonly<{ readonly kind: "missing" }>
  | Readonly<{
      readonly kind: "live" | "tombstone";
      readonly commitSeq: CommitSeq;
    }>;

const prepareExpectedSourcePageEffect = Effect.fn(
  "ApplicationRelationBuild.prepareExpectedSourcePage",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  located: LocatedBuildDefinition,
  rowIds: ReadonlyArray<AppRowIdHexV1>,
  validateAllTargets: boolean,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<
  ReadonlyArray<ExpectedSource>,
  ApplicationRelationBuildTransactionError
> {
  const currentByRowId = yield* readCurrentSourcePageAtFrontierEffect(
    tx,
    head,
    located.definition.binding.sourceTableId,
    rowIds,
    options,
  );
  const expected = yield* Effect.forEach(rowIds, (rowId) => {
    const current = currentByRowId.get(rowId);
    return current === undefined
      ? Effect.fail(new ApplicationRelationBuildCorruptionError({
          reason: "currentRowEvidence",
        }))
      : prepareExpectedSourceEffect(head, located, rowId, current);
  }, { concurrency: 1 });
  if (validateAllTargets) {
    yield* validateExpectedTargetsAtFrontierEffect(
      tx,
      head,
      located,
      expected,
      options,
    );
  }
  return Object.freeze(expected);
});

const prepareExpectedSourceEffect = Effect.fn(
  "ApplicationRelationBuild.prepareExpectedSource",
)(function* (
  head: ApplicationRelationBuildHead,
  located: LocatedBuildDefinition,
  rowId: AppRowIdHexV1,
  current: ExpectedSourceCurrent,
): Effect.fn.Return<
  ExpectedSource,
  ApplicationRelationBuildTransactionError
> {
  const definition = located.definition;
  const documentId = appDocumentIdV1FromRowIdentity({
    tableId: definition.binding.sourceTableId,
    rowId,
  });
  const prepared = yield* Effect.fromResult(
    prepareApplicationRelationDefinitionBuildResult(
      located.definitions,
      definition.edge.edgeDefinitionId,
      [{
        documentId,
        tableId: definition.binding.sourceTableId,
        rowId,
        prior: null,
        final: current.kind === "live" ? current.document : null,
      }],
    ).pipe(Result.mapError((cause) => mapPrepareFailure(head, rowId, cause))),
  );
  const putActions = yield* Effect.fromResult(
    putActionsResult(prepared.actions).pipe(
      Result.mapError((cause) => new ApplicationRelationBuildCorruptionError({
        reason: "storedHead",
        cause,
      })),
    ),
  );
  if (putActions.length !== prepared.actions.length) {
    return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
      reason: "storedHead",
      cause: new Error("Null-to-current lowering emitted a non-put action."),
    }));
  }
  return Object.freeze({ rowId, current, prepared });
});

const readCurrentSourcePageAtFrontierEffect = Effect.fn(
  "ApplicationRelationBuild.readCurrentSourcePageAtFrontier",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  tableId: CatalogTableId,
  rowIds: ReadonlyArray<AppRowIdHexV1>,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<
  ReadonlyMap<AppRowIdHexV1, ExpectedSourceCurrent>,
  ApplicationRelationBuildTransactionError
> {
  const statuses = yield* readCurrentRowStatusesAtFrontierEffect(
    tx,
    head,
    tableId,
    rowIds,
    "readSourceCurrentBatch",
    options,
  );
  const liveRowIds = rowIds.filter((rowId) =>
    statuses.get(rowId)?.kind === "live"
  );
  let revisions: ReadonlyArray<LiveAppRowRevisionV1> = Object.freeze([]);
  if (liveRowIds.length !== 0) {
    observeBuildQuery(
      options,
      "readSourceRevisionBatch",
      liveRowIds.length,
    );
    revisions = yield* readLiveAppRowsAtSnapshotInTransactionEffect(tx, {
      scopeId: head.scopeId,
      tableId,
      rowIds: liveRowIds,
      snapshotCommitSeq: head.frontierCommitSeq,
    });
  }
  const revisionsByRowId = new Map(revisions.map((revision) => [
    revision.rowId,
    revision,
  ]));
  const currentByRowId = new Map<AppRowIdHexV1, ExpectedSourceCurrent>();
  for (const rowId of rowIds) {
    const status = statuses.get(rowId);
    if (status === undefined) {
      return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
        reason: "currentRowEvidence",
      }));
    }
    if (status.kind !== "live") {
      currentByRowId.set(rowId, Object.freeze({ kind: "notLive" }));
      continue;
    }
    const revision = revisionsByRowId.get(rowId);
    if (
      revision === undefined || revision.tableId !== tableId ||
      revision.commitSeq !== status.commitSeq
    ) {
      return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
        reason: "currentRowEvidence",
      }));
    }
    currentByRowId.set(rowId, Object.freeze({
      kind: "live",
      document: revision.document,
    }));
  }
  return currentByRowId;
});

const validateExpectedTargetsAtFrontierEffect = Effect.fn(
  "ApplicationRelationBuild.validateExpectedTargetsAtFrontier",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  located: LocatedBuildDefinition,
  expectedSources: ReadonlyArray<ExpectedSource>,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<void, ApplicationRelationBuildTransactionError> {
  const targetTableId = located.definition.binding.targetTableId;
  const targetRowIds: AppRowIdHexV1[] = [];
  const seen = new Set<AppRowIdHexV1>();
  for (const source of expectedSources) {
    for (const target of source.prepared.storedTargetChecks) {
      if (target.tableId !== targetTableId) {
        return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
          reason: "storedHead",
        }));
      }
      if (!seen.has(target.rowId)) {
        seen.add(target.rowId);
        targetRowIds.push(target.rowId);
      }
    }
  }
  return yield* validateTargetRowIdsAtFrontierEffect(
    tx,
    head,
    targetTableId,
    targetRowIds,
    options,
  );
});

const validateTargetRowIdsAtFrontierEffect = Effect.fn(
  "ApplicationRelationBuild.validateTargetRowsAtFrontier",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  targetTableId: CatalogTableId,
  targetRowIds: ReadonlyArray<AppRowIdHexV1>,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<void, ApplicationRelationBuildTransactionError> {
  const statuses = yield* readCurrentRowStatusesAtFrontierEffect(
    tx,
    head,
    targetTableId,
    targetRowIds,
    "readTargetCurrentBatch",
    options,
  );
  for (const rowId of targetRowIds) {
    if (statuses.get(rowId)?.kind !== "live") {
      return yield* Effect.fail(new ApplicationRelationBuildMismatchError({
        scopeId: head.scopeId,
        edgeDefinitionId: head.edgeDefinitionId,
        lifecycle: relationBuildValidationLifecycle(head),
        reason: "targetNotLive",
        rowId,
      }));
    }
  }
});

const readCurrentRowStatusesAtFrontierEffect = Effect.fn(
  "ApplicationRelationBuild.readCurrentRowsAtFrontier",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  tableId: CatalogTableId,
  rowIds: ReadonlyArray<AppRowIdHexV1>,
  queryName: "readSourceCurrentBatch" | "readTargetCurrentBatch",
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<
  ReadonlyMap<AppRowIdHexV1, CurrentRowStatus>,
  ApplicationRelationBuildTransactionError
> {
  if (new Set(rowIds).size !== rowIds.length) {
    return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
      reason: "currentRowEvidence",
    }));
  }
  const scope = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(head.scopeId).pipe(
      Result.mapError((cause) => new ApplicationRelationBuildCorruptionError({
        reason: "invalidRowIdentity",
        cause,
      })),
    ),
  );
  const statuses = new Map<AppRowIdHexV1, CurrentRowStatus>(rowIds.map(
    (rowId) => [rowId, Object.freeze({ kind: "missing" })],
  ));
  for (
    let offset = 0;
    offset < rowIds.length;
    offset += APP_RELATION_EDGE_BUILD_MAXIMUM_SOURCE_OCCURRENCES
  ) {
    const batch = rowIds.slice(
      offset,
      offset + APP_RELATION_EDGE_BUILD_MAXIMUM_SOURCE_OCCURRENCES,
    );
    observeBuildQuery(options, queryName, batch.length);
    const rows = yield* queryEffect(
      "readCurrentRows",
      tx.select({
        rowId: fxAppRowCurrent.rowId,
        pointerCommitSeq: fxAppRowCurrent.commitSeq,
        revisionCommitSeq: fxAppRowRevisions.commitSeq,
        isTombstone: fxAppRowRevisions.isTombstone,
      }).from(fxAppRowCurrent).leftJoin(
        fxAppRowRevisions,
        and(
          eq(fxAppRowRevisions.scopeUuid, fxAppRowCurrent.scopeUuid),
          eq(fxAppRowRevisions.tableId, fxAppRowCurrent.tableId),
          eq(fxAppRowRevisions.rowId, fxAppRowCurrent.rowId),
          eq(fxAppRowRevisions.commitSeq, fxAppRowCurrent.commitSeq),
        ),
      ).where(and(
        eq(fxAppRowCurrent.scopeUuid, scope.scopeUuid),
        eq(fxAppRowCurrent.tableId, tableId),
        inArray(fxAppRowCurrent.rowId, batch.map(appRowIdHexV1ToBytes)),
      )),
    );
    for (const row of rows) {
      const rowId = yield* Effect.fromResult(
        appRowIdHexV1FromBytesResult(row.rowId).pipe(
          Result.mapError((cause) =>
            new ApplicationRelationBuildCorruptionError({
              reason: "invalidRowIdentity",
              cause,
            })
          ),
        ),
      );
      const prior = statuses.get(rowId);
      if (
        prior === undefined || prior.kind !== "missing" ||
        row.revisionCommitSeq === null ||
        row.pointerCommitSeq !== row.revisionCommitSeq ||
        typeof row.isTombstone !== "boolean"
      ) {
        return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
          reason: "currentRowEvidence",
        }));
      }
      if (row.pointerCommitSeq > head.frontierCommitSeq) {
        return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
          reason: "futureCurrentRevision",
          cause: new Error(
            `Current row ${tableId}:${rowId} is newer than the fixed frontier.`,
          ),
        }));
      }
      statuses.set(rowId, Object.freeze({
        kind: row.isTombstone ? "tombstone" : "live",
        commitSeq: row.pointerCommitSeq,
      }));
    }
  }
  return statuses;
});

const validateExactSourceContentsEffect = Effect.fn(
  "ApplicationRelationBuild.validateExactSourceContents",
)(function* (
  head: ApplicationRelationBuildHead,
  prepared: PreparedApplicationRelationCommit,
  stored: ReadonlyArray<StoredAppRelationEdge>,
  port: ApplicationRelationBuildPortState,
  rowId: AppRowIdHexV1,
  provenance: ApplicationRelationSourceValidationProvenance,
): Effect.fn.Return<void, ApplicationRelationBuildTransactionError> {
  const expected = yield* Effect.fromResult(
    putActionsResult(prepared.actions).pipe(
      Result.mapError((cause) => new ApplicationRelationBuildCorruptionError({
        reason: "storedHead",
        cause,
      })),
    ),
  );
  if (expected.length !== stored.length) {
    return yield* edgeMismatch(head, rowId, "sourceContents");
  }
  const byTarget = new Map(stored.map((edge) => [edge.targetRowId, edge]));
  const epochProjection = yield* Effect.fromResult(
    projectScopeEpochUuidV1Result(head.epoch).pipe(
      Result.mapError((cause) => new ApplicationRelationBuildCorruptionError({
        reason: "storedHead",
        cause,
      })),
    ),
  );
  for (const action of expected) {
    const targetId = action.occurrence.targetDocumentId;
    const targetRowId = yield* Effect.fromResult(
      decodeAppDocumentIdentityV1Result(targetId).pipe(
        Result.map(
          (identity) => identity.rowId,
        ),
        Result.mapError((cause) =>
          new ApplicationRelationBuildCorruptionError({
            reason: "storedHead",
            cause,
          })
        ),
      ),
    );
    const actual = byTarget.get(targetRowId);
    if (actual === undefined) {
      return yield* edgeMismatch(head, rowId, "sourceContents");
    }
    const verification = provenance.kind === "freshBuild"
      ? verifyAppRelationEdgeBuildRowEffect({
          stored: actual,
          expected: action,
          frontierCommitSeq: head.frontierCommitSeq,
          writeEpochUuid: epochProjection.epochUuid,
        })
      : verifyAppRelationEdgeCurrentRowEffect({
          stored: actual,
          expected: action,
          rootFrontierCommitSeq: provenance.rootFrontierCommitSeq,
          currentFrontierCommitSeq: head.frontierCommitSeq,
          writeEpochUuid: epochProjection.epochUuid,
        });
    yield* verification.pipe(Effect.provideService(
      RelationOccurrenceSha256,
      port.occurrenceSha256,
    ));
    byTarget.delete(targetRowId);
  }
  if (byTarget.size !== 0) {
    return yield* edgeMismatch(head, rowId, "sourceContents");
  }
});

type ApplicationRelationSourceValidationProvenance =
  | Readonly<{ readonly kind: "freshBuild" }>
  | Readonly<{
      readonly kind: "semanticCurrent";
      readonly rootFrontierCommitSeq: CommitSeq;
    }>;

function putActionsResult(
  actions: ReadonlyArray<AppRelationEdgeStorageAction>,
): Result.Result<
  ReadonlyArray<Extract<AppRelationEdgeStorageAction, { readonly kind: "put" }>>,
  Error
> {
  const puts: Extract<AppRelationEdgeStorageAction, { readonly kind: "put" }>[] = [];
  for (const action of actions) {
    if (action.kind !== "put") {
      return Result.fail(new Error("Expected only put actions."));
    }
    puts.push(action);
  }
  return Result.succeed(Object.freeze(puts));
}

const settleReadinessEffect = Effect.fn(
  "ApplicationRelationBuild.settleReadiness",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
  options: ApplicationRelationBuildOptions,
): Effect.fn.Return<ApplicationRelationBuildHead, BuildTransactionFailure> {
  const timestampRows = yield* queryEffect(
    "readReceipt",
    tx.select({ settledAt: sql<Date>`clock_timestamp()` })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, head.scopeId))
      .limit(1),
  );
  const settledAt = databaseTimestampFromUnknown(timestampRows[0]?.settledAt);
  if (settledAt === null) {
    return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
      reason: "receiptEvidence",
    }));
  }
  const canonical = yield* canonicalReadinessEffect(head, settledAt);
  let readinessSha256 = canonical.sha256;
  const inserted = yield* queryEffect(
    "insertReceipt",
    tx.insert(fxSystemEdgeDefinitionReadiness).values({
      scopeId: head.scopeId,
      edgeDefinitionId: head.edgeDefinitionId,
      attemptFence: head.attemptFence,
      deploymentId: head.deploymentId,
      relationId: head.relationId,
      sourceTableId: head.sourceTableId,
      targetTableId: head.targetTableId,
      semanticDefinitionSha256: copyBytes(head.semanticDefinitionSha256),
      physicalDefinitionSha256: copyBytes(head.physicalDefinitionSha256),
      storageGeneration: head.storageGeneration,
      storageGenerationFence: head.storageGenerationFence,
      epoch: head.epoch,
      frontierCommitSeq: head.frontierCommitSeq,
      receiptCodecVersion:
        APPLICATION_RELATION_READINESS_RECEIPT_CODEC_VERSION,
      receiptBytes: copyBytes(canonical.canonicalBytes),
      readinessSha256: copyBytes(canonical.sha256),
      sourceCount: head.validatedSourceCount,
      edgeCount: head.validatedEdgeCount,
      versionCount: head.validatedVersionCount,
      settledAt,
    }).onConflictDoNothing().returning({
      readinessSha256: fxSystemEdgeDefinitionReadiness.readinessSha256,
    }),
  );
  if (inserted[0] === undefined) {
    const replay = yield* readReceiptRowEffect(tx, head);
    if (replay === null) {
      return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
        reason: "receiptEvidence",
      }));
    }
    const evidence = yield* verifyReceiptRowEffect(head, replay);
    readinessSha256 = evidence.sha256;
  }
  yield* runFault(options, "afterReceiptInsert");
  return yield* updateBuildHeadEffect(
    tx,
    head,
    {
      lifecycle: "enabled",
      versionCursor: null,
      validatedVersionCount: head.validatedVersionCount,
      readinessSha256,
    },
    options,
  );
});

const readinessInTransaction = Effect.fn(
  "ApplicationRelationBuild.readinessInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  located: LocatedBuildDefinition,
): Effect.fn.Return<
  ApplicationRelationReadinessEvidence | null,
  BuildTransactionFailure
> {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  return yield* validateReadinessUnderLockedClock(
    tx,
    authority,
    clock,
    located,
  );
});

const validateReadinessUnderLockedClock = Effect.fn(
  "ApplicationRelationBuild.validateReadinessUnderLockedClock",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
  located: LocatedBuildDefinition,
): Effect.fn.Return<
  ApplicationRelationReadinessEvidence | null,
  ApplicationRelationBuildReadinessValidationError
> {
  yield* Effect.fromResult(requireCurrentAuthorityResult(
    authority,
    located.definition.edge.edgeDefinitionId,
    clock,
  ));
  return yield* validateStoredReadinessForLocatedDefinition(
    tx,
    authority.scopeId,
    located,
    clock,
  );
});

const validateStoredReadinessForLocatedDefinition = Effect.fn(
  "ApplicationRelationBuild.validateStoredReadinessForLocatedDefinition",
)(function* (
  tx: AppRowTransaction,
  scopeId: ScopeId,
  located: LocatedBuildDefinition,
  currentClock?: ScopeClockRecord,
): Effect.fn.Return<
  ApplicationRelationReadinessEvidence | null,
  ApplicationRelationBuildReadinessValidationError
> {
  const head = yield* readBuildHeadForUpdateEffect(
    tx,
    scopeId,
    located.definition.edge.edgeDefinitionId,
  );
  if (head === null) return null;
  yield* Effect.fromResult(requireImmutableDefinitionResult(head, located));
  if (
    head.lifecycle !== "enabled" ||
    head.readinessSha256 === null ||
    !headMatchesBinding(head, located) ||
    (currentClock !== undefined && (
      head.frontierCommitSeq !== currentClock.lastCommitSeq ||
      !headMatchesAuthority(head, currentClock)
    ))
  ) {
    return null;
  }
  const row = yield* readReceiptRowEffect(tx, head);
  if (row === null) {
    return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
      reason: "receiptEvidence",
    }));
  }
  const evidence = yield* verifyReceiptRowEffect(head, row);
  if (!bytesEqual(head.readinessSha256, evidence.sha256)) {
    return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
      reason: "receiptEvidence",
    }));
  }
  return evidence;
});

type ReadinessRow = typeof fxSystemEdgeDefinitionReadiness.$inferSelect;

function buildHeadFromReadinessRowResult(
  row: ReadinessRow,
): Result.Result<
  ApplicationRelationBuildHead,
  ApplicationRelationBuildCorruptionError
> {
  if (
    !isNonBlankString(row.scopeId) ||
    !isNonBlankString(row.deploymentId) ||
    !Number.isSafeInteger(row.relationId) || row.relationId < 1 ||
    !Number.isSafeInteger(row.edgeDefinitionId) ||
    row.edgeDefinitionId < 1 ||
    !Number.isSafeInteger(row.sourceTableId) || row.sourceTableId < 1 ||
    !Number.isSafeInteger(row.targetTableId) || row.targetTableId < 1 ||
    !isUint8ArrayWithByteLength(row.semanticDefinitionSha256, 32) ||
    !isUint8ArrayWithByteLength(row.physicalDefinitionSha256, 32) ||
    row.storageGeneration !== FLAREXDB_V1_STORAGE_GENERATION ||
    row.storageGenerationFence < 1n ||
    !isNonBlankString(row.epoch) ||
    row.frontierCommitSeq < 0n ||
    row.attemptFence < 1n ||
    row.sourceCount < 0n ||
    row.edgeCount < 0n ||
    row.versionCount < 0n ||
    !isUint8ArrayWithByteLength(row.readinessSha256, 32)
  ) {
    return Result.fail(new ApplicationRelationBuildCorruptionError({
      reason: "receiptEvidence",
    }));
  }
  return Result.succeed(Object.freeze({
    scopeId: row.scopeId,
    edgeDefinitionId: row.edgeDefinitionId,
    deploymentId: row.deploymentId,
    relationId: row.relationId,
    sourceTableId: row.sourceTableId,
    targetTableId: row.targetTableId,
    semanticDefinitionSha256: copyBytes(row.semanticDefinitionSha256),
    physicalDefinitionSha256: copyBytes(row.physicalDefinitionSha256),
    storageGeneration: row.storageGeneration,
    storageGenerationFence: row.storageGenerationFence,
    epoch: row.epoch,
    frontierCommitSeq: row.frontierCommitSeq,
    attemptFence: row.attemptFence,
    lifecycle: "enabled",
    sourceCursorRowId: null,
    edgeCursor: null,
    versionCursor: null,
    processedSourceCount: row.sourceCount,
    validatedSourceCount: row.sourceCount,
    validatedEdgeCount: row.edgeCount,
    validatedVersionCount: row.versionCount,
    readinessSha256: copyBytes(row.readinessSha256),
  }));
}

const readReceiptRowEffect = Effect.fn(
  "ApplicationRelationBuild.readReceipt",
)(function* (
  tx: AppRowTransaction,
  head: ApplicationRelationBuildHead,
): Effect.fn.Return<
  ReadinessRow | null,
  ApplicationRelationBuildPersistenceError
> {
  const rows = yield* queryEffect(
    "readReceipt",
    tx.select().from(fxSystemEdgeDefinitionReadiness).where(and(
      eq(fxSystemEdgeDefinitionReadiness.scopeId, head.scopeId),
      eq(
        fxSystemEdgeDefinitionReadiness.edgeDefinitionId,
        head.edgeDefinitionId,
      ),
      eq(
        fxSystemEdgeDefinitionReadiness.attemptFence,
        head.attemptFence,
      ),
    )).limit(1),
  );
  return rows[0] ?? null;
});

const verifyReceiptRowEffect = Effect.fn(
  "ApplicationRelationBuild.verifyReceipt",
)(function* (
  head: ApplicationRelationBuildHead,
  row: ReadinessRow,
): Effect.fn.Return<
  ApplicationRelationReadinessEvidence,
  ApplicationRelationBuildCorruptionError |
    ApplicationRelationBuildPersistenceError
> {
  const settledAt = copyFiniteDate(row.settledAt);
  if (
    settledAt === undefined ||
    row.scopeId !== head.scopeId ||
    row.edgeDefinitionId !== head.edgeDefinitionId ||
    row.attemptFence !== head.attemptFence ||
    row.deploymentId !== head.deploymentId ||
    row.relationId !== head.relationId ||
    row.sourceTableId !== head.sourceTableId ||
    row.targetTableId !== head.targetTableId ||
    !isUint8ArrayWithByteLength(row.semanticDefinitionSha256, 32) ||
    !isUint8ArrayWithByteLength(row.physicalDefinitionSha256, 32) ||
    !bytesEqual(
      row.semanticDefinitionSha256,
      head.semanticDefinitionSha256,
    ) ||
    !bytesEqual(
      row.physicalDefinitionSha256,
      head.physicalDefinitionSha256,
    ) ||
    row.storageGeneration !== head.storageGeneration ||
    row.storageGenerationFence !== head.storageGenerationFence ||
    row.epoch !== head.epoch ||
    row.frontierCommitSeq !== head.frontierCommitSeq ||
    row.receiptCodecVersion !==
      APPLICATION_RELATION_READINESS_RECEIPT_CODEC_VERSION ||
    row.sourceCount !== head.validatedSourceCount ||
    row.edgeCount !== head.validatedEdgeCount ||
    row.versionCount !== head.validatedVersionCount ||
    !isUint8ArrayWithByteLength(row.readinessSha256, 32) ||
    !isUint8Array(row.receiptBytes) ||
    row.receiptBytes.byteLength < 1 ||
    row.receiptBytes.byteLength >
      APPLICATION_RELATION_READINESS_RECEIPT_MAXIMUM_BYTES
  ) {
    return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
      reason: "receiptEvidence",
    }));
  }
  const canonical = yield* canonicalReadinessEffect(head, settledAt);
  if (
    !bytesEqual(row.receiptBytes, canonical.canonicalBytes) ||
    !bytesEqual(row.readinessSha256, canonical.sha256)
  ) {
    return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
      reason: "receiptEvidence",
    }));
  }
  return yield* Effect.fromResult(readinessEvidenceResult(
    canonical.receipt,
    canonical.canonicalBytes,
    canonical.sha256,
    settledAt,
  ));
});

interface CanonicalReadiness {
  readonly receipt: ApplicationRelationReadinessReceipt;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

const canonicalReadinessEffect = Effect.fn(
  "ApplicationRelationBuild.canonicalReadiness",
)(function* (
  head: ApplicationRelationBuildHead,
  settledAt: Date,
): Effect.fn.Return<
  CanonicalReadiness,
  ApplicationRelationBuildCorruptionError |
    ApplicationRelationBuildPersistenceError
> {
  const ownedSettledAt = copyFiniteDate(settledAt);
  if (ownedSettledAt === undefined) {
    return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
      reason: "receiptEvidence",
    }));
  }
  const receiptJson = {
    format: "flarex.application-relation-readiness",
    version: APPLICATION_RELATION_READINESS_RECEIPT_CODEC_VERSION,
    scopeId: head.scopeId,
    deploymentId: head.deploymentId,
    relationId: head.relationId,
    edgeDefinitionId: head.edgeDefinitionId,
    sourceTableId: head.sourceTableId,
    targetTableId: head.targetTableId,
    semanticDefinitionSha256: encodeBytesToLowercaseHex(
      head.semanticDefinitionSha256,
    ),
    physicalDefinitionSha256: encodeBytesToLowercaseHex(
      head.physicalDefinitionSha256,
    ),
    storageGeneration: head.storageGeneration,
    storageGenerationFence: head.storageGenerationFence.toString(),
    epoch: head.epoch,
    frontierCommitSeq: head.frontierCommitSeq.toString(),
    attemptFence: head.attemptFence.toString(),
    sourceCount: head.validatedSourceCount.toString(),
    edgeCount: head.validatedEdgeCount.toString(),
    versionCount: head.validatedVersionCount.toString(),
    settledAt: ownedSettledAt.toISOString(),
  } satisfies ApplicationRelationReadinessReceipt & JsonObject;
  const receipt: ApplicationRelationReadinessReceipt = Object.freeze(
    receiptJson,
  );
  const canonicalText = encodeCanonicalJson(
    receiptJson,
    (issue) => {
      throw new Error(
        `Typed relation readiness lost JSON: ${issue.reason}.`,
      );
    },
  );
  const canonicalBytes = TEXT_ENCODER.encode(canonicalText);
  if (
    canonicalBytes.byteLength < 1 ||
    canonicalBytes.byteLength >
      APPLICATION_RELATION_READINESS_RECEIPT_MAXIMUM_BYTES
  ) {
    return yield* Effect.fail(new ApplicationRelationBuildCorruptionError({
      reason: "receiptEvidence",
    }));
  }
  const sha256 = yield* digestReceiptEffect(canonicalBytes);
  return Object.freeze({
    receipt,
    canonicalBytes: copyBytes(canonicalBytes),
    sha256,
  });
});

function readinessEvidenceResult(
  receipt: ApplicationRelationReadinessReceipt,
  canonicalBytes: Uint8Array,
  sha256: Uint8Array,
  settledAt: Date,
): Result.Result<
  ApplicationRelationReadinessEvidence,
  ApplicationRelationBuildCorruptionError
> {
  const stableBytes = copyBytes(canonicalBytes);
  const stableSha256 = copyBytes(sha256);
  const stableSettledAt = copyFiniteDate(settledAt);
  if (stableSettledAt === undefined) {
    return Result.fail(new ApplicationRelationBuildCorruptionError({
      reason: "receiptEvidence",
    }));
  }
  return Result.succeed(Object.freeze({
    receipt,
    get canonicalBytes(): Uint8Array {
      return copyBytes(stableBytes);
    },
    get sha256(): Uint8Array {
      return copyBytes(stableSha256);
    },
    get settledAt(): Date {
      return new Date(stableSettledAt.getTime());
    },
  }));
}

function digestReceiptEffect(
  bytes: Uint8Array,
): Effect.Effect<Uint8Array, ApplicationRelationBuildPersistenceError> {
  return Effect.tryPromise({
    try: async () => new Uint8Array(await globalThis.crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(bytes),
    )),
    catch: (cause) => new ApplicationRelationBuildPersistenceError({
      operation: "digestReceipt",
      retryable: true,
      cause,
    }),
  });
}

function requireCurrentAuthorityResult(
  expected: TrustedScopeAuthority,
  edgeDefinitionId: CatalogEdgeDefinitionId,
  current: ScopeClockRecord,
): Result.Result<void, ApplicationRelationBuildStaleAuthorityError> {
  for (const reason of [
    "storageGeneration",
    "storageGenerationFence",
    "epoch",
  ] as const) {
    if (expected[reason] !== current[reason]) {
      return Result.fail(new ApplicationRelationBuildStaleAuthorityError({
        scopeId: expected.scopeId,
        edgeDefinitionId,
        reason,
      }));
    }
  }
  if (current.storageGeneration !== FLAREXDB_V1_STORAGE_GENERATION) {
    return Result.fail(new ApplicationRelationBuildStaleAuthorityError({
      scopeId: expected.scopeId,
      edgeDefinitionId,
      reason: "storageGeneration",
    }));
  }
  return Result.succeed(undefined);
}

function requireImmutableDefinitionResult(
  head: ApplicationRelationBuildHead,
  located: LocatedBuildDefinition,
): Result.Result<void, ApplicationRelationBuildCorruptionError> {
  const definition = located.definition;
  return head.deploymentId === located.definitions.deploymentId &&
      head.relationId === definition.binding.relationId &&
      head.sourceTableId === definition.binding.sourceTableId &&
      head.targetTableId === definition.binding.targetTableId &&
      bytesEqual(
        head.physicalDefinitionSha256,
        located.physicalDefinitionSha256,
      )
    ? Result.succeed(undefined)
    : Result.fail(new ApplicationRelationBuildCorruptionError({
      reason: "immutableDefinition",
    }));
}

function headMatchesBinding(
  head: ApplicationRelationBuildHead,
  located: LocatedBuildDefinition,
): boolean {
  return bytesEqual(
    head.semanticDefinitionSha256,
    located.semanticDefinitionSha256,
  );
}

function headMatchesAuthority(
  head: ApplicationRelationBuildHead,
  clock: ScopeClockRecord,
): boolean {
  return head.storageGeneration === clock.storageGeneration &&
    head.storageGenerationFence === clock.storageGenerationFence &&
    head.epoch === clock.epoch;
}

function mapPrepareFailure(
  head: ApplicationRelationBuildHead,
  rowId: AppRowIdHexV1,
  cause:
    | ApplicationRelationConstraintError
    | ApplicationRelationCommitResourceExhaustionError
    | ApplicationRelationCommitCorruptionError
    | ApplicationRelationTargetNotLiveError,
): ApplicationRelationBuildMismatchError |
  ApplicationRelationBuildCorruptionError {
  if (cause instanceof ApplicationRelationConstraintError) {
    return new ApplicationRelationBuildMismatchError({
      scopeId: head.scopeId,
      edgeDefinitionId: head.edgeDefinitionId,
      lifecycle: head.lifecycle === "backfilling"
        ? "backfilling"
        : head.lifecycle === "validating_sources"
        ? "validating_sources"
        : "validating_edges",
      reason: "invalidSourceValue",
      rowId,
      cause,
    });
  }
  if (cause instanceof ApplicationRelationTargetNotLiveError) {
    return new ApplicationRelationBuildMismatchError({
      scopeId: head.scopeId,
      edgeDefinitionId: head.edgeDefinitionId,
      lifecycle: head.lifecycle === "backfilling"
        ? "backfilling"
        : head.lifecycle === "validating_sources"
        ? "validating_sources"
        : "validating_edges",
      reason: "targetNotLive",
      rowId,
      cause,
    });
  }
  if (cause instanceof ApplicationRelationCommitResourceExhaustionError) {
    return new ApplicationRelationBuildCorruptionError({
      reason: "lowererResourceExhaustion",
      cause,
    });
  }
  return new ApplicationRelationBuildCorruptionError({
    reason: "storedHead",
    cause,
  });
}

function decodeRowIds(
  values: ReadonlyArray<unknown>,
): Effect.Effect<
  ReadonlyArray<AppRowIdHexV1>,
  ApplicationRelationBuildCorruptionError
> {
  return Effect.forEach(values, (value) =>
    Effect.fromResult(appRowIdHexV1FromBytesResult(value).pipe(
      Result.mapError((cause) => new ApplicationRelationBuildCorruptionError({
        reason: "invalidRowIdentity",
        cause,
      })),
    )), { concurrency: 1 }).pipe(
      Effect.map((rowIds) => Object.freeze(rowIds)),
    );
}

function decodeNullableRowIdResult(
  value: unknown,
): Result.Result<
  AppRowIdHexV1 | null,
  ApplicationRelationBuildCorruptionError
> {
  return value === null
    ? Result.succeed(null)
    : appRowIdHexV1FromBytesResult(value).pipe(
      Result.mapError((cause) => new ApplicationRelationBuildCorruptionError({
        reason: "storedHead",
        cause,
      })),
    );
}

function isBuildLifecycle(
  value: unknown,
): value is ApplicationRelationBuildLifecycle {
  return value === "cleaning" || value === "backfilling" ||
    value === "validating_sources" || value === "validating_edges" ||
    value === "validating_versions" || value === "enabled";
}

interface BuildHeadProgress {
  readonly lifecycle: ApplicationRelationBuildLifecycle;
  readonly sourceCursorRowId: AppRowIdHexV1 | null;
  readonly edgeCursor: AppRelationEdgeBuildFrontier | null;
  readonly versionCursor: AppRelationEdgeBuildVersionFrontier | null;
  readonly processedSourceCount: bigint;
  readonly validatedSourceCount: bigint;
  readonly validatedEdgeCount: bigint;
  readonly validatedVersionCount: bigint;
}

function buildHeadProgressMatchesLifecycle(
  progress: BuildHeadProgress,
): boolean {
  const noSourceCursor = progress.sourceCursorRowId === null;
  const noEdgeCursor = progress.edgeCursor === null;
  const noVersionCursor = progress.versionCursor === null;
  switch (progress.lifecycle) {
    case "cleaning":
      return noSourceCursor && noEdgeCursor && noVersionCursor &&
        progress.processedSourceCount === 0n &&
        progress.validatedSourceCount === 0n &&
        progress.validatedEdgeCount === 0n &&
        progress.validatedVersionCount === 0n;
    case "backfilling":
      return noEdgeCursor && noVersionCursor &&
        progress.validatedSourceCount === 0n &&
        progress.validatedEdgeCount === 0n &&
        progress.validatedVersionCount === 0n;
    case "validating_sources":
      return noEdgeCursor && noVersionCursor &&
        progress.validatedSourceCount <= progress.processedSourceCount &&
        progress.validatedEdgeCount === 0n &&
        progress.validatedVersionCount === 0n;
    case "validating_edges":
      return noSourceCursor && noVersionCursor &&
        progress.validatedSourceCount === progress.processedSourceCount &&
        progress.validatedVersionCount === 0n;
    case "validating_versions":
    case "enabled":
      return noSourceCursor && noEdgeCursor &&
        (progress.lifecycle !== "enabled" || noVersionCursor) &&
        progress.validatedSourceCount === progress.processedSourceCount;
  }
}

function semanticProgressMatchesLifecycle(
  progress: ApplicationRelationSemanticValidationProgress,
): boolean {
  if (
    !Number.isSafeInteger(progress.relationOrdinal) ||
    progress.relationOrdinal < 1 ||
    progress.validatedSourceCount < 0n ||
    progress.validatedEdgeCount < 0n ||
    progress.validatedVersionCount < 0n
  ) {
    return false;
  }
  switch (progress.lifecycle) {
    case "validating_sources":
      return progress.edgeCursor === null &&
        progress.versionCursor === null &&
        progress.validatedEdgeCount === 0n &&
        progress.validatedVersionCount === 0n;
    case "validating_edges":
      return progress.sourceCursorRowId === null &&
        progress.versionCursor === null &&
        progress.validatedVersionCount === 0n;
    case "validating_versions":
      return progress.sourceCursorRowId === null &&
        progress.edgeCursor === null;
  }
}

interface SemanticPageUpdate {
  readonly lifecycle:
    ApplicationRelationSemanticValidationPageResult["lifecycle"];
  readonly sourceCursorRowId?: AppRowIdHexV1 | null;
  readonly edgeCursor?: AppRelationEdgeBuildFrontier | null;
  readonly versionCursor?: AppRelationEdgeBuildVersionFrontier | null;
  readonly validatedSourceCount?: bigint;
  readonly validatedEdgeCount?: bigint;
  readonly validatedVersionCount?: bigint;
  readonly processedSourceRows?: number;
  readonly processedEdges?: number;
  readonly processedVersions?: number;
}

function semanticPageResult(
  progress: ApplicationRelationSemanticValidationProgress,
  frontierCommitSeq: CommitSeq,
  update: SemanticPageUpdate,
): ApplicationRelationSemanticValidationPageResult {
  return Object.freeze({
    relationOrdinal: progress.relationOrdinal,
    lifecycle: update.lifecycle,
    rootFrontierCommitSeq: progress.rootFrontierCommitSeq,
    frontierCommitSeq,
    attemptFence: progress.attemptFence,
    sourceCursorRowId: update.sourceCursorRowId === undefined
      ? progress.sourceCursorRowId
      : update.sourceCursorRowId,
    edgeCursor: update.edgeCursor === undefined
      ? progress.edgeCursor
      : update.edgeCursor,
    versionCursor: update.versionCursor === undefined
      ? progress.versionCursor
      : update.versionCursor,
    validatedSourceCount:
      update.validatedSourceCount ?? progress.validatedSourceCount,
    validatedEdgeCount:
      update.validatedEdgeCount ?? progress.validatedEdgeCount,
    validatedVersionCount:
      update.validatedVersionCount ?? progress.validatedVersionCount,
    processedSourceRows: update.processedSourceRows ?? 0,
    processedEdges: update.processedEdges ?? 0,
    processedVersions: update.processedVersions ?? 0,
  });
}

function corruptHead(): Result.Result<
  never,
  ApplicationRelationBuildCorruptionError
> {
  return Result.fail(new ApplicationRelationBuildCorruptionError({
    reason: "storedHead",
  }));
}

function edgeMismatch(
  head: ApplicationRelationBuildHead,
  rowId: AppRowIdHexV1,
  reason: ApplicationRelationBuildMismatchError["reason"],
): Effect.Effect<never, ApplicationRelationBuildMismatchError> {
  const lifecycle = head.lifecycle === "validating_sources"
    ? "validating_sources" as const
    : "validating_edges" as const;
  return Effect.fail(new ApplicationRelationBuildMismatchError({
    scopeId: head.scopeId,
    edgeDefinitionId: head.edgeDefinitionId,
    lifecycle,
    reason,
    rowId,
  }));
}

function relationBuildValidationLifecycle(
  head: ApplicationRelationBuildHead,
): ApplicationRelationBuildMismatchError["lifecycle"] {
  return head.lifecycle === "backfilling"
    ? "backfilling"
    : head.lifecycle === "validating_sources"
    ? "validating_sources"
    : "validating_edges";
}

function edgeEndpointRequests(
  edges: ReadonlyArray<StoredAppRelationEdge>,
): ReadonlyArray<AppRelationEdgeBuildVersionFrontier> {
  const requests: AppRelationEdgeBuildVersionFrontier[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    const outgoing = Object.freeze({
      direction: "outgoing" as const,
      endpointRowId: edge.sourceRowId,
    });
    const incoming = Object.freeze({
      direction: "incoming" as const,
      endpointRowId: edge.targetRowId,
    });
    for (const request of [outgoing, incoming]) {
      const key = endpointKey(request.direction, request.endpointRowId);
      if (seen.has(key)) continue;
      seen.add(key);
      requests.push(request);
    }
  }
  return Object.freeze(requests);
}

function endpointKey(
  direction: AppRelationEdgeBuildVersionFrontier["direction"],
  endpointRowId: AppRowIdHexV1,
): string {
  return `${direction}:${endpointRowId}`;
}

function observeBuildQuery(
  options: ApplicationRelationBuildOptions,
  name: Parameters<NonNullable<
    ApplicationRelationBuildOptions["observeQuery"]
  >>[0]["name"],
  requestedRows: number,
): void {
  options.observeQuery?.(Object.freeze({ name, requestedRows }));
}

function stepResult(
  head: ApplicationRelationBuildHead,
  status: ApplicationRelationBuildStepResult["status"],
  counts: Partial<Pick<
    ApplicationRelationBuildStepResult,
    | "processedSourceRows"
    | "processedEdges"
    | "processedVersions"
    | "deletedEdges"
    | "deletedVersions"
  >> = {},
): ApplicationRelationBuildStepResult {
  return Object.freeze({
    status,
    scopeId: head.scopeId,
    edgeDefinitionId: head.edgeDefinitionId,
    lifecycle: head.lifecycle,
    frontierCommitSeq: head.frontierCommitSeq,
    attemptFence: head.attemptFence,
    processedSourceRows: counts.processedSourceRows ?? 0,
    processedEdges: counts.processedEdges ?? 0,
    processedVersions: counts.processedVersions ?? 0,
    deletedEdges: counts.deletedEdges ?? 0,
    deletedVersions: counts.deletedVersions ?? 0,
  });
}

function runFault(
  options: ApplicationRelationBuildOptions,
  point: Parameters<NonNullable<
    ApplicationRelationBuildOptions["faultAfter"]
  >>[0],
): Effect.Effect<void, ApplicationRelationBuildPersistenceError> {
  return options.faultAfter === undefined
    ? Effect.void
    : Effect.tryPromise({
      try: async () => options.faultAfter?.(point),
      catch: (cause) => new ApplicationRelationBuildPersistenceError({
        operation: "targetTransaction",
        retryable: true,
        cause,
      }),
    });
}

function queryEffect<Value>(
  operation: ApplicationRelationBuildPersistenceError["operation"],
  query: PromiseLike<Value>,
): Effect.Effect<Value, ApplicationRelationBuildPersistenceError> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) => new ApplicationRelationBuildPersistenceError({
      operation,
      retryable: true,
      cause,
    }),
  }));
}

function lowercaseHexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

const webCryptoRelationOccurrenceSha256 = RelationOccurrenceSha256.of({
  digest: (bytes) => Effect.tryPromise({
    try: async () => new Uint8Array(await globalThis.crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(bytes),
    )),
    catch: (cause) => new RelationOccurrenceSha256Error({
      operation: "digest",
      cause,
    }),
  }),
});
