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
  getPreparedAppSchemaPublicationV1StateResult,
  type InvalidPreparedAppSchemaPublicationV1Error,
  type PreparedAppSchemaPublicationV1,
  type PreparedAppSchemaPublicationV1State,
} from "./appSchemaPublicationPreparation";
import {
  ensureAppCreationTimeIndexDefinitionV1InTransaction,
  ensureAppDeveloperIndexDefinitionBindingV1InTransaction,
  listAppSchemaVersionIndexBindingsEffect,
  prepareAppCreationTimeIndexDefinitionsV1Result,
  prepareAppDeveloperIndexDefinitionBindingsV1Result,
  type AppCreationTimeIndexDefinitionRequirementError,
  type AppDeveloperIndexDefinitionRequirementError,
  type AppIndexDefinitionRecordForAccessKindV1,
  type AppSchemaVersionIndexBindingRecord,
  type EnsureAppCreationTimeIndexDefinitionV1Error,
  type EnsureAppDeveloperIndexDefinitionBindingV1Error,
  type EnsureAppDeveloperIndexDefinitionBindingV1Result,
  type PreparedAppCreationTimeIndexDefinitionV1,
  type PreparedAppDeveloperIndexDefinitionBindingV1,
  type ReadAppSchemaVersionIndexBindingError,
} from "./appIndexDefinitions";
import {
  applySchemaManifestAppSchemaBindingsV1InTransactionEffect,
  type ApplySchemaManifestAppSchemaBindingsV1Error,
} from "./schemaManifestAppSchemaBindings";
import {
  ensureSchemaVersionArtifactInTransactionEffect,
  verifyPreparedSchemaVersionArtifactInTransactionEffect,
  type EnsureSchemaVersionArtifactError,
  type SchemaVersionArtifact,
  type VerifyPreparedSchemaVersionArtifactError,
} from "./schemaVersionArtifacts";
import {
  type StableTableCatalogTransaction,
} from "./stableTableCatalog";

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
  readonly _tag = "AppSchemaPublicationV1ProjectionError" as const;

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

  const manifest = yield* applySchemaManifestAppSchemaBindingsV1InTransactionEffect(
    tx,
    state.logicalBindings,
  );
  yield* ensureSchemaVersionArtifactInTransactionEffect(
    tx,
    state.artifact,
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

  const artifact = yield* verifyPreparedSchemaVersionArtifactInTransactionEffect(
    tx,
    state.artifact,
  );
  const schemaVersionIndexBindings = yield* listAppSchemaVersionIndexBindingsEffect(
    tx,
    publication.deploymentId,
    publication.schemaVersionId,
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
  ApplySchemaManifestAppSchemaBindingsV1Error;

type AppSchemaPublicationV1ArtifactFailure =
  | EnsureSchemaVersionArtifactError
  | VerifyPreparedSchemaVersionArtifactError;

type AppSchemaPublicationV1BindingReadFailure =
  ReadAppSchemaVersionIndexBindingError;

function prepareAppSchemaPublicationTransactionResult(
  publication: PreparedAppSchemaPublicationV1,
): Result.Result<{
  readonly state: PreparedAppSchemaPublicationV1State;
  readonly creationTimeTokens: ReadonlyArray<
    PreparedAppCreationTimeIndexDefinitionV1
  >;
  readonly developerTokens: ReadonlyArray<
    PreparedAppDeveloperIndexDefinitionBindingV1
  >;
}, AppSchemaPublicationV1PreparationFailure> {
  return Result.gen(function* () {
    const state = yield* getPreparedAppSchemaPublicationV1StateResult(
      publication,
    );
    const creationTimeTokens = yield*
      prepareAppCreationTimeIndexDefinitionsV1Result(publication);
    const developerTokens = yield*
      prepareAppDeveloperIndexDefinitionBindingsV1Result(publication);
    return { state, creationTimeTokens, developerTokens };
  });
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
