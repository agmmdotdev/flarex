import { IndexMaintenanceError } from "../indexMaintenanceEvidence";
import { ExactDecimalError } from "flarex-protocol/internal/exact-decimal";
import { MAX_POINT_COMMIT_MATERIAL_ROWS_V1 } from "flarex-protocol/commit-protocol";
import {
  isIndexBuildSnapshotCoveredInTransactionEffect,
  readIndexCoverageContextInTransactionEffect,
  validateIndexBuildStateFrontierResult,
} from "../indexBuildStates";
import { sqlCall } from "../pointCommitErrors";
import {
  runPointCommitInTransactionEffect,
  projectPointCommitTransactionResult,
} from "../pointCommitPromiseBoundary";
import {
  ApplicationDocumentDefinitionComposition,
  ApplicationDocumentMaterializationOptions,
  PointCommitDependencyV1,
  PreparedPointCommitRowIntentV1,
  ApplicationDocumentDefinitionCommand,
  ApplicationDocumentMaterializationCommand,
  ApplicationDocumentMaterializationClock,
  PreparedPointCommitCandidateSchemaWriteGuard,
  PreparedPointCommitApplicationRelations,
  LocatedPreparedPointCommitApplicationRelations,
  LoadedPointCommitHeadV1,
  PreparedPointCommitApplicationRelationPlan,
  PointCommitApplicationRelationMaintenanceError,
  LockedPointCommitDeveloperIndexV1,
  PointCommitDeveloperIndexEntryHeadV1,
  PointCommitDeveloperIndexEntryActionV1,
  PointCommitDeveloperIndexRowPlanV1,
  PointCommitDeveloperIndexDocumentRequestV1,
  PointCommitUniqueKeyPlanV1,
  PointCommitUniqueKeyOwnerV1,
  PointCommitUniqueKeyOwnerPositionV1,
  PointCommitUniqueKeyActionV1,
  PointCommitDeveloperIndexPositionV1,
  LockedPointCommitIntrinsicIndexV1,
} from "./model";

import {
  PointCommitConflictV1Error,
  PointCommitCorruptionV1Error,
  PointCommitCorruptionReasonV1,
  PointCommitIntrinsicIndexDefinitionUnavailableV1Error,
  PointCommitDeveloperIndexMaintenanceUnavailableV1Error,
  PointCommitUniqueConstraintMaintenanceUnavailableV1Error,
  PointCommitSqlFailureMarkerV1,
  PointCommitSqlOperationV1,
  corruption,
} from "../pointCommitErrors";

import {
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";

import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";

import {
  AppCreationTimeV1Schema,
  decodeCanonicalAppDocumentEvidenceV1Effect,
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";

import {
  appRowIdHexV1ToBytes,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  type CatalogIndexDefinitionId,
  type CatalogUniqueConstraintDefinitionId,
  type CatalogTableId,
} from "flarex-protocol/catalog";

import {
  encodeAppOrderedIndexKeyV1,
  orderedIndexCreationTimeV1,
  orderedIndexKeyBytesHexV1ToBytes,
  orderedIndexKeyHexV1ToBytes,
  orderedIndexRowIdHexV1ToBytes,
  orderedIndexRowIdHexV1FromBytesResult,
  type OrderedIndexKeyHexV1,
  type OrderedIndexRowIdHexV1,
} from "flarex-protocol/ordered-index";

import {
  MAX_PERSISTED_SIGNED_INT64_V1,
  CommitSeqSchema,
  projectScopeIdUuidV1Result,
  type CommitSeq,
  type ReplacementScopeIdV1,
  type ScopeEpoch,
} from "flarex-protocol/storage-authority";

import {
  type CanonicalFlarexValueV1,
} from "flarex-protocol/value";
import {
  lowerAppDeveloperIndexKeyV1,
  type LocateAppDeveloperIndexDefinitionsV1Error,
} from "../appDeveloperIndexCommitV1";

import {
  hasAppUniqueConstraintDefinitionAuthorityV1,
  lowerCanonicalAppUniqueConstraintV1Result,
  type LoweredCanonicalAppUniqueConstraintV1,
} from "../appUniqueConstraintCommitV1";
import {
  isLocatedAppUniqueConstraintDefinitionV1,
  type LocatedAppUniqueConstraintDefinitionV1,
} from "../appUniqueConstraintDefinitions";
import type { ReadAppUniqueConstraintSetClosureV1Error } from "../appUniqueConstraintSetClosureV1";
import {
  AppUniqueConstraintSetBuildIntegrationV1Error,
  prepareActiveUniqueCoverageInTransactionEffect,
  advanceUnboundUniqueCoverageInTransactionEffect,
} from "../appUniqueConstraintSetBuildV1";
import {
  applyAppUniqueKeyMutationsInTransactionEffect,
  readAppUniqueKeyOwnersInTransactionEffect,
  AppUniqueKeyConflictError,
  AppUniqueKeyHashError,
  AppUniqueKeyPersistenceError,
  CanonicalAppUniqueKeyHashCollisionError,
  type ApplyAppUniqueKeyMutationV1Input,
} from "../appUniqueKeys";
import {
  type AppUniqueKeyProjectionV1,
} from "../appUniqueKeyContract";
import {
  appendAppIndexEntryRevisionsInTransactionEffect,
  AppIndexEntryWritePersistenceError,
  AppIndexEntryReadPersistenceError,
  readAppIndexMembershipHeadsInTransactionEffect,
  type AppIndexEntryPositionV1,
  type AppendAppIndexEntryRevisionV1Input,
} from "../appIndexEntries";
import type {
  LocatedAppIndexDefinitionV1,
  ReadAppIndexDefinitionError,
} from "../appIndexDefinitions";
import {
  AppRowReadPersistenceError,
  AppRowWritePersistenceError,
  appendPreparedAppRowRevisionsInTransactionEffect,
  type AppendPreparedAppRowRevisionV1Input,
  type AppRowIdentityV1,
  type AppRowPointDependencyV1,
  type AppRowTransaction,
} from "../appRows";
import { AppRelationEdgePersistenceError } from "../appRelationEdges";
import {
  applyApplicationRelationCommitEdgesInTransactionEffect,
  assertApplicationRelationRestrictProbesInTransactionEffect,
  hasPreparedApplicationRelationCommitAuthority,
  prepareApplicationRelationCommitResult,
  ApplicationRelationCommitCorruptionError,
  ApplicationRelationCommitUnavailableError,
  ApplicationRelationTargetDeleteRestrictedError,
  ApplicationRelationTargetNotLiveError,
  type ApplicationRelationRowTransition,
  type PreparedApplicationRelationCommit,
} from "../applicationRelationCommit";

import { ReadApplicationRelationBindingError } from "../applicationRelationBinding";
import {
  applyAppSchemaCandidateWriteGuardInTransactionEffect,
  prepareAppSchemaCandidateWriteGuardEffect,
  AppSchemaCandidateWriteGuardError,
  type AppSchemaCandidateWriteGuardPort,
  type PreparedAppSchemaCandidateWriteGuard,
} from "../appSchemaCandidateValidation";

import {
  decodeIndexBuildStateRowResult,
  publicationModeForTable,
  type IndexBuildStateRecord,
} from "../indexBuildStates";
import { validateAppRowPointOccV1 } from "../appRowPointOcc";

import { rowsFromDriverExecuteResult } from "../driverExecuteResult";

import { type ScopeClockRecord } from "../scopeClock";
import { type TrustedScopeAuthority } from "../scopeAuthorityResolution";

import { fxAppIndexEntryRevisions, fxSystemIndexBuildStates } from "../schema";

const MAX_SIGNED_COMMIT_SEQ = MAX_PERSISTED_SIGNED_INT64_V1;

const MAX_SIGNED_COMMIT_SEQ_TEXT_LENGTH =
  MAX_SIGNED_COMMIT_SEQ.toString().length;

export const decodePointCommitCreationTimeResult = Schema.decodeUnknownResult(
  Schema.toType(AppCreationTimeV1Schema),
);

export const decodePointCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);

export const MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1 = 256;

/**
 * The unique owner applies bounded statement batches in the borrowed transaction.
 * Allow one constraint transition per material row at the core row ceiling;
 * additional constraints consume the same aggregate budget. A transition may
 * release one previous claim and acquire one replacement claim.
 */
export const MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1 = MAX_POINT_COMMIT_MATERIAL_ROWS_V1;

export const MAX_POINT_COMMIT_UNIQUE_KEY_ACTIONS_V1 = 2 * MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1;

export const prepareIntrinsicIndexDefinitions = Effect.fn(
  "PointCommitTransaction.prepareIntrinsicIndexDefinitions",
)(function* (
  command: ApplicationDocumentDefinitionCommand,
  options: ApplicationDocumentMaterializationOptions,
): Effect.fn.Return<
  ReadonlyArray<LocatedAppIndexDefinitionV1>,
  | ReadAppIndexDefinitionError
  | PointCommitIntrinsicIndexDefinitionUnavailableV1Error
  | PointCommitCorruptionV1Error
> {
  const port = options.intrinsicCreationTimeIndexes;
  if (command.rowIntents.length === 0 || port === undefined) {
    return Object.freeze([]);
  }
  const definitions: LocatedAppIndexDefinitionV1[] = [];
  let previousTableId: CatalogTableId | undefined;
  for (const intent of command.rowIntents) {
    if (intent.tableId === previousTableId) continue;
    previousTableId = intent.tableId;
    const definition = yield* port.locate({
      deploymentId: command.authorityPins.deploymentId,
      scopeId: command.authorityPins.scopeId,
      tableId: intent.tableId,
    });
    if (definition === null) {
      return yield* Effect.fail(
        new PointCommitIntrinsicIndexDefinitionUnavailableV1Error({
          deploymentId: command.authorityPins.deploymentId,
          scopeId: command.authorityPins.scopeId,
          tableId: intent.tableId,
        }),
      );
    }
    if (
      definition.scopeId !== command.authorityPins.scopeId ||
      definition.deploymentId !== command.authorityPins.deploymentId ||
      definition.access.kind !== "by_creation_time" ||
      definition.access.tableId !== intent.tableId
    ) {
      return yield* Effect.fail(corruption("intrinsicIndexBuildInvalid"));
    }
    definitions.push(definition);
  }
  return Object.freeze(definitions);
});

export const prepareDeveloperIndexDefinitions = Effect.fn(
  "PointCommitTransaction.prepareDeveloperIndexDefinitions",
)(function* (
  command: ApplicationDocumentDefinitionCommand,
  options: ApplicationDocumentMaterializationOptions,
): Effect.fn.Return<
  ReadonlyArray<LocatedAppIndexDefinitionV1>,
  | LocateAppDeveloperIndexDefinitionsV1Error
  | PointCommitDeveloperIndexMaintenanceUnavailableV1Error
  | PointCommitCorruptionV1Error
> {
  const port = options.developerIndexes;
  if (command.rowIntents.length === 0 || port === undefined) {
    return Object.freeze([]);
  }
  const definitions = yield* port.locate({
    deploymentId: command.authorityPins.deploymentId,
    scopeId: command.authorityPins.scopeId,
    schemaVersionId: command.authorityPins.schemaVersionId,
    tableIds: Object.freeze([
      ...new Set(command.rowIntents.map((intent) => intent.tableId)),
    ]),
    maximumDefinitions: MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1,
  });
  if (definitions === null) {
    return yield* Effect.fail(
      new PointCommitDeveloperIndexMaintenanceUnavailableV1Error({
        reason: "definitionSetUnavailable",
      }),
    );
  }
  let minimumEntryRevisionCount = 0;
  let previousDefinitionId = 0;
  for (const definition of definitions) {
    if (
      definition.scopeId !== command.authorityPins.scopeId ||
      definition.deploymentId !== command.authorityPins.deploymentId ||
      definition.access.kind !== "developer" ||
      definition.indexDefinitionId <= previousDefinitionId
    ) {
      return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
    }
    previousDefinitionId = definition.indexDefinitionId;
    for (const intent of command.rowIntents) {
      if (intent.tableId === definition.access.tableId) {
        minimumEntryRevisionCount += 1;
      }
    }
  }
  if (
    minimumEntryRevisionCount >
    MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1
  ) {
    return yield* Effect.fail(
      new PointCommitDeveloperIndexMaintenanceUnavailableV1Error({
        reason: "entryRevisionLimitExceeded",
        observed: minimumEntryRevisionCount,
        maximum: MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1,
      }),
    );
  }
  return definitions;
});

export const prepareUniqueConstraintDefinitions = Effect.fn(
  "PointCommitTransaction.prepareUniqueConstraintDefinitions",
)(function* (
  command: ApplicationDocumentDefinitionCommand,
  options: ApplicationDocumentMaterializationOptions,
): Effect.fn.Return<
  ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  | ReadAppUniqueConstraintSetClosureV1Error
  | PointCommitUniqueConstraintMaintenanceUnavailableV1Error
  | PointCommitCorruptionV1Error
> {
  const port = options.uniqueConstraints;
  if (command.rowIntents.length === 0 || port === undefined) {
    return Object.freeze([]);
  }
  if (!hasAppUniqueConstraintDefinitionAuthorityV1(port)) {
    return yield* Effect.fail(
      new PointCommitUniqueConstraintMaintenanceUnavailableV1Error({
        reason: "definitionPortInvalid",
      }),
    );
  }
  const definitions = yield* port.locate({
    deploymentId: command.authorityPins.deploymentId,
    scopeId: command.authorityPins.scopeId,
    schemaVersionId: command.authorityPins.schemaVersionId,
    tableIds: Object.freeze([
      ...new Set(command.rowIntents.map((intent) => intent.tableId)),
    ]),
    maximumDefinitions: MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1,
  });
  if (definitions === null) {
    return yield* Effect.fail(
      new PointCommitUniqueConstraintMaintenanceUnavailableV1Error({
        reason: "definitionSetUnavailable",
      }),
    );
  }
  let previousDefinitionId = 0;
  for (const definition of definitions) {
    if (
      !isLocatedAppUniqueConstraintDefinitionV1(definition) ||
      definition.scopeId !== command.authorityPins.scopeId ||
      definition.deploymentId !== command.authorityPins.deploymentId ||
      definition.schemaVersionId !== command.authorityPins.schemaVersionId ||
      definition.uniqueConstraintDefinitionId <= previousDefinitionId
    ) {
      return yield* Effect.fail(
        corruption("uniqueConstraintDefinitionInvalid"),
      );
    }
    previousDefinitionId = definition.uniqueConstraintDefinitionId;
  }
  yield* Effect.fromResult(
    validateApplicationUniqueTransitionBudget(command.rowIntents, definitions),
  );
  return definitions;
});

export function validateApplicationUniqueTransitionBudget(
  rows: ApplicationDocumentDefinitionCommand["rowIntents"],
  definitions: readonly LocatedAppUniqueConstraintDefinitionV1[],
): Result.Result<
  void,
  PointCommitUniqueConstraintMaintenanceUnavailableV1Error
> {
  const count = definitions.reduce(
    (total, definition) =>
      total + rows.filter((row) => row.tableId === definition.tableId).length,
    0,
  );
  return count > MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1
    ? Result.fail(
        new PointCommitUniqueConstraintMaintenanceUnavailableV1Error({
          reason: "mutationLimitExceeded",
          observed: count,
          maximum: MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1,
        }),
      )
    : Result.succeed(undefined);
}

export const prepareApplicationRelationDefinitions = Effect.fn(
  "PointCommitTransaction.prepareApplicationRelationDefinitions",
)(function* (
  command: ApplicationDocumentDefinitionCommand,
  composition: ApplicationDocumentDefinitionComposition,
  options: ApplicationDocumentMaterializationOptions,
): Effect.fn.Return<
  PreparedPointCommitApplicationRelations | null,
  | ApplicationRelationCommitUnavailableError
  | PointCommitCorruptionV1Error
  | ReadApplicationRelationBindingError
> {
  const port = options.applicationRelations;
  if (command.rowIntents.length === 0 || port === undefined) return null;
  if (!composition.hasRelationAuthority(port)) {
    return yield* Effect.fail(
      new ApplicationRelationCommitUnavailableError({
        reason: "compositionMissing",
      }),
    );
  }
  const definitions = yield* port
    .locate({
      deploymentId: command.authorityPins.deploymentId,
      schemaVersionId: command.authorityPins.schemaVersionId,
    })
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof ApplicationRelationCommitCorruptionError ||
        (cause instanceof ReadApplicationRelationBindingError &&
          cause.reason !== "resourceFailure")
          ? corruption("relationBindingInvalid")
          : cause,
      ),
    );
  if (definitions === null) {
    return Object.freeze({ port, definitions: null });
  }
  if (
    definitions.deploymentId !== command.authorityPins.deploymentId ||
    definitions.schemaVersionId !== command.authorityPins.schemaVersionId
  ) {
    return yield* Effect.fail(corruption("relationBindingInvalid"));
  }
  return Object.freeze({ port, definitions });
});

export const prepareCandidateSchemaWriteGuard = Effect.fn(
  "PointCommitTransaction.prepareCandidateSchemaWriteGuard",
)(function* (
  command: ApplicationDocumentDefinitionCommand,
  composition: ApplicationDocumentDefinitionComposition,
  options: ApplicationDocumentMaterializationOptions,
): Effect.fn.Return<
  Readonly<{
    readonly guard: AppSchemaCandidateWriteGuardPort;
    readonly prepared: PreparedAppSchemaCandidateWriteGuard;
  }> | null,
  AppSchemaCandidateWriteGuardError
> {
  const guard = options.candidateSchemaWriteGuard;
  if (command.rowIntents.length === 0 || guard === undefined) return null;
  if (!composition.hasCandidateGuardAuthority(guard)) {
    return yield* Effect.fail(
      new AppSchemaCandidateWriteGuardError({
        reason: "compositionMismatch",
      }),
    );
  }
  const prepared = yield* prepareAppSchemaCandidateWriteGuardEffect(guard, {
    deploymentId: command.authorityPins.deploymentId,
    scopeId: command.authorityPins.scopeId,
  });
  return Object.freeze({ guard, prepared });
});

export function hasOwn<T extends object>(
  value: T,
  field: PropertyKey,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

export function pointDependenciesEqual(
  left: PointCommitDependencyV1,
  right: PointCommitDependencyV1,
): boolean {
  if (
    left.documentId !== right.documentId ||
    left.tableId !== right.tableId ||
    left.rowId !== right.rowId ||
    left.dependency.observed.kind !== right.dependency.observed.kind
  ) {
    return false;
  }
  if (
    left.dependency.observed.kind === "present" &&
    right.dependency.observed.kind === "present"
  ) {
    return (
      left.dependency.observed.revisionCommitSeq ===
      right.dependency.observed.revisionCommitSeq
    );
  }
  if (
    left.dependency.observed.kind !== "missing" ||
    right.dependency.observed.kind !== "missing" ||
    left.dependency.observed.basis.kind !== right.dependency.observed.basis.kind
  ) {
    return false;
  }
  return (
    left.dependency.observed.basis.kind === "noVisibleRevision" ||
    (right.dependency.observed.basis.kind === "tombstone" &&
      left.dependency.observed.basis.revisionCommitSeq ===
        right.dependency.observed.basis.revisionCommitSeq)
  );
}

/** The existing Application row/index/unique lowering order, shared by both participants. */
export async function materializeApplicationDocumentRows(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  commitSeq: CommitSeq,
  clock: ScopeClockRecord,
  loadedHeads: ReadonlyArray<LoadedPointCommitHeadV1>,
  intrinsicBuilds: ReadonlyArray<LockedPointCommitIntrinsicIndexV1>,
  developerIndexActions: ReadonlyArray<PointCommitDeveloperIndexEntryActionV1>,
  developerBuilds: ReadonlyArray<LockedPointCommitDeveloperIndexV1>,
  uniqueKeyActions: ReadonlyArray<PointCommitUniqueKeyActionV1>,
  uniqueDefinitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  publicationProfile: import("../indexBuildStates").IndexPublicationProfile,
  options: ApplicationDocumentMaterializationOptions,
  deferCoverage = false,
): Promise<(() => Promise<void>) | void> {
  const writeEpoch = clock.epoch;
  const maintainedBuilds = [...intrinsicBuilds, ...developerBuilds];
  const coverageContext = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
    readIndexCoverageContextInTransactionEffect(tx, clock).pipe(Effect.mapError(cause =>
      cause.reason === "resourceFailure" ? new PointCommitSqlFailureMarkerV1("lockDeveloperIndexBuilds", cause.cause)
        : corruption("developerIndexBuildInvalid"))),
  ));
  const uniqueBuilds = await runUniqueCoverage(
    prepareActiveUniqueCoverageInTransactionEffect(tx, clock, command.authorityPins.schemaVersionId,
      uniqueDefinitions, coverageContext, publicationProfile, deferCoverage),
  );
  for (const { build, definition } of maintainedBuilds) {
    const mode = publicationModeForTable(publicationProfile, definition.access.tableId);
    if ((mode === "activeApplication" && coverageContext.active !== null && (build.lifecycle !== "enabled" || build.maintenance === null)) ||
      (mode === "sourceBound" && (build.lifecycle !== "enabled" || build.maintenance !== null)) ||
      (typeof publicationProfile !== "string" && mode === "activeApplication" && coverageContext.active === null))
      throw new PointCommitDeveloperIndexMaintenanceUnavailableV1Error({ reason: "definitionSetUnavailable" });
    const maintenanceSchemaVersionId = typeof publicationProfile !== "string" && mode === "activeApplication"
      ? coverageContext.active?.schema.schemaVersionId : command.authorityPins.schemaVersionId;
    if (build.maintenance !== null && (build.maintenance.frame.schemaVersionId !== maintenanceSchemaVersionId ||
      build.maintenance.frame.deploymentId !== command.authorityPins.deploymentId ||
      build.maintenance.frame.physicalSpecSha256Hex !== definition.physicalSpecSha256Hex))
      throw corruption("developerIndexBuildInvalid");
    if (build.lifecycle !== "enabled") continue;
    const covered = projectPointCommitTransactionResult(
      await runPointCommitInTransactionEffect(
        isIndexBuildSnapshotCoveredInTransactionEffect(
          tx,
          build,
          { ...definition, tableId: definition.access.tableId },
          CommitSeqSchema.make(commitSeq - 1n),
          coverageContext,
        ).pipe(
          Effect.mapError((cause) =>
            cause instanceof AppRowReadPersistenceError || (cause instanceof IndexMaintenanceError && cause.reason === "resourceFailure")
              ? new PointCommitSqlFailureMarkerV1(
                  "lockDeveloperIndexBuilds",
                  cause.cause,
                )
              : corruption("developerIndexBuildInvalid"),
          ),
        ),
      ),
    );
    if (!covered)
      throw new PointCommitDeveloperIndexMaintenanceUnavailableV1Error({
        reason: "definitionSetUnavailable",
      });
    // A batch can rely on table-local frontier proof only before its first
    // page. Persist that baseline while the scope is locked so its own later
    // pages remain covered without admitting any intervening committed write.
    const baselineCoverage = build.coveredThroughCommitSeq;
    if (deferCoverage && mode === "sourceBound" && baselineCoverage !== null &&
      baselineCoverage < clock.lastCommitSeq) {
      const updated = await sqlCall("resetDeveloperIndexValidation", () => tx.update(fxSystemIndexBuildStates)
        .set({ coveredThroughCommitSeq: clock.lastCommitSeq, updatedAt: sql`clock_timestamp()` })
        .where(and(eq(fxSystemIndexBuildStates.scopeId, build.scopeId),
          eq(fxSystemIndexBuildStates.indexDefinitionId, build.indexDefinitionId),
          eq(fxSystemIndexBuildStates.attemptFence, build.attemptFence),
          eq(fxSystemIndexBuildStates.epoch, build.epoch),
          eq(fxSystemIndexBuildStates.storageGenerationFence, build.storageGenerationFence),
          eq(fxSystemIndexBuildStates.coveredThroughCommitSeq, baselineCoverage),
          eq(fxSystemIndexBuildStates.lifecycle, "enabled"))).returning({ id: fxSystemIndexBuildStates.indexDefinitionId }));
      if (updated.length !== 1) throw corruption("developerIndexBuildInvalid");
    }
  }
  const rowRevisions = command.rowIntents.map((intent) =>
    projectPointCommitTransactionResult(
      prepareTentativePointCommitRowResult(
        writeEpoch,
        commitSeq,
        command,
        loadedHeads,
        intent,
      ),
    ),
  );
  if (rowRevisions.length > 0 && intrinsicBuilds.length > 0)
    await emitTransactionStep(options, command, "intrinsicMembershipPreparing");
  const intrinsicActions = projectPointCommitTransactionResult(
    await runPointCommitInTransactionEffect(
      prepareIntrinsicIndexActionsEffect(
        tx,
        command.authorityPins.scopeId,
        rowRevisions,
        intrinsicBuilds,
      ),
    ),
  );
  if (rowRevisions.length > 0 && intrinsicBuilds.length > 0)
    await emitTransactionStep(options, command, "intrinsicMembershipPrepared");
  if (rowRevisions.length > 0) await emitTransactionStep(options, command, "rowBatchWriting");
  projectPointCommitTransactionResult(
    await runPointCommitInTransactionEffect(
      appendPreparedAppRowRevisionsInTransactionEffect(tx, rowRevisions).pipe(
        Effect.mapError(cause => cause instanceof AppRowWritePersistenceError
          ? new PointCommitSqlFailureMarkerV1("writeTentativeRow", cause.cause)
          : cause),
      ),
    ),
  );
  if (rowRevisions.length > 0) await emitTransactionStep(options, command, "rowBatchWritten");
  for (let rowIndex = 0; rowIndex < rowRevisions.length; rowIndex += 1) {
    await emitTransactionStep(options, command, "tentativeRowWritten");
  }
  const indexActions = [
    ...intrinsicActions.values(),
    ...developerIndexActions.map(action => ({
      kind: action.kind, scopeId: command.authorityPins.scopeId, definition: action.definition,
      encodedKey: action.encodedKey, rowId: action.rowId, writeEpoch, commitSeq,
    })),
  ];
  if (indexActions.length > 0) {
    await emitTransactionStep(options, command, "indexBatchWriting");
    projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
      appendAppIndexEntryRevisionsInTransactionEffect(tx, indexActions).pipe(
        Effect.mapError(cause => cause instanceof AppIndexEntryWritePersistenceError || cause instanceof AppIndexEntryReadPersistenceError
          ? new PointCommitSqlFailureMarkerV1("writeIndexEntries", cause.cause) : cause),
      ),
    ));
    await emitTransactionStep(options, command, "indexBatchWritten");
    for (let i = 0; i < intrinsicActions.size; i++)
      await emitTransactionStep(options, command, "intrinsicIndexEntryWritten");
    for (let i = 0; i < developerIndexActions.length; i++)
      await emitTransactionStep(options, command, "developerIndexEntryWritten");
  }
  for (const intrinsic of intrinsicBuilds) {
    await resetPointCommitIntrinsicIndexValidation(tx, intrinsic.build);
  }
  await writePointCommitUniqueKeyActions(
    tx,
    command,
    writeEpoch,
    uniqueKeyActions,
    options,
  );
  // Page writes may share one publication sequence. The coverage watermarks
  // must advance only after every page is lowered, or the next page would be
  // validated against a future watermark while the scope clock is still old.
  const coverageSchemaVersionId = command.authorityPins.schemaVersionId;
  const coverageAuthority = { authorityPins: { scopeId: command.authorityPins.scopeId } };
  const completeCoverage = async () => {
    for (const { build } of maintainedBuilds) {
      if (build.lifecycle !== "enabled" || build.maintenance !== null) continue;
      const updated = await sqlCall("resetDeveloperIndexValidation", () =>
        tx
          .update(fxSystemIndexBuildStates)
          .set({
            coveredThroughCommitSeq: commitSeq,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(fxSystemIndexBuildStates.scopeId, build.scopeId),
              eq(
                fxSystemIndexBuildStates.indexDefinitionId,
                build.indexDefinitionId,
              ),
              eq(fxSystemIndexBuildStates.attemptFence, build.attemptFence),
              eq(fxSystemIndexBuildStates.epoch, build.epoch),
              eq(
                fxSystemIndexBuildStates.storageGenerationFence,
                build.storageGenerationFence,
              ),
              eq(fxSystemIndexBuildStates.lifecycle, "enabled"),
            ),
          )
          .returning({ id: fxSystemIndexBuildStates.indexDefinitionId }),
      );
      if (updated.length !== 1) throw corruption("developerIndexBuildInvalid");
    }

    await runUniqueCoverage(
      advanceUnboundUniqueCoverageInTransactionEffect(
        tx,
        uniqueBuilds,
        commitSeq,
        coverageSchemaVersionId,
      ),
    );
    if (uniqueBuilds.length > 0)
      await emitTransactionStep(
        options,
        coverageAuthority,
        "uniquePublicationApplied",
      );
  };
  if (deferCoverage) return completeCoverage;
  await completeCoverage();
}

async function runUniqueCoverage<A>(
  effect: Effect.Effect<
    A,
    | AppUniqueConstraintSetBuildIntegrationV1Error
    | import("../appUniqueConstraintSetBuildV1").AppUniqueConstraintSetBuildStateV1Error
  >,
): Promise<A> {
  return projectPointCommitTransactionResult(
    (await runPointCommitInTransactionEffect(effect)).pipe(
      Result.mapError((failure) =>
        failure instanceof AppUniqueConstraintSetBuildIntegrationV1Error
          ? new PointCommitSqlFailureMarkerV1(
              "maintainUniqueConstraintCoverage",
              failure.cause,
            )
          : corruption("uniqueConstraintBuildInvalid"),
      ),
    ),
  );
}

export async function preparePointCommitApplicationRelationPlan(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  priorState: ApplicationDocumentPriorState,
  relations: LocatedPreparedPointCommitApplicationRelations | null,
  lastCommitSeq: bigint,
  options: ApplicationDocumentMaterializationOptions,
): Promise<PreparedPointCommitApplicationRelationPlan | null> {
  if (relations === null) return null;
  const { headsByDocumentId, documents: priorDocuments } = priorState;
  const sourceTableIds = new Set(
    relations.definitions.definitions.map(definition => definition.binding.sourceTableId),
  );
  const relationTableIds = new Set(
    relations.definitions.definitions.flatMap((definition) => [
      definition.binding.sourceTableId,
      definition.binding.targetTableId,
    ]),
  );
  const transitions: ApplicationRelationRowTransition[] = [];
  for (const intent of command.rowIntents) {
    if (!relationTableIds.has(intent.tableId)) continue;
    const loaded = headsByDocumentId.get(intent.documentId);
    if (loaded === undefined) {
      throw corruption("relationTransitionInvalid");
    }
    const prior = sourceTableIds.has(intent.tableId)
      ? priorDocuments.get(intent.documentId) ?? null
      : null;
    if (
      sourceTableIds.has(intent.tableId) &&
      loaded.head.kind === "live" &&
      prior === null
    ) {
      throw corruption("relationTransitionInvalid");
    }
    transitions.push(
      Object.freeze({
        documentId: intent.documentId,
        tableId: intent.tableId,
        rowId: intent.rowId,
        prior,
        final: intent.kind === "live" ? intent.document : null,
      }),
    );
  }
  if (transitions.length === 0) return null;
  const prepared = projectPointCommitTransactionResult(
    prepareApplicationRelationCommitResult(
      relations.definitions,
      Object.freeze(transitions),
    ).pipe(
      Result.mapError((cause) =>
        cause instanceof ApplicationRelationCommitCorruptionError
          ? corruption(
              cause.reason === "invalidDefinitionSet"
                ? "relationBindingInvalid"
                : "relationTransitionInvalid",
            )
          : cause,
      ),
    ),
  );
  if (
    !hasPreparedApplicationRelationCommitAuthority(
      relations.port,
      prepared,
      command.authorityPins.schemaVersionId,
    )
  ) {
    throw corruption("relationTransitionInvalid");
  }
  await validatePointCommitApplicationRelationTargets(
    tx,
    command,
    prepared,
    lastCommitSeq,
    options,
  );
  return Object.freeze({ port: relations.port, prepared });
}

async function validatePointCommitApplicationRelationTargets(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  prepared: PreparedApplicationRelationCommit,
  lastCommitSeq: bigint,
  options: ApplicationDocumentMaterializationOptions,
): Promise<void> {
  const checks = prepared.storedTargetChecks;
  if (checks.length === 0) return;
  const scopeUuid = projectPointCommitTransactionResult(
    projectScopeIdUuidV1Result(command.authorityPins.scopeId).pipe(
      Result.mapError(() => corruption("relationTargetEvidenceInvalid")),
    ),
  ).scopeUuid;
  const values = sql.join(
    checks.map(
      (check, ordinal) => sql`
    (
      ${ordinal}::integer,
      ${check.tableId}::integer,
      ${appRowIdHexV1ToBytes(check.rowId)}::bytea
    )
  `,
    ),
    sql`, `,
  );
  const statement = sql`
    with requested(ordinal, table_id, row_id) as (
      values ${values}
    )
    select
      requested.ordinal::text as "ordinalText",
      current_row.commit_seq::text as "pointerCommitSeqText",
      revision.commit_seq::text as "revisionCommitSeqText",
      revision.is_tombstone as "isTombstone"
    from requested
    left join fx_app_row_current as current_row
      on current_row.scope_uuid = ${scopeUuid}
      and current_row.table_id = requested.table_id
      and current_row.row_id = requested.row_id
    left join fx_app_row_rev as revision
      on revision.scope_uuid = ${scopeUuid}
      and revision.table_id = requested.table_id
      and revision.row_id = requested.row_id
      and revision.commit_seq = current_row.commit_seq
    order by requested.ordinal asc
  `;
  options.observeQuery?.(
    Object.freeze({
      name: "loadRelationTargets",
      sql: "bounded VALUES with exact current-pointer relation-target evidence",
      params: Object.freeze([]),
    }),
  );
  const result = await sqlCall("loadRelationTargets", () =>
    tx.execute(statement),
  );
  const rows = rowsFromDriverExecuteResult(result, () => {
    throw corruption("relationTargetEvidenceInvalid");
  });
  if (rows.length !== checks.length) {
    throw corruption("relationTargetEvidenceInvalid");
  }
  for (let ordinal = 0; ordinal < checks.length; ordinal += 1) {
    const raw = rows[ordinal];
    const check = checks[ordinal];
    if (
      !isNonArrayRecord(raw) ||
      check === undefined ||
      raw.ordinalText !== String(ordinal)
    ) {
      throw corruption("relationTargetEvidenceInvalid");
    }
    const pointerCommitSeq = projectPointCommitTransactionResult(
      parseNullableCommitSeqTextResult(raw.pointerCommitSeqText).pipe(
        Result.mapError(() => corruption("relationTargetEvidenceInvalid")),
      ),
    );
    const revisionCommitSeq = projectPointCommitTransactionResult(
      parseNullableCommitSeqTextResult(raw.revisionCommitSeqText).pipe(
        Result.mapError(() => corruption("relationTargetEvidenceInvalid")),
      ),
    );
    if (
      pointerCommitSeq === null &&
      revisionCommitSeq === null &&
      raw.isTombstone === null
    ) {
      throw new ApplicationRelationTargetNotLiveError({
        targetDocumentId: check.documentId,
      });
    }
    if (
      pointerCommitSeq === null ||
      revisionCommitSeq === null ||
      pointerCommitSeq !== revisionCommitSeq ||
      revisionCommitSeq > lastCommitSeq ||
      typeof raw.isTombstone !== "boolean"
    ) {
      throw corruption("relationTargetEvidenceInvalid");
    }
    if (raw.isTombstone) {
      throw new ApplicationRelationTargetNotLiveError({
        targetDocumentId: check.documentId,
      });
    }
  }
}

export const maintainPointCommitApplicationRelationsEffect = Effect.fn(
  "PointCommitTransaction.maintainApplicationRelations",
)(function* (
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  commitSeq: CommitSeq,
  plan: PreparedPointCommitApplicationRelationPlan,
  options: ApplicationDocumentMaterializationOptions,
): Effect.fn.Return<void, PointCommitApplicationRelationMaintenanceError> {
  if (plan.prepared.actions.length > 0) {
    yield* applyApplicationRelationCommitEdgesInTransactionEffect(
      plan.port,
      tx,
      {
        scopeId: command.authorityPins.scopeId,
        schemaVersionId: command.authorityPins.schemaVersionId,
        commitSeq,
        prepared: plan.prepared,
      },
    ).pipe(
      Effect.mapError((cause) => {
        if (cause instanceof ApplicationRelationCommitUnavailableError) {
          return cause;
        }
        if (cause instanceof AppRelationEdgePersistenceError) {
          return new PointCommitSqlFailureMarkerV1(
            "writeRelationEdges",
            cause.cause,
          );
        }
        return corruption("relationEdgeInvalid");
      }),
    );
    // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: transaction - proof-hook rejection aborts the transaction and preserves cause identity
    yield* Effect.promise(() =>
      emitTransactionStep(options, command, "relationEdgeWritten"),
    );
  }

  yield* assertApplicationRelationRestrictProbesInTransactionEffect(
    plan.port,
    tx,
    command.authorityPins.scopeId,
    plan.prepared,
  ).pipe(
    Effect.mapError((cause) => {
      if (
        cause instanceof ApplicationRelationCommitUnavailableError ||
        cause instanceof ApplicationRelationTargetDeleteRestrictedError
      ) {
        return cause;
      }
      if (cause instanceof AppRelationEdgePersistenceError) {
        return new PointCommitSqlFailureMarkerV1(
          "validateRelationRestrict",
          cause.cause,
        );
      }
      return corruption("relationEdgeInvalid");
    }),
  );
  if (plan.prepared.restrictProbes.length > 0) {
    // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: transaction - proof-hook rejection aborts the transaction and preserves cause identity
    yield* Effect.promise(() =>
      emitTransactionStep(options, command, "relationRestrictValidated"),
    );
  }
});

export async function loadPointCommitHeads(
  tx: AppRowTransaction,
  clock: ApplicationDocumentMaterializationClock,
  command: Pick<
    ApplicationDocumentMaterializationCommand,
    "authorityPins" | "dependencies"
  >,
  options: ApplicationDocumentMaterializationOptions,
): Promise<ReadonlyArray<LoadedPointCommitHeadV1>> {
  if (command.dependencies.length === 0) return Object.freeze([]);
  const values = sql.join(
    command.dependencies.map(
      (dependency, ordinal) => sql`
      (
        ${ordinal}::integer,
        ${dependency.tableId}::integer,
        ${appRowIdHexV1ToBytes(dependency.rowId)}::bytea
      )
    `,
    ),
    sql`, `,
  );
  const statement = sql`
    with requested(ordinal, table_id, row_id) as (
      values ${values}
    )
    select
      requested.ordinal::text as "ordinalText",
      current_row.commit_seq::text as "pointerCommitSeqText",
      latest.commit_seq::text as "latestCommitSeqText",
      latest.is_tombstone as "latestIsTombstone",
      latest.creation_time::text as "latestCreationTimeText"
    from requested
    left join fx_app_row_current as current_row
      on current_row.scope_uuid = ${clock.scopeUuid}
      and current_row.table_id = requested.table_id
      and current_row.row_id = requested.row_id
    left join lateral (
      select revision.commit_seq, revision.is_tombstone, revision.creation_time
      from fx_app_row_rev as revision
      where revision.scope_uuid = ${clock.scopeUuid}
        and revision.table_id = requested.table_id
        and revision.row_id = requested.row_id
      order by revision.commit_seq desc
      limit 1
    ) as latest on true
    order by requested.ordinal asc
  `;
  options.observeQuery?.(
    Object.freeze({
      name: "loadRowHeads",
      sql: "bounded VALUES with current-pointer and latest-revision correlation",
      params: Object.freeze([]),
    }),
  );
  const result = await sqlCall("loadRowHeads", () => tx.execute(statement));
  const rows = rowsFromDriverExecuteResult(result, () => {
    throw corruption("rowHeadInvalid");
  });
  return projectPointCommitTransactionResult(
    capturePointCommitHeadsResult(rows, command, clock.record.lastCommitSeq),
  );
}

function capturePointCommitHeadsResult(
  rows: ReadonlyArray<unknown>,
  command: Pick<
    ApplicationDocumentMaterializationCommand,
    "authorityPins" | "dependencies"
  >,
  lastCommitSeq: CommitSeq,
): Result.Result<
  ReadonlyArray<LoadedPointCommitHeadV1>,
  PointCommitCorruptionV1Error
> {
  return Result.gen(function* () {
    const rowCount = rows.length;
    if (rowCount !== command.dependencies.length) {
      return yield* Result.fail(corruption("rowHeadInvalid"));
    }
    const heads: LoadedPointCommitHeadV1[] = [];
    for (let ordinal = 0; ordinal < rowCount; ordinal += 1) {
      if (!Object.hasOwn(rows, ordinal)) {
        return yield* Result.fail(corruption("dependencySetInvalid"));
      }
      heads.push(
        yield* decodePointCommitHeadResult(
          rows[ordinal],
          ordinal,
          command.dependencies[ordinal],
          command.authorityPins.scopeId,
          lastCommitSeq,
        ),
      );
    }
    return Object.freeze(heads);
  });
}

function decodePointCommitHeadResult(
  raw: unknown,
  expectedOrdinal: number,
  dependency: PointCommitDependencyV1 | undefined,
  scopeId: ReplacementScopeIdV1,
  lastCommitSeq: CommitSeq,
): Result.Result<LoadedPointCommitHeadV1, PointCommitCorruptionV1Error> {
  if (dependency === undefined || !isNonArrayRecord(raw)) {
    return Result.fail(corruption("rowHeadInvalid"));
  }
  return Result.gen(function* () {
    const ordinal = yield* parseNonNegativeIntegerTextResult(raw.ordinalText);
    const pointerCommitSeq = yield* parseNullableCommitSeqTextResult(
      raw.pointerCommitSeqText,
    );
    const latestCommitSeq = yield* parseNullableCommitSeqTextResult(
      raw.latestCommitSeqText,
    );
    if (
      ordinal !== expectedOrdinal ||
      (pointerCommitSeq === null) !== (latestCommitSeq === null) ||
      pointerCommitSeq !== latestCommitSeq
    ) {
      return yield* Result.fail(corruption("rowHeadInvalid"));
    }
    const identity = freezeRowIdentity(dependency, scopeId);
    if (latestCommitSeq === null) {
      if (
        raw.latestIsTombstone !== null ||
        raw.latestCreationTimeText !== null
      ) {
        return yield* Result.fail(corruption("rowHeadInvalid"));
      }
      return Object.freeze({
        head: Object.freeze({ kind: "missing", identity }),
        creationTime: null,
      });
    }
    if (
      latestCommitSeq > lastCommitSeq ||
      typeof raw.latestIsTombstone !== "boolean" ||
      typeof raw.latestCreationTimeText !== "string"
    ) {
      return yield* Result.fail(corruption("rowHeadInvalid"));
    }
    const creationTime = yield* decodePointCommitCreationTimeResult(
      Number(raw.latestCreationTimeText),
    ).pipe(Result.mapError(() => corruption("rowHeadInvalid")));
    return Object.freeze({
      head: Object.freeze({
        kind: raw.latestIsTombstone ? "tombstone" : "live",
        identity,
        revisionCommitSeq: latestCommitSeq,
      }),
      creationTime,
    });
  });
}

export function validatePointCommitDependenciesResult(
  command: Pick<
    ApplicationDocumentMaterializationCommand,
    "authorityPins" | "dependencies"
  >,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
): Result.Result<
  void,
  PointCommitConflictV1Error | PointCommitCorruptionV1Error
> {
  return findPointCommitConflictAfterEvidenceValidationResult(
    command,
    heads,
  ).pipe(
    Result.flatMap((conflict) =>
      conflict === null ? Result.succeed(undefined) : Result.fail(conflict),
    ),
  );
}

export function findPointCommitConflictAfterEvidenceValidationResult(
  command: Pick<
    ApplicationDocumentMaterializationCommand,
    "authorityPins" | "dependencies"
  >,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
): Result.Result<
  PointCommitConflictV1Error | null,
  PointCommitCorruptionV1Error
> {
  if (heads.length !== command.dependencies.length) {
    return Result.fail(corruption("dependencySetInvalid"));
  }
  let firstConflict: PointCommitConflictV1Error | null = null;
  for (let index = 0; index < command.dependencies.length; index += 1) {
    const dependency = command.dependencies[index];
    const loaded = heads[index];
    if (dependency === undefined || loaded === undefined) {
      return Result.fail(corruption("dependencySetInvalid"));
    }
    const validation = validateAppRowPointOccV1({
      snapshotToken: command.authorityPins.snapshotToken,
      dependency: adaptPointDependency(
        command.authorityPins.scopeId,
        dependency,
      ),
      head: loaded.head,
    });
    switch (validation.kind) {
      case "valid":
        break;
      case "conflict":
        firstConflict ??= new PointCommitConflictV1Error({
          conflict: Object.freeze({
            kind: "appRowPoint",
            documentId: dependency.documentId,
          }),
          snapshotCommitSeq: validation.conflict.snapshotCommitSeq,
          currentCommitSeq: validation.conflict.currentState.revisionCommitSeq,
        });
        break;
      case "invalidEvidence":
        return Result.fail(corruption("occEvidenceInvalid"));
    }
  }
  return Result.succeed(firstConflict);
}

function adaptPointDependency(
  scopeId: ReplacementScopeIdV1,
  input: PointCommitDependencyV1,
): AppRowPointDependencyV1 {
  const identity = freezeRowIdentity(input, scopeId);
  switch (input.dependency.observed.kind) {
    case "present":
      return Object.freeze({
        kind: "present",
        identity,
        revisionCommitSeq: input.dependency.observed.revisionCommitSeq,
      });
    case "missing":
      switch (input.dependency.observed.basis.kind) {
        case "noVisibleRevision":
          return Object.freeze({
            kind: "missing",
            identity,
            basis: Object.freeze({ kind: "noVisibleRevision" }),
          });
        case "tombstone":
          return Object.freeze({
            kind: "missing",
            identity,
            basis: Object.freeze({
              kind: "tombstone",
              revisionCommitSeq:
                input.dependency.observed.basis.revisionCommitSeq,
            }),
          });
      }
  }
}

export async function lockPointCommitDeveloperIndexBuilds(
  tx: AppRowTransaction,
  clock: ApplicationDocumentMaterializationClock,
  definitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  command: ApplicationDocumentMaterializationCommand,
): Promise<ReadonlyArray<LockedPointCommitDeveloperIndexV1>> {
  if (definitions.length === 0) return Object.freeze([]);
  const rows = await sqlCall("lockDeveloperIndexBuilds", () =>
    tx
      .select()
      .from(fxSystemIndexBuildStates)
      .where(
        and(
          eq(fxSystemIndexBuildStates.scopeId, command.authorityPins.scopeId),
          inArray(
            fxSystemIndexBuildStates.indexDefinitionId,
            definitions.map((definition) => definition.indexDefinitionId),
          ),
        ),
      )
      .orderBy(fxSystemIndexBuildStates.indexDefinitionId)
      .for("share"),
  );
  if (rows.length !== definitions.length) {
    throw corruption("developerIndexBuildInvalid");
  }
  const locked: LockedPointCommitDeveloperIndexV1[] = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const row = rows[index];
    if (definition === undefined || row === undefined) {
      throw corruption("developerIndexBuildInvalid");
    }
    const state = projectPointCommitTransactionResult(
      decodeIndexBuildStateRowResult(
        row,
        command.authorityPins.scopeId,
        definition.indexDefinitionId,
      ).pipe(Result.mapError(() => corruption("developerIndexBuildInvalid"))),
    );
    if (
      definition.access.kind !== "developer" ||
      state.indexDefinitionId !== definition.indexDefinitionId ||
      state.storageGeneration !== clock.record.storageGeneration ||
      state.storageGenerationFence !== clock.record.storageGenerationFence ||
      state.epoch !== clock.record.epoch ||
      state.lifecycle === "retiring"
    ) {
      throw corruption("developerIndexBuildInvalid");
    }
    projectPointCommitTransactionResult(
      validateIndexBuildStateFrontierResult(
        state,
        clock.record.lastCommitSeq,
      ).pipe(Result.mapError(() => corruption("developerIndexBuildInvalid"))),
    );
    locked.push(Object.freeze({ definition, build: state }));
  }
  return Object.freeze(locked);
}

export async function preparePointCommitDeveloperIndexActions(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  priorState: ApplicationDocumentPriorState,
  builds: ReadonlyArray<LockedPointCommitDeveloperIndexV1>,
): Promise<ReadonlyArray<PointCommitDeveloperIndexEntryActionV1>> {
  const plans: PointCommitDeveloperIndexRowPlanV1[] = [];
  const { headsByDocumentId: loadedHeadsByDocumentId, documents: priorDocuments } = priorState;
  for (const locked of builds) {
    for (const intent of command.rowIntents) {
      const loaded = loadedHeadsByDocumentId.get(intent.documentId);
      if (
        loaded === undefined ||
        intent.tableId !== locked.definition.access.tableId
      ) {
        continue;
      }
      const rowId = projectPointCommitTransactionResult(
        orderedIndexRowIdHexV1FromBytesResult(
          appRowIdHexV1ToBytes(intent.rowId),
        ).pipe(
          Result.mapError(() => corruption("developerIndexTransitionInvalid")),
        ),
      );
      const priorDocument = priorDocuments.get(intent.documentId) ?? null;
      if (
        loaded.head.kind === "live" &&
        (priorDocument === null || loaded.creationTime === null)
      ) {
        throw corruption("developerIndexTransitionInvalid");
      }
      const priorKey =
        loaded.head.kind === "live" &&
        priorDocument !== null &&
        loaded.creationTime !== null
          ? lowerDeveloperIndexKey(
              locked.definition,
              priorDocument,
              loaded.creationTime,
            )
          : null;
      const finalKey =
        intent.kind === "live"
          ? lowerDeveloperIndexKey(
              locked.definition,
              intent.document,
              intent.creationTime,
            )
          : null;
      plans.push(
        Object.freeze({
          definition: locked.definition,
          build: locked.build,
          rowId,
          priorCommitSeq:
            loaded.head.kind === "live" ? loaded.head.revisionCommitSeq : null,
          priorKey,
          finalKey,
        }),
      );
    }
  }
  const positions = uniqueDeveloperIndexPositions(plans);
  const heads = await loadPointCommitDeveloperIndexEntryHeads(
    tx,
    command,
    positions,
  );
  const actions: PointCommitDeveloperIndexEntryActionV1[] = [];
  for (const plan of plans) {
    const priorHead =
      plan.priorKey === null
        ? null
        : (heads.get(
            developerIndexPositionKey(
              plan.definition.indexDefinitionId,
              plan.priorKey,
              plan.rowId,
            ),
          ) ?? null);
    const finalHead =
      plan.finalKey === null
        ? null
        : (heads.get(
            developerIndexPositionKey(
              plan.definition.indexDefinitionId,
              plan.finalKey,
              plan.rowId,
            ),
          ) ?? null);
    const sameKey = plan.priorKey !== null && plan.priorKey === plan.finalKey;
    if (plan.priorKey !== null) {
      if (
        priorHead?.commitSeq !== null &&
        priorHead?.commitSeq !== undefined &&
        (priorHead.isTombstone ||
          plan.priorCommitSeq === null ||
          priorHead.commitSeq > plan.priorCommitSeq)
      ) {
        throw corruption("developerIndexTransitionInvalid");
      }
      if (
        (priorHead === null || priorHead.commitSeq === null) &&
        plan.build.lifecycle === "enabled"
      ) {
        throw corruption("developerIndexTransitionInvalid");
      }
      if (sameKey && (priorHead === null || priorHead.commitSeq === null)) {
        actions.push(
          Object.freeze({
            kind: "live",
            definition: plan.definition,
            encodedKey: plan.priorKey,
            rowId: plan.rowId,
          }),
        );
      } else if (
        !sameKey &&
        priorHead !== null &&
        priorHead.commitSeq !== null
      ) {
        actions.push(
          Object.freeze({
            kind: "tombstone",
            definition: plan.definition,
            encodedKey: plan.priorKey,
            rowId: plan.rowId,
          }),
        );
      }
    }
    if (plan.finalKey !== null && !sameKey) {
      if (finalHead?.commitSeq !== null && finalHead?.isTombstone === false) {
        throw corruption("developerIndexTransitionInvalid");
      }
      actions.push(
        Object.freeze({
          kind: "live",
          definition: plan.definition,
          encodedKey: plan.finalKey,
          rowId: plan.rowId,
        }),
      );
    }
  }
  if (actions.length > MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1) {
    throw new PointCommitDeveloperIndexMaintenanceUnavailableV1Error({
      reason: "entryRevisionLimitExceeded",
      observed: actions.length,
      maximum: MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1,
    });
  }
  actions.sort(compareDeveloperIndexEntryActions);
  return Object.freeze(actions);
}

export async function preparePointCommitUniqueKeyActions(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  priorState: ApplicationDocumentPriorState,
  definitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
): Promise<ReadonlyArray<PointCommitUniqueKeyActionV1>> {
  if (definitions.length === 0) return Object.freeze([]);
  const { headsByDocumentId, documents: priorDocuments } = priorState;
  const plans: PointCommitUniqueKeyPlanV1[] = [];
  for (const definition of definitions) {
    for (const intent of command.rowIntents) {
      if (intent.tableId !== definition.tableId) continue;
      const loaded = headsByDocumentId.get(intent.documentId);
      if (loaded === undefined) throw corruption("uniqueKeyTransitionInvalid");
      const priorDocument = priorDocuments.get(intent.documentId) ?? null;
      if (loaded.head.kind === "live" && priorDocument === null) {
        throw corruption("uniqueKeyTransitionInvalid");
      }
      const previous =
        loaded.head.kind === "live" && priorDocument !== null
          ? lowerPointCommitUniqueKey(definition, priorDocument)
          : null;
      const next =
        intent.kind === "live"
          ? lowerPointCommitUniqueKey(definition, intent.document)
          : null;
      plans.push(
        Object.freeze({
          definition,
          rowId: intent.rowId,
          rowPrevCommitSeq:
            loaded.head.kind === "live" ? loaded.head.revisionCommitSeq : null,
          previousProjection: previous?.kind === "claim" ? previous.projection : null,
          previousCanonical: previous,
          nextProjection: next?.kind === "claim" ? next.projection : null,
          nextCanonical: next,
        }),
      );
    }
  }
  const owners = await loadPointCommitUniqueKeyOwners(tx, command, plans);
  const actions: PointCommitUniqueKeyActionV1[] = [];
  for (const plan of plans) {
    const owner =
      owners.get(
        uniqueKeyOwnerPosition(
          plan.definition.uniqueConstraintDefinitionId,
          plan.definition.tableId,
          plan.rowId,
        ),
      ) ?? null;
    const previousClaim =
      plan.previousCanonical?.kind === "claim" ? plan.previousCanonical : null;
    const nextClaim =
      plan.nextCanonical?.kind === "claim" ? plan.nextCanonical : null;
    if (owner === null && previousClaim !== null)
      throw corruption("uniqueKeyTransitionInvalid");
    if (owner !== null) {
      if (
        plan.rowPrevCommitSeq === null ||
        previousClaim === null ||
        owner.encodedKey !== previousClaim.encodedKey
      )
        throw corruption("uniqueKeyTransitionInvalid");
      if (
        nextClaim !== null &&
        nextClaim.encodedKey === previousClaim.encodedKey
      ) {
        continue;
      }
      actions.push(
        uniqueKeyAction(
          "release",
          plan,
          plan.previousProjection,
          null,
          previousClaim.encodedKey,
        ),
      );
    }
    if (nextClaim !== null) {
      actions.push(
        uniqueKeyAction(
          "claim",
          plan,
          null,
          plan.nextProjection,
          nextClaim.encodedKey,
        ),
      );
    }
  }
  if (actions.length > MAX_POINT_COMMIT_UNIQUE_KEY_ACTIONS_V1) {
    throw new PointCommitUniqueConstraintMaintenanceUnavailableV1Error({
      reason: "mutationLimitExceeded",
      observed: actions.length,
      maximum: MAX_POINT_COMMIT_UNIQUE_KEY_ACTIONS_V1,
    });
  }
  actions.sort(comparePointCommitUniqueKeyActions);
  return Object.freeze(actions);
}

function lowerPointCommitUniqueKey(
  definition: LocatedAppUniqueConstraintDefinitionV1,
  document: CanonicalFlarexValueV1,
): LoweredCanonicalAppUniqueConstraintV1 {
  return projectPointCommitTransactionResult(
    lowerCanonicalAppUniqueConstraintV1Result(definition, document).pipe(
      Result.mapError(
        (cause) =>
          new PointCommitUniqueConstraintMaintenanceUnavailableV1Error({
            reason: "keyInvalid",
            cause,
          }),
      ),
    ),
  );
}

async function loadPointCommitUniqueKeyOwners(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  plans: ReadonlyArray<PointCommitUniqueKeyPlanV1>,
): Promise<ReadonlyMap<string, PointCommitUniqueKeyOwnerV1>> {
  const positions = uniquePointCommitUniqueKeyOwnerPositions(plans);
  const claims = projectPointCommitTransactionResult(
    (
      await runPointCommitInTransactionEffect(
        readAppUniqueKeyOwnersInTransactionEffect(tx, {
          scopeId: command.authorityPins.scopeId,
          positions: positions.map((position) => {
            const plan = plans.find(
              (value) =>
                value.definition.uniqueConstraintDefinitionId ===
                position.definitionId,
            );
            if (!plan) throw corruption("uniqueKeyTransitionInvalid");
            return {
              constraintId: position.definitionId,
              tableId: position.tableId,
              rowId: position.rowId,
              componentCount:
                plan.definition.physicalSpec.orderedFields.length + 1,
            };
          }),
        }),
      )
    ).pipe(Result.mapError(mapPointCommitUniqueKeyFailure)),
  );
  const owners = new Map<string, PointCommitUniqueKeyOwnerV1>();
  for (const claim of claims) {
    const key = uniqueKeyOwnerPosition(
      claim.constraintId,
      claim.tableId,
      claim.rowId,
    );
    if (claim.localeKey !== "" || owners.has(key))
      throw corruption("uniqueKeyTransitionInvalid");
    owners.set(key, Object.freeze({ encodedKey: claim.encodedKey }));
  }
  return owners;
}

function uniquePointCommitUniqueKeyOwnerPositions(
  plans: ReadonlyArray<PointCommitUniqueKeyPlanV1>,
): ReadonlyArray<PointCommitUniqueKeyOwnerPositionV1> {
  const positions = new Map<string, PointCommitUniqueKeyOwnerPositionV1>();
  for (const plan of plans) {
    const position = Object.freeze({
      definitionId: plan.definition.uniqueConstraintDefinitionId,
      tableId: plan.definition.tableId,
      rowId: plan.rowId,
    } satisfies PointCommitUniqueKeyOwnerPositionV1);
    positions.set(
      uniqueKeyOwnerPosition(
        position.definitionId,
        position.tableId,
        position.rowId,
      ),
      position,
    );
  }
  return Object.freeze(
    [...positions.values()].toSorted(
      (left, right) =>
        left.definitionId - right.definitionId ||
        left.tableId - right.tableId ||
        left.rowId.localeCompare(right.rowId),
    ),
  );
}

function uniqueKeyAction(
  phase: PointCommitUniqueKeyActionV1["phase"],
  plan: PointCommitUniqueKeyPlanV1,
  previous: AppUniqueKeyProjectionV1 | null,
  next: AppUniqueKeyProjectionV1 | null,
  sortKey: OrderedIndexKeyHexV1,
): PointCommitUniqueKeyActionV1 {
  return Object.freeze({
    phase,
    definition: plan.definition,
    rowId: plan.rowId,
    previous,
    next,
    sortKey,
  });
}

function uniqueKeyOwnerPosition(
  definitionId: CatalogUniqueConstraintDefinitionId,
  tableId: CatalogTableId,
  rowId: AppRowIdHexV1,
): string {
  return `${definitionId}:${tableId}:${rowId}`;
}

function pointCommitUniqueKeyPhaseRank(
  phase: PointCommitUniqueKeyActionV1["phase"],
): number {
  return phase === "release" ? 0 : 1;
}

function comparePointCommitUniqueKeyActions(
  left: PointCommitUniqueKeyActionV1,
  right: PointCommitUniqueKeyActionV1,
): number {
  return (
    pointCommitUniqueKeyPhaseRank(left.phase) -
      pointCommitUniqueKeyPhaseRank(right.phase) ||
    left.definition.uniqueConstraintDefinitionId -
      right.definition.uniqueConstraintDefinitionId ||
    left.sortKey.localeCompare(right.sortKey) ||
    left.rowId.localeCompare(right.rowId)
  );
}

export interface ApplicationDocumentPriorState {
  readonly headsByDocumentId: ReadonlyMap<AppDocumentIdV1, LoadedPointCommitHeadV1>;
  readonly documents: ReadonlyMap<AppDocumentIdV1, CanonicalFlarexValueV1>;
}

/** Exact predecessor evidence for one command in its protected transaction. */
export const loadApplicationDocumentPriorState = Effect.fn("ApplicationDocument.loadPriorState")(function* (
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  loadedHeads: ReadonlyArray<LoadedPointCommitHeadV1>,
  developer: ReadonlyArray<LockedPointCommitDeveloperIndexV1>,
  unique: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  relations: LocatedPreparedPointCommitApplicationRelations | null,
  options: ApplicationDocumentMaterializationOptions,
): Effect.fn.Return<ApplicationDocumentPriorState, PointCommitCorruptionV1Error | PointCommitSqlFailureMarkerV1> {
  const headsByDocumentId = new Map<AppDocumentIdV1, LoadedPointCommitHeadV1>();
  if (loadedHeads.length !== command.dependencies.length) return yield* Effect.fail(corruption("priorDocumentInvalid"));
  for (let index = 0; index < command.dependencies.length; index++) {
    const dependency = command.dependencies[index];
    const loaded = loadedHeads[index];
    if (dependency === undefined || loaded === undefined || headsByDocumentId.has(dependency.documentId)) {
      return yield* Effect.fail(corruption("priorDocumentInvalid"));
    }
    headsByDocumentId.set(dependency.documentId, loaded);
  }
  const tableIds = new Set([
    ...developer.map(index => index.definition.access.tableId),
    ...unique.map(definition => definition.tableId),
    ...(relations?.definitions.definitions.map(definition => definition.binding.sourceTableId) ?? []),
  ]);
  const documents = yield* loadPointCommitDocumentsForTables(tx, command, headsByDocumentId, tableIds, options);
  return Object.freeze({ headsByDocumentId, documents });
});

const decodePriorDocumentRowsResult = Schema.decodeUnknownResult(Schema.Struct({
  rows: Schema.Array(Schema.Unknown),
}));
const decodeStoredPriorDocumentResult = Schema.decodeUnknownResult(Schema.Struct({
  ordinalText: Schema.String,
  isTombstone: Schema.Literal(false),
  creationTimeText: Schema.String,
  valueCodecVersion: Schema.Literal(1),
  valueBytes: Schema.Uint8Array,
  valueSha256: Schema.Uint8Array.check(Schema.makeFilter(value => value.byteLength === 32)),
}));

const loadPointCommitDocumentsForTables = Effect.fn("ApplicationDocument.loadPriorDocuments")(function* (
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  loadedHeadsByDocumentId: ReadonlyMap<
    AppDocumentIdV1,
    LoadedPointCommitHeadV1
  >,
  indexedTableIds: ReadonlySet<CatalogTableId>,
  options: ApplicationDocumentMaterializationOptions,
): Effect.fn.Return<ReadonlyMap<AppDocumentIdV1, CanonicalFlarexValueV1>, PointCommitCorruptionV1Error | PointCommitSqlFailureMarkerV1> {
  if (indexedTableIds.size === 0) return new Map();
  const requests: PointCommitDeveloperIndexDocumentRequestV1[] = [];
  for (const intent of command.rowIntents) {
    if (!indexedTableIds.has(intent.tableId)) continue;
    const loaded = loadedHeadsByDocumentId.get(intent.documentId);
    if (loaded === undefined) {
      return yield* Effect.fail(corruption("priorDocumentInvalid"));
    }
    if (loaded.head.kind !== "live") continue;
    if (loaded.creationTime === null) {
      return yield* Effect.fail(corruption("priorDocumentInvalid"));
    }
    requests.push(
      Object.freeze({
        documentId: intent.documentId,
        tableId: intent.tableId,
        rowId: intent.rowId,
        commitSeq: loaded.head.revisionCommitSeq,
        creationTime: loaded.creationTime,
      }),
    );
  }
  if (requests.length === 0) return new Map();
  const { scopeUuid } = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(command.authorityPins.scopeId).pipe(
      Result.mapError(() => corruption("priorDocumentInvalid")),
    ),
  );
  const values = sql.join(
    requests.map(
      (request, ordinal) => sql`
    (
      ${ordinal}::integer,
      ${request.tableId}::integer,
      ${appRowIdHexV1ToBytes(request.rowId)}::bytea,
      ${request.commitSeq}::bigint
    )
  `,
    ),
    sql`, `,
  );
  const statement = sql`
    with requested(ordinal, table_id, row_id, commit_seq) as (
      values ${values}
    )
    select
      requested.ordinal::text as "ordinalText",
      revision.is_tombstone as "isTombstone",
      revision.creation_time::text as "creationTimeText",
      revision.value_codec_version as "valueCodecVersion",
      revision.value_bytes as "valueBytes",
      revision.value_sha256 as "valueSha256"
    from requested
    left join fx_app_row_rev as revision
      on revision.scope_uuid = ${scopeUuid}
      and revision.table_id = requested.table_id
      and revision.row_id = requested.row_id
      and revision.commit_seq = requested.commit_seq
    order by requested.ordinal asc
  `;
  options.observeQuery?.(Object.freeze({
    name: "loadPriorDocuments", sql: "bounded VALUES with exact predecessor document evidence",
    params: Object.freeze([]),
  }));
  const result = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => tx.execute(statement),
    catch: cause => new PointCommitSqlFailureMarkerV1("loadPriorDocuments", cause),
  }));
  const { rows } = yield* Effect.fromResult(decodePriorDocumentRowsResult(result).pipe(
    Result.mapError(() => corruption("priorDocumentInvalid")),
  ));
  if (rows.length !== requests.length) {
    return yield* Effect.fail(corruption("priorDocumentInvalid"));
  }
  const documents = new Map<AppDocumentIdV1, CanonicalFlarexValueV1>();
  for (let ordinal = 0; ordinal < requests.length; ordinal += 1) {
    const raw = yield* Effect.fromResult(decodeStoredPriorDocumentResult(rows[ordinal]).pipe(
      Result.mapError(() => corruption("priorDocumentInvalid")),
    ));
    const request = requests[ordinal];
    if (
      request === undefined ||
      raw.ordinalText !== String(ordinal) ||
      raw.creationTimeText !== String(request.creationTime)
    ) {
      return yield* Effect.fail(corruption("priorDocumentInvalid"));
    }
    const document = yield* decodeCanonicalAppDocumentEvidenceV1Effect({
      tableId: request.tableId,
      rowId: request.rowId,
      creationTime: request.creationTime,
      codecVersion: raw.valueCodecVersion,
      canonicalBytes: raw.valueBytes,
      sha256: raw.valueSha256,
    }).pipe(Effect.mapError(() => corruption("priorDocumentInvalid")));
    documents.set(request.documentId, document);
  }
  return documents;
});

function lowerDeveloperIndexKey(
  definition: LocatedAppIndexDefinitionV1,
  document: CanonicalFlarexValueV1,
  creationTime: AppCreationTimeV1,
): OrderedIndexKeyHexV1 | null {
  return projectPointCommitTransactionResult(
    lowerAppDeveloperIndexKeyV1(definition, document, creationTime).pipe(
      Result.mapError(
        (cause) =>
          new PointCommitDeveloperIndexMaintenanceUnavailableV1Error(cause instanceof ExactDecimalError ? { reason: "entryValueInvalid" } : {
            reason: "entryKeyLimitExceeded",
            observed: cause.observedBytes,
            maximum: cause.maximumBytes,
          }),
      ),
    ),
  );
}

function uniqueDeveloperIndexPositions(
  plans: ReadonlyArray<PointCommitDeveloperIndexRowPlanV1>,
): ReadonlyArray<PointCommitDeveloperIndexPositionV1> {
  const positions = new Map<string, PointCommitDeveloperIndexPositionV1>();
  for (const plan of plans) {
    for (const encodedKey of [plan.priorKey, plan.finalKey]) {
      if (encodedKey === null) continue;
      const key = developerIndexPositionKey(
        plan.definition.indexDefinitionId,
        encodedKey,
        plan.rowId,
      );
      positions.set(
        key,
        Object.freeze({
          definitionId: plan.definition.indexDefinitionId,
          definition: plan.definition,
          encodedKey,
          rowId: plan.rowId,
        }),
      );
    }
  }
  return Object.freeze(
    [...positions.values()].toSorted(
      (left, right) =>
        left.definitionId - right.definitionId ||
        left.encodedKey.localeCompare(right.encodedKey) ||
        left.rowId.localeCompare(right.rowId),
    ),
  );
}

async function loadPointCommitDeveloperIndexEntryHeads(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  positions: ReadonlyArray<PointCommitDeveloperIndexPositionV1>,
): Promise<ReadonlyMap<string, PointCommitDeveloperIndexEntryHeadV1>> {
  const entries = projectPointCommitTransactionResult(
    await runPointCommitInTransactionEffect(
      readAppIndexMembershipHeadsInTransactionEffect(tx, {
        scopeId: command.authorityPins.scopeId,
        positions,
      }).pipe(Effect.mapError(failure => failure instanceof AppIndexEntryReadPersistenceError
        ? new PointCommitSqlFailureMarkerV1("loadDeveloperIndexEntryHeads", failure.cause)
        : failure)),
    ),
  );
  const heads = new Map<string, PointCommitDeveloperIndexEntryHeadV1>();
  for (let index = 0; index < positions.length; index += 1) {
    const position = positions[index];
    if (position === undefined)
      throw corruption("developerIndexTransitionInvalid");
    const head = entries[index];
    heads.set(
      developerIndexPositionKey(
        position.definitionId,
        position.encodedKey,
        position.rowId,
      ),
      Object.freeze({
        commitSeq: head?.commitSeq ?? null,
        isTombstone: head?.isTombstone ?? null,
      }),
    );
  }
  return heads;
}

function developerIndexPositionKey(
  definitionId: CatalogIndexDefinitionId,
  encodedKey: OrderedIndexKeyHexV1,
  rowId: OrderedIndexRowIdHexV1,
): string {
  return `${definitionId}:${encodedKey}:${rowId}`;
}

function compareDeveloperIndexEntryActions(
  left: PointCommitDeveloperIndexEntryActionV1,
  right: PointCommitDeveloperIndexEntryActionV1,
): number {
  return (
    left.definition.indexDefinitionId - right.definition.indexDefinitionId ||
    left.encodedKey.localeCompare(right.encodedKey) ||
    left.rowId.localeCompare(right.rowId) ||
    (left.kind === right.kind ? 0 : left.kind === "tombstone" ? -1 : 1)
  );
}

async function writePointCommitUniqueKeyActions(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  writeEpoch: ScopeEpoch,
  actions: ReadonlyArray<PointCommitUniqueKeyActionV1>,
  options: ApplicationDocumentMaterializationOptions,
): Promise<void> {
  if (actions.length === 0) return;
  await emitTransactionStep(options, command, "uniqueKeyBatchWriting");
  for (const phase of ["release", "claim"] as const) {
    const selected = actions.filter((action) => action.phase === phase);
    const inputs = selected.map(
      (action) =>
        ({
          scopeId: command.authorityPins.scopeId,
          constraintId: action.definition.uniqueConstraintDefinitionId,
          tableId: action.definition.tableId,
          rowId: action.rowId,
          writeEpoch,
          previous: action.previous,
          next: action.next,
        }) satisfies ApplyAppUniqueKeyMutationV1Input,
    );
    const settled = await runPointCommitInTransactionEffect(
      applyAppUniqueKeyMutationsInTransactionEffect(tx, inputs),
    );
    projectPointCommitTransactionResult(
      settled.pipe(Result.mapError(mapPointCommitUniqueKeyFailure)),
    );
    for (let index = 0; index < selected.length; index += 1) {
      await emitTransactionStep(options, command, "uniqueKeyWritten");
    }
  }
  await emitTransactionStep(options, command, "uniqueKeyBatchWritten");
}

function mapPointCommitUniqueKeyFailure(
  failure: Effect.Error<
    ReturnType<typeof applyAppUniqueKeyMutationsInTransactionEffect>
  >,
) {
  if (
    failure instanceof AppUniqueKeyConflictError ||
    failure instanceof AppUniqueKeyHashError ||
    failure instanceof CanonicalAppUniqueKeyHashCollisionError
  )
    return failure;
  if (failure instanceof AppUniqueKeyPersistenceError) {
    return new PointCommitSqlFailureMarkerV1("writeUniqueKey", failure.cause);
  }
  return corruption("uniqueKeyTransitionInvalid");
}

export const runCandidateSchemaWriteGuard = Effect.fn(
  "ApplicationDocumentMaterialization.runCandidateSchemaWriteGuard",
)(
  (
    tx: AppRowTransaction,
    candidate: PreparedPointCommitCandidateSchemaWriteGuard,
    authority: TrustedScopeAuthority,
    clock: ScopeClockRecord,
    commitSeq: CommitSeq,
    liveRows: ReadonlyArray<
      Readonly<{
        readonly tableId: CatalogTableId;
        readonly rowId: AppRowIdHexV1;
        readonly document: CanonicalFlarexValueV1;
      }>
    >,
  ) =>
    applyAppSchemaCandidateWriteGuardInTransactionEffect(
      tx,
      candidate.guard,
      candidate.prepared,
      authority,
      clock,
      commitSeq,
      liveRows,
    ).pipe(
      Effect.mapError((failure) =>
        failure.reason === "persistence"
          ? new PointCommitSqlFailureMarkerV1(
              "validateCandidateSchema",
              failure.cause ?? failure,
            )
          : corruption("candidateSchemaValidationInvalid"),
      ),
    ),
);

export async function resetPointCommitDeveloperIndexValidation(
  tx: AppRowTransaction,
  build: IndexBuildStateRecord,
): Promise<void> {
  if (build.lifecycle !== "validating") return;
  const updated = await sqlCall("resetDeveloperIndexValidation", () =>
    tx
      .update(fxSystemIndexBuildStates)
      .set({
        backfillCursorRowId: null,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(fxSystemIndexBuildStates.scopeId, build.scopeId),
          eq(
            fxSystemIndexBuildStates.indexDefinitionId,
            build.indexDefinitionId,
          ),
          eq(
            fxSystemIndexBuildStates.storageGenerationFence,
            build.storageGenerationFence,
          ),
          eq(fxSystemIndexBuildStates.epoch, build.epoch),
          eq(fxSystemIndexBuildStates.attemptFence, build.attemptFence),
          eq(fxSystemIndexBuildStates.lifecycle, "validating"),
        ),
      )
      .returning({
        indexDefinitionId: fxSystemIndexBuildStates.indexDefinitionId,
      }),
  );
  if (updated.length !== 1) {
    throw corruption("developerIndexBuildInvalid");
  }
}

export async function lockPointCommitIntrinsicIndexBuilds(
  tx: AppRowTransaction,
  clock: ApplicationDocumentMaterializationClock,
  definitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  command: ApplicationDocumentMaterializationCommand,
): Promise<ReadonlyArray<LockedPointCommitIntrinsicIndexV1>> {
  const locked: LockedPointCommitIntrinsicIndexV1[] = [];
  for (const definition of definitions) {
    const rows = await sqlCall("lockIntrinsicIndexBuild", () =>
      tx
        .select()
        .from(fxSystemIndexBuildStates)
        .where(
          and(
            eq(fxSystemIndexBuildStates.scopeId, command.authorityPins.scopeId),
            eq(
              fxSystemIndexBuildStates.indexDefinitionId,
              definition.indexDefinitionId,
            ),
          ),
        )
        .limit(1)
        .for("share"),
    );
    const row = rows[0];
    if (row === undefined) throw corruption("intrinsicIndexBuildInvalid");
    const state = projectPointCommitTransactionResult(
      decodeIndexBuildStateRowResult(
        row,
        command.authorityPins.scopeId,
        definition.indexDefinitionId,
      ).pipe(Result.mapError(() => corruption("intrinsicIndexBuildInvalid"))),
    );
    if (
      state.storageGeneration !== clock.record.storageGeneration ||
      state.storageGenerationFence !== clock.record.storageGenerationFence ||
      state.epoch !== clock.record.epoch ||
      state.lifecycle === "retiring"
    ) {
      throw corruption("intrinsicIndexBuildInvalid");
    }
    projectPointCommitTransactionResult(
      validateIndexBuildStateFrontierResult(
        state,
        clock.record.lastCommitSeq,
      ).pipe(Result.mapError(() => corruption("intrinsicIndexBuildInvalid"))),
    );
    locked.push(Object.freeze({ definition, build: state }));
  }
  return Object.freeze(locked);
}

const prepareIntrinsicIndexActionsEffect = Effect.fn(
  "ApplicationDocumentMaterialization.prepareIntrinsicIndexActions",
)(function* (
  tx: AppRowTransaction,
  scopeId: ReplacementScopeIdV1,
  rows: readonly AppendPreparedAppRowRevisionV1Input[],
  builds: readonly LockedPointCommitIntrinsicIndexV1[],
) {
  const positions: (AppIndexEntryPositionV1 & {
    readonly encodedKey: OrderedIndexKeyHexV1;
    readonly row: AppendPreparedAppRowRevisionV1Input;
    readonly build: IndexBuildStateRecord;
  })[] = [];
  let buildIndex = 0;
  for (const row of rows) {
    let intrinsic = builds[buildIndex];
    while (
      intrinsic !== undefined &&
      intrinsic.definition.access.tableId < row.tableId
    ) {
      intrinsic = builds[++buildIndex];
    }
    if (
      intrinsic === undefined ||
      intrinsic.definition.access.tableId !== row.tableId
    )
      continue;
    const { definition, build } = intrinsic;
    if (
      definition.access.kind !== "by_creation_time" ||
      build.indexDefinitionId !== definition.indexDefinitionId ||
      build.scopeId !== row.scopeId
    ) {
      return yield* Effect.fail(corruption("intrinsicIndexBuildInvalid"));
    }
    const encodedKey = encodeAppOrderedIndexKeyV1({
      spec: definition.physicalSpec,
      values: [orderedIndexCreationTimeV1(row.creationTime)],
    });
    const rowId = yield* Effect.fromResult(
      orderedIndexRowIdHexV1FromBytesResult(
        appRowIdHexV1ToBytes(row.rowId),
      ).pipe(
        Result.mapError(() => corruption("intrinsicIndexTransitionInvalid")),
      ),
    );
    positions.push({ row, build, definition, encodedKey, rowId });
  }
  const heads = yield* readAppIndexMembershipHeadsInTransactionEffect(tx, {
    scopeId,
    positions,
  }).pipe(
    Effect.mapError((failure) =>
      failure instanceof AppIndexEntryReadPersistenceError
        ? new PointCommitSqlFailureMarkerV1(
            "loadIntrinsicIndexEntryHeads",
            failure.cause,
          )
        : failure,
    ),
  );
  const actions = new Map<
    AppendPreparedAppRowRevisionV1Input,
    AppendAppIndexEntryRevisionV1Input
  >();
  for (let index = 0; index < positions.length; index += 1) {
    const position = positions[index];
    const head = heads[index];
    if (position === undefined || head === undefined)
      return yield* Effect.fail(corruption("intrinsicIndexTransitionInvalid"));
    const { row, build, definition, encodedKey, rowId } = position;
    if (row.kind === "tombstone") {
      if (head === null) {
        if (build.lifecycle === "enabled")
          return yield* Effect.fail(
            corruption("intrinsicIndexTransitionInvalid"),
          );
        continue;
      }
      if (
        head.isTombstone ||
        row.prevCommitSeq === null ||
        head.commitSeq > row.prevCommitSeq
      )
        return yield* Effect.fail(
          corruption("intrinsicIndexTransitionInvalid"),
        );
    } else {
      if (
        head === null &&
        row.prevCommitSeq !== null &&
        build.lifecycle === "enabled"
      )
        return yield* Effect.fail(
          corruption("intrinsicIndexTransitionInvalid"),
        );
      if (head !== null) {
        if (
          head.isTombstone ||
          row.prevCommitSeq === null ||
          head.commitSeq > row.prevCommitSeq
        )
          return yield* Effect.fail(
            corruption("intrinsicIndexTransitionInvalid"),
          );
        continue;
      }
    }
    actions.set(row, {
      kind: row.kind,
      scopeId: row.scopeId,
      definition,
      encodedKey,
      rowId,
      writeEpoch: row.writeEpoch,
      commitSeq: row.commitSeq,
    });
  }
  return actions;
});

async function resetPointCommitIntrinsicIndexValidation(
  tx: AppRowTransaction,
  build: IndexBuildStateRecord,
): Promise<void> {
  if (build.lifecycle !== "validating") return;
  const updated = await sqlCall("resetIntrinsicIndexValidation", () =>
    tx
      .update(fxSystemIndexBuildStates)
      .set({
        backfillCursorRowId: null,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(fxSystemIndexBuildStates.scopeId, build.scopeId),
          eq(
            fxSystemIndexBuildStates.indexDefinitionId,
            build.indexDefinitionId,
          ),
          eq(
            fxSystemIndexBuildStates.storageGenerationFence,
            build.storageGenerationFence,
          ),
          eq(fxSystemIndexBuildStates.epoch, build.epoch),
          eq(fxSystemIndexBuildStates.attemptFence, build.attemptFence),
          eq(fxSystemIndexBuildStates.lifecycle, "validating"),
        ),
      )
      .returning({
        indexDefinitionId: fxSystemIndexBuildStates.indexDefinitionId,
      }),
  );
  if (updated.length !== 1) {
    throw corruption("intrinsicIndexBuildInvalid");
  }
}

function prepareTentativePointCommitRowResult(
  writeEpoch: ScopeEpoch,
  tentativeCommitSeq: CommitSeq,
  command: ApplicationDocumentMaterializationCommand,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
  intent: PreparedPointCommitRowIntentV1,
): Result.Result<
  AppendPreparedAppRowRevisionV1Input,
  PointCommitCorruptionV1Error
> {
  const index = command.dependencies.findIndex((dependency) =>
    pointDependenciesEqual(dependency, intent),
  );
  const loaded = heads[index];
  if (index < 0 || loaded === undefined) {
    return Result.fail(corruption("rowTransitionInvalid"));
  }
  const observed = intent.dependency.observed;
  if (intent.kind === "deleted") {
    if (
      observed.kind !== "present" ||
      loaded.head.kind !== "live" ||
      loaded.creationTime === null
    ) {
      return Result.fail(corruption("rowTransitionInvalid"));
    }
    const predecessorCommitSeq = loaded.head.revisionCommitSeq;
    const creationTime = loaded.creationTime;
    return Result.succeed({
      kind: "tombstone",
      scopeId: command.authorityPins.scopeId,
      tableId: intent.tableId,
      rowId: intent.rowId,
      writeEpoch,
      commitSeq: tentativeCommitSeq,
      prevCommitSeq: predecessorCommitSeq,
      schemaVersionId: command.authorityPins.schemaVersionId,
      creationTime,
    });
  }

  let prevCommitSeq: CommitSeq | null;
  if (
    observed.kind === "missing" &&
    observed.basis.kind === "noVisibleRevision" &&
    loaded.head.kind === "missing"
  ) {
    prevCommitSeq = null;
  } else if (observed.kind === "present" && loaded.head.kind === "live") {
    prevCommitSeq = loaded.head.revisionCommitSeq;
  } else {
    return Result.fail(corruption("rowTransitionInvalid"));
  }
  return Result.succeed({
    kind: "live",
    scopeId: command.authorityPins.scopeId,
    tableId: intent.tableId,
    rowId: intent.rowId,
    writeEpoch,
    commitSeq: tentativeCommitSeq,
    prevCommitSeq,
    schemaVersionId: command.authorityPins.schemaVersionId,
    creationTime: intent.creationTime,
    document: intent.document,
  });
}

function freezeRowIdentity(
  input: Pick<PointCommitDependencyV1, "tableId" | "rowId">,
  scopeId: ReplacementScopeIdV1,
): Readonly<AppRowIdentityV1> {
  return Object.freeze({
    scopeId,
    tableId: input.tableId,
    rowId: input.rowId,
  });
}

export async function emitTransactionStep<Step extends string>(
  options: {
    readonly afterTransactionStep?: (event: {
      readonly scopeId: ReplacementScopeIdV1;
      readonly step: Step;
    }) => Promise<void>;
  },
  command: Readonly<{
    authorityPins: { readonly scopeId: ReplacementScopeIdV1 };
  }>,
  step: Step,
): Promise<void> {
  await options.afterTransactionStep?.(
    Object.freeze({
      scopeId: command.authorityPins.scopeId,
      step,
    }),
  );
}

export function parseNonNegativeIntegerTextResult(
  value: unknown,
): Result.Result<number, PointCommitCorruptionV1Error> {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return Result.fail(corruption("rowHeadInvalid"));
  }
  const parsed = Number(value);
  if (!isNonNegativeSafeInteger(parsed)) {
    return Result.fail(corruption("rowHeadInvalid"));
  }
  return Result.succeed(parsed);
}

export function parseNullableCommitSeqTextResult(
  value: unknown,
): Result.Result<CommitSeq | null, PointCommitCorruptionV1Error> {
  if (value === null) return Result.succeed(null);
  if (
    typeof value !== "string" ||
    value.length > MAX_SIGNED_COMMIT_SEQ_TEXT_LENGTH ||
    !/^[1-9][0-9]*$/.test(value)
  ) {
    return Result.fail(corruption("rowHeadInvalid"));
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SIGNED_COMMIT_SEQ) {
    return Result.fail(corruption("rowHeadInvalid"));
  }
  return decodePointCommitSeqResult(parsed).pipe(
    Result.mapError(() => corruption("rowHeadInvalid")),
  );
}
