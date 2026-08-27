import { Data } from "effect";

import type {
  ScopeSyncActiveQueryGenerationV1,
  ScopeSyncActiveHeadObservationV1,
  ScopeSyncCanonicalQueryIdentityV1,
  ScopeSyncCursorV1,
  ScopeSyncDependencyKeySetV1Error,
  ScopeSyncDependencyKeyV1,
  ScopeSyncQueryGenerationSequenceV1,
  ScopeSyncQueryResultSha256HexV1,
} from "flarex-protocol/internal/scope-sync-v1";
import type {
  ApplicationActivationSequenceV1,
  ApplicationActiveHeadSha256HexV1,
} from "flarex-protocol/commit-protocol";
import type {
  CommitSeq,
  ScopeEpochUuidV1,
  ScopeUuidV1,
  SnapshotToken,
  StorageGeneration,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";

export type ScopeSyncCursorPolicyOperation =
  | "classifyWake"
  | "advanceCommit";

export class ScopeSyncScopeMismatchError extends Data.TaggedError(
  "ScopeSyncScopeMismatchError",
)<{
  readonly operation: ScopeSyncCursorPolicyOperation;
  readonly expectedScopeUuid: ScopeUuidV1;
  readonly observedScopeUuid: ScopeUuidV1;
}> {}

export class ScopeSyncEpochMismatchError extends Data.TaggedError(
  "ScopeSyncEpochMismatchError",
)<{
  readonly operation: "advanceCommit";
  readonly expectedEpochUuid: ScopeEpochUuidV1;
  readonly observedEpochUuid: ScopeEpochUuidV1;
}> {}

export class ScopeSyncCommitGapError extends Data.TaggedError(
  "ScopeSyncCommitGapError",
)<{
  readonly operation: "advanceCommit";
  readonly nextRequiredCommitSeq: CommitSeq;
  readonly observedCommitSeq: CommitSeq;
}> {}

export class ScopeSyncInvalidCommitChangeError extends Data.TaggedError(
  "ScopeSyncInvalidCommitChangeError",
)<{
  readonly operation: "collectInvalidationKeys";
  readonly changeKind: "appRow";
  readonly changeOrdinal: number;
  readonly cause: unknown;
}> {}

export type ScopeSyncAdvanceCommitError =
  | ScopeSyncScopeMismatchError
  | ScopeSyncEpochMismatchError
  | ScopeSyncCommitGapError;

export type ScopeSyncAdvanceCommitDecision =
  | Readonly<{
      readonly kind: "duplicate";
      readonly cursor: ScopeSyncCursorV1;
      readonly observedCommitSeq: CommitSeq;
    }>
  | Readonly<{
      readonly kind: "exactNext";
      readonly nextCursor: ScopeSyncCursorV1;
    }>;

export type ScopeSyncWakeDecision =
  | Readonly<{
      readonly kind: "duplicate";
      readonly appliedThroughCommitSeq: CommitSeq;
      readonly observedCommitSeq: CommitSeq;
    }>
  | Readonly<{
      readonly kind: "exactNext";
      readonly expectedCommitSeq: CommitSeq;
    }>
  | Readonly<{
      readonly kind: "gap";
      readonly nextRequiredCommitSeq: CommitSeq;
      readonly observedCommitSeq: CommitSeq;
    }>
  | Readonly<{
      readonly kind: "epochCheckRequired";
      readonly expectedEpochUuid: ScopeEpochUuidV1;
      readonly observedEpochUuid: ScopeEpochUuidV1;
    }>;

export type ScopeSyncEpochAuthorityDecision =
  | Readonly<{
      readonly kind: "oldEpochDuplicate";
      readonly cursorEpochUuid: ScopeEpochUuidV1;
      readonly observedWakeEpochUuid: ScopeEpochUuidV1;
    }>
  | Readonly<{
      readonly kind: "resetRequired";
      readonly cursorEpochUuid: ScopeEpochUuidV1;
      readonly authoritativeEpochUuid: ScopeEpochUuidV1;
    }>;

export type ScopeSyncQueryGenerationEvidenceField =
  | "registrationScopeUuid"
  | "registrationEpochUuid"
  | "snapshotScopeId"
  | "snapshotEpoch"
  | "snapshotCommitSeq"
  | "refreshScopeUuid"
  | "refreshEpochUuid"
  | "refreshCommitSeq"
  | "receiptActivationSequence"
  | "receiptActiveHeadSha256Hex"
  | "receiptStorageGeneration"
  | "receiptStorageGenerationFence"
  | "currentHeadScopeUuid"
  | "currentHeadEpochUuid"
  | "currentHeadCommitSeq";

export class ScopeSyncQueryGenerationMismatchError extends Data.TaggedError(
  "ScopeSyncQueryGenerationMismatchError",
)<{
  readonly expectedGeneration: ScopeSyncQueryGenerationSequenceV1;
  readonly observedGeneration: ScopeSyncQueryGenerationSequenceV1;
}> {}

export class ScopeSyncQueryGenerationEvidenceError extends Data.TaggedError(
  "ScopeSyncQueryGenerationEvidenceError",
)<{
  readonly operation: "beginQueryGeneration" | "activateQueryGeneration";
  readonly field: ScopeSyncQueryGenerationEvidenceField;
  readonly expected: string;
  readonly observed: string;
}> {}

export interface ScopeSyncQueryActiveHeadWitnessV1 {
  readonly activationSequence: ApplicationActivationSequenceV1;
  readonly activeHeadSha256Hex: ApplicationActiveHeadSha256HexV1;
}

export interface ScopeSyncQueryActivationEvidenceV1 {
  readonly expectedGeneration: ScopeSyncQueryGenerationSequenceV1;
  readonly snapshotToken: SnapshotToken;
  readonly receiptActiveHead: ScopeSyncQueryActiveHeadWitnessV1;
  readonly receiptStorageGeneration: StorageGeneration;
  readonly receiptStorageGenerationFence: StorageGenerationFence;
  readonly currentActiveHead: ScopeSyncActiveHeadObservationV1;
  readonly refreshedThroughCursor: ScopeSyncCursorV1;
  readonly dirtyThroughCommitSeq: CommitSeq | null;
  readonly dependencies: ReadonlyArray<ScopeSyncDependencyKeyV1>;
  readonly resultSha256Hex: ScopeSyncQueryResultSha256HexV1;
}

export type ScopeSyncBeginQueryGenerationError =
  ScopeSyncQueryGenerationEvidenceError;

export type ScopeSyncActivateQueryGenerationError =
  | ScopeSyncQueryGenerationMismatchError
  | ScopeSyncQueryGenerationEvidenceError
  | ScopeSyncDependencyKeySetV1Error;

export type ScopeSyncQueryActivationDecision =
  | Readonly<{
      readonly kind: "activated";
      readonly activeGeneration: ScopeSyncActiveQueryGenerationV1;
    }>
  | Readonly<{
      readonly kind: "rerunRequired";
      readonly identity: ScopeSyncCanonicalQueryIdentityV1;
      readonly generation: ScopeSyncQueryGenerationSequenceV1;
      readonly snapshotCommitSeq: CommitSeq;
      readonly dirtyThroughCommitSeq: CommitSeq;
    }>
  | Readonly<{
      readonly kind: "resnapshotRequired";
      readonly identity: ScopeSyncCanonicalQueryIdentityV1;
      readonly generation: ScopeSyncQueryGenerationSequenceV1;
      readonly expectedActiveHead: ScopeSyncQueryActiveHeadWitnessV1;
      readonly currentActiveHead: ScopeSyncQueryActiveHeadWitnessV1;
    }>;

export interface ScopeSyncBeginQueryGenerationV1Input {
  readonly identity: ScopeSyncCanonicalQueryIdentityV1;
  readonly generation: ScopeSyncQueryGenerationSequenceV1;
  readonly registeredAtCursor: ScopeSyncCursorV1;
}
