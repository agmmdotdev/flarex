import { fxSystemIndexMaintenanceObligations } from "../schema";
import { IndexMaintenanceError } from "../indexMaintenanceModel";
export { prepareApplicationDocumentSettlementEffect, preparedApplicationDocumentSettlementHasFailure,
  type PreparedApplicationDocumentSettlement } from "./settlementPlan";
import { prepareDeveloperIndexKeyPairsResult, prepareUniqueKeyPairsResult, prepareRelationTransitionsResult,
  type PreparedApplicationDocumentSettlement } from "./settlementPlan";
import { observePointCommitPublicationEffect, type PointCommitPublicationObservation } from "../pointCommitPublicationObservation";
import { MAX_POINT_COMMIT_MATERIAL_ROWS_V1 } from "flarex-protocol/commit-protocol";
import { MAX_SCHEMA_MANIFEST_APP_INDEXES } from "flarex-protocol/schema-manifest";
import {
  isIndexBuildSnapshotCoveredInTransactionEffect,
  readIndexCoverageContextInTransactionEffect,
  readIndexCoverageTableFrontiersInTransactionEffect,
  readPreparedIndexCoverageTableFrontiers,
  validateIndexBuildStateFrontierResult,
} from "../indexBuildStates";
import { sqlCall, pointCommitSqlCallFailure } from "../pointCommitErrors";
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
  FinitePointCommitHeads,
  PreparedPointCommitApplicationRelationPlan,
  PointCommitApplicationRelationMaintenanceError,
  LockedPointCommitDeveloperIndexV1,
  PointCommitDeveloperIndexEntryActionV1,
  PointCommitDeveloperIndexRowPlanV1,
  PointCommitDeveloperIndexDocumentRequestV1,
  PointCommitUniqueKeyPlanV1,
  PointCommitUniqueKeyActionV1,
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
  corruption,
} from "../pointCommitErrors";

import {
  encodeBytesToLowercaseHex,
  bytesEqual,
} from "@flarex/utils/bytes";

import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { getTableColumns, and, eq, inArray, sql } from "drizzle-orm";
import { Data, Effect, Exit, Result, Schema } from "effect";

import {
  AppCreationTimeV1Schema,
  decodeCanonicalAppDocumentEvidenceV1Effect,
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";

import {
  appRowIdHexV1ToBytes,
  appDocumentIdV1FromRowIdentity,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  type CatalogTableId,
} from "flarex-protocol/catalog";

import {
  encodeAppOrderedIndexKeyV1,
  orderedIndexCreationTimeV1,
  orderedIndexRowIdHexV1ToBytes,
  orderedIndexRowIdHexV1FromBytesResult,
  type OrderedIndexKeyHexV1,
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
  type LocateAppDeveloperIndexDefinitionsV1Error,
} from "../appDeveloperIndexCommitV1";

import {
  hasAppUniqueConstraintDefinitionAuthorityV1,
} from "../appUniqueConstraintCommitV1";
import {
  isLocatedAppUniqueConstraintDefinitionV1,
  type LocatedAppUniqueConstraintDefinitionV1,
} from "../appUniqueConstraintDefinitions";
import type { ReadAppUniqueConstraintSetClosureV1Error } from "../appUniqueConstraintSetClosureV1";
import {
  AppUniqueConstraintSetBuildIntegrationV1Error,
  prepareActiveUniqueCoverageInTransactionEffect,
  prepareUnboundUniqueCoverageApplicationResult,
} from "../appUniqueConstraintSetBuildV1";
import {
  AppUniqueKeyConflictError,
  AppUniqueKeyHashError,
  AppUniqueKeyPersistenceError,
  AppUniqueKeyParentRowError, AppUniqueKeyPreviousClaimMismatchError, AppUniqueKeyStorageCorruptionError,
  AppUniqueKeyScopeAuthorityUnavailableError, InvalidAppUniqueKeyMutationV1Error,
  CanonicalAppUniqueKeyHashCollisionError,
  preparedAppUniqueApplicationFailure, recordPreparedAppUniqueApplication,
  type PreparedAppUniqueMutationApplication,
  acceptAppUniqueOriginalOwnersInTransactionEffect, prepareAppUniqueCanonicalMutationApplicationEffect,
  applyPreparedAppUniqueMutationApplicationEffect,
} from "../appUniqueKeys";
import {
  AppIndexEntryWritePersistenceError,
  AppIndexEntryReadPersistenceError,
  type AppIndexEntryPositionV1,
  type AppendAppIndexEntryRevisionV1Input,
  prepareAppIndexRevisionApplicationEffect, preparedAppIndexApplicationFailure, type PreparedAppIndexRevisionApplication,
  acceptAppIndexKeyTransitionsInTransactionEffect, AppIndexTransitionLimitExceededError, AppIndexTransitionAcceptanceError,
} from "../appIndexEntries";
import type {
  LocatedAppIndexDefinitionV1,
  ReadAppIndexDefinitionError,
} from "../appIndexDefinitions";
import {
  AppRowReadPersistenceError,
  AppRowWritePersistenceError,
  type AppendPreparedAppRowRevisionV1Input,
  type AppRowIdentityV1,
  type AppRowPointDependencyV1,
  type AppRowTransaction,
  type LiveAppRowRevisionV1,
  prepareAppRowRevisionApplicationEffect, preparedAppRowApplicationFailure, type PreparedAppRowRevisionApplication,
} from "../appRows";
import { AppRelationEdgePersistenceError } from "../appRelationEdges";
import {
  applyApplicationRelationCommitEdgesInTransactionEffect,
  assertApplicationRelationRestrictProbesInTransactionEffect,
  ApplicationRelationCommitCorruptionError,
  ApplicationRelationCommitUnavailableError,
  ApplicationRelationTargetDeleteRestrictedError,
  ApplicationRelationTargetNotLiveError,
  type PreparedApplicationRelationCommit,
} from "../applicationRelationCommit";

import { ReadApplicationRelationBindingError } from "../applicationRelationBinding";
import {
  applyAppSchemaCandidateWriteGuardInTransactionEffect,
  prepareAppSchemaCandidateWriteGuardEffect,
  prepareAppSchemaCandidateWriteGuardFromPlanningHeadEffect,
  AppSchemaCandidateWriteGuardError,
  type AppSchemaCandidateWriteGuardPort,
  type PreparedAppSchemaCandidateWriteGuard,
} from "../appSchemaCandidateValidation";

import {
  decodeIndexBuildStateRowResult, indexBuildStateSelection, indexMaintenanceBindingPredicate,
  publicationModeForIndex,
  type IndexBuildStateRecord, type IndexBuildStateRow,
} from "../indexBuildStates";
import { validateAppRowPointOccV1 } from "../appRowPointOcc";

import { rowsFromDriverExecuteResult } from "../driverExecuteResult";
import { requireAdmittedTargetInstallationSchema } from "../installationLifecycle";
import { applicationCompositeSelection, applicationDomainFailureDetail, buildApplicationMaterializationStatement, applicationMaterializationBindCount,
  applicationIndexCoverageArray, type ApplicationMaterializationValues } from "./domainApplication";
import { applyApplicationCoverage, applicationCoverageFailure, ApplicationCoverageRefusal, ApplicationCoveragePersistenceError, APPLICATION_COVERAGE_MAX_ROWS,
  type IndexCoverageWrite, type UniqueCoverageWrite } from "./domainCoverage";
import { prepareLogicalSearchApplications, searchApplicationFailure, type PreparedLogicalSearchApplication } from "../logicalDocuments/searchEntries";

import { closeExactAttemptScopeClockObservation, readExactScopeWriteClockObservation, type ScopeClockRecord } from "../scopeClock";
import { type TrustedScopeAuthority } from "../scopeAuthorityResolution";

import { fxAppRowRevisions, fxSystemIndexBuildStates } from "../schema";

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
    const definition = yield* observePointCommitPublicationEffect(options.publicationObservation, "intrinsicDefinition", port.locate({
      deploymentId: command.authorityPins.deploymentId,
      scopeId: command.authorityPins.scopeId,
      tableId: intent.tableId,
    }));
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
    maximumDefinitions: MAX_SCHEMA_MANIFEST_APP_INDEXES,
  });
  if (definitions === null) {
    return yield* Effect.fail(
      new PointCommitDeveloperIndexMaintenanceUnavailableV1Error({
        reason: "definitionSetUnavailable",
      }),
    );
  }
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
  const prepared = yield* (command.candidatePlanningHead === undefined
    ? prepareAppSchemaCandidateWriteGuardEffect(guard, { deploymentId: command.authorityPins.deploymentId, scopeId: command.authorityPins.scopeId })
    : prepareAppSchemaCandidateWriteGuardFromPlanningHeadEffect(guard, command.candidatePlanningHead));
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
export interface PreparedApplicationMaterializationBlock {
  readonly commitSeq: CommitSeq;
  readonly scopeUuid: import("flarex-protocol/storage-authority").ScopeUuidV1;
  readonly rows?: PreparedAppRowRevisionApplication;
  readonly indexes?: PreparedAppIndexRevisionApplication;
  readonly unique?: PreparedAppUniqueMutationApplication;
  readonly validation?: readonly IndexCoverageWrite[];
  readonly indexCoverage?: readonly IndexCoverageWrite[];
  readonly uniqueCoverage?: readonly UniqueCoverageWrite[];
  readonly search?: readonly PreparedLogicalSearchApplication[];
}
export class ApplicationMaterializationPersistenceError extends Data.TaggedError("ApplicationMaterializationPersistenceError")<{
  readonly cause: unknown;
}> {}
class ApplicationIndexValidationRefusal extends Data.TaggedError("ApplicationIndexValidationRefusal")<{
  readonly ordinal: number; readonly cause: unknown;
}> {}
const decodeMaterializationRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Struct({
  family: Schema.Literals(["row", "index", "unique", "indexValidation", "indexCoverage", "uniqueCoverage", "search"]),
  pageOffset: Schema.Number, detail: Schema.String,
})), { onExcessProperty: "error" });
const decodeIndexValidationRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Struct({
  reason: Schema.Literals(["invalidBatch", "storedCorruption"]), ordinal: Schema.Number,
})), { onExcessProperty: "error" });
const decodeIndexValidationSuccess = Schema.decodeUnknownResult(Schema.Struct({
  reason: Schema.Literal("accepted"), rows: Schema.Number,
}), { onExcessProperty: "error" });
const decodeMaterializationSuccess = Schema.decodeUnknownResult(Schema.Struct({
  reason: Schema.Literal("accepted"), row_count: Schema.Number, index_count: Schema.Number, unique_count: Schema.Number,
  validation_count: Schema.Number, coverage_count: Schema.Number, search_count: Schema.Number, search_build_count: Schema.Number,
}), { onExcessProperty: "error" });

function materializationValues(block: PreparedApplicationMaterializationBlock): ApplicationMaterializationValues {
  return { rows: block.rows?.values ?? [], rowPages: block.rows?.pageCounts ?? [], indexes: block.indexes?.values ?? [],
    unique: block.unique ?? { owners: [], previous: [], next: [] }, validation: block.validation ?? [],
    indexCoverage: block.indexCoverage ?? [], uniqueCoverage: block.uniqueCoverage ?? [],
    commitSeq: block.commitSeq, scopeUuid: block.scopeUuid, search: block.search ?? [] };
}

function materializationApplicationFailure(cause: unknown, block: PreparedApplicationMaterializationBlock) {
  const detail = applicationDomainFailureDetail(cause, "fx_apply_app_materialization");
  if (detail === null) return new ApplicationMaterializationPersistenceError({ cause });
  return Result.match(decodeMaterializationRefusal(detail), {
    onFailure: () => new ApplicationMaterializationPersistenceError({ cause }),
    onSuccess: refusal => {
      if (!Number.isSafeInteger(refusal.pageOffset) || refusal.pageOffset < 0) return new ApplicationMaterializationPersistenceError({ cause });
      switch (refusal.family) {
        case "row": return block.rows === undefined ? new ApplicationMaterializationPersistenceError({ cause })
          : preparedAppRowApplicationFailure(cause, block.rows, refusal.pageOffset, refusal.detail);
        case "index": return block.indexes === undefined ? new ApplicationMaterializationPersistenceError({ cause })
          : preparedAppIndexApplicationFailure(cause, block.indexes, refusal.pageOffset, refusal.detail);
        case "unique": return block.unique === undefined || refusal.pageOffset !== 0 ? new ApplicationMaterializationPersistenceError({ cause })
          : preparedAppUniqueApplicationFailure(cause, block.unique, refusal.detail);
        case "indexValidation": return Result.match(decodeIndexValidationRefusal(refusal.detail), {
          onFailure: () => new ApplicationMaterializationPersistenceError({ cause }),
          onSuccess: proof => refusal.pageOffset !== 0 || !Number.isSafeInteger(proof.ordinal) || proof.ordinal < 0 || proof.ordinal >= (block.validation?.length ?? 0)
            ? new ApplicationMaterializationPersistenceError({ cause }) : new ApplicationIndexValidationRefusal({ ordinal: proof.ordinal, cause }),
        });
        case "indexCoverage":
        case "uniqueCoverage": {
          const rows = refusal.family === "indexCoverage" ? block.indexCoverage ?? [] : block.uniqueCoverage ?? [];
          const offset = refusal.pageOffset;
          if (offset % 32 !== 0 || offset >= rows.length) return new ApplicationMaterializationPersistenceError({ cause });
          const count = Math.min(32, rows.length - offset);
          const prior = offset + count === rows.length ? offset : 0;
          const failure = applicationCoverageFailure(cause, refusal.family === "indexCoverage" ? count : 0,
            refusal.family === "uniqueCoverage" ? count : 0, refusal.family === "indexCoverage" ? prior : 0,
            refusal.family === "uniqueCoverage" ? prior : 0, refusal.detail);
          return failure instanceof ApplicationCoverageRefusal && failure.family !== (refusal.family === "indexCoverage" ? "index" : "unique")
            ? new ApplicationMaterializationPersistenceError({ cause }) : failure;
        }
        case "search": {
          let offset = 0;
          for (const search of block.search ?? []) {
            if (refusal.pageOffset >= offset && refusal.pageOffset < offset + search.ids.length && (refusal.pageOffset - offset) % 32 === 0)
              return searchApplicationFailure(cause, refusal.detail);
            offset += search.ids.length;
          }
          return new ApplicationMaterializationPersistenceError({ cause });
        }
      }
    },
  });
}

/** This accepting boundary composes only already-prepared fixed domain owners. */
const applyOnePreparedApplicationMaterializationEffect = Effect.fn("ApplicationDocument.applyPreparedMaterializationBlock")(function* (
  tx: AppRowTransaction, block: PreparedApplicationMaterializationBlock,
  observation?: PointCommitPublicationObservation,
) {
  const values = materializationValues(block);
  const schemaName = yield* Effect.fromResult(requireAdmittedTargetInstallationSchema(tx).pipe(Result.mapError(cause => new ApplicationMaterializationPersistenceError({ cause }))));
  const statement = buildApplicationMaterializationStatement(values, schemaName);
  const result = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => tx.execute(statement),
    catch: cause => materializationApplicationFailure(cause, block),
  }));
  const rows = rowsFromDriverExecuteResult(result, () => { throw new ApplicationMaterializationPersistenceError({ cause: result }); });
  if (rows.length !== 1) return yield* Effect.fail(new ApplicationMaterializationPersistenceError({ cause: result }));
  const proof = yield* Effect.fromResult(decodeMaterializationSuccess(rows[0]).pipe(Result.mapError(cause => new ApplicationMaterializationPersistenceError({ cause }))));
  if (proof.row_count !== values.rows.length || proof.index_count !== values.indexes.length || proof.unique_count !== values.unique.owners.length ||
    proof.validation_count !== values.validation.length || proof.coverage_count !== values.indexCoverage.length + values.uniqueCoverage.length ||
    proof.search_count !== values.search.reduce((sum, search) => sum + search.entryCount, 0) || !Number.isSafeInteger(proof.search_build_count) ||
    proof.search_build_count < 0 || proof.search_build_count > values.search.length)
    return yield* Effect.fail(new ApplicationMaterializationPersistenceError({ cause: proof }));
  recordPreparedMaterialization(block, proof.search_build_count, observation);
  return proof;
}, (effect, tx) => effect.pipe(Effect.onError(() => Effect.sync(() => closeExactAttemptScopeClockObservation(tx)))));

const APPLICATION_MATERIALIZATION_MAX_DRIVER_BINDS = 65_535;
export const applyPreparedApplicationMaterializationEffect = Effect.fn("ApplicationDocument.applyPreparedMaterialization")(function* (
  tx: AppRowTransaction, block: PreparedApplicationMaterializationBlock, observation?: PointCommitPublicationObservation,
) {
  const base = { commitSeq: block.commitSeq, scopeUuid: block.scopeUuid };
  const stages: PreparedApplicationMaterializationBlock[] = [];
  if (block.rows !== undefined && block.rows.values.length > 0) stages.push({ ...base, rows: block.rows });
  if (block.indexes !== undefined && block.indexes.values.length > 0) stages.push({ ...base, indexes: block.indexes });
  if (block.validation !== undefined && block.validation.length > 0) stages.push({ ...base, validation: block.validation });
  if (block.unique !== undefined && block.unique.mutations.length > 0) stages.push({ ...base, unique: block.unique });
  if (block.indexCoverage !== undefined && block.indexCoverage.length > 0) stages.push({ ...base, indexCoverage: block.indexCoverage });
  if (block.uniqueCoverage !== undefined && block.uniqueCoverage.length > 0) stages.push({ ...base, uniqueCoverage: block.uniqueCoverage });
  stages.push(...(block.search ?? []).map(search => ({ ...base, search: [search] })));
  const blocks: PreparedApplicationMaterializationBlock[] = [];
  let pending: PreparedApplicationMaterializationBlock = base;
  let hasStage = false;
  for (const stage of stages) {
    const candidate = { ...pending, ...stage, search: [...(pending.search ?? []), ...(stage.search ?? [])] };
    if (hasStage && applicationMaterializationBindCount(materializationValues(candidate)) > APPLICATION_MATERIALIZATION_MAX_DRIVER_BINDS) {
      blocks.push(pending); pending = stage;
    } else pending = candidate;
    hasStage = true;
  }
  if (hasStage) blocks.push(pending);
  let accepted = { reason: "accepted", row_count: 0, index_count: 0, unique_count: 0,
    validation_count: 0, coverage_count: 0, search_count: 0, search_build_count: 0 };
  for (const selected of blocks) {
    const proof = yield* observePointCommitPublicationEffect(observation, "materializationWrites", applyOnePreparedApplicationMaterializationEffect(tx, selected, observation));
    accepted = { reason: "accepted", row_count: accepted.row_count + proof.row_count, index_count: accepted.index_count + proof.index_count,
      unique_count: accepted.unique_count + proof.unique_count, validation_count: accepted.validation_count + proof.validation_count,
      coverage_count: accepted.coverage_count + proof.coverage_count, search_count: accepted.search_count + proof.search_count,
      search_build_count: accepted.search_build_count + proof.search_build_count };
  }
  return accepted;
});

function projectMaterializationApplicationFailure(failure: Effect.Error<ReturnType<typeof applyPreparedApplicationMaterializationEffect>>) {
  if (failure instanceof ApplicationMaterializationPersistenceError) return pointCommitSqlCallFailure("applyApplicationMaterialization", failure.cause);
  if (failure instanceof AppRowWritePersistenceError) return pointCommitSqlCallFailure("writeTentativeRow", failure.cause);
  if (failure instanceof AppIndexEntryReadPersistenceError || failure instanceof AppIndexEntryWritePersistenceError)
    return pointCommitSqlCallFailure("writeIndexEntries", failure.cause);
  if (failure instanceof AppUniqueKeyPersistenceError || failure instanceof AppUniqueKeyConflictError || failure instanceof AppUniqueKeyHashError ||
    failure instanceof CanonicalAppUniqueKeyHashCollisionError || failure instanceof AppUniqueKeyParentRowError ||
    failure instanceof AppUniqueKeyPreviousClaimMismatchError || failure instanceof AppUniqueKeyStorageCorruptionError ||
    failure instanceof AppUniqueKeyScopeAuthorityUnavailableError || failure instanceof InvalidAppUniqueKeyMutationV1Error)
    return mapPointCommitUniqueKeyFailure(failure);
  if (failure instanceof ApplicationCoveragePersistenceError) return pointCommitSqlCallFailure("applyApplicationMaterialization", failure.cause);
  if (failure instanceof ApplicationCoverageRefusal) return corruption(failure.family === "index" ? "developerIndexBuildInvalid" : "uniqueConstraintBuildInvalid");
  if (failure instanceof ApplicationIndexValidationRefusal) return corruption("intrinsicIndexBuildInvalid");
  return failure;
}

function recordPreparedMaterialization(block: PreparedApplicationMaterializationBlock, advancedSearchBuilds: number, observation?: PointCommitPublicationObservation): void {
  if (!observation?.detail) return;
  let rowOffset = 0;
  for (const count of block.rows?.pageCounts ?? []) {
    const rows = block.rows?.decoded.slice(rowOffset, rowOffset + count) ?? [];
    observation.record({ kind: "batch", owner: "rowRevisions", counts: { rows: count,
      canonicalBytes: rows.reduce((sum, row) => sum + (row.kind === "live" ? row.document.canonicalBytes.byteLength : 0), 0) } });
    const creates = rows.filter(row => row.prevCommitSeq === null).length;
    if (creates > 0) observation.record({ kind: "batch", owner: "rowCreates", counts: { rows: creates } });
    if (creates < count) observation.record({ kind: "batch", owner: "rowUpdates", counts: { rows: count - creates } });
    rowOffset += count;
  }
  for (let offset = 0; offset < (block.indexes?.values.length ?? 0); offset += 32) {
    const rows = block.indexes?.values.slice(offset, offset + 32) ?? [];
    observation.record({ kind: "batch", owner: "indexRevisions", counts: { rows: rows.length, canonicalBytes: rows.reduce((sum, row) => sum + row.row.encodedKey.byteLength, 0) } });
    const creates = rows.filter(row => !row.row.isTombstone).length;
    if (creates > 0) observation.record({ kind: "batch", owner: "indexCreates", counts: { rows: creates } });
    if (creates < rows.length) observation.record({ kind: "batch", owner: "indexDeletes", counts: { rows: rows.length - creates } });
  }
  if (block.unique !== undefined) recordPreparedAppUniqueApplication(block.unique, observation);
  for (const [owner, rows] of [["indexValidation", block.validation ?? []], ["indexCoverage", block.indexCoverage ?? []], ["uniqueCoverage", block.uniqueCoverage ?? []]] as const)
    for (let offset = 0; offset < rows.length; offset += 32) observation.record({ kind: "batch", owner, counts: { rows: Math.min(32, rows.length - offset) } });
  let entries = 0; let textBytes = 0;
  for (const search of block.search ?? []) {
    entries += search.entryCount; textBytes += search.textBytes;
    for (let offset = 0; offset < search.ids.length; offset += 32) {
      observation.record({ kind: "batch", owner: "searchDeletes", counts: { rows: Math.min(32, search.ids.length - offset) } });
      const count = (search.textPages[offset / 32]?.length ?? 0) + (search.jsonPages[offset / 32]?.length ?? 0);
      if (count > 0) observation.record({ kind: "batch", owner: "searchInserts", counts: { entries: count } });
    }
  }
  if (advancedSearchBuilds > 0) observation.record({ kind: "batch", owner: "searchBuilds", counts: { rows: advancedSearchBuilds } });
  if ((block.search?.length ?? 0) > 0) observation.record({ kind: "counts", owner: "searchInserts", counts: { entries, textBytes } });
}

export interface ApplicationDocumentMaterializationInput {
  readonly command: ApplicationDocumentMaterializationCommand;
  readonly commitSeq: CommitSeq;
  readonly clock: ScopeClockRecord;
  readonly loadedHeads: readonly LoadedPointCommitHeadV1[];
  readonly intrinsicBuilds: readonly LockedPointCommitIntrinsicIndexV1[];
  readonly developerIndexActions: readonly PointCommitDeveloperIndexEntryActionV1[];
  readonly developerBuilds: readonly LockedPointCommitDeveloperIndexV1[];
  readonly uniqueKeyActions: readonly PointCommitUniqueKeyActionV1[];
  readonly uniqueDefinitions: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly canonicalUniquePairs: readonly PointCommitUniqueKeyPlanV1[];
  readonly publicationProfile: import("../indexBuildStates").IndexPublicationProfile;
  readonly options: ApplicationDocumentMaterializationOptions;
  readonly deferCoverage?: boolean;
  readonly capturedCoverage?: import("../indexBuildStates").CapturedApplicationMaterializationCoverage;
  readonly searchContribution?: Result.Result<import("./model").ApplicationDocumentSearchContribution, PointCommitCorruptionV1Error>;
  readonly preparedIntrinsic?: PreparedApplicationDocumentSettlement["intrinsic"];
}

export async function materializeApplicationDocumentRows(
  tx: AppRowTransaction,
  input: ApplicationDocumentMaterializationInput,
): Promise<(() => Promise<void>) | void> {
  const { command, commitSeq, clock, loadedHeads, intrinsicBuilds, developerIndexActions, developerBuilds,
    uniqueKeyActions, uniqueDefinitions, canonicalUniquePairs, publicationProfile, options,
    deferCoverage = false, capturedCoverage, searchContribution, preparedIntrinsic } = input;
  const writeEpoch = clock.epoch;
  const maintainedBuilds = [...intrinsicBuilds, ...developerBuilds];
  const coverageContext = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
    readIndexCoverageContextInTransactionEffect(tx, clock, undefined, capturedCoverage).pipe(Effect.mapError(cause =>
      cause.reason === "resourceFailure" ? new PointCommitSqlFailureMarkerV1("lockDeveloperIndexBuilds", cause.cause)
        : corruption("developerIndexBuildInvalid"))),
  ));
  const indexFrontierTableIds = [...new Set(maintainedBuilds.flatMap(({ build, definition }) =>
    build.lifecycle === "enabled" && build.maintenance === null &&
      build.coveredThroughCommitSeq !== null && build.coveredThroughCommitSeq < clock.lastCommitSeq &&
      build.firstReadableCommitSeq !== null && build.firstReadableCommitSeq <= clock.lastCommitSeq
      ? [definition.access.tableId] : []))];
  const uniqueBuilds = await runUniqueCoverage(
    prepareActiveUniqueCoverageInTransactionEffect(tx, clock, command.authorityPins.schemaVersionId,
      uniqueDefinitions, coverageContext, publicationProfile, deferCoverage, indexFrontierTableIds),
  );
  let indexFrontiersPrepared = false;
  for (const { build, definition } of maintainedBuilds) {
    const mode = publicationModeForIndex(publicationProfile, definition);
    if ((mode === "activeApplication" && coverageContext.active !== null && (build.lifecycle !== "enabled" || build.maintenance === null)) ||
      (mode === "sourceBound" && (build.lifecycle !== "enabled" || build.maintenance !== null)) ||
      (typeof publicationProfile !== "string" && mode === "activeApplication" && coverageContext.active === null))
      throw new PointCommitDeveloperIndexMaintenanceUnavailableV1Error({ reason: "definitionSetUnavailable" });
    const maintenanceSchemaVersionId = typeof publicationProfile !== "string" && mode === "activeApplication"
      ? coverageContext.active?.schema.schemaVersionId : command.authorityPins.schemaVersionId;
    if (build.maintenance !== null && (build.maintenance.schemaVersionId !== maintenanceSchemaVersionId ||
      build.maintenance.deploymentId !== command.authorityPins.deploymentId ||
      encodeBytesToLowercaseHex(build.maintenance.physicalSpecSha256) !== definition.physicalSpecSha256Hex))
      throw corruption("developerIndexBuildInvalid");
    if (build.lifecycle !== "enabled") continue;
    if (!indexFrontiersPrepared && indexFrontierTableIds.length > 0 &&
      build.maintenance === null && build.coveredThroughCommitSeq !== null &&
      build.coveredThroughCommitSeq < clock.lastCommitSeq) {
      const prepared = projectPointCommitTransactionResult(readPreparedIndexCoverageTableFrontiers(
        tx, clock, coverageContext, indexFrontierTableIds).pipe(Result.mapError(() =>
          corruption("developerIndexBuildInvalid"))));
      if (prepared === null) projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
        readIndexCoverageTableFrontiersInTransactionEffect(tx, coverageContext, indexFrontierTableIds)
          .pipe(Effect.mapError(cause => cause instanceof AppRowReadPersistenceError
            ? new PointCommitSqlFailureMarkerV1("lockDeveloperIndexBuilds", cause.cause)
            : corruption("developerIndexBuildInvalid")))));
      indexFrontiersPrepared = true;
    }
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
      projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
        applyApplicationCoverage(tx, [build], [], clock.lastCommitSeq, baselineCoverage).pipe(Effect.mapError(cause =>
          cause instanceof ApplicationCoveragePersistenceError ? pointCommitSqlCallFailure("resetDeveloperIndexValidation", cause.cause)
            : corruption("developerIndexBuildInvalid")))));
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
      observePointCommitPublicationEffect(options.publicationObservation, "intrinsicMembership", prepareIntrinsicIndexActionsEffect(
        tx,
        command.authorityPins.scopeId,
        rowRevisions,
        intrinsicBuilds,
        preparedIntrinsic,
      )),
    ),
  );
  if (rowRevisions.length > 0 && intrinsicBuilds.length > 0)
    await emitTransactionStep(options, command, "intrinsicMembershipPrepared");
  const scopeUuid = projectPointCommitTransactionResult(projectScopeIdUuidV1Result(command.authorityPins.scopeId)).scopeUuid;
  const base = { commitSeq, scopeUuid };
  let pending: PreparedApplicationMaterializationBlock = base;
  const flush = async () => {
    projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
      applyPreparedApplicationMaterializationEffect(tx, pending, options.publicationObservation)
        .pipe(Effect.mapError(projectMaterializationApplicationFailure))));
    pending = base;
  };
  // Expected later preparation failures are folded only after their genuine
  // successful prefix has performed its stored-row and trigger proofs.
  const prepare = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> => {
    const exit = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(Effect.exit(effect)));
    if (Exit.isFailure(exit)) {
      await flush();
      closeExactAttemptScopeClockObservation(tx);
      return projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(Effect.failCause(exit.cause)));
    }
    return exit.value;
  };
  const hasClockObservation = () => readExactScopeWriteClockObservation(tx, command.authorityPins.scopeId) !== undefined;
  if (rowRevisions.length > 0) await emitTransactionStep(options, command, "rowBatchWriting");
  pending = { ...pending, rows: await prepare(prepareAppRowRevisionApplicationEffect(tx, rowRevisions)
    .pipe(Effect.mapError(cause => cause instanceof AppRowWritePersistenceError
      ? pointCommitSqlCallFailure("writeTentativeRow", cause.cause) : cause))) };
  if (options.afterTransactionStep !== undefined) {
    await flush();
    if (rowRevisions.length > 0) await emitTransactionStep(options, command, "rowBatchWritten");
    for (let ordinal = 0; ordinal < rowRevisions.length; ordinal++)
      await emitTransactionStep(options, command, "tentativeRowWritten");
  }
  const indexActions = [
    ...intrinsicActions.values(),
    ...developerIndexActions.map(action => ({
      kind: action.kind, scopeId: command.authorityPins.scopeId, definition: action.definition,
      encodedKey: action.encodedKey, rowId: action.rowId, writeEpoch, commitSeq, membershipHeadEvidence: action.membershipHeadEvidence,
    })),
  ];
  if (indexActions.length > 0) {
    await emitTransactionStep(options, command, "indexBatchWriting");
    // The ordinary profile may need an actual scope/membership observation.
    // It occurs after row application, while genuine retained evidence can
    // prepare the same operation without introducing another database read.
    if (!hasClockObservation() || !indexActions.some(action => action.membershipHeadEvidence !== undefined)) await flush();
    pending = { ...pending, indexes: await prepare(prepareAppIndexRevisionApplicationEffect(tx, indexActions)
      .pipe(Effect.mapError(cause => cause instanceof AppIndexEntryWritePersistenceError || cause instanceof AppIndexEntryReadPersistenceError
        ? pointCommitSqlCallFailure("writeIndexEntries", cause.cause) : cause))) };
    if (options.afterTransactionStep !== undefined) {
      await flush();
      await emitTransactionStep(options, command, "indexBatchWritten");
      for (let ordinal = 0; ordinal < intrinsicActions.size; ordinal++)
        await emitTransactionStep(options, command, "intrinsicIndexEntryWritten");
      for (let ordinal = 0; ordinal < developerIndexActions.length; ordinal++)
        await emitTransactionStep(options, command, "developerIndexEntryWritten");
    }
  }
  pending = { ...pending, validation: intrinsicBuilds.map(intrinsic => intrinsic.build)
    .filter(build => build.lifecycle === "validating") };
  if (options.afterTransactionStep !== undefined) {
    await flush();
    await writePointCommitUniqueKeyActions(tx, command, writeEpoch, uniqueKeyActions, options, canonicalUniquePairs);
  } else if (canonicalUniquePairs.length > 0) {
    if (!hasClockObservation()) await flush();
    pending = { ...pending, unique: await prepare(prepareAppUniqueCanonicalMutationApplicationEffect(
      tx, command.authorityPins.scopeId, writeEpoch, uniqueCanonicalTransitions(canonicalUniquePairs))
      .pipe(Effect.mapError(mapPointCommitUniqueKeyFailure))) };
  }
  // Page writes share the sequence but retain the existing completion seam:
  // their watermarks advance only once every page has been lowered.
  const prepareCoverage = async () => {
    const selectedIndexBuilds = maintainedBuilds.map(({ build }) => build)
      .filter(build => build.lifecycle === "enabled" && build.maintenance === null);
    if (selectedIndexBuilds.length > APPLICATION_COVERAGE_MAX_ROWS) {
      await flush();
      throw corruption("developerIndexBuildInvalid");
    }
    for (let offset = 0; offset < selectedIndexBuilds.length; offset += 32) {
      const batch = selectedIndexBuilds.slice(offset, offset + 32);
      if (new Set(batch.map(build => build.indexDefinitionId)).size !== batch.length) {
        // A refused later page cannot preempt the actual earlier page writes.
        await flush();
        for (let prefix = 0; prefix < offset; prefix += 32) {
          projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
            applyApplicationCoverage(tx, selectedIndexBuilds.slice(prefix, prefix + 32), [], commitSeq)
              .pipe(Effect.mapError(cause => cause instanceof ApplicationCoveragePersistenceError
                ? pointCommitSqlCallFailure("resetDeveloperIndexValidation", cause.cause) : corruption("developerIndexBuildInvalid")))));
        }
        throw corruption("developerIndexBuildInvalid");
      }
    }
    pending = { ...pending, indexCoverage: selectedIndexBuilds };
    const selectedUnique: Array<Readonly<{ state: (typeof uniqueBuilds)[number];
      schemaVersionId: (typeof uniqueDefinitions)[number]["schemaVersionId"] }>> = [];
    const retainUniqueCoverage = async () => {
      const prepared = await prepare(Effect.fromResult(prepareUnboundUniqueCoverageApplicationResult(selectedUnique))
        .pipe(Effect.mapError(projectUniqueCoverageFailure)));
      pending = { ...pending, uniqueCoverage: prepared.rows };
    };
    for (const build of uniqueBuilds) {
      const definition = uniqueDefinitions.find(member => member.uniqueConstraintDefinitionId === build.uniqueConstraintDefinitionId);
      if (definition === undefined) {
        await retainUniqueCoverage();
        await flush();
        throw corruption("uniqueConstraintDefinitionInvalid");
      }
      selectedUnique.push({ state: build, schemaVersionId: definition.schemaVersionId });
    }
    await retainUniqueCoverage();
  };
  const finishCoverage = async () => {
    await prepareCoverage();
    await flush();
    if (uniqueBuilds.length > 0) await emitTransactionStep(options, command, "uniquePublicationApplied");
  };
  if (!deferCoverage) {
    await prepareCoverage();
    if (options.afterTransactionStep !== undefined) {
      await flush();
      if (uniqueBuilds.length > 0) await emitTransactionStep(options, command, "uniquePublicationApplied");
    }
  }
  if (searchContribution !== undefined) {
    if (Result.isFailure(searchContribution)) await flush();
    const contribution = projectPointCommitTransactionResult(searchContribution);
    const searchStages = prepareLogicalSearchApplications(contribution.definitions, contribution.changes, scopeUuid, commitSeq);
    while (true) {
      const stage = await prepare(Effect.sync(() => searchStages.next()));
      if (stage.done) break;
      const search = await prepare(Effect.fromResult(stage.value));
      pending = { ...pending, search: [...(pending.search ?? []), search] };
    }
  }
  await flush();
  if (deferCoverage) return finishCoverage;
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
      Result.mapError(projectUniqueCoverageFailure),
    ),
  );
}

function projectUniqueCoverageFailure(
  failure: AppUniqueConstraintSetBuildIntegrationV1Error |
    import("../appUniqueConstraintSetBuildV1").AppUniqueConstraintSetBuildStateV1Error,
): PointCommitSqlFailureMarkerV1 | PointCommitCorruptionV1Error {
  return failure instanceof AppUniqueConstraintSetBuildIntegrationV1Error
    ? new PointCommitSqlFailureMarkerV1("maintainUniqueConstraintCoverage", failure.cause)
    : corruption("uniqueConstraintBuildInvalid");
}

export async function preparePointCommitApplicationRelationPlan(
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  priorState: ApplicationDocumentPriorState,
  relations: LocatedPreparedPointCommitApplicationRelations | null,
  lastCommitSeq: bigint,
  options: ApplicationDocumentMaterializationOptions,
): Promise<PreparedPointCommitApplicationRelationPlan | null> {
  const plan = projectPointCommitTransactionResult(prepareRelationTransitionsResult(command, priorState, relations));
  if (plan === null) return null;
  const { prepared } = plan;
  projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(validatePointCommitApplicationRelationTargetsEffect(tx, command, prepared, lastCommitSeq, options)));
  return plan;
}

const decodeRelationTargetDriverRows = Schema.decodeUnknownResult(Schema.Struct({ rows: Schema.Array(Schema.Unknown) }));
const validatePointCommitApplicationRelationTargetsEffect = Effect.fn("ApplicationDocument.validateRelationTargets")(function* (
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  prepared: PreparedApplicationRelationCommit,
  lastCommitSeq: bigint,
  options: ApplicationDocumentMaterializationOptions,
) {
  const checks = prepared.storedTargetChecks;
  if (checks.length === 0) return;
  const scopeUuid = (yield* Effect.fromResult(
    projectScopeIdUuidV1Result(command.authorityPins.scopeId).pipe(
      Result.mapError(() => corruption("relationTargetEvidenceInvalid")),
    ),
  )).scopeUuid;
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
  const result = yield* Effect.uninterruptible(Effect.tryPromise({ try: () => tx.execute(statement),
    catch: cause => new PointCommitSqlFailureMarkerV1("loadRelationTargets", cause) }));
  const { rows } = yield* Effect.fromResult(decodeRelationTargetDriverRows(result).pipe(Result.mapError(() => corruption("relationTargetEvidenceInvalid"))));
  if (rows.length !== checks.length) {
    return yield* Effect.fail(corruption("relationTargetEvidenceInvalid"));
  }
  for (let ordinal = 0; ordinal < checks.length; ordinal += 1) {
    const raw = rows[ordinal];
    const check = checks[ordinal];
    if (
      !isNonArrayRecord(raw) ||
      check === undefined ||
      raw.ordinalText !== String(ordinal)
    ) {
      return yield* Effect.fail(corruption("relationTargetEvidenceInvalid"));
    }
    const pointerCommitSeq = yield* Effect.fromResult(
      parseNullableCommitSeqTextResult(raw.pointerCommitSeqText).pipe(
        Result.mapError(() => corruption("relationTargetEvidenceInvalid")),
      ),
    );
    const revisionCommitSeq = yield* Effect.fromResult(
      parseNullableCommitSeqTextResult(raw.revisionCommitSeqText).pipe(
        Result.mapError(() => corruption("relationTargetEvidenceInvalid")),
      ),
    );
    if (
      pointerCommitSeq === null &&
      revisionCommitSeq === null &&
      raw.isTombstone === null
    ) {
      return yield* Effect.fail(new ApplicationRelationTargetNotLiveError({
        targetDocumentId: check.documentId,
      }));
    }
    if (
      pointerCommitSeq === null ||
      revisionCommitSeq === null ||
      pointerCommitSeq !== revisionCommitSeq ||
      revisionCommitSeq > lastCommitSeq ||
      typeof raw.isTombstone !== "boolean"
    ) {
      return yield* Effect.fail(corruption("relationTargetEvidenceInvalid"));
    }
    if (raw.isTombstone) {
      return yield* Effect.fail(new ApplicationRelationTargetNotLiveError({
        targetDocumentId: check.documentId,
      }));
    }
  }
});

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
  return (await selectPointCommitHeads(tx, clock, command, options)).heads;
}

/** Select fresh continuity in the existing current-head command. Only demanded
 * positive predecessors hash, and an oversized body never reaches hashing. */
export async function lockFinitePointCommitDeveloperIndexBuildsAndHeads(
  tx: AppRowTransaction, clock: ApplicationDocumentMaterializationClock,
  definitions: readonly LocatedAppIndexDefinitionV1[], command: ApplicationDocumentMaterializationCommand,
  originalRows: readonly LiveAppRowRevisionV1[], unique: readonly LocatedAppUniqueConstraintDefinitionV1[],
  relations: LocatedPreparedPointCommitApplicationRelations | null, options: ApplicationDocumentMaterializationOptions,
): Promise<Readonly<{ developerIndexBuilds: readonly LockedPointCommitDeveloperIndexV1[]; freshHeads: FinitePointCommitHeads }>> {
  const schemaName = projectPointCommitTransactionResult(requireAdmittedTargetInstallationSchema(tx).pipe(
    Result.mapError(cause => pointCommitSqlCallFailure("lockDeveloperIndexBuilds", cause))));
  const tables = new Set(definitions.map(definition => definition.access.tableId));
  for (const id of predecessorDocumentTableIds([], unique, relations)) tables.add(id);
  const originals = new Map(originalRows.map(row => [appDocumentIdV1FromRowIdentity(row), row]));
  const lengths = new Map<AppDocumentIdV1, number>();
  for (const intent of command.rowIntents) {
    const original = originals.get(intent.documentId);
    if (tables.has(intent.tableId) && intent.dependency.observed.kind === "present" && original !== undefined)
      lengths.set(intent.documentId, original.document.canonicalBytes.byteLength);
  }
  const rows = await sqlCall("lockDeveloperIndexBuilds", () => tx.select({
    maintenanceObligation: getTableColumns(fxSystemIndexMaintenanceObligations),
    kind: sql<string>`observed.kind`, developerBuild: applicationCompositeSelection(fxSystemIndexBuildStates, "observed.developer_build"),
    ordinalText: sql<string>`observed.ordinal::text`, pointerCommitSeqText: sql<string | null>`observed.pointer_commit_seq_text`,
    latestCommitSeqText: sql<string | null>`observed.latest_commit_seq_text`, latestIsTombstone: sql<boolean | null>`observed.latest_is_tombstone`,
    latestCreationTimeText: sql<string | null>`observed.latest_creation_time_text`,
    originalScopeUuid: sql<string | null>`observed.original_scope_uuid`,
    originalWriteEpochUuid: sql<string | null>`observed.original_write_epoch_uuid`,
    originalPrevCommitSeqText: sql<string | null>`observed.original_prev_commit_seq_text`,
    originalSchemaVersionId: sql<string | null>`observed.original_schema_version_id`,
    originalCodecVersion: sql<number | null>`observed.original_codec_version`,
    originalByteLengthText: sql<string | null>`observed.original_byte_length_text`,
    originalStoredSha256: sql`observed.original_stored_sha256`.mapWith(fxAppRowRevisions.valueSha256),
    originalActualSha256: sql`observed.original_actual_sha256`.mapWith(fxAppRowRevisions.valueSha256),
  }).from(sql`${sql.identifier(schemaName)}.fx_observe_app_developer_heads(
    ${command.authorityPins.scopeId}::text, ${clock.scopeUuid}::uuid,
    array[${sql.join(definitions.map(definition => sql`${definition.indexDefinitionId}::integer`), sql`, `)}]::integer[],
    array[${sql.join(command.dependencies.map(dependency => sql`${dependency.tableId}::integer`), sql`, `)}]::integer[],
    array[${sql.join(command.dependencies.map(dependency => sql`${sql.param(appRowIdHexV1ToBytes(dependency.rowId), fxAppRowRevisions.rowId)}::bytea`), sql`, `)}]::bytea[],
    array[${sql.join(command.dependencies.map(dependency => sql`${lengths.get(dependency.documentId) ?? null}::integer`), sql`, `)}]::integer[]
  ) observed`).leftJoin(fxSystemIndexMaintenanceObligations, indexMaintenanceBindingPredicate(
    sql`(observed.developer_build).${sql.identifier(fxSystemIndexBuildStates.scopeId.name)}`,
    sql`(observed.developer_build).${sql.identifier(fxSystemIndexBuildStates.indexDefinitionId.name)}`,
    sql`(observed.developer_build).${sql.identifier(fxSystemIndexBuildStates.maintenanceActivationSequence.name)}`,
  )));
  if (rows.some(row => row.kind !== "developerBuild" && row.kind !== "head")) throw corruption("developerIndexBuildInvalid");
  const developerIndexBuilds = decodePointCommitDeveloperIndexBuilds(rows.filter(row => row.kind === "developerBuild").map(row => ({ ...row.developerBuild, maintenanceObligation: row.maintenanceObligation })),
    clock, definitions, command);
  const predecessorRows = rows.filter(row => row.kind === "head").map(({ kind: _kind, developerBuild: _build, maintenanceObligation: _maintenance, ...row }) => row);
  options.observeQuery?.(Object.freeze({ name: "loadRowHeads", sql: "fresh heads after developer build locks", params: Object.freeze([]) }));
  const freshHeads = Object.freeze({ heads: projectPointCommitTransactionResult(
    capturePointCommitHeadsResult(predecessorRows, command, clock.record.lastCommitSeq)), predecessorRows });
  return Object.freeze({ developerIndexBuilds, freshHeads });
}


async function selectPointCommitHeads(
  tx: AppRowTransaction,
  clock: ApplicationDocumentMaterializationClock,
  command: Pick<ApplicationDocumentMaterializationCommand, "authorityPins" | "dependencies">,
  options: ApplicationDocumentMaterializationOptions,
  originalLengths?: ReadonlyMap<AppDocumentIdV1, number>,
): Promise<FinitePointCommitHeads> {
  if (command.dependencies.length === 0) return Object.freeze({ heads: Object.freeze([]), predecessorRows: Object.freeze([]) });
  const values = sql.join(
    command.dependencies.map(
      (dependency, ordinal) => sql`
      (
        ${ordinal}::integer,
        ${dependency.tableId}::integer,
        ${appRowIdHexV1ToBytes(dependency.rowId)}::bytea
        ${originalLengths === undefined ? sql`` : sql`, ${originalLengths.get(dependency.documentId) ?? null}::integer`}
      )
    `,
    ),
    sql`, `,
  );
  const statement = sql`
    with requested(ordinal, table_id, row_id${originalLengths === undefined ? sql`` : sql`, original_byte_length`}) as (
      values ${values}
    )
    select
      requested.ordinal::text as "ordinalText",
      current_row.commit_seq::text as "pointerCommitSeqText",
      latest.commit_seq::text as "latestCommitSeqText",
      latest.is_tombstone as "latestIsTombstone",
      latest.creation_time::text as "latestCreationTimeText"
      ${originalLengths === undefined ? sql`` : sql`,
        latest.scope_uuid as "originalScopeUuid",
        latest.write_epoch_uuid as "originalWriteEpochUuid",
        latest.prev_commit_seq::text as "originalPrevCommitSeqText",
        latest.schema_version_id as "originalSchemaVersionId",
        latest.value_codec_version as "originalCodecVersion",
        octet_length(latest.value_bytes)::text as "originalByteLengthText",
        latest.value_sha256 as "originalStoredSha256",
        case when requested.original_byte_length is not null and latest.is_tombstone = false
          and latest.value_codec_version = 1 and octet_length(latest.value_bytes) = requested.original_byte_length
          then pg_catalog.sha256(latest.value_bytes) else null end as "originalActualSha256"`}
    from requested
    left join fx_app_row_current as current_row
      on current_row.scope_uuid = ${clock.scopeUuid}
      and current_row.table_id = requested.table_id
      and current_row.row_id = requested.row_id
    left join lateral (
      select revision.commit_seq, revision.is_tombstone, revision.creation_time
        ${originalLengths === undefined ? sql`` : sql`, revision.scope_uuid, revision.write_epoch_uuid,
          revision.prev_commit_seq, revision.schema_version_id, revision.value_codec_version,
          revision.value_bytes, revision.value_sha256`}
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
  return Object.freeze({ heads: projectPointCommitTransactionResult(
    capturePointCommitHeadsResult(rows, command, clock.record.lastCommitSeq)), predecessorRows: rows });
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
      .select(indexBuildStateSelection())
      .from(fxSystemIndexBuildStates)
      .leftJoin(fxSystemIndexMaintenanceObligations, indexMaintenanceBindingPredicate())
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
      .for("share", { of: fxSystemIndexBuildStates }),
  );
  return decodePointCommitDeveloperIndexBuilds(rows, clock, definitions, command);
}
function decodePointCommitDeveloperIndexBuilds(rows: readonly IndexBuildStateRow[], clock: ApplicationDocumentMaterializationClock, definitions: readonly LocatedAppIndexDefinitionV1[], command: ApplicationDocumentMaterializationCommand): readonly LockedPointCommitDeveloperIndexV1[] {
  if (rows.length !== definitions.length) {
    throw corruption("developerIndexBuildInvalid");
  }
  const rowsByDefinitionId = new Map(rows.map((row) => [row.indexDefinitionId, row]));
  if (rowsByDefinitionId.size !== definitions.length) {
    throw corruption("developerIndexBuildInvalid");
  }
  const locked: LockedPointCommitDeveloperIndexV1[] = [];
  for (const definition of definitions) {
    const row = rowsByDefinitionId.get(definition.indexDefinitionId);
    if (row === undefined) {
      throw corruption("developerIndexBuildInvalid");
    }
    const state = projectPointCommitTransactionResult(
      decodeIndexBuildStateRowResult(
        row,
        command.authorityPins.scopeId,
        definition.indexDefinitionId, row.maintenanceObligation,
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
  const pairs = projectPointCommitTransactionResult(prepareDeveloperIndexKeyPairsResult(command, priorState, builds.map(index => index.definition)));
  const plans = pairs.map(pair => {
    const build = builds.find(index => index.definition === pair.definition)?.build;
    if (build === undefined) throw corruption("developerIndexBuildInvalid");
    return { ...pair, build };
  });
  return acceptPreparedDeveloperIndexKeyPairs(tx, command, plans);

}

const acceptPreparedDeveloperIndexKeyPairsEffect = Effect.fn("ApplicationDocument.acceptDeveloperKeyPairs")(function* (
  tx: AppRowTransaction, command: ApplicationDocumentMaterializationCommand, plans: readonly PointCommitDeveloperIndexRowPlanV1[],
) {
  if (plans.length === 0) return Object.freeze([]);
  const actions = yield* acceptAppIndexKeyTransitionsInTransactionEffect(tx, { scopeId: command.authorityPins.scopeId, pairs: plans,
    maximumActions: MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1 }).pipe(Effect.mapError(cause =>
      cause instanceof AppIndexTransitionLimitExceededError ? new PointCommitDeveloperIndexMaintenanceUnavailableV1Error({
        reason: "entryRevisionLimitExceeded", observed: cause.observed, maximum: cause.maximum })
        : cause instanceof AppIndexEntryReadPersistenceError ? new PointCommitSqlFailureMarkerV1("loadDeveloperIndexEntryHeads", cause.cause)
          : corruption("developerIndexTransitionInvalid")));
  return Object.freeze(actions.toSorted(compareDeveloperIndexEntryActions));
});
export async function acceptPreparedDeveloperIndexKeyPairs(tx: AppRowTransaction, command: ApplicationDocumentMaterializationCommand,
  plans: readonly PointCommitDeveloperIndexRowPlanV1[]): Promise<readonly PointCommitDeveloperIndexEntryActionV1[]> {
  return projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(acceptPreparedDeveloperIndexKeyPairsEffect(tx, command, plans)));
}

export const acceptPreparedApplicationDeveloperTransitionsEffect = Effect.fn("ApplicationDocument.acceptPreparedDeveloperTransitions")(function* (
  tx: AppRowTransaction, prepared: PreparedApplicationDocumentSettlement, builds: readonly LockedPointCommitDeveloperIndexV1[],
) {
  if (Exit.isFailure(prepared.developer)) return yield* Effect.failCause(prepared.developer.cause);
  const plans: PointCommitDeveloperIndexRowPlanV1[] = [];
  for (const pair of prepared.developer.value) {
    const build = builds.find(index => index.definition === pair.definition)?.build;
    if (build === undefined) return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
    plans.push({ ...pair, build });
  }
  return yield* acceptPreparedDeveloperIndexKeyPairsEffect(tx, prepared.command, plans);
});

function uniqueCanonicalTransitions(plans: readonly PointCommitUniqueKeyPlanV1[]) {
  return plans.map(plan => ({ constraintId: plan.definition.uniqueConstraintDefinitionId, tableId: plan.definition.tableId,
    rowId: plan.rowId, localeKey: plan.previousCanonical?.localeKey ?? plan.nextCanonical?.localeKey ?? "",
    previous: plan.previousCanonical, next: plan.nextCanonical, rowPrevCommitSeq: plan.rowPrevCommitSeq }));
}
function preparedUniqueKeyActions(plans: readonly PointCommitUniqueKeyPlanV1[]): readonly PointCommitUniqueKeyActionV1[] {
  const actions: PointCommitUniqueKeyActionV1[] = [];
  for (const plan of plans) {
    const previous = plan.previousCanonical?.kind === "claim" ? plan.previousCanonical : null;
    const next = plan.nextCanonical?.kind === "claim" ? plan.nextCanonical : null;
    if (previous !== null && next !== null && previous.encodedKey === next.encodedKey) continue;
    if (previous !== null) actions.push(uniqueKeyAction("release", plan, previous.encodedKey));
    if (next !== null) actions.push(uniqueKeyAction("claim", plan, next.encodedKey));
  }
  return Object.freeze(actions.toSorted(comparePointCommitUniqueKeyActions));
}
export const acceptPreparedUniqueKeyPairsEffect = Effect.fn("ApplicationDocument.acceptUniqueKeyPairs")(function* (
  tx: AppRowTransaction, command: ApplicationDocumentMaterializationCommand, plans: readonly PointCommitUniqueKeyPlanV1[], writeEpoch: ScopeEpoch,
) {
  yield* acceptAppUniqueOriginalOwnersInTransactionEffect(tx, command.authorityPins.scopeId, writeEpoch, uniqueCanonicalTransitions(plans))
    .pipe(Effect.mapError(mapPointCommitUniqueKeyFailure));
  const actions = preparedUniqueKeyActions(plans);
  if (actions.length > MAX_POINT_COMMIT_UNIQUE_KEY_ACTIONS_V1) return yield* Effect.fail(new PointCommitUniqueConstraintMaintenanceUnavailableV1Error({
    reason: "mutationLimitExceeded", observed: actions.length, maximum: MAX_POINT_COMMIT_UNIQUE_KEY_ACTIONS_V1 }));
  return actions;
});
export async function preparePointCommitUniqueKeyActions(
  tx: AppRowTransaction, command: ApplicationDocumentMaterializationCommand, priorState: ApplicationDocumentPriorState,
  definitions: readonly LocatedAppUniqueConstraintDefinitionV1[], writeEpoch: ScopeEpoch,
): Promise<Readonly<{ actions: readonly PointCommitUniqueKeyActionV1[]; pairs: readonly PointCommitUniqueKeyPlanV1[] }>> {
  const plans = projectPointCommitTransactionResult(prepareUniqueKeyPairsResult(command, priorState, definitions));
  const actions = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(acceptPreparedUniqueKeyPairsEffect(tx, command, plans, writeEpoch)));
  return Object.freeze({ actions, pairs: plans });
}
export const acceptPreparedApplicationUniqueOwnersEffect = Effect.fn("ApplicationDocument.acceptPreparedUniqueOwners")(function* (
  tx: AppRowTransaction, prepared: PreparedApplicationDocumentSettlement, writeEpoch: ScopeEpoch,
) {
  if (prepared.unique === undefined) return yield* Effect.die(new Error("Unique planning was not reached"));
  if (Exit.isFailure(prepared.unique)) return yield* Effect.failCause(prepared.unique.cause);
  return yield* acceptPreparedUniqueKeyPairsEffect(tx, prepared.command, prepared.unique.value, writeEpoch);
});

export const acceptPreparedApplicationRelationsEffect = Effect.fn("ApplicationDocument.acceptPreparedRelations")(function* (
  tx: AppRowTransaction, prepared: PreparedApplicationDocumentSettlement, lastCommitSeq: bigint, options: ApplicationDocumentMaterializationOptions,
) {
  if (prepared.relation === undefined) return yield* Effect.die(new Error("Relation planning was not reached"));
  if (Exit.isFailure(prepared.relation)) return yield* Effect.failCause(prepared.relation.cause);
  const relation = prepared.relation.value;
  if (relation !== null) {
    yield* validatePointCommitApplicationRelationTargetsEffect(tx, prepared.command, relation.prepared, lastCommitSeq, options);
  }
  return relation;
});

function uniqueKeyAction(
  phase: PointCommitUniqueKeyActionV1["phase"],
  plan: PointCommitUniqueKeyPlanV1,
  sortKey: OrderedIndexKeyHexV1,
): PointCommitUniqueKeyActionV1 {
  return Object.freeze({
    phase,
    definition: plan.definition,
    rowId: plan.rowId,
    sortKey,
  });
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

function predecessorDocumentTableIds(
  developer: readonly LockedPointCommitDeveloperIndexV1[],
  unique: readonly LocatedAppUniqueConstraintDefinitionV1[],
  relations: LocatedPreparedPointCommitApplicationRelations | null,
): ReadonlySet<CatalogTableId> {
  return new Set([
    ...developer.map(index => index.definition.access.tableId),
    ...unique.map(definition => definition.tableId),
    ...(relations?.definitions.definitions.map(definition => definition.binding.sourceTableId) ?? []),
  ]);
}

function priorDocumentHeadsResult(command: ApplicationDocumentMaterializationCommand,
  heads: readonly LoadedPointCommitHeadV1[]): Result.Result<ReadonlyMap<AppDocumentIdV1, LoadedPointCommitHeadV1>, PointCommitCorruptionV1Error> {
  const byId = new Map<AppDocumentIdV1, LoadedPointCommitHeadV1>();
  if (heads.length !== command.dependencies.length) return Result.fail(corruption("priorDocumentInvalid"));
  for (const [index, dependency] of command.dependencies.entries()) {
    const loaded = heads[index];
    if (loaded === undefined || byId.has(dependency.documentId)) return Result.fail(corruption("priorDocumentInvalid"));
    byId.set(dependency.documentId, loaded);
  }
  return Result.succeed(byId);
}

const decodeFinitePredecessorResult = Schema.decodeUnknownResult(Schema.Struct({
  ordinalText: Schema.String,
  originalScopeUuid: Schema.String,
  originalWriteEpochUuid: Schema.String,
  originalPrevCommitSeqText: Schema.NullOr(Schema.String),
  originalSchemaVersionId: Schema.String,
  originalCodecVersion: Schema.Literal(1),
  originalByteLengthText: Schema.String,
  originalStoredSha256: Schema.Uint8Array.check(Schema.makeFilter(value => value.byteLength === 32)),
  originalActualSha256: Schema.Uint8Array.check(Schema.makeFilter(value => value.byteLength === 32)),
}));

/** Called only at the existing predecessor-verification point after ordinary
 * OCC and liveness verdicts. No finite fallback can reload missing originals. */
export const acceptPreparedApplicationOriginalsEffect = Effect.fn("ApplicationDocument.acceptPreparedOriginals")(function* (
  command: ApplicationDocumentMaterializationCommand,
  fresh: FinitePointCommitHeads,
  prepared: PreparedApplicationDocumentSettlement,
  developer: readonly LockedPointCommitDeveloperIndexV1[],
  unique: readonly LocatedAppUniqueConstraintDefinitionV1[],
  relations: LocatedPreparedPointCommitApplicationRelations | null,
): Effect.fn.Return<void, PointCommitCorruptionV1Error> {
  if (prepared.command !== command) return yield* Effect.fail(corruption("priorDocumentInvalid"));
  if (Exit.isFailure(prepared.originals)) return yield* Effect.failCause(prepared.originals.cause);
  const originalRows = prepared.originalRows;
  const headsByDocumentId = yield* Effect.fromResult(priorDocumentHeadsResult(command, fresh.heads));
  const intentsByDocumentId = new Map(command.rowIntents.map(intent => [intent.documentId, intent]));
  const ordinalsByDocumentId = new Map(command.dependencies.map((dependency, ordinal) => [dependency.documentId, ordinal]));
  const originals = new Map<AppDocumentIdV1, LiveAppRowRevisionV1>();
  for (const original of originalRows) {
    const id = appDocumentIdV1FromRowIdentity(original);
    const intent = intentsByDocumentId.get(id);
    if (original.scopeId !== command.authorityPins.scopeId || original.commitSeq > command.authorityPins.snapshotToken.commitSeq ||
      (intent !== undefined && (intent.dependency.observed.kind !== "present" || intent.dependency.observed.revisionCommitSeq !== original.commitSeq)) || originals.has(id))
      return yield* Effect.fail(corruption("priorDocumentInvalid"));
    originals.set(id, original);
  }
  const tables = predecessorDocumentTableIds(developer, unique, relations);
  if (fresh.predecessorRows.length !== command.dependencies.length) return yield* Effect.fail(corruption("priorDocumentInvalid"));
  for (const intent of command.rowIntents) {
    const loaded = headsByDocumentId.get(intent.documentId);
    if (loaded === undefined) return yield* Effect.fail(corruption("priorDocumentInvalid"));
    if (intent.dependency.observed.kind === "present" && !originals.has(intent.documentId))
      return yield* Effect.fail(corruption("priorDocumentInvalid"));
    if (!tables.has(intent.tableId) || loaded.head.kind !== "live") continue;
    const original = originals.get(intent.documentId);
    if (original === undefined || loaded.head.revisionCommitSeq !== original.commitSeq || loaded.creationTime !== original.creationTime)
      return yield* Effect.fail(corruption("priorDocumentInvalid"));
    const ordinal = ordinalsByDocumentId.get(intent.documentId);
    if (ordinal === undefined) return yield* Effect.fail(corruption("priorDocumentInvalid"));
    const raw = yield* Effect.fromResult(decodeFinitePredecessorResult(fresh.predecessorRows[ordinal])
      .pipe(Result.mapError(() => corruption("priorDocumentInvalid"))));
    if (raw.ordinalText !== String(ordinal) || raw.originalScopeUuid !== original.scopeUuid ||
      raw.originalWriteEpochUuid !== original.writeEpochUuid || raw.originalSchemaVersionId !== original.schemaVersionId ||
      raw.originalPrevCommitSeqText !== (original.prevCommitSeq === null ? null : String(original.prevCommitSeq)) ||
      raw.originalCodecVersion !== original.document.codecVersion || raw.originalByteLengthText !== String(original.document.canonicalBytes.byteLength) ||
      !bytesEqual(raw.originalStoredSha256, original.document.sha256) || !bytesEqual(raw.originalActualSha256, original.document.sha256))
      return yield* Effect.fail(corruption("priorDocumentInvalid"));
  }
});
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
  const headsByDocumentId = yield* Effect.fromResult(priorDocumentHeadsResult(command, loadedHeads));
  const tableIds = predecessorDocumentTableIds(developer, unique, relations);
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

function compareDeveloperIndexEntryActions(
  left: Omit<PointCommitDeveloperIndexEntryActionV1, "membershipHeadEvidence">,
  right: Omit<PointCommitDeveloperIndexEntryActionV1, "membershipHeadEvidence">,
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
  canonicalPairs: readonly PointCommitUniqueKeyPlanV1[],
): Promise<void> {
  if (canonicalPairs.length === 0) return;
  if (actions.length > 0) await emitTransactionStep(options, command, "uniqueKeyBatchWriting");
  for (const phase of ["release", "claim"] as const) {
    const selected = actions.filter(action => action.phase === phase);
    const phasePairs = uniqueCanonicalTransitions(canonicalPairs)
      .filter(pair => phase === "claim" || (pair.previous?.kind === "claim" &&
        (pair.next?.kind !== "claim" || pair.previous.encodedKey !== pair.next.encodedKey)))
      .map(pair => phase === "release" ? { ...pair, next: null }
        : pair.previous?.kind === "claim" && pair.next?.kind === "claim" && pair.previous.encodedKey === pair.next.encodedKey
          ? pair : { ...pair, previous: null });
    const application = prepareAppUniqueCanonicalMutationApplicationEffect(tx, command.authorityPins.scopeId, writeEpoch, phasePairs)
        .pipe(Effect.flatMap(prepared => applyPreparedAppUniqueMutationApplicationEffect(tx, prepared, options.publicationObservation)));
    const settled = await runPointCommitInTransactionEffect(observePointCommitPublicationEffect(
      options.publicationObservation, "uniqueWrites", application));
    projectPointCommitTransactionResult(settled.pipe(Result.mapError(mapPointCommitUniqueKeyFailure)));
    for (let ordinal = 0; ordinal < selected.length; ordinal++) await emitTransactionStep(options, command, "uniqueKeyWritten");
  }
  if (actions.length > 0) await emitTransactionStep(options, command, "uniqueKeyBatchWritten");
}

function mapPointCommitUniqueKeyFailure(
  failure: Effect.Error<
    ReturnType<typeof prepareAppUniqueCanonicalMutationApplicationEffect> | ReturnType<typeof applyPreparedAppUniqueMutationApplicationEffect>
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

function developerIndexValidationInvalid(): PointCommitCorruptionV1Error {
  return corruption("developerIndexBuildInvalid");
}

export async function resetPointCommitDeveloperIndexValidations(
  tx: AppRowTransaction, builds: readonly IndexBuildStateRecord[],
  publicationObservation?: PointCommitPublicationObservation,
): Promise<void> {
  const selected = builds.filter(build => build.lifecycle === "validating");
  if (selected.length === 0) return;
  const operation = "resetDeveloperIndexValidation";
  const effect = Effect.gen(function* () {
    const schemaName = yield* Effect.fromResult(requireAdmittedTargetInstallationSchema(tx)
      .pipe(Result.mapError(cause => pointCommitSqlCallFailure(operation, cause))));
    const statement = sql`select reason, rows from ${sql.identifier(schemaName)}.fx_reset_app_index_validation(
      ${applicationIndexCoverageArray(selected, schemaName)})`;
    const result = yield* Effect.uninterruptible(Effect.tryPromise({
      try: () => tx.execute(statement),
      catch: cause => {
        const detail = applicationDomainFailureDetail(cause, "fx_reset_app_index_validation");
        if (detail === null) return pointCommitSqlCallFailure(operation, cause);
        return Result.match(decodeIndexValidationRefusal(detail), {
          onFailure: () => pointCommitSqlCallFailure(operation, cause),
          onSuccess: refusal => Number.isSafeInteger(refusal.ordinal) && refusal.ordinal >= 0 && refusal.ordinal < selected.length
            ? developerIndexValidationInvalid() : pointCommitSqlCallFailure(operation, cause),
        });
      },
    }));
    const rows = rowsFromDriverExecuteResult(result, () => { throw developerIndexValidationInvalid(); });
    if (rows.length !== 1) return yield* Effect.fail(developerIndexValidationInvalid());
    const proof = yield* Effect.fromResult(decodeIndexValidationSuccess(rows[0]).pipe(Result.mapError(developerIndexValidationInvalid)));
    if (proof.rows !== selected.length) return yield* Effect.fail(developerIndexValidationInvalid());
    if (publicationObservation?.detail) for (let offset = 0; offset < selected.length; offset += 32)
      publicationObservation.record({ kind: "batch", owner: "indexValidation", counts: { rows: Math.min(32, selected.length - offset) } });
  });
  projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(effect));
}

export async function lockPointCommitIntrinsicIndexBuilds(
  tx: AppRowTransaction,
  clock: ApplicationDocumentMaterializationClock,
  definitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  command: ApplicationDocumentMaterializationCommand,
): Promise<ReadonlyArray<LockedPointCommitIntrinsicIndexV1>> {
  const locked: LockedPointCommitIntrinsicIndexV1[] = [];
  if (definitions.length === 0) return Object.freeze(locked);
  if (new Set(definitions.map(definition => definition.indexDefinitionId)).size !== definitions.length)
    throw corruption("intrinsicIndexBuildInvalid");
  for (let offset = 0; offset < definitions.length; offset += 32) {
    const batch = definitions.slice(offset, offset + 32);
    // PostgreSQL locks after this explicit input-ordinal sort. It retains the
    // former definition order rather than introducing a new build-ID order.
    const order = sql<number>`case ${fxSystemIndexBuildStates.indexDefinitionId} ${sql.join(batch.map((definition, ordinal) =>
      sql`when ${definition.indexDefinitionId} then ${ordinal}`), sql` `)} end`;
    const rows = await sqlCall("lockIntrinsicIndexBuild", () => tx.select(indexBuildStateSelection()).from(fxSystemIndexBuildStates)
      .leftJoin(fxSystemIndexMaintenanceObligations, indexMaintenanceBindingPredicate())
      .where(and(eq(fxSystemIndexBuildStates.scopeId, command.authorityPins.scopeId),
        inArray(fxSystemIndexBuildStates.indexDefinitionId, batch.map(definition => definition.indexDefinitionId))))
      .orderBy(order).for("share", { of: fxSystemIndexBuildStates }));
    for (const definition of batch) {
      const row = rows.find(member => member.indexDefinitionId === definition.indexDefinitionId);

    if (row === undefined) throw corruption("intrinsicIndexBuildInvalid");
    const state = projectPointCommitTransactionResult(
      decodeIndexBuildStateRowResult(
        row,
        command.authorityPins.scopeId,
        definition.indexDefinitionId, row.maintenanceObligation,
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
  prepared?: PreparedApplicationDocumentSettlement["intrinsic"],
) {
  if (prepared !== undefined && Exit.isFailure(prepared)) return yield* Effect.failCause(prepared.cause);
  const preparedKeys = prepared === undefined || Exit.isFailure(prepared) ? undefined
    : new Map(prepared.value.map(key => [`${key.definition.indexDefinitionId}/${key.rowId}`, key]));
  const positions: (AppIndexEntryPositionV1 & {
    readonly encodedKey: OrderedIndexKeyHexV1;
    readonly row: AppendPreparedAppRowRevisionV1Input;
    readonly build: IndexBuildStateRecord;
  })[] = [];
  const buildsByTable = new Map<CatalogTableId, LockedPointCommitIntrinsicIndexV1>();
  for (const intrinsic of builds) {
    const { definition, build } = intrinsic;
    if (definition.access.kind !== "by_creation_time" || build.indexDefinitionId !== definition.indexDefinitionId ||
      build.scopeId !== scopeId || buildsByTable.has(definition.access.tableId))
      return yield* Effect.fail(corruption("intrinsicIndexBuildInvalid"));
    buildsByTable.set(definition.access.tableId, intrinsic);
  }
  for (const row of rows) {
    const intrinsic = buildsByTable.get(row.tableId);
    if (intrinsic === undefined) continue;
    const { definition, build } = intrinsic;
    if (
      definition.access.kind !== "by_creation_time" ||
      build.indexDefinitionId !== definition.indexDefinitionId ||
      build.scopeId !== row.scopeId
    ) {
      return yield* Effect.fail(corruption("intrinsicIndexBuildInvalid"));
    }
    const rowId = yield* Effect.fromResult(
      orderedIndexRowIdHexV1FromBytesResult(
        appRowIdHexV1ToBytes(row.rowId),
      ).pipe(
        Result.mapError(() => corruption("intrinsicIndexTransitionInvalid")),
      ),
    );
    const frozen = preparedKeys?.get(`${definition.indexDefinitionId}/${rowId}`);
    if (preparedKeys !== undefined && (frozen === undefined || frozen.definition !== definition ||
      frozen.creationTime !== row.creationTime))
      return yield* Effect.fail(corruption("intrinsicIndexTransitionInvalid"));
    const encodedKey = frozen?.encodedKey ?? encodeAppOrderedIndexKeyV1({
      spec: definition.physicalSpec, values: [orderedIndexCreationTimeV1(row.creationTime)],
    });
    positions.push({ row, build, definition, encodedKey, rowId });
  }
  const actions = new Map<AppendPreparedAppRowRevisionV1Input, AppendAppIndexEntryRevisionV1Input>();
  if (positions.length === 0) return actions;
  const selected = yield* acceptAppIndexKeyTransitionsInTransactionEffect(tx, { scopeId, maximumActions: rows.length,
    pairs: positions.map(position => ({ definition: position.definition, build: position.build, rowId: position.rowId,
      priorCommitSeq: position.row.prevCommitSeq, priorKey: position.row.kind === "tombstone" || position.row.prevCommitSeq !== null ? position.encodedKey : null,
      finalKey: position.row.kind === "live" ? position.encodedKey : null })) }).pipe(Effect.mapError(failure =>
        failure instanceof AppIndexEntryReadPersistenceError ? new PointCommitSqlFailureMarkerV1("loadIntrinsicIndexEntryHeads", failure.cause)
          : failure instanceof AppIndexTransitionAcceptanceError ? corruption(failure.reason === "buildInvalid" ? "intrinsicIndexBuildInvalid" : "intrinsicIndexTransitionInvalid")
            : failure));
  const rowsByPosition = new Map(positions.map(position => [`${position.definition.indexDefinitionId}/${position.rowId}`, position.row]));
  for (const action of selected) {
    const row = rowsByPosition.get(`${action.definition.indexDefinitionId}/${action.rowId}`);
    if (row === undefined) return yield* Effect.fail(corruption("intrinsicIndexTransitionInvalid"));
    actions.set(row, { ...action, scopeId: row.scopeId, writeEpoch: row.writeEpoch, commitSeq: row.commitSeq });
  }
  return actions;
});


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
      schemaVersionId: command.sourceSchemaVersionByTable?.get(intent.tableId) ?? command.authorityPins.schemaVersionId,
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
    schemaVersionId: command.sourceSchemaVersionByTable?.get(intent.tableId) ?? command.authorityPins.schemaVersionId,
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
