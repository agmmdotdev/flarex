import {
  CommittedPointOutcomeCorruptionErrorV1,
  CommittedPointOutcomeRequestKeyReuseErrorV1,
} from "./committedPointOutcome";

import { isNonArrayRecord } from "@flarex/utils/records";

import { Data } from "effect";

import {
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  type CatalogIndexDefinitionId,
  type CatalogEdgeDefinitionId,
  type CatalogTableId,
} from "flarex-protocol/catalog";

import {
  type OrderedIndexKeyBytesHexV1,
  type OrderedIndexRowIdHexV1,
} from "flarex-protocol/ordered-index";

import {
  type CommitSeq,
  type ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";

import { type LocateAppDeveloperIndexDefinitionsV1Error } from "./appDeveloperIndexCommitV1";

import { type ReadAppUniqueConstraintDefinitionV1Error } from "./appUniqueConstraintDefinitions";

import {
  AppUniqueKeyConflictError,
  AppUniqueKeyHashError,
  CanonicalAppUniqueKeyHashCollisionError,
} from "./appUniqueKeys";

import {
  isAppendAppIndexEntryRevisionV1Error,
  type AppendAppIndexEntryRevisionV1Error,
} from "./appIndexEntries";
import type { ReadAppIndexDefinitionError } from "./appIndexDefinitions";
import { isAppendAppRowRevisionV1Error } from "./appRows";

import {
  ApplicationRelationCommitCorruptionError,
  ApplicationRelationCommitResourceExhaustionError,
  ApplicationRelationCommitUnavailableError,
  ApplicationRelationConstraintError,
  ApplicationRelationTargetDeleteRestrictedError,
  ApplicationRelationTargetNotLiveError,
} from "./applicationRelationCommit";

import { ReadApplicationRelationBindingError } from "./applicationRelationBinding";
import { AppSchemaCandidateWriteGuardError } from "./appSchemaCandidateValidation";

import {
  ScopeClockCorruptionError,
  ScopeClockNotFoundError,
} from "./scopeClock";

import { LocatedReadCommittedTransactionFailureV1 } from "./transactionSessionAttemptKernel";

export type PointCommitConflictCauseV1 =
  | Readonly<{
      readonly kind: "appRowPoint";
      readonly documentId: AppDocumentIdV1;
    }>
  | Readonly<{
      readonly kind: "appIndexRange";
      readonly reason: "overlap" | "validationWindowExceeded";
      readonly dependencyOrdinal: number;
      readonly tableId: CatalogTableId;
      readonly indexDefinitionId: CatalogIndexDefinitionId;
      readonly encodedKey?: OrderedIndexKeyBytesHexV1;
      readonly rowId?: OrderedIndexRowIdHexV1;
    }>
  | Readonly<{
      readonly kind: "appRelationIncoming";
      readonly edgeDefinitionId: CatalogEdgeDefinitionId;
      readonly targetRowId: AppRowIdHexV1;
    }>;

export interface PointCommitConflictEvidenceV1 {
  readonly conflict: PointCommitConflictCauseV1;
  readonly snapshotCommitSeq: CommitSeq;
  readonly currentCommitSeq: CommitSeq;
}

export class PointCommitConflictV1Error extends Data.TaggedError(
  "PointCommitConflictV1Error",
)<PointCommitConflictEvidenceV1> {}

export type PointCommitStaleAuthorityReasonV1 =
  | "placementChanged"
  | "scopeChanged"
  | "generationChanged"
  | "epochChanged"
  | "revocationEpochChanged"
  | "activeSchemaChanged"
  | "activeRelationSelectionChanged"
  | "attemptMissing"
  | "attemptReplaced"
  | "lifecycleChanged"
  | "snapshotChanged"
  | "leaseMissing"
  | "leaseReplaced"
  | "expired";

export class PointCommitStaleAuthorityV1Error extends Data.TaggedError(
  "PointCommitStaleAuthorityV1Error",
)<{
  readonly reason: PointCommitStaleAuthorityReasonV1;
}> {}

export type PointCommitCorruptionReasonV1 =
  | "commandInvalid"
  | "finishingTransitionInvalid"
  | "readCommittedCapabilityMissing"
  | "scopeClockInvalid"
  | "activeApplicationHeadInvalid"
  | "applicationWritePolicyDenied"
  | "applicationWritePolicyEvidenceInvalid"
  | "sessionDuplicate"
  | "sessionInvalid"
  | "leaseDuplicate"
  | "leaseInvalid"
  | "journalRootMissingOrDuplicate"
  | "journalRootInvalid"
  | "dependencySetInvalid"
  | "rowHeadInvalid"
  | "occEvidenceInvalid"
  | "rowTransitionInvalid"
  | "rowWriteInvalid"
  | "intrinsicIndexBuildInvalid"
  | "intrinsicIndexTransitionInvalid"
  | "developerIndexBuildInvalid"
  | "developerIndexTransitionInvalid"
  | "uniqueConstraintDefinitionInvalid"
  | "uniqueConstraintBuildInvalid"
  | "uniqueKeyTransitionInvalid"
  | "relationBindingInvalid"
  | "relationTransitionInvalid"
  | "relationTargetEvidenceInvalid"
  | "relationEdgeInvalid"
  | "candidateSchemaValidationInvalid"
  | "successfulResultInvalid"
  | "committedOutcomeMissing"
  | "publishedOutcomeInvalid"
  | "publicationInvariantInvalid"
  | "rollbackSentinelMissing";

export class PointCommitCorruptionV1Error extends Data.TaggedError(
  "PointCommitCorruptionV1Error",
)<{
  readonly reason: PointCommitCorruptionReasonV1;
}> {}

export class PointCommitResourceExhaustionV1Error extends Data.TaggedError(
  "PointCommitResourceExhaustionV1Error",
)<{
  readonly dimension: "commitSequence";
  readonly maximum: bigint;
}> {}

export class PointCommitIntrinsicIndexDefinitionUnavailableV1Error extends Data.TaggedError(
  "PointCommitIntrinsicIndexDefinitionUnavailableV1Error",
)<{
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly tableId: CatalogTableId;
}> {}

export class PointCommitDeveloperIndexMaintenanceUnavailableV1Error extends Data.TaggedError(
  "PointCommitDeveloperIndexMaintenanceUnavailableV1Error",
)<{
  readonly reason:
    | "definitionSetUnavailable"
    | "entryRevisionLimitExceeded"
    | "entryKeyLimitExceeded";
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export class PointCommitUniqueConstraintMaintenanceUnavailableV1Error extends Data.TaggedError(
  "PointCommitUniqueConstraintMaintenanceUnavailableV1Error",
)<{
  readonly reason:
    | "definitionPortInvalid"
    | "definitionSetUnavailable"
    | "mutationLimitExceeded"
    | "keyInvalid";
  readonly observed?: number;
  readonly maximum?: number;
  readonly cause?: unknown;
}> {}

export type PointCommitSqlOperationV1 =
  | "resolveAuthority"
  | "beginOrRollback"
  | "lockScopeClock"
  | "validateActiveApplicationSchema"
  | "validateActiveRelationSelection"
  | "lockSession"
  | "lockLease"
  | "lockJournalRoot"
  | "lockExecutionClaim"
  | "readDatabaseTime"
  | "enterFinishing"
  | "deleteExecutionClaim"
  | "loadRowHeads"
  | "validateIndexRanges"
  | "validateRelationDependencies"
  | "lockIntrinsicIndexBuild"
  | "lockDeveloperIndexBuilds"
  | "loadDeveloperIndexDocuments"
  | "loadUniqueKeyDocuments"
  | "loadRelationDocuments"
  | "loadRelationTargets"
  | "loadDeveloperIndexEntryHeads"
  | "loadUniqueKeyOwners"
  | "resetIntrinsicIndexValidation"
  | "resetDeveloperIndexValidation"
  | "maintainUniqueConstraintCoverage"
  | "validateCandidateSchema"
  | "writeTentativeRow"
  | "writeIntrinsicIndexEntry"
  | "writeDeveloperIndexEntry"
  | "writeUniqueKey"
  | "writeRelationEdges"
  | "validateRelationRestrict"
  | "recheckOutcome"
  | "writeCommitHeader"
  | "writeCommitChange"
  | "writeCommitRelationAdjacencyChange"
  | "writeOutcome"
  | "writeWake"
  | "deleteJournal"
  | "deleteLease"
  | "commitSession"
  | "advanceScopeClock";

export class PointCommitSqlErrorV1 extends Data.TaggedError(
  "PointCommitSqlErrorV1",
)<{
  readonly operation: PointCommitSqlOperationV1;
  readonly sqlState?: string;
  readonly cause: unknown;
}> {}

export type PointCommitRollbackProofV1Error =
  | PointCommitConflictV1Error
  | PointCommitStaleAuthorityV1Error
  | PointCommitCorruptionV1Error
  | PointCommitResourceExhaustionV1Error
  | PointCommitSqlErrorV1
  | PointCommitIntrinsicIndexDefinitionUnavailableV1Error
  | PointCommitDeveloperIndexMaintenanceUnavailableV1Error
  | PointCommitUniqueConstraintMaintenanceUnavailableV1Error
  | AppSchemaCandidateWriteGuardError
  | ApplicationRelationCommitUnavailableError
  | ApplicationRelationConstraintError
  | ApplicationRelationCommitResourceExhaustionError
  | ApplicationRelationTargetNotLiveError
  | ApplicationRelationTargetDeleteRestrictedError
  | ReadApplicationRelationBindingError
  | LocateAppDeveloperIndexDefinitionsV1Error
  | ReadAppUniqueConstraintDefinitionV1Error
  | ReadAppIndexDefinitionError
  | AppendAppIndexEntryRevisionV1Error
  | AppUniqueKeyConflictError
  | AppUniqueKeyHashError
  | CanonicalAppUniqueKeyHashCollisionError;

export class PointCommitSqlFailureMarkerV1 {
  constructor(
    readonly operation: PointCommitSqlOperationV1,
    readonly cause: unknown,
  ) {}
}

export function mapTransactionFailure(
  cause: unknown,
): PointCommitRollbackProofV1Error {
  if (
    cause instanceof PointCommitConflictV1Error ||
    cause instanceof PointCommitStaleAuthorityV1Error ||
    cause instanceof PointCommitCorruptionV1Error ||
    cause instanceof PointCommitResourceExhaustionV1Error ||
    cause instanceof PointCommitSqlErrorV1 ||
    cause instanceof PointCommitIntrinsicIndexDefinitionUnavailableV1Error ||
    cause instanceof PointCommitDeveloperIndexMaintenanceUnavailableV1Error ||
    cause instanceof PointCommitUniqueConstraintMaintenanceUnavailableV1Error ||
    cause instanceof ApplicationRelationCommitUnavailableError ||
    cause instanceof ApplicationRelationConstraintError ||
    cause instanceof ApplicationRelationCommitResourceExhaustionError ||
    cause instanceof ApplicationRelationTargetNotLiveError ||
    cause instanceof ApplicationRelationTargetDeleteRestrictedError ||
    cause instanceof AppSchemaCandidateWriteGuardError ||
    cause instanceof AppUniqueKeyConflictError ||
    cause instanceof AppUniqueKeyHashError ||
    cause instanceof CanonicalAppUniqueKeyHashCollisionError ||
    isAppendAppIndexEntryRevisionV1Error(cause)
  ) {
    return cause;
  }
  if (cause instanceof ApplicationRelationCommitCorruptionError) {
    return corruption("relationTransitionInvalid");
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    if (
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause !== cause
    ) {
      return mapTransactionFailure(cause.issue.callbackCause);
    }
    return sqlError("beginOrRollback", cause);
  }
  if (cause instanceof PointCommitSqlFailureMarkerV1) {
    return sqlError(cause.operation, cause.cause);
  }
  if (isAppendAppRowRevisionV1Error(cause)) {
    return corruption("rowWriteInvalid");
  }
  if (
    cause instanceof ScopeClockCorruptionError ||
    cause instanceof ScopeClockNotFoundError
  ) {
    return corruption("scopeClockInvalid");
  }
  const sqlState = findSqlState(cause);
  if (sqlState !== undefined) {
    return sqlError("beginOrRollback", cause);
  }
  throw cause;
}

export function sqlError(
  operation: PointCommitSqlOperationV1,
  cause: unknown,
): PointCommitSqlErrorV1 {
  const sqlState = findSqlState(cause);
  return new PointCommitSqlErrorV1({
    operation,
    cause,
    ...(sqlState === undefined ? {} : { sqlState }),
  });
}

export function findSqlState(cause: unknown, depth = 0): string | undefined {
  if (depth > 4 || !isNonArrayRecord(cause)) return undefined;
  const code = cause.code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
    return code;
  }
  const nested = cause.cause;
  return nested === cause ? undefined : findSqlState(nested, depth + 1);
}

export function corruption(
  reason: PointCommitCorruptionReasonV1,
): PointCommitCorruptionV1Error {
  return new PointCommitCorruptionV1Error({ reason });
}

export async function sqlCall<Value>(
  operation: PointCommitSqlOperationV1,
  call: () => PromiseLike<Value>,
): Promise<Value> {
  try {
    return await call();
  } catch (cause) {
    throw pointCommitSqlCallFailure(operation, cause);
  }
}

export function pointCommitSqlCallFailure(
  operation: PointCommitSqlOperationV1,
  cause: unknown,
) {
  if (
    cause instanceof PointCommitConflictV1Error ||
    cause instanceof PointCommitStaleAuthorityV1Error ||
    cause instanceof PointCommitCorruptionV1Error ||
    cause instanceof PointCommitResourceExhaustionV1Error ||
    isAppendAppIndexEntryRevisionV1Error(cause) ||
    cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1 ||
    cause instanceof CommittedPointOutcomeCorruptionErrorV1
  ) {
    return cause;
  }

  return new PointCommitSqlFailureMarkerV1(operation, cause);
}
