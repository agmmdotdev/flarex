import { isIndexBuildSnapshotCoveredInTransactionEffect, validateIndexBuildStateFrontierResult } from "../indexBuildStates";
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
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";

import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";

import {
  AppCreationTimeV1Schema,
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
  FLAREX_VALUE_CODEC_VERSION_V1,
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
  decodeCanonicalFlarexValueEvidenceV1,
  isCanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexValueV1,
} from "flarex-protocol/value";
import {
  lowerAppDeveloperIndexKeyV1,
  type LocateAppDeveloperIndexDefinitionsV1Error,
} from "../appDeveloperIndexCommitV1";

import {
  hasAppUniqueConstraintDefinitionAuthorityV1,
  lowerCanonicalAppUniqueConstraintV1Result,
} from "../appUniqueConstraintCommitV1";
import {
  isLocatedAppUniqueConstraintDefinitionV1,
  type LocatedAppUniqueConstraintDefinitionV1,
  type ReadAppUniqueConstraintDefinitionV1Error,
} from "../appUniqueConstraintDefinitions";
import {
  AppUniqueConstraintSetBuildIntegrationV1Error,
  resetAppUniqueConstraintSetValidationInTransactionEffect,
} from "../appUniqueConstraintSetBuildV1";
import {
  applyAppUniqueKeyMutationInTransactionEffect,
  AppUniqueKeyConflictError,
  AppUniqueKeyHashError,
  AppUniqueKeyPersistenceError,
  CanonicalAppUniqueKeyHashCollisionError,
  type ApplyAppUniqueKeyMutationV1Input,
} from "../appUniqueKeys";
import {
  type AppUniqueKeyProjectionV1,
  type CanonicalAppUniqueKeyV1,
} from "../appUniqueKeyContract";
import { appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult } from "../appIndexEntries";
import type {
  LocatedAppIndexDefinitionV1,
  ReadAppIndexDefinitionError,
} from "../appIndexDefinitions";
import {
  AppRowReadPersistenceError,
  appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult,
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
 * S11 currently performs one bounded transaction-local transition per action.
 * Keep this materially below the general material-row ceiling until that owner
 * has a set-based mutation primitive and corresponding contention evidence.
 */
export const MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1 = 32;

export const MAX_POINT_COMMIT_UNIQUE_KEY_ACTIONS_V1 = 64;

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
  | ReadAppUniqueConstraintDefinitionV1Error
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

function isCanonicalDocumentForLoadedHead(
  document: CanonicalFlarexValueV1,
  documentId: AppDocumentIdV1,
  creationTime: AppCreationTimeV1,
): boolean {
  const value = document.value;
  return (
    isCanonicalFlarexRuntimeObjectV1(value) &&
    value._id === documentId &&
    value._creationTime === creationTime
  );
}

/** The existing Application row/index/unique lowering order, shared by both participants. */
export async function materializeApplicationDocumentRows(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  commitSeq: CommitSeq,
  writeEpoch: ScopeEpoch,
  loadedHeads: ReadonlyArray<LoadedPointCommitHeadV1>,
  intrinsicBuilds: ReadonlyArray<LockedPointCommitIntrinsicIndexV1>,
  developerIndexActions: ReadonlyArray<PointCommitDeveloperIndexEntryActionV1>,
  developerBuilds: ReadonlyArray<LockedPointCommitDeveloperIndexV1>,
  uniqueKeyActions: ReadonlyArray<PointCommitUniqueKeyActionV1>,
  options: ApplicationDocumentMaterializationOptions,
): Promise<void> {
  const maintainedBuilds = [...intrinsicBuilds, ...developerBuilds];
  for (const { build, definition } of maintainedBuilds) {
    if (build.lifecycle !== "enabled") continue;
    const covered = projectPointCommitTransactionResult(
      await runPointCommitInTransactionEffect(
        isIndexBuildSnapshotCoveredInTransactionEffect(
          tx,
          build,
          definition.access.tableId,
          CommitSeqSchema.make(commitSeq - 1n),
        ).pipe(
          Effect.mapError((cause) =>
            cause instanceof AppRowReadPersistenceError
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
  }
  let intrinsicBuildIndex = 0;
  for (const rowIntent of command.rowIntents) {
    const rowRevision = await lowerTentativePointCommitRow(
      tx,
      writeEpoch,
      commitSeq,
      command,
      loadedHeads,
      rowIntent,
    );
    await emitTransactionStep(options, command, "tentativeRowWritten");
    let intrinsic: LockedPointCommitIntrinsicIndexV1 | undefined =
      intrinsicBuilds[intrinsicBuildIndex];
    while (
      intrinsic !== undefined &&
      intrinsic.definition.access.tableId < rowIntent.tableId
    ) {
      intrinsicBuildIndex += 1;
      intrinsic = intrinsicBuilds[intrinsicBuildIndex];
    }
    if (
      intrinsic !== undefined &&
      intrinsic.definition.access.tableId !== rowIntent.tableId
    ) {
      intrinsic = undefined;
    }
    if (intrinsic !== undefined) {
      const changed = await lowerTentativePointCommitIntrinsicIndex(
        tx,
        intrinsic.build,
        intrinsic.definition,
        rowRevision,
      );
      if (changed) {
        await emitTransactionStep(
          options,
          command,
          "intrinsicIndexEntryWritten",
        );
      }
    }
  }
  for (const intrinsic of intrinsicBuilds) {
    await resetPointCommitIntrinsicIndexValidation(tx, intrinsic.build);
  }
  await writePointCommitDeveloperIndexActions(
    tx,
    command,
    commitSeq,
    writeEpoch,
    developerIndexActions,
    options,
  );
  await writePointCommitUniqueKeyActions(
    tx,
    command,
    commitSeq,
    writeEpoch,
    uniqueKeyActions,
    options,
  );
  for (const { build } of maintainedBuilds) {
    if (build.lifecycle !== "enabled") continue;
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

  if (command.rowIntents.length > 0) {
    const reset = await resetPointCommitUniqueConstraintValidation(tx, command);
    if (reset) {
      await emitTransactionStep(
        options,
        command,
        "uniqueConstraintValidationReset",
      );
    }
  }
}

async function resetPointCommitUniqueConstraintValidation(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
): Promise<boolean> {
  const settled = await Effect.runPromise(
    Effect.result(
      resetAppUniqueConstraintSetValidationInTransactionEffect(tx, {
        scopeId: command.authorityPins.scopeId,
      }),
    ),
  );
  const result = projectPointCommitTransactionResult(
    settled.pipe(
      Result.mapError((failure) =>
        failure instanceof AppUniqueConstraintSetBuildIntegrationV1Error
          ? new PointCommitSqlFailureMarkerV1(
              "resetUniqueConstraintValidation",
              failure.cause,
            )
          : corruption("uniqueConstraintBuildInvalid"),
      ),
    ),
  );
  return result.status === "reset";
}

export async function preparePointCommitApplicationRelationPlan(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  loadedHeads: ReadonlyArray<LoadedPointCommitHeadV1>,
  relations: LocatedPreparedPointCommitApplicationRelations | null,
  lastCommitSeq: bigint,
  options: ApplicationDocumentMaterializationOptions,
): Promise<PreparedPointCommitApplicationRelationPlan | null> {
  if (relations === null) return null;
  const headsByDocumentId = new Map<AppDocumentIdV1, LoadedPointCommitHeadV1>();
  for (let index = 0; index < command.dependencies.length; index += 1) {
    const dependency = command.dependencies[index];
    const loaded = loadedHeads[index];
    if (
      dependency === undefined ||
      loaded === undefined ||
      headsByDocumentId.has(dependency.documentId)
    ) {
      throw corruption("relationTransitionInvalid");
    }
    headsByDocumentId.set(dependency.documentId, loaded);
  }
  const sourceTableIds = new Set(
    relations.definitions.definitions.map(
      (definition) => definition.binding.sourceTableId,
    ),
  );
  const priorDocuments = await loadPointCommitRelationDocuments(
    tx,
    command,
    headsByDocumentId,
    sourceTableIds,
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
    const prior = priorDocuments.get(intent.documentId) ?? null;
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
      .for("update"),
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
    projectPointCommitTransactionResult(validateIndexBuildStateFrontierResult(state, clock.record.lastCommitSeq).pipe(
      Result.mapError(() => corruption("developerIndexBuildInvalid")),
    ));
    locked.push(Object.freeze({ definition, build: state }));
  }
  return Object.freeze(locked);
}

export async function preparePointCommitDeveloperIndexActions(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  loadedHeads: ReadonlyArray<LoadedPointCommitHeadV1>,
  builds: ReadonlyArray<LockedPointCommitDeveloperIndexV1>,
): Promise<ReadonlyArray<PointCommitDeveloperIndexEntryActionV1>> {
  const plans: PointCommitDeveloperIndexRowPlanV1[] = [];
  const loadedHeadsByDocumentId = new Map<
    AppDocumentIdV1,
    LoadedPointCommitHeadV1
  >();
  for (let index = 0; index < command.dependencies.length; index += 1) {
    const dependency = command.dependencies[index];
    const loaded = loadedHeads[index];
    if (dependency === undefined || loaded === undefined) {
      throw corruption("developerIndexTransitionInvalid");
    }
    if (loadedHeadsByDocumentId.has(dependency.documentId)) {
      throw corruption("developerIndexTransitionInvalid");
    }
    loadedHeadsByDocumentId.set(dependency.documentId, loaded);
  }
  const priorDocuments = await loadPointCommitDeveloperIndexDocuments(
    tx,
    command,
    loadedHeadsByDocumentId,
    builds,
  );
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
        (priorHead.isTombstone || priorHead.commitSeq !== plan.priorCommitSeq)
      ) {
        throw corruption("developerIndexTransitionInvalid");
      }
      if (
        (priorHead === null || priorHead.commitSeq === null) &&
        plan.build.lifecycle === "enabled"
      ) {
        throw corruption("developerIndexTransitionInvalid");
      }
      if (sameKey) {
        actions.push(
          Object.freeze({
            kind: "live",
            definition: plan.definition,
            encodedKey: plan.priorKey,
            rowId: plan.rowId,
            prevCommitSeq: priorHead?.commitSeq ?? null,
          }),
        );
      } else if (priorHead !== null && priorHead.commitSeq !== null) {
        actions.push(
          Object.freeze({
            kind: "tombstone",
            definition: plan.definition,
            encodedKey: plan.priorKey,
            rowId: plan.rowId,
            prevCommitSeq: priorHead.commitSeq,
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
          prevCommitSeq: finalHead?.commitSeq ?? null,
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
  loadedHeads: ReadonlyArray<LoadedPointCommitHeadV1>,
  definitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
): Promise<ReadonlyArray<PointCommitUniqueKeyActionV1>> {
  if (definitions.length === 0) return Object.freeze([]);
  const headsByDocumentId = new Map<AppDocumentIdV1, LoadedPointCommitHeadV1>();
  for (let index = 0; index < command.dependencies.length; index += 1) {
    const dependency = command.dependencies[index];
    const loaded = loadedHeads[index];
    if (
      dependency === undefined ||
      loaded === undefined ||
      headsByDocumentId.has(dependency.documentId)
    )
      throw corruption("uniqueKeyTransitionInvalid");
    headsByDocumentId.set(dependency.documentId, loaded);
  }
  const priorDocuments = await loadPointCommitUniqueKeyDocuments(
    tx,
    command,
    headsByDocumentId,
    definitions,
  );
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
          previousProjection: previous?.projection ?? null,
          previousCanonical: previous?.canonical ?? null,
          nextProjection: next?.projection ?? null,
          nextCanonical: next?.canonical ?? null,
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
    if (owner !== null) {
      if (
        plan.rowPrevCommitSeq === null ||
        owner.commitSeq !== plan.rowPrevCommitSeq ||
        previousClaim === null ||
        owner.encodedKey !== previousClaim.encodedKey
      )
        throw corruption("uniqueKeyTransitionInvalid");
      if (
        nextClaim !== null &&
        nextClaim.encodedKey === previousClaim.encodedKey
      ) {
        actions.push(
          uniqueKeyAction(
            "advance",
            plan,
            owner.commitSeq,
            plan.previousProjection,
            plan.nextProjection,
            previousClaim.encodedKey,
          ),
        );
        continue;
      }
      actions.push(
        uniqueKeyAction(
          "release",
          plan,
          owner.commitSeq,
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
): Readonly<{
  readonly projection: AppUniqueKeyProjectionV1;
  readonly canonical: CanonicalAppUniqueKeyV1;
}> {
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
  if (plans.length === 0) return new Map();
  const scopeUuid = projectPointCommitTransactionResult(
    projectScopeIdUuidV1Result(command.authorityPins.scopeId).pipe(
      Result.mapError(() => corruption("uniqueKeyTransitionInvalid")),
    ),
  ).scopeUuid;
  const positions = uniquePointCommitUniqueKeyOwnerPositions(plans);
  const values = sql.join(
    positions.map(
      (position, ordinal) => sql`
    (
      ${ordinal}::integer,
      ${position.definitionId}::integer,
      ${position.tableId}::integer,
      ${appRowIdHexV1ToBytes(position.rowId)}::bytea
    )
  `,
    ),
    sql`, `,
  );
  const statement = sql`
    with requested(ordinal, constraint_id, table_id, row_id) as (
      values ${values}
    )
    select
      requested.ordinal::text as "ordinalText",
      current_key.locale_key as "localeKey",
      current_key.encoded_key as "encodedKey",
      current_key.commit_seq::text as "commitSeqText"
    from requested
    left join fx_app_unique_key as current_key
      on current_key.scope_uuid = ${scopeUuid}
      and current_key.constraint_id = requested.constraint_id
      and current_key.table_id = requested.table_id
      and current_key.row_id = requested.row_id
    order by requested.ordinal asc
  `;
  const result = await sqlCall("loadUniqueKeyOwners", () =>
    tx.execute(statement),
  );
  const rows = rowsFromDriverExecuteResult(result, () => {
    throw corruption("uniqueKeyTransitionInvalid");
  });
  if (rows.length !== positions.length) {
    throw corruption("uniqueKeyTransitionInvalid");
  }
  const owners = new Map<string, PointCommitUniqueKeyOwnerV1>();
  for (let ordinal = 0; ordinal < positions.length; ordinal += 1) {
    const row = rows[ordinal];
    const position = positions[ordinal];
    if (!isNonArrayRecord(row) || position === undefined) {
      throw corruption("uniqueKeyTransitionInvalid");
    }
    const decodedOrdinal = projectPointCommitTransactionResult(
      parseNonNegativeIntegerTextResult(row.ordinalText).pipe(
        Result.mapError(() => corruption("uniqueKeyTransitionInvalid")),
      ),
    );
    if (decodedOrdinal !== ordinal) {
      throw corruption("uniqueKeyTransitionInvalid");
    }
    if (
      row.localeKey === null &&
      row.encodedKey === null &&
      row.commitSeqText === null
    )
      continue;
    if (
      row.localeKey !== "" ||
      !isUint8Array(row.encodedKey) ||
      typeof row.commitSeqText !== "string"
    )
      throw corruption("uniqueKeyTransitionInvalid");
    const commitSeq = projectPointCommitTransactionResult(
      parseNullableCommitSeqTextResult(row.commitSeqText).pipe(
        Result.mapError(() => corruption("uniqueKeyTransitionInvalid")),
        Result.filterOrFail(
          (value): value is CommitSeq => value !== null,
          () => corruption("uniqueKeyTransitionInvalid"),
        ),
      ),
    );
    const ownerPosition = uniqueKeyOwnerPosition(
      position.definitionId,
      position.tableId,
      position.rowId,
    );
    if (owners.has(ownerPosition)) {
      throw corruption("uniqueKeyTransitionInvalid");
    }
    owners.set(
      ownerPosition,
      Object.freeze({
        commitSeq,
        // SAFETY: row.encodedKey stores the canonical lowercase hex spelling
        // of an ordered index key.
        encodedKey: encodeBytesToLowercaseHex(
          row.encodedKey,
        ) as OrderedIndexKeyHexV1,
      }),
    );
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
  previousClaimCommitSeq: CommitSeq | null,
  previous: AppUniqueKeyProjectionV1 | null,
  next: AppUniqueKeyProjectionV1 | null,
  sortKey: OrderedIndexKeyHexV1,
): PointCommitUniqueKeyActionV1 {
  return Object.freeze({
    phase,
    definition: plan.definition,
    rowId: plan.rowId,
    rowPrevCommitSeq: plan.rowPrevCommitSeq,
    previousClaimCommitSeq,
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
  return phase === "release" ? 0 : phase === "advance" ? 1 : 2;
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

async function loadPointCommitDeveloperIndexDocuments(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  loadedHeadsByDocumentId: ReadonlyMap<
    AppDocumentIdV1,
    LoadedPointCommitHeadV1
  >,
  builds: ReadonlyArray<LockedPointCommitDeveloperIndexV1>,
): Promise<ReadonlyMap<AppDocumentIdV1, CanonicalFlarexValueV1>> {
  return loadPointCommitDocumentsForTables(
    tx,
    command,
    loadedHeadsByDocumentId,
    new Set(builds.map((build) => build.definition.access.tableId)),
    "loadDeveloperIndexDocuments",
    "developerIndexTransitionInvalid",
  );
}

async function loadPointCommitUniqueKeyDocuments(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  loadedHeadsByDocumentId: ReadonlyMap<
    AppDocumentIdV1,
    LoadedPointCommitHeadV1
  >,
  definitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
): Promise<ReadonlyMap<AppDocumentIdV1, CanonicalFlarexValueV1>> {
  return loadPointCommitDocumentsForTables(
    tx,
    command,
    loadedHeadsByDocumentId,
    new Set(definitions.map((definition) => definition.tableId)),
    "loadUniqueKeyDocuments",
    "uniqueKeyTransitionInvalid",
  );
}

async function loadPointCommitRelationDocuments(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  loadedHeadsByDocumentId: ReadonlyMap<
    AppDocumentIdV1,
    LoadedPointCommitHeadV1
  >,
  sourceTableIds: ReadonlySet<CatalogTableId>,
): Promise<ReadonlyMap<AppDocumentIdV1, CanonicalFlarexValueV1>> {
  return loadPointCommitDocumentsForTables(
    tx,
    command,
    loadedHeadsByDocumentId,
    sourceTableIds,
    "loadRelationDocuments",
    "relationTransitionInvalid",
  );
}

async function loadPointCommitDocumentsForTables(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  loadedHeadsByDocumentId: ReadonlyMap<
    AppDocumentIdV1,
    LoadedPointCommitHeadV1
  >,
  indexedTableIds: ReadonlySet<CatalogTableId>,
  operation: Extract<
    PointCommitSqlOperationV1,
    | "loadDeveloperIndexDocuments"
    | "loadUniqueKeyDocuments"
    | "loadRelationDocuments"
  >,
  corruptionReason: Extract<
    PointCommitCorruptionReasonV1,
    | "developerIndexTransitionInvalid"
    | "uniqueKeyTransitionInvalid"
    | "relationTransitionInvalid"
  >,
): Promise<ReadonlyMap<AppDocumentIdV1, CanonicalFlarexValueV1>> {
  if (indexedTableIds.size === 0) return new Map();
  const requests: PointCommitDeveloperIndexDocumentRequestV1[] = [];
  for (const intent of command.rowIntents) {
    if (!indexedTableIds.has(intent.tableId)) continue;
    const loaded = loadedHeadsByDocumentId.get(intent.documentId);
    if (loaded === undefined) {
      throw corruption(corruptionReason);
    }
    if (loaded.head.kind !== "live") continue;
    if (loaded.creationTime === null) {
      throw corruption(corruptionReason);
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
  const scopeUuid = projectPointCommitTransactionResult(
    projectScopeIdUuidV1Result(command.authorityPins.scopeId).pipe(
      Result.mapError(() => corruption(corruptionReason)),
    ),
  ).scopeUuid;
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
  const result = await sqlCall(operation, () => tx.execute(statement));
  const rows = rowsFromDriverExecuteResult(result, () => {
    throw corruption(corruptionReason);
  });
  if (rows.length !== requests.length) {
    throw corruption(corruptionReason);
  }
  const documents = new Map<AppDocumentIdV1, CanonicalFlarexValueV1>();
  for (let ordinal = 0; ordinal < requests.length; ordinal += 1) {
    const raw = rows[ordinal];
    const request = requests[ordinal];
    if (
      !isNonArrayRecord(raw) ||
      request === undefined ||
      raw.ordinalText !== String(ordinal) ||
      raw.isTombstone !== false ||
      raw.creationTimeText !== String(request.creationTime) ||
      raw.valueCodecVersion !== FLAREX_VALUE_CODEC_VERSION_V1 ||
      !isUint8Array(raw.valueBytes) ||
      !isUint8ArrayWithByteLength(raw.valueSha256, 32)
    ) {
      throw corruption(corruptionReason);
    }
    let document: CanonicalFlarexValueV1;
    try {
      document = await decodeCanonicalFlarexValueEvidenceV1({
        profile: "appDocument",
        canonicalBytes: raw.valueBytes,
        sha256: raw.valueSha256,
      });
    } catch (cause) {
      if (
        cause instanceof FlarexValueEvidenceV1Error ||
        cause instanceof FlarexValueCodecV1Error
      ) {
        throw corruption(corruptionReason);
      }
      throw cause;
    }
    if (
      !isCanonicalDocumentForLoadedHead(
        document,
        request.documentId,
        request.creationTime,
      )
    ) {
      throw corruption(corruptionReason);
    }
    documents.set(request.documentId, document);
  }
  return documents;
}

function lowerDeveloperIndexKey(
  definition: LocatedAppIndexDefinitionV1,
  document: CanonicalFlarexValueV1,
  creationTime: AppCreationTimeV1,
): OrderedIndexKeyHexV1 {
  return projectPointCommitTransactionResult(
    lowerAppDeveloperIndexKeyV1(definition, document, creationTime).pipe(
      Result.mapError(
        (cause) =>
          new PointCommitDeveloperIndexMaintenanceUnavailableV1Error({
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
  if (positions.length === 0) return new Map();
  const scopeUuid = projectPointCommitTransactionResult(
    projectScopeIdUuidV1Result(command.authorityPins.scopeId).pipe(
      Result.mapError(() => corruption("developerIndexTransitionInvalid")),
    ),
  ).scopeUuid;
  const values = sql.join(
    positions.map(
      (position, ordinal) => sql`
    (
      ${ordinal}::integer,
      ${position.definitionId}::integer,
      ${orderedIndexKeyBytesHexV1ToBytes(position.encodedKey)}::bytea,
      ${orderedIndexRowIdHexV1ToBytes(position.rowId)}::bytea
    )
  `,
    ),
    sql`, `,
  );
  const statement = sql`
    with requested(ordinal, index_definition_id, encoded_key, row_id) as (
      values ${values}
    )
    select
      requested.ordinal::text as "ordinalText",
      current_entry.commit_seq::text as "currentCommitSeqText",
      latest.commit_seq::text as "latestCommitSeqText",
      latest.is_tombstone as "latestIsTombstone"
    from requested
    left join fx_app_index_entry_current as current_entry
      on current_entry.scope_uuid = ${scopeUuid}
      and current_entry.index_definition_id = requested.index_definition_id
      and current_entry.encoded_key = requested.encoded_key
      and current_entry.row_id = requested.row_id
    left join lateral (
      select revision.commit_seq, revision.is_tombstone
      from fx_app_index_entry_rev as revision
      where revision.scope_uuid = ${scopeUuid}
        and revision.index_definition_id = requested.index_definition_id
        and revision.encoded_key = requested.encoded_key
        and revision.row_id = requested.row_id
      order by revision.commit_seq desc
      limit 1
    ) as latest on true
    order by requested.ordinal asc
  `;
  const result = await sqlCall("loadDeveloperIndexEntryHeads", () =>
    tx.execute(statement),
  );
  const rows = rowsFromDriverExecuteResult(result, () => {
    throw corruption("developerIndexTransitionInvalid");
  });
  if (rows.length !== positions.length) {
    throw corruption("developerIndexTransitionInvalid");
  }
  const heads = new Map<string, PointCommitDeveloperIndexEntryHeadV1>();
  for (let ordinal = 0; ordinal < positions.length; ordinal += 1) {
    const raw = rows[ordinal];
    const position = positions[ordinal];
    if (!isNonArrayRecord(raw) || position === undefined) {
      throw corruption("developerIndexTransitionInvalid");
    }
    const decodedOrdinal = projectPointCommitTransactionResult(
      parseNonNegativeIntegerTextResult(raw.ordinalText).pipe(
        Result.mapError(() => corruption("developerIndexTransitionInvalid")),
      ),
    );
    const currentCommitSeq = projectPointCommitTransactionResult(
      parseNullableCommitSeqTextResult(raw.currentCommitSeqText).pipe(
        Result.mapError(() => corruption("developerIndexTransitionInvalid")),
      ),
    );
    const latestCommitSeq = projectPointCommitTransactionResult(
      parseNullableCommitSeqTextResult(raw.latestCommitSeqText).pipe(
        Result.mapError(() => corruption("developerIndexTransitionInvalid")),
      ),
    );
    if (
      decodedOrdinal !== ordinal ||
      (latestCommitSeq === null
        ? raw.latestIsTombstone !== null || currentCommitSeq !== null
        : typeof raw.latestIsTombstone !== "boolean" ||
          (raw.latestIsTombstone
            ? currentCommitSeq !== null
            : currentCommitSeq !== latestCommitSeq))
    ) {
      throw corruption("developerIndexTransitionInvalid");
    }
    heads.set(
      developerIndexPositionKey(
        position.definitionId,
        position.encodedKey,
        position.rowId,
      ),
      Object.freeze({
        commitSeq: latestCommitSeq,
        // SAFETY: latestIsTombstone is a boolean persistence column and is
        // only read here when a latest commit exists.
        isTombstone:
          latestCommitSeq === null ? null : (raw.latestIsTombstone as boolean),
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

async function writePointCommitDeveloperIndexActions(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  commitSeq: CommitSeq,
  writeEpoch: ScopeEpoch,
  actions: ReadonlyArray<PointCommitDeveloperIndexEntryActionV1>,
  options: ApplicationDocumentMaterializationOptions,
): Promise<void> {
  for (const action of actions) {
    const appended = await sqlCall("writeDeveloperIndexEntry", () =>
      appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(tx, {
        kind: action.kind,
        scopeId: command.authorityPins.scopeId,
        definition: action.definition,
        encodedKey: action.encodedKey,
        rowId: action.rowId,
        writeEpoch,
        commitSeq,
        prevCommitSeq: action.prevCommitSeq,
      }),
    );
    projectPointCommitTransactionResult(appended);
    await emitTransactionStep(options, command, "developerIndexEntryWritten");
  }
}

async function writePointCommitUniqueKeyActions(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  commitSeq: CommitSeq,
  writeEpoch: ScopeEpoch,
  actions: ReadonlyArray<PointCommitUniqueKeyActionV1>,
  options: ApplicationDocumentMaterializationOptions,
): Promise<void> {
  for (const action of actions) {
    const input: ApplyAppUniqueKeyMutationV1Input = Object.freeze({
      scopeId: command.authorityPins.scopeId,
      constraintId: action.definition.uniqueConstraintDefinitionId,
      tableId: action.definition.tableId,
      rowId: action.rowId,
      writeEpoch,
      commitSeq,
      rowPrevCommitSeq: action.rowPrevCommitSeq,
      previousClaimCommitSeq: action.previousClaimCommitSeq,
      previous: action.previous,
      next: action.next,
    });
    const settled = await runPointCommitInTransactionEffect(
      applyAppUniqueKeyMutationInTransactionEffect(tx, input),
    );
    projectPointCommitTransactionResult(
      settled.pipe(Result.mapError(mapPointCommitUniqueKeyFailure)),
    );
    await emitTransactionStep(options, command, "uniqueKeyWritten");
  }
}

function mapPointCommitUniqueKeyFailure(
  failure: Effect.Error<
    ReturnType<typeof applyAppUniqueKeyMutationInTransactionEffect>
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
        .for("update"),
    );
    const row = rows[0];
    if (row === undefined) continue;
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
    projectPointCommitTransactionResult(validateIndexBuildStateFrontierResult(state, clock.record.lastCommitSeq).pipe(
      Result.mapError(() => corruption("intrinsicIndexBuildInvalid")),
    ));
    locked.push(Object.freeze({ definition, build: state }));
  }
  return Object.freeze(locked);
}

async function lowerTentativePointCommitIntrinsicIndex(
  tx: AppRowTransaction,
  build: IndexBuildStateRecord,
  definition: LocatedAppIndexDefinitionV1,
  rowRevision: AppendPreparedAppRowRevisionV1Input,
): Promise<boolean> {
  if (
    definition.access.kind !== "by_creation_time" ||
    definition.access.tableId !== rowRevision.tableId ||
    build.indexDefinitionId !== definition.indexDefinitionId ||
    build.scopeId !== rowRevision.scopeId
  ) {
    throw corruption("intrinsicIndexBuildInvalid");
  }
  const encodedKey = encodeAppOrderedIndexKeyV1({
    spec: definition.physicalSpec,
    values: [orderedIndexCreationTimeV1(rowRevision.creationTime)],
  });
  const rowId = projectPointCommitTransactionResult(
    orderedIndexRowIdHexV1FromBytesResult(
      appRowIdHexV1ToBytes(rowRevision.rowId),
    ).pipe(
      Result.mapError(() => corruption("intrinsicIndexTransitionInvalid")),
    ),
  );
  const keyBytes = orderedIndexKeyHexV1ToBytes(encodedKey);
  const rowIdBytes = appRowIdHexV1ToBytes(rowRevision.rowId);
  const heads = await sqlCall("writeIntrinsicIndexEntry", () =>
    tx
      .select({
        commitSeq: fxAppIndexEntryRevisions.commitSeq,
        isTombstone: fxAppIndexEntryRevisions.isTombstone,
      })
      .from(fxAppIndexEntryRevisions)
      .where(
        and(
          eq(
            fxAppIndexEntryRevisions.scopeUuid,
            projectScopeIdUuidV1Result(rowRevision.scopeId).pipe(
              Result.getOrThrow,
            ).scopeUuid,
          ),
          eq(
            fxAppIndexEntryRevisions.indexDefinitionId,
            definition.indexDefinitionId,
          ),
          eq(fxAppIndexEntryRevisions.encodedKey, keyBytes),
          eq(fxAppIndexEntryRevisions.rowId, rowIdBytes),
        ),
      )
      .orderBy(desc(fxAppIndexEntryRevisions.commitSeq))
      .limit(1),
  );
  const head = heads[0];
  if (rowRevision.kind === "tombstone") {
    if (head === undefined) {
      if (build.lifecycle === "enabled") {
        throw corruption("intrinsicIndexTransitionInvalid");
      }
      return false;
    }
    if (
      head.isTombstone ||
      rowRevision.prevCommitSeq === null ||
      head.commitSeq !== rowRevision.prevCommitSeq
    ) {
      throw corruption("intrinsicIndexTransitionInvalid");
    }
  } else {
    if (
      head === undefined &&
      rowRevision.prevCommitSeq !== null &&
      build.lifecycle === "enabled"
    ) {
      throw corruption("intrinsicIndexTransitionInvalid");
    }
    if (
      head !== undefined &&
      (head.isTombstone ||
        rowRevision.prevCommitSeq === null ||
        head.commitSeq !== rowRevision.prevCommitSeq)
    ) {
      throw corruption("intrinsicIndexTransitionInvalid");
    }
  }
  const appended = await sqlCall("writeIntrinsicIndexEntry", () =>
    appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(tx, {
      kind: rowRevision.kind,
      scopeId: rowRevision.scopeId,
      definition,
      encodedKey,
      rowId,
      writeEpoch: rowRevision.writeEpoch,
      commitSeq: rowRevision.commitSeq,
      prevCommitSeq: head?.commitSeq ?? null,
    }),
  );
  projectPointCommitTransactionResult(appended);
  return true;
}

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

async function lowerTentativePointCommitRow(
  tx: AppRowTransaction,
  writeEpoch: ScopeEpoch,
  tentativeCommitSeq: CommitSeq,
  command: ApplicationDocumentMaterializationCommand,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
  intent: PreparedPointCommitRowIntentV1,
): Promise<AppendPreparedAppRowRevisionV1Input> {
  const input = projectPointCommitTransactionResult(
    prepareTentativePointCommitRowResult(
      writeEpoch,
      tentativeCommitSeq,
      command,
      heads,
      intent,
    ),
  );
  const written = await sqlCall("writeTentativeRow", () =>
    appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult(tx, input),
  );
  projectPointCommitTransactionResult(written);
  return input;
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
