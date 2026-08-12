import { isNonBlankString } from "@flarex/utils/strings";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Cause, Data, Effect, Exit, Result, Schema } from "effect";
import {
  compileAppSchemaCatalogRequirementsV1,
  AppSchemaCatalogCompilationErrorV1,
  type CompiledAppSchemaCatalogRequirementsV1,
} from "flarex-protocol/app-schema-catalog";
import {
  CatalogIndexDefinitionIdSchema,
  type CatalogIndexDefinitionId,
} from "flarex-protocol/catalog";
import {
  INDEX_BUILD_CURSOR_CODEC_VERSION_V1,
  IndexBuildAttemptFenceSchema,
  MAX_INDEX_BUILD_ATTEMPT_FENCE,
} from "flarex-protocol/index-build-state";
import {
  CatalogSchemaVersionIdSchema,
  decodeSchemaManifestAppSchemaV1Result,
  type CatalogSchemaVersionId,
  type SchemaManifestAppSchemaV1,
  type SchemaManifestSha256,
} from "flarex-protocol/schema-manifest";
import type {
  ScopeId,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import { FlarexDbV1StorageGenerationSchema } from
  "flarex-protocol/storage-authority";

import {
  listRequiredAppIndexDefinitionsEffect,
  listAppSchemaVersionIndexBindingsEffect,
  type AppIndexDefinitionRecord,
  type AppSchemaVersionIndexBindingRecord,
  type ReadAppIndexDefinitionError,
  type ReadAppSchemaVersionIndexBindingError,
} from "./appIndexDefinitions";
import type { AppRowTransaction } from "./appRows";
import type { FlarexMetadataDatabase } from "./deployments";
import { hasExactOwnDataKeys } from "./exactOwnDataKeys";
import {
  decodeIndexBuildStateRowResult,
  IndexBuildStateCorruptionError,
  type IndexBuildStateRecord,
  validateIndexBuildStateFrontierResult,
} from "./indexBuildStates";
import {
  getScopeClock,
  type LockScopeClockForUpdateError,
  lockScopeClockForUpdateInTransactionEffect,
} from "./scopeClock";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type LocatedScopeClockReader,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import { captureScopePhysicalLocator } from "./scopePhysicalLocator";
import {
  getSchemaVersionArtifactByIdEffect,
  type ReadSchemaVersionArtifactError,
} from "./schemaVersionArtifacts";
import { fxSystemIndexBuildStates } from "./schema";
import { snapshotSchemaManifestValue } from "./schemaManifestValueSnapshot";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
  type RunLocatedReadCommittedTransactionV1,
} from "./transactionSessionAttemptKernel";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "./transactionSessionActivation";

const INPUT_KEYS = Object.freeze(["deploymentId", "schemaVersionId"]);
const decodeSchemaVersionIdResult = Schema.decodeUnknownResult(
  CatalogSchemaVersionIdSchema,
);
const decodeDefinitionIdResult = Schema.decodeUnknownResult(
  CatalogIndexDefinitionIdSchema,
);
const MAX_RECONCILED_DEFINITIONS = 256;

export interface ReconcilePublishedIndexBuildsV1Input {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
}

export interface LocatedIndexBuildReconciliationTargetV1
  extends LocatedReadCommittedAttemptTargetV1 {}

export function createLocatedIndexBuildReconciliationTargetV1(
  db: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
  runReadCommitted: RunLocatedReadCommittedTransactionV1 =
    createDefaultLocatedReadCommittedTransactionRunnerV1(db),
): LocatedIndexBuildReconciliationTargetV1 {
  return Object.freeze({
    physicalLocator: captureScopePhysicalLocator(physicalLocator),
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(db, scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
  });
}

export interface IndexBuildReconciliationPortsV1 {
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedIndexBuildReconciliationTargetV1
  >;
}

export type IndexBuildReconciliationFaultPointV1 =
  | "afterBuildInsert"
  | "afterStaleBuildRedeclare";

export interface IndexBuildReconciliationOptionsV1 {
  /** Package-internal deterministic fault seam used by the persistence proof. */
  readonly faultAfter?: (
    point: IndexBuildReconciliationFaultPointV1,
    indexDefinitionId: CatalogIndexDefinitionId,
  ) => void;
  /** Package-internal cross-store race seam; it grants no persistence authority. */
  readonly afterTargetCommit?: () => void | Promise<void>;
}

export type IndexBuildReconciliationDispositionV1 =
  | "created"
  | "replayed"
  | "completed_partial"
  | "redeployed"
  | "replayed_after_uncertain_completion";

export type ReconcilePublishedIndexBuildsV1Result =
  | Readonly<{
      readonly status: "absent";
      readonly deploymentId: string;
      readonly schemaVersionId: CatalogSchemaVersionId;
      readonly reason: "schemaVersionNotPublished" | "noPhysicalDefinitions";
    }>
  | Readonly<{
      readonly status: "reconciled";
      readonly disposition: IndexBuildReconciliationDispositionV1;
      readonly deploymentId: string;
      readonly schemaVersionId: CatalogSchemaVersionId;
      readonly scopeId: ScopeId;
      readonly storageGenerationFence: StorageGenerationFence;
      readonly epoch: string;
      readonly definitionIds: ReadonlyArray<CatalogIndexDefinitionId>;
      readonly createdCount: number;
      readonly replayedCount: number;
      readonly redeclaredCount: number;
    }>;

export class InvalidIndexBuildReconciliationInputV1Error
  extends Data.TaggedError("InvalidIndexBuildReconciliationInputV1Error")<{
    readonly reason:
      | "invalidInputShape"
      | "invalidDeploymentId"
      | "invalidSchemaVersionId";
  }> {}

export class IndexBuildReconciliationCatalogV1Error
  extends Data.TaggedError("IndexBuildReconciliationCatalogV1Error")<{
    readonly reason:
      | "manifestInvalid"
      | "publishedProjectionIncomplete"
      | "publishedProjectionContradictory"
      | "definitionLimitExceeded";
    readonly deploymentId: string;
    readonly schemaVersionId: CatalogSchemaVersionId;
    readonly detail: string;
    readonly cause?: unknown;
  }> {}

export class IndexBuildReconciliationStaleAuthorityV1Error
  extends Data.TaggedError("IndexBuildReconciliationStaleAuthorityV1Error")<{
    readonly scopeId: ScopeId;
    readonly reason:
      | "storageGeneration"
      | "storageGenerationFence"
      | "epoch";
  }> {}

export class IndexBuildReconciliationDefinitionSetChangedV1Error
  extends Data.TaggedError(
    "IndexBuildReconciliationDefinitionSetChangedV1Error",
  )<{
    readonly deploymentId: string;
    readonly schemaVersionId: CatalogSchemaVersionId;
  }> {}

export class IndexBuildReconciliationStateV1Error
  extends Data.TaggedError("IndexBuildReconciliationStateV1Error")<{
    readonly reason:
      | "attemptFenceExhausted"
      | "concurrentStateChange";
    readonly scopeId: ScopeId;
    readonly indexDefinitionId?: CatalogIndexDefinitionId;
  }> {}

export class IndexBuildReconciliationIntegrationV1Error
  extends Data.TaggedError("IndexBuildReconciliationIntegrationV1Error")<{
    readonly phase: "targetTransaction" | "postCommitControlRead";
    readonly retryable: boolean;
    readonly cause: unknown;
  }> {}

export class IndexBuildReconciliationDecisionUncertainV1Error
  extends Data.TaggedError(
    "IndexBuildReconciliationDecisionUncertainV1Error",
  )<{
    readonly scopeId: ScopeId;
    readonly schemaVersionId: CatalogSchemaVersionId;
    readonly cause: unknown;
  }> {}

export type ReconcilePublishedIndexBuildsV1Error =
  | InvalidIndexBuildReconciliationInputV1Error
  | ReadSchemaVersionArtifactError
  | ReadAppIndexDefinitionError
  | ReadAppSchemaVersionIndexBindingError
  | TrustedScopeAuthorityError
  | LockScopeClockForUpdateError
  | IndexBuildStateCorruptionError
  | IndexBuildReconciliationCatalogV1Error
  | IndexBuildReconciliationStaleAuthorityV1Error
  | IndexBuildReconciliationDefinitionSetChangedV1Error
  | IndexBuildReconciliationStateV1Error
  | IndexBuildReconciliationIntegrationV1Error
  | IndexBuildReconciliationDecisionUncertainV1Error;

interface PhysicalDefinitionRequirementV1 {
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly physicalSpecCodecVersion: AppIndexDefinitionRecord["physicalSpecCodecVersion"];
  readonly physicalSpecBytesHex: AppIndexDefinitionRecord["physicalSpecBytesHex"];
  readonly physicalSpecSha256Hex: AppIndexDefinitionRecord["physicalSpecSha256Hex"];
}

export interface PublishedPhysicalRequirementSnapshotV1 {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly manifestSha256: SchemaManifestSha256;
  /** Exact immutable validator/schema owner retained for scoped consumers. */
  readonly manifest: SchemaManifestAppSchemaV1;
  readonly definitions: ReadonlyArray<PhysicalDefinitionRequirementV1>;
}

interface TransactionProjectionV1 {
  readonly createdCount: number;
  readonly replayedCount: number;
  readonly redeclaredCount: number;
}

export const reconcilePublishedIndexBuildsV1Effect = Effect.fn(
  "IndexBuildReconciliation.reconcilePublishedV1",
)(function* (
  ports: IndexBuildReconciliationPortsV1,
  input: unknown,
  options: IndexBuildReconciliationOptionsV1 = {},
): Effect.fn.Return<
  ReconcilePublishedIndexBuildsV1Result,
  ReconcilePublishedIndexBuildsV1Error
> {
  const decoded = yield* Effect.fromResult(decodeInputResult(input));
  const initial = yield* loadPublishedPhysicalRequirementSnapshotV1(
    ports.controlDb,
    decoded,
  );
  if (initial === null) {
    return Object.freeze({
      status: "absent",
      deploymentId: decoded.deploymentId,
      schemaVersionId: decoded.schemaVersionId,
      reason: "schemaVersionNotPublished",
    });
  }
  if (initial.definitions.length === 0) {
    return Object.freeze({
      status: "absent",
      deploymentId: decoded.deploymentId,
      schemaVersionId: decoded.schemaVersionId,
      reason: "noPhysicalDefinitions",
    });
  }

  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    decoded.deploymentId,
    ports.authority,
  );
  const settled = yield* runReconciliationTransaction(
    located.target,
    located.authority,
    initial,
    options,
  );
  if (options.afterTargetCommit !== undefined) {
    yield* Effect.tryPromise({
      try: () => Promise.resolve(options.afterTargetCommit?.()),
      catch: (cause) => new IndexBuildReconciliationIntegrationV1Error({
        phase: "postCommitControlRead",
        retryable: true,
        cause,
      }),
    });
  }
  const final = yield* loadPublishedPhysicalRequirementSnapshotV1(
    ports.controlDb,
    decoded,
  );
  if (final === null || !requirementSnapshotsEqual(initial, final)) {
    return yield* Effect.fail(
      new IndexBuildReconciliationDefinitionSetChangedV1Error({
        deploymentId: decoded.deploymentId,
        schemaVersionId: decoded.schemaVersionId,
      }),
    );
  }
  return makeResult(initial, located.authority, settled);
});

function decodeInputResult(
  input: unknown,
): Result.Result<
  ReconcilePublishedIndexBuildsV1Input,
  InvalidIndexBuildReconciliationInputV1Error
> {
  return Result.gen(function* () {
    if (!hasExactOwnDataKeys(input, INPUT_KEYS)) {
      return yield* Result.fail(
        new InvalidIndexBuildReconciliationInputV1Error({
          reason: "invalidInputShape",
        }),
      );
    }
    if (!isNonBlankString(input.deploymentId)) {
      return yield* Result.fail(
        new InvalidIndexBuildReconciliationInputV1Error({
          reason: "invalidDeploymentId",
        }),
      );
    }
    const schemaVersionId = yield* decodeSchemaVersionIdResult(
      input.schemaVersionId,
    ).pipe(Result.mapError((cause) =>
      new InvalidIndexBuildReconciliationInputV1Error({
        reason: "invalidSchemaVersionId",
      })
    ));
    return Object.freeze({
      deploymentId: input.deploymentId,
      schemaVersionId,
    });
  });
}

export const loadPublishedPhysicalRequirementSnapshotV1 = Effect.fn(
  "IndexBuildReconciliation.loadPublishedRequirements",
)(function* (
  db: FlarexMetadataDatabase,
  input: ReconcilePublishedIndexBuildsV1Input,
): Effect.fn.Return<
  PublishedPhysicalRequirementSnapshotV1 | null,
  | ReadSchemaVersionArtifactError
  | ReadAppIndexDefinitionError
  | ReadAppSchemaVersionIndexBindingError
  | IndexBuildReconciliationCatalogV1Error
> {
  const artifact = yield* getSchemaVersionArtifactByIdEffect(
    db,
    input.deploymentId,
    input.schemaVersionId,
  );
  if (artifact === null) return null;
  const manifest = yield* Effect.fromResult(
    decodeSchemaManifestAppSchemaV1Result(artifact.manifestJson),
  ).pipe(Effect.mapError((cause) =>
    new IndexBuildReconciliationCatalogV1Error({
      reason: "manifestInvalid",
      deploymentId: input.deploymentId,
      schemaVersionId: input.schemaVersionId,
      detail: "the immutable schema artifact is not an app-schema V1 manifest",
      cause,
    })
  ));
  const requirements = yield* Effect.tryPromise({
    try: () => compileAppSchemaCatalogRequirementsV1(manifest),
    catch: (cause) => cause,
  }).pipe(Effect.catch((cause) =>
    cause instanceof AppSchemaCatalogCompilationErrorV1
      ? Effect.fail(new IndexBuildReconciliationCatalogV1Error({
        reason: "publishedProjectionContradictory",
        deploymentId: input.deploymentId,
        schemaVersionId: input.schemaVersionId,
        detail: "the immutable app-schema artifact cannot be compiled",
        cause,
      }))
      : Effect.die(cause)
  ));
  if (
    requirements.creationTimeIndexes.length +
        requirements.developerIndexes.length > MAX_RECONCILED_DEFINITIONS
  ) {
    return yield* Effect.fail(new IndexBuildReconciliationCatalogV1Error({
      reason: "definitionLimitExceeded",
      deploymentId: input.deploymentId,
      schemaVersionId: input.schemaVersionId,
      detail:
        `the required physical definition set exceeds ${MAX_RECONCILED_DEFINITIONS}`,
    }));
  }
  const bindings = yield* listAppSchemaVersionIndexBindingsEffect(
    db,
    input.deploymentId,
    input.schemaVersionId,
  );
  if (bindings.length !== requirements.developerIndexes.length) {
    return yield* Effect.fail(new IndexBuildReconciliationCatalogV1Error({
      reason: "publishedProjectionIncomplete",
      deploymentId: input.deploymentId,
      schemaVersionId: input.schemaVersionId,
      detail: "the schema-version binding count does not match compiled requirements",
    }));
  }
  const definitions = yield* listRequiredAppIndexDefinitionsEffect(
    db,
    input.deploymentId,
    Object.freeze({
      developerDefinitionIds: Object.freeze(
        bindings.map((binding) => binding.indexDefinitionId),
      ),
      creationTime: Object.freeze(requirements.creationTimeIndexes.map(
        (requirement) => Object.freeze({
          tableId: requirement.tableId,
          physicalSpecSha256Hex: requirement.canonical.sha256Hex,
        }),
      )),
    }),
  );
  const projectedDefinitions = yield* Effect.fromResult(
    projectExactRequirementsResult(
      input,
      requirements,
      definitions,
      bindings,
    ),
  );
  return Object.freeze({
    deploymentId: input.deploymentId,
    schemaVersionId: input.schemaVersionId,
    manifestSha256: artifact.manifestSha256,
    manifest: snapshotSchemaManifestValue(manifest),
    definitions: projectedDefinitions,
  });
});

function projectExactRequirementsResult(
  input: ReconcilePublishedIndexBuildsV1Input,
  requirements: CompiledAppSchemaCatalogRequirementsV1,
  definitions: ReadonlyArray<AppIndexDefinitionRecord>,
  bindings: ReadonlyArray<AppSchemaVersionIndexBindingRecord>,
): Result.Result<
  ReadonlyArray<PhysicalDefinitionRequirementV1>,
  IndexBuildReconciliationCatalogV1Error
> {
  const fail = (
    reason: IndexBuildReconciliationCatalogV1Error["reason"],
    detail: string,
  ) => Result.fail(new IndexBuildReconciliationCatalogV1Error({
    reason,
    deploymentId: input.deploymentId,
    schemaVersionId: input.schemaVersionId,
    detail,
  }));
  if (
    requirements.creationTimeIndexes.length +
        requirements.developerIndexes.length > MAX_RECONCILED_DEFINITIONS
  ) {
    return fail(
      "definitionLimitExceeded",
      `the required physical definition set exceeds ${MAX_RECONCILED_DEFINITIONS}`,
    );
  }
  if (bindings.length !== requirements.developerIndexes.length) {
    return fail(
      "publishedProjectionIncomplete",
      "the schema-version binding count does not match compiled requirements",
    );
  }
  const definitionsById = new Map(
    definitions.map((definition) => [definition.indexDefinitionId, definition]),
  );
  const selected: AppIndexDefinitionRecord[] = [];
  for (const [position, requirement] of requirements.developerIndexes.entries()) {
    const binding = bindings[position];
    if (
      binding === undefined ||
      binding.logicalIndexId !== requirement.logicalIndexId
    ) {
      return fail(
        "publishedProjectionContradictory",
        `developer binding ${position} does not match logical index ${requirement.logicalIndexId}`,
      );
    }
    const definition = definitionsById.get(binding.indexDefinitionId);
    if (
      definition === undefined ||
      definition.access.kind !== "developer" ||
      definition.access.tableId !== requirement.tableId ||
      definition.access.logicalIndexId !== requirement.logicalIndexId ||
      !definitionMatchesCanonical(definition, requirement.canonical)
    ) {
      return fail(
        "publishedProjectionContradictory",
        `developer binding ${requirement.logicalIndexId} does not resolve to its exact immutable definition`,
      );
    }
    selected.push(definition);
  }
  for (const requirement of requirements.creationTimeIndexes) {
    const matches = definitions.filter((definition) =>
      definition.access.kind === "by_creation_time" &&
      definition.access.tableId === requirement.tableId &&
      definitionMatchesCanonical(definition, requirement.canonical)
    );
    if (matches.length !== 1) {
      return fail(
        matches.length === 0
          ? "publishedProjectionIncomplete"
          : "publishedProjectionContradictory",
        `table ${requirement.tableId} has ${matches.length} exact creation-time definitions`,
      );
    }
    selected.push(matches[0]!);
  }
  selected.sort((left, right) =>
    left.indexDefinitionId - right.indexDefinitionId
  );
  const seen = new Set<number>();
  const projected: PhysicalDefinitionRequirementV1[] = [];
  for (const definition of selected) {
    if (seen.has(definition.indexDefinitionId)) {
      return fail(
        "publishedProjectionContradictory",
        `physical definition ${definition.indexDefinitionId} is required more than once`,
      );
    }
    seen.add(definition.indexDefinitionId);
    projected.push(Object.freeze({
      indexDefinitionId: definition.indexDefinitionId,
      physicalSpecCodecVersion: definition.physicalSpecCodecVersion,
      physicalSpecBytesHex: definition.physicalSpecBytesHex,
      physicalSpecSha256Hex: definition.physicalSpecSha256Hex,
    }));
  }
  return Result.succeed(Object.freeze(projected));
}

function definitionMatchesCanonical(
  definition: AppIndexDefinitionRecord,
  canonical: {
    readonly codecVersion: AppIndexDefinitionRecord["physicalSpecCodecVersion"];
    readonly canonicalBytesHex: AppIndexDefinitionRecord["physicalSpecBytesHex"];
    readonly sha256Hex: AppIndexDefinitionRecord["physicalSpecSha256Hex"];
  },
): boolean {
  return definition.physicalSpecCodecVersion === canonical.codecVersion &&
    definition.physicalSpecBytesHex === canonical.canonicalBytesHex &&
    definition.physicalSpecSha256Hex === canonical.sha256Hex;
}

const runReconciliationTransaction = Effect.fn(
  "IndexBuildReconciliation.runTransaction",
)(function* (
  target: LocatedIndexBuildReconciliationTargetV1,
  authority: TrustedScopeAuthority,
  snapshot: PublishedPhysicalRequirementSnapshotV1,
  options: IndexBuildReconciliationOptionsV1,
): Effect.fn.Return<
  TransactionProjectionV1 & {
    readonly uncertain: boolean;
  },
  | LockScopeClockForUpdateError
  | IndexBuildStateCorruptionError
  | IndexBuildReconciliationStaleAuthorityV1Error
  | IndexBuildReconciliationStateV1Error
  | IndexBuildReconciliationIntegrationV1Error
  | IndexBuildReconciliationDecisionUncertainV1Error
> {
  const started = startLocatedEffectTransaction(
    target,
    "S03-D3 reconciliation rolled back.",
    (tx) => reconcileInTransaction(tx, authority, snapshot, options),
  );
  const settled = yield* awaitTransactionExit(started.promise);
  if (Exit.isSuccess(settled)) return settled.value;
  const failure = Cause.findErrorOption(settled.cause);
  if (failure._tag === "None") return yield* Effect.die(settled.cause);
  const cause = failure.value;
  const callbackCause = started.callbackCause();
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack" &&
    cause.issue.callbackCause === started.rollbackSignal &&
    callbackCause !== undefined
  ) {
    return yield* Effect.failCause(callbackCause);
  }
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "decisionUncertain"
  ) {
    return yield* observeUncertainCompletion(
      target,
      authority,
      snapshot,
      cause,
    );
  }
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackCleanupFailed" &&
    callbackCause !== undefined
  ) {
    return yield* Effect.failCause(Cause.combine(
      callbackCause,
      Cause.die(new IndexBuildReconciliationIntegrationV1Error({
        phase: "targetTransaction",
        retryable: false,
        cause,
      })),
    ));
  }
  const retryable = cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    (cause.issue.kind === "infrastructureFailure" ||
      cause.issue.kind === "callbackRolledBack");
  return yield* Effect.fail(new IndexBuildReconciliationIntegrationV1Error({
    phase: "targetTransaction",
    retryable,
    cause,
  }));
});

const reconcileInTransaction = Effect.fn(
  "IndexBuildReconciliation.reconcileInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: PublishedPhysicalRequirementSnapshotV1,
  options: IndexBuildReconciliationOptionsV1,
): Effect.fn.Return<
  TransactionProjectionV1 & { readonly uncertain: false },
  | LockScopeClockForUpdateError
  | IndexBuildStateCorruptionError
  | IndexBuildReconciliationStaleAuthorityV1Error
  | IndexBuildReconciliationStateV1Error
  | IndexBuildReconciliationIntegrationV1Error
> {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  const ids = snapshot.definitions.map((definition) =>
    definition.indexDefinitionId
  );
  const rows = ids.length === 0
    ? []
    : yield* queryEffect(
      tx.select()
        .from(fxSystemIndexBuildStates)
        .where(and(
          eq(fxSystemIndexBuildStates.scopeId, authority.scopeId),
          inArray(fxSystemIndexBuildStates.indexDefinitionId, ids),
        ))
        .orderBy(asc(fxSystemIndexBuildStates.indexDefinitionId))
        .for("update"),
    );
  const states = new Map<CatalogIndexDefinitionId, IndexBuildStateRecord>();
  for (const row of rows) {
    const definitionId = yield* Effect.fromResult(
      decodeDefinitionIdResult(row.indexDefinitionId),
    ).pipe(Effect.mapError((cause) =>
      new IndexBuildStateCorruptionError(
        authority.scopeId,
        CatalogIndexDefinitionIdSchema.make(1),
        "stored definition ID is invalid",
        { cause },
      )
    ));
    const state = yield* Effect.fromResult(decodeIndexBuildStateRowResult(
      row,
      authority.scopeId,
      definitionId,
    ));
    yield* Effect.fromResult(validateIndexBuildStateFrontierResult(
      state,
      clock.lastCommitSeq,
    ));
    states.set(definitionId, state);
  }

  let createdCount = 0;
  let replayedCount = 0;
  let redeclaredCount = 0;
  for (const definition of snapshot.definitions) {
    const existing = states.get(definition.indexDefinitionId);
    if (existing === undefined) {
      const inserted = yield* queryEffect(tx.insert(fxSystemIndexBuildStates).values({
        scopeId: authority.scopeId,
        indexDefinitionId: definition.indexDefinitionId,
        storageGeneration: FlarexDbV1StorageGenerationSchema.make(
          "flarexdb_v1",
        ),
        storageGenerationFence: clock.storageGenerationFence,
        epoch: clock.epoch,
        startCommitSeq: clock.lastCommitSeq,
        lifecycle: "declared",
        cursorCodecVersion: INDEX_BUILD_CURSOR_CODEC_VERSION_V1,
        backfillCursorRowId: null,
        attemptFence: IndexBuildAttemptFenceSchema.make(1n),
      }).returning({ id: fxSystemIndexBuildStates.indexDefinitionId }));
      if (inserted.length !== 1) {
        return yield* Effect.fail(new IndexBuildReconciliationStateV1Error({
          reason: "concurrentStateChange",
          scopeId: authority.scopeId,
          indexDefinitionId: definition.indexDefinitionId,
        }));
      }
      yield* runFault(options, "afterBuildInsert", definition.indexDefinitionId);
      createdCount += 1;
      continue;
    }
    if (buildAuthorityIsCurrent(existing, clock)) {
      replayedCount += 1;
      continue;
    }
    if (existing.attemptFence >= MAX_INDEX_BUILD_ATTEMPT_FENCE) {
      return yield* Effect.fail(new IndexBuildReconciliationStateV1Error({
        reason: "attemptFenceExhausted",
        scopeId: authority.scopeId,
        indexDefinitionId: definition.indexDefinitionId,
      }));
    }
    const nextAttemptFence = IndexBuildAttemptFenceSchema.make(
      existing.attemptFence + 1n,
    );
    const updated = yield* queryEffect(
      tx.update(fxSystemIndexBuildStates)
        .set({
          storageGeneration: FlarexDbV1StorageGenerationSchema.make(
            "flarexdb_v1",
          ),
          storageGenerationFence: clock.storageGenerationFence,
          epoch: clock.epoch,
          startCommitSeq: clock.lastCommitSeq,
          lifecycle: "declared",
          cursorCodecVersion: INDEX_BUILD_CURSOR_CODEC_VERSION_V1,
          backfillCursorRowId: null,
          attemptFence: nextAttemptFence,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(and(
          eq(fxSystemIndexBuildStates.scopeId, authority.scopeId),
          eq(
            fxSystemIndexBuildStates.indexDefinitionId,
            definition.indexDefinitionId,
          ),
          eq(
            fxSystemIndexBuildStates.storageGenerationFence,
            existing.storageGenerationFence,
          ),
          eq(fxSystemIndexBuildStates.epoch, existing.epoch),
          eq(fxSystemIndexBuildStates.attemptFence, existing.attemptFence),
        ))
        .returning({ id: fxSystemIndexBuildStates.indexDefinitionId }),
    );
    if (updated.length !== 1) {
      return yield* Effect.fail(new IndexBuildReconciliationStateV1Error({
        reason: "concurrentStateChange",
        scopeId: authority.scopeId,
        indexDefinitionId: definition.indexDefinitionId,
      }));
    }
    yield* runFault(
      options,
      "afterStaleBuildRedeclare",
      definition.indexDefinitionId,
    );
    redeclaredCount += 1;
  }
  return Object.freeze({
    createdCount,
    replayedCount,
    redeclaredCount,
    uncertain: false as const,
  });
});

const observeUncertainCompletion = Effect.fn(
  "IndexBuildReconciliation.observeUncertainCompletion",
)(function* (
  target: LocatedIndexBuildReconciliationTargetV1,
  authority: TrustedScopeAuthority,
  snapshot: PublishedPhysicalRequirementSnapshotV1,
  transactionCause: unknown,
): Effect.fn.Return<
  TransactionProjectionV1 & { readonly uncertain: true },
  | IndexBuildReconciliationDecisionUncertainV1Error
  | IndexBuildReconciliationIntegrationV1Error
  | LockScopeClockForUpdateError
  | IndexBuildStateCorruptionError
  | IndexBuildReconciliationStaleAuthorityV1Error
> {
  const started = startLocatedEffectTransaction(
    target,
    "S03-D3 uncertainty observation rolled back.",
    (tx) => observeCompletionInTransaction(tx, authority, snapshot),
  );
  const settled = yield* awaitTransactionExit(started.promise);
  if (Exit.isFailure(settled)) {
    const failure = Cause.findErrorOption(settled.cause);
    if (failure._tag === "None") return yield* Effect.die(settled.cause);
    const cause = failure.value;
    const callbackCause = started.callbackCause();
    if (
      cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause === started.rollbackSignal &&
      callbackCause !== undefined
    ) {
      return yield* Effect.failCause(callbackCause);
    }
    if (
      cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackCleanupFailed" &&
      callbackCause !== undefined
    ) {
      return yield* Effect.failCause(Cause.combine(
        callbackCause,
        Cause.die(new IndexBuildReconciliationIntegrationV1Error({
          phase: "targetTransaction",
          retryable: false,
          cause,
        })),
      ));
    }
    return yield* Effect.fail(new IndexBuildReconciliationIntegrationV1Error({
      phase: "targetTransaction",
      retryable: true,
      cause,
    }));
  }
  if (!settled.value) {
    return yield* Effect.fail(
      new IndexBuildReconciliationDecisionUncertainV1Error({
        scopeId: authority.scopeId,
        schemaVersionId: snapshot.schemaVersionId,
        cause: transactionCause,
      }),
    );
  }
  return Object.freeze({
    createdCount: 0,
    replayedCount: snapshot.definitions.length,
    redeclaredCount: 0,
    uncertain: true as const,
  });
});

const observeCompletionInTransaction = Effect.fn(
  "IndexBuildReconciliation.observeCompletionInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: PublishedPhysicalRequirementSnapshotV1,
): Effect.fn.Return<
  boolean,
  | LockScopeClockForUpdateError
  | IndexBuildStateCorruptionError
  | IndexBuildReconciliationStaleAuthorityV1Error
  | IndexBuildReconciliationIntegrationV1Error
> {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  const ids = snapshot.definitions.map((definition) =>
    definition.indexDefinitionId
  );
  const rows = yield* queryEffect(
    tx.select()
      .from(fxSystemIndexBuildStates)
      .where(and(
        eq(fxSystemIndexBuildStates.scopeId, authority.scopeId),
        inArray(fxSystemIndexBuildStates.indexDefinitionId, ids),
      ))
      .orderBy(asc(fxSystemIndexBuildStates.indexDefinitionId)),
  );
  if (rows.length !== ids.length) return false;
  for (const [position, row] of rows.entries()) {
    const expectedId = ids[position];
    if (expectedId === undefined || row.indexDefinitionId !== expectedId) {
      return false;
    }
    const state = yield* Effect.fromResult(decodeIndexBuildStateRowResult(
      row,
      authority.scopeId,
      expectedId,
    ));
    yield* Effect.fromResult(validateIndexBuildStateFrontierResult(
      state,
      clock.lastCommitSeq,
    ));
    if (!buildAuthorityIsCurrent(state, clock)) return false;
  }
  return true;
});

interface StartedLocatedEffectTransaction<Value, Failure> {
  readonly promise: Promise<Value>;
  readonly rollbackSignal: Error;
  readonly callbackCause: () => Cause.Cause<Failure> | undefined;
}

/** The single audited Effect runtime bridge for this driver callback owner. */
function startLocatedEffectTransaction<Value, Failure>(
  target: LocatedIndexBuildReconciliationTargetV1,
  rollbackMessage: string,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): StartedLocatedEffectTransaction<Value, Failure> {
  let observedCause: Cause.Cause<Failure> | undefined;
  const rollbackSignal = new Error(rollbackMessage);
  const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
    const exit = await Effect.runPromise(Effect.exit(work(tx)));
    if (Exit.isFailure(exit)) {
      observedCause = exit.cause;
      throw rollbackSignal;
    }
    return exit.value;
  });
  return Object.freeze({
    promise,
    rollbackSignal,
    callbackCause: () => observedCause,
  });
}

const awaitTransactionExit = Effect.fn(
  "IndexBuildReconciliation.awaitTransactionExit",
)(function* <Value>(promise: Promise<Value>) {
  return yield* Effect.uninterruptible(Effect.exit(Effect.tryPromise({
    try: () => promise,
    catch: (cause) => cause,
  })));
});

function requireExactAuthorityResult(
  expected: TrustedScopeAuthority,
  current: {
    readonly storageGeneration: string;
    readonly storageGenerationFence: StorageGenerationFence;
    readonly epoch: string;
  },
): Result.Result<void, IndexBuildReconciliationStaleAuthorityV1Error> {
  if (
    expected.storageGeneration !== "flarexdb_v1" ||
    current.storageGeneration !== expected.storageGeneration
  ) {
    return Result.fail(new IndexBuildReconciliationStaleAuthorityV1Error({
      scopeId: expected.scopeId,
      reason: "storageGeneration",
    }));
  }
  if (current.storageGenerationFence !== expected.storageGenerationFence) {
    return Result.fail(new IndexBuildReconciliationStaleAuthorityV1Error({
      scopeId: expected.scopeId,
      reason: "storageGenerationFence",
    }));
  }
  if (current.epoch !== expected.epoch) {
    return Result.fail(new IndexBuildReconciliationStaleAuthorityV1Error({
      scopeId: expected.scopeId,
      reason: "epoch",
    }));
  }
  return Result.succeed(undefined);
}

function buildAuthorityIsCurrent(
  state: IndexBuildStateRecord,
  clock: {
    readonly storageGeneration: string;
    readonly storageGenerationFence: StorageGenerationFence;
    readonly epoch: string;
  },
): boolean {
  return state.storageGeneration === clock.storageGeneration &&
    state.storageGenerationFence === clock.storageGenerationFence &&
    state.epoch === clock.epoch;
}

function runFault(
  options: IndexBuildReconciliationOptionsV1,
  point: IndexBuildReconciliationFaultPointV1,
  indexDefinitionId: CatalogIndexDefinitionId,
): Effect.Effect<void, IndexBuildReconciliationIntegrationV1Error> {
  return options.faultAfter === undefined
    ? Effect.void
    : Effect.try({
      try: () => options.faultAfter?.(point, indexDefinitionId),
      catch: (cause) => new IndexBuildReconciliationIntegrationV1Error({
        phase: "targetTransaction",
        retryable: true,
        cause,
      }),
    });
}

function queryEffect<Row>(
  query: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<
  ReadonlyArray<Row>,
  IndexBuildReconciliationIntegrationV1Error
> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) => new IndexBuildReconciliationIntegrationV1Error({
      phase: "targetTransaction",
      retryable: true,
      cause,
    }),
  }));
}

function requirementSnapshotsEqual(
  left: PublishedPhysicalRequirementSnapshotV1,
  right: PublishedPhysicalRequirementSnapshotV1,
): boolean {
  if (
    left.deploymentId !== right.deploymentId ||
    left.schemaVersionId !== right.schemaVersionId ||
    left.manifestSha256.byteLength !== right.manifestSha256.byteLength ||
    !left.manifestSha256.every((byte, index) =>
      byte === right.manifestSha256[index]
    ) ||
    left.definitions.length !== right.definitions.length
  ) return false;
  return left.definitions.every((definition, index) => {
    const other = right.definitions[index];
    return other !== undefined &&
      definition.indexDefinitionId === other.indexDefinitionId &&
      definition.physicalSpecCodecVersion === other.physicalSpecCodecVersion &&
      definition.physicalSpecBytesHex === other.physicalSpecBytesHex &&
      definition.physicalSpecSha256Hex === other.physicalSpecSha256Hex;
  });
}

function makeResult(
  snapshot: PublishedPhysicalRequirementSnapshotV1,
  authority: TrustedScopeAuthority,
  projection: TransactionProjectionV1 & { readonly uncertain: boolean },
): ReconcilePublishedIndexBuildsV1Result {
  const disposition: IndexBuildReconciliationDispositionV1 = projection.uncertain
    ? "replayed_after_uncertain_completion"
    : projection.redeclaredCount > 0
    ? "redeployed"
    : projection.createdCount === 0
    ? "replayed"
    : projection.replayedCount === 0
    ? "created"
    : "completed_partial";
  return Object.freeze({
    status: "reconciled",
    disposition,
    deploymentId: snapshot.deploymentId,
    schemaVersionId: snapshot.schemaVersionId,
    scopeId: authority.scopeId,
    storageGenerationFence: authority.storageGenerationFence,
    epoch: authority.epoch,
    definitionIds: Object.freeze(
      snapshot.definitions.map((definition) => definition.indexDefinitionId),
    ),
    createdCount: projection.createdCount,
    replayedCount: projection.replayedCount,
    redeclaredCount: projection.redeclaredCount,
  });
}
