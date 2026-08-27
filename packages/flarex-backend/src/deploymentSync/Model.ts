import { Data } from "effect";

import type { ScopeSyncCursorV1 } from
  "flarex-protocol/internal/scope-sync-v1";
import type {
  CommitSeq,
  ScopeEpochUuidV1,
  ScopeUuidV1,
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
