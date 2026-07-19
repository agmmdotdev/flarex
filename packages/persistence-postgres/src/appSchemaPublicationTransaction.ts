import type {
  CatalogIndexDefinitionId,
  CatalogIndexId,
} from "flarex-protocol/catalog";
import { Effect, Result } from "effect";
import type {
  CatalogSchemaVersionId,
  SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";

import {
  getPreparedAppSchemaPublicationV1State,
  InvalidPreparedAppSchemaPublicationV1Error,
  type PreparedAppSchemaPublicationV1,
} from "./appSchemaPublicationPreparation";
import {
  AppCreationTimeIndexDefinitionRequirementError,
  AppDeveloperIndexDefinitionRequirementError,
  AppIndexDefinitionCatalogCorruptionError,
  InvalidAppIndexDefinitionBindingInputError,
  ensureAppCreationTimeIndexDefinitionV1InTransaction,
  ensureAppDeveloperIndexDefinitionBindingV1InTransaction,
  listAppSchemaVersionIndexBindings,
  prepareAppCreationTimeIndexDefinitionsV1,
  prepareAppDeveloperIndexDefinitionBindingsV1,
  type AppIndexDefinitionRecordForAccessKindV1,
  type AppSchemaVersionIndexBindingRecord,
  type EnsureAppCreationTimeIndexDefinitionV1Error,
  type EnsureAppDeveloperIndexDefinitionBindingV1Error,
  type EnsureAppDeveloperIndexDefinitionBindingV1Result,
} from "./appIndexDefinitions";
import {
  applySchemaManifestAppSchemaBindingsV1InTransaction,
  InvalidPreparedSchemaManifestAppSchemaBindingsError,
  SchemaManifestAppSchemaBindingPlanStaleError,
} from "./schemaManifestAppSchemaBindings";
import { SchemaManifestTableBindingCorruptionError } from
  "./schemaManifestTableBindings";
import {
  ensureSchemaVersionArtifactInTransaction,
  InvalidPreparedSchemaVersionArtifactError,
  SchemaManifestChecksumCollisionError,
  SchemaVersionArtifactConflictError,
  SchemaVersionArtifactCorruptionError,
  SchemaVersionArtifactDeploymentNotFoundError,
  verifyPreparedSchemaVersionArtifactInTransaction,
  type SchemaVersionArtifact,
} from "./schemaVersionArtifacts";
import {
  StableTableCatalogDeploymentNotFoundError,
  type StableTableCatalogTransaction,
} from "./stableTableCatalog";
import { StableTableCatalogCorruptionError } from
  "./stableTableCatalogAllocation";
import { StableLogicalIndexCatalogCorruptionError } from
  "./stableLogicalIndexCatalogAllocation";

export interface AppSchemaPublicationV1Result {
  readonly manifest: SchemaManifestAppSchemaV1;
  readonly artifact: SchemaVersionArtifact;
  readonly creationTimeIndexDefinitions: ReadonlyArray<
    AppIndexDefinitionRecordForAccessKindV1<"by_creation_time">
  >;
  readonly developerIndexDefinitions: ReadonlyArray<
    AppIndexDefinitionRecordForAccessKindV1<"developer">
  >;
  readonly schemaVersionIndexBindings:
    ReadonlyArray<AppSchemaVersionIndexBindingRecord>;
}

export type AppSchemaPublicationV1ProjectionIssue =
  | {
      readonly reason: "schemaBindingCountMismatch";
      readonly expectedCount: number;
      readonly actualCount: number;
    }
  | {
      readonly reason: "schemaBindingMismatch";
      readonly position: number;
      readonly expectedLogicalIndexId: CatalogIndexId;
      readonly expectedIndexDefinitionId: CatalogIndexDefinitionId;
      readonly actualLogicalIndexId: CatalogIndexId;
      readonly actualIndexDefinitionId: CatalogIndexDefinitionId;
    };

export class AppSchemaPublicationV1ProjectionError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly schemaVersionId: CatalogSchemaVersionId,
    readonly issue: AppSchemaPublicationV1ProjectionIssue,
  ) {
    super(
      `App-schema V1 publication is incomplete or contradictory for ${deploymentId}/${schemaVersionId}: ${projectionIssueMessage(issue)}`,
    );
    this.name = "AppSchemaPublicationV1ProjectionError";
  }
}

export type PublishPreparedAppSchemaV1InTransactionError =
  | AppSchemaPublicationV1PreparationFailure
  | AppSchemaPublicationV1LogicalBindingFailure
  | AppSchemaPublicationV1ArtifactFailure
  | EnsureAppCreationTimeIndexDefinitionV1Error
  | EnsureAppDeveloperIndexDefinitionBindingV1Error
  | AppSchemaPublicationV1BindingReadFailure
  | AppSchemaPublicationV1ProjectionError;

/**
 * Atomically apply and verify one already-prepared full app-schema projection.
 *
 * This package-internal D2c primitive owns no transaction, commit, retry,
 * quota, routing, build state, readiness, or activation. The caller must invoke
 * it inside one short control-database transaction. Every child token is
 * derived from the authenticated D2a envelope before the first SQL await, and
 * the locked phase performs no canonical encoding or hashing.
 */
export const publishPreparedAppSchemaV1InTransactionEffect = Effect.fn(
  "AppSchemaPublication.publishPreparedInTransaction",
)(function* (
  tx: StableTableCatalogTransaction,
  publication: PreparedAppSchemaPublicationV1,
): Effect.fn.Return<
  AppSchemaPublicationV1Result,
  PublishPreparedAppSchemaV1InTransactionError
> {
  const prepared = yield* Effect.fromResult(
    prepareAppSchemaPublicationTransactionResult(publication),
  );
  const { state, creationTimeTokens, developerTokens } = prepared;

  const manifest = yield* transitionalPromiseEffect(
    () => applySchemaManifestAppSchemaBindingsV1InTransaction(
      tx,
      state.logicalBindings,
    ),
    isLogicalBindingFailure,
  );
  yield* transitionalPromiseEffect(
    () => ensureSchemaVersionArtifactInTransaction(tx, state.artifact),
    isArtifactFailure,
  );

  const creationTimeIndexDefinitions: Array<
    AppIndexDefinitionRecordForAccessKindV1<"by_creation_time">
  > = [];
  for (const token of creationTimeTokens) {
    const ensured = yield* ensureAppCreationTimeIndexDefinitionV1InTransaction(
      tx,
      token,
    );
    creationTimeIndexDefinitions.push(ensured.definition);
  }

  const developerResults: EnsureAppDeveloperIndexDefinitionBindingV1Result[] = [];
  for (const token of developerTokens) {
    developerResults.push(
      yield* ensureAppDeveloperIndexDefinitionBindingV1InTransaction(
        tx,
        token,
      ),
    );
  }

  const artifact = yield* transitionalPromiseEffect(
    () => verifyPreparedSchemaVersionArtifactInTransaction(
      tx,
      state.artifact,
    ),
    isArtifactFailure,
  );
  const schemaVersionIndexBindings = yield* transitionalPromiseEffect(
    () => listAppSchemaVersionIndexBindings(
      tx,
      publication.deploymentId,
      publication.schemaVersionId,
    ),
    isBindingReadFailure,
  );
  yield* Effect.fromResult(
    verifyExactSchemaVersionBindingsResult(
      publication,
      developerResults,
      schemaVersionIndexBindings,
    ),
  );

  return Object.freeze({
    manifest,
    artifact,
    creationTimeIndexDefinitions: Object.freeze(creationTimeIndexDefinitions),
    developerIndexDefinitions: Object.freeze(
      developerResults.map((result) => result.definition),
    ),
    schemaVersionIndexBindings,
  } satisfies AppSchemaPublicationV1Result);
});

type AppSchemaPublicationV1PreparationFailure =
  | InvalidPreparedAppSchemaPublicationV1Error
  | AppCreationTimeIndexDefinitionRequirementError
  | AppDeveloperIndexDefinitionRequirementError;

type AppSchemaPublicationV1LogicalBindingFailure =
  | InvalidPreparedSchemaManifestAppSchemaBindingsError
  | SchemaManifestAppSchemaBindingPlanStaleError
  | StableTableCatalogDeploymentNotFoundError
  | StableTableCatalogCorruptionError
  | StableLogicalIndexCatalogCorruptionError
  | SchemaManifestTableBindingCorruptionError;

type AppSchemaPublicationV1ArtifactFailure =
  | InvalidPreparedSchemaVersionArtifactError
  | SchemaVersionArtifactDeploymentNotFoundError
  | SchemaVersionArtifactConflictError
  | SchemaManifestChecksumCollisionError
  | SchemaVersionArtifactCorruptionError;

type AppSchemaPublicationV1BindingReadFailure =
  | InvalidAppIndexDefinitionBindingInputError
  | AppIndexDefinitionCatalogCorruptionError;

function prepareAppSchemaPublicationTransactionResult(
  publication: PreparedAppSchemaPublicationV1,
): Result.Result<{
  readonly state: ReturnType<typeof getPreparedAppSchemaPublicationV1State>;
  readonly creationTimeTokens: ReturnType<
    typeof prepareAppCreationTimeIndexDefinitionsV1
  >;
  readonly developerTokens: ReturnType<
    typeof prepareAppDeveloperIndexDefinitionBindingsV1
  >;
}, AppSchemaPublicationV1PreparationFailure> {
  return Result.try({
    try: () => ({
      state: getPreparedAppSchemaPublicationV1State(publication),
      creationTimeTokens: prepareAppCreationTimeIndexDefinitionsV1(publication),
      developerTokens:
        prepareAppDeveloperIndexDefinitionBindingsV1(publication),
    }),
    catch: (cause) => {
      if (
        cause instanceof InvalidPreparedAppSchemaPublicationV1Error ||
        cause instanceof AppCreationTimeIndexDefinitionRequirementError ||
        cause instanceof AppDeveloperIndexDefinitionRequirementError
      ) {
        return cause;
      }
      throw cause;
    },
  });
}

// These child operations still expose Promise APIs. Keep them uninterruptible
// so the Drizzle callback cannot settle while their SQL continues, preserve
// their declared domain failures, and route unexpected causes to defects.
// Delete this adapter as each owning child operation becomes Effect-native.
function transitionalPromiseEffect<Result, Failure>(
  run: () => Promise<Result>,
  isFailure: (cause: unknown) => cause is Failure,
): Effect.Effect<Result, Failure> {
  return Effect.catch(
    Effect.uninterruptible(Effect.tryPromise({
      try: run,
      catch: (cause) => ({ cause }),
    })),
    (rejection) => isFailure(rejection.cause)
      ? Effect.fail(rejection.cause)
      : Effect.die(rejection.cause),
  );
}

function isLogicalBindingFailure(
  cause: unknown,
): cause is AppSchemaPublicationV1LogicalBindingFailure {
  return cause instanceof InvalidPreparedSchemaManifestAppSchemaBindingsError ||
    cause instanceof SchemaManifestAppSchemaBindingPlanStaleError ||
    cause instanceof StableTableCatalogDeploymentNotFoundError ||
    cause instanceof StableTableCatalogCorruptionError ||
    cause instanceof StableLogicalIndexCatalogCorruptionError ||
    cause instanceof SchemaManifestTableBindingCorruptionError;
}

function isArtifactFailure(
  cause: unknown,
): cause is AppSchemaPublicationV1ArtifactFailure {
  return cause instanceof InvalidPreparedSchemaVersionArtifactError ||
    cause instanceof SchemaVersionArtifactDeploymentNotFoundError ||
    cause instanceof SchemaVersionArtifactConflictError ||
    cause instanceof SchemaManifestChecksumCollisionError ||
    cause instanceof SchemaVersionArtifactCorruptionError;
}

function isBindingReadFailure(
  cause: unknown,
): cause is AppSchemaPublicationV1BindingReadFailure {
  return cause instanceof InvalidAppIndexDefinitionBindingInputError ||
    cause instanceof AppIndexDefinitionCatalogCorruptionError;
}

function verifyExactSchemaVersionBindingsResult(
  publication: PreparedAppSchemaPublicationV1,
  expected: ReadonlyArray<EnsureAppDeveloperIndexDefinitionBindingV1Result>,
  actual: ReadonlyArray<AppSchemaVersionIndexBindingRecord>,
): Result.Result<void, AppSchemaPublicationV1ProjectionError> {
  if (actual.length !== expected.length) {
    return Result.fail(new AppSchemaPublicationV1ProjectionError(
      publication.deploymentId,
      publication.schemaVersionId,
      {
        reason: "schemaBindingCountMismatch",
        expectedCount: expected.length,
        actualCount: actual.length,
      },
    ));
  }
  for (const [position, expectedResult] of expected.entries()) {
    const actualBinding = actual[position];
    if (actualBinding === undefined) {
      return Result.fail(new AppSchemaPublicationV1ProjectionError(
        publication.deploymentId,
        publication.schemaVersionId,
        {
          reason: "schemaBindingCountMismatch",
          expectedCount: expected.length,
          actualCount: actual.length,
        },
      ));
    }
    if (
      actualBinding.logicalIndexId !== expectedResult.binding.logicalIndexId ||
      actualBinding.indexDefinitionId !== expectedResult.binding.indexDefinitionId
    ) {
      return Result.fail(new AppSchemaPublicationV1ProjectionError(
        publication.deploymentId,
        publication.schemaVersionId,
        {
          reason: "schemaBindingMismatch",
          position,
          expectedLogicalIndexId: expectedResult.binding.logicalIndexId,
          expectedIndexDefinitionId: expectedResult.binding.indexDefinitionId,
          actualLogicalIndexId: actualBinding.logicalIndexId,
          actualIndexDefinitionId: actualBinding.indexDefinitionId,
        },
      ));
    }
  }
  return Result.succeed(undefined);
}

function projectionIssueMessage(
  issue: AppSchemaPublicationV1ProjectionIssue,
): string {
  switch (issue.reason) {
    case "schemaBindingCountMismatch":
      return `expected ${issue.expectedCount} schema bindings but found ${issue.actualCount}`;
    case "schemaBindingMismatch":
      return `binding ${issue.position} is ${issue.actualLogicalIndexId}/${issue.actualIndexDefinitionId}, not ${issue.expectedLogicalIndexId}/${issue.expectedIndexDefinitionId}`;
  }
}
