import { Data } from "effect";
import type { ScopeUuidV1, CommitSeq } from "flarex-protocol/storage-authority";

export type CommittedPointOutcomeInputFailureReasonV1 =
  | "recordInvalid"
  | "scopeUuidInvalid"
  | "requestKeyInvalid"
  | "identityAccessPolicySha256Invalid"
  | "functionPathInvalid"
  | "requestSha256Invalid";

export type CommittedPointOutcomeMismatchV1 =
  | "resultEncoding"
  | "identityAccessPolicySha256"
  | "functionPath"
  | "requestSha256";

export type CommittedPointOutcomeCorruptionReasonV1 =
  | "duplicateOutcome"
  | "outcomeRowInvalid"
  | "scopeClockMissing"
  | "scopeClockInvalid"
  | "commitTokenInvalid"
  | "commitTokenAheadOfClock"
  | "missingRetainedHeader"
  | "retainedHeaderInvalid"
  | "retainedHeaderEpochMismatch"
  | "resultStateInvalid"
  | "availableResultEvidenceInvalid"
  | "expiredResultEvidenceInvalid"
  | "resultCanonicalEvidenceInvalid"
  | "resultSemanticSizeMismatch";

export class CommittedPointOutcomeInputErrorV1 extends Data.TaggedError(
  "CommittedPointOutcomeInputErrorV1",
)<{
  readonly reason: CommittedPointOutcomeInputFailureReasonV1;
}> {}

export class CommittedPointOutcomeRequestKeyReuseErrorV1 extends Data.TaggedError(
  "CommittedPointOutcomeRequestKeyReuseErrorV1"
)<{
  readonly scopeUuid: ScopeUuidV1;
  readonly mismatches: ReadonlyArray<CommittedPointOutcomeMismatchV1>;
}> {}

export class CommittedPointOutcomeCorruptionErrorV1 extends Data.TaggedError(
  "CommittedPointOutcomeCorruptionErrorV1",
)<{
  readonly scopeUuid: ScopeUuidV1;
  readonly reason: CommittedPointOutcomeCorruptionReasonV1;
  readonly commitSeq?: CommitSeq;
}> {}

export class CommittedPointOutcomeSqlErrorV1 extends Data.TaggedError(
  "CommittedPointOutcomeSqlErrorV1",
)<{
  readonly operation: "resolve";
  readonly cause: unknown;
}> {}

export type ResolveCommittedPointOutcomeErrorV1 =
  | CommittedPointOutcomeInputErrorV1
  | CommittedPointOutcomeRequestKeyReuseErrorV1
  | CommittedPointOutcomeCorruptionErrorV1
  | CommittedPointOutcomeSqlErrorV1;
