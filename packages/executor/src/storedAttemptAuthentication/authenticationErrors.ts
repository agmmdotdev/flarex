import { Data } from "effect";

import type { CommitProtocolV1Error } from
  "flarex-protocol/commit-protocol";
import type { TransactionSessionLifecycleV1 } from
  "flarex-protocol/transaction-session";

import type { StoredAttemptStorageCorruptionReasonV1 } from
  "../storedAttemptAuthentication";

export class InvalidStoredAttemptAuthorityV1Error extends Data.TaggedError(
  "InvalidStoredAttemptAuthorityV1Error",
)<{
  readonly reason:
    | "notProcessLocal"
    | "invalidLoadedAttempt"
    | "invalidExecutionClaim";
}> {}

export class StoredAttemptAlreadyCommittedV1Error extends Data.TaggedError(
  "StoredAttemptAlreadyCommittedV1Error",
)<{
  readonly updatedAtMilliseconds: number;
}> {}

export class StoredAttemptNotPlannableV1Error extends Data.TaggedError(
  "StoredAttemptNotPlannableV1Error",
)<{
  readonly reason: "lifecycle" | "rootNotSealed" | "expired";
  readonly lifecycle?: TransactionSessionLifecycleV1;
  readonly rootState?:
    | "open"
    | "sealed"
    | "failed"
    | "relation_conflicted";
}> {}

export class StoredAttemptAuthorityMismatchV1Error extends Data.TaggedError(
  "StoredAttemptAuthorityMismatchV1Error",
)<{
  readonly reason:
    | "placementChanged"
    | "scopeChanged"
    | "attemptMissing"
    | "attemptReplaced"
    | "generationChanged"
    | "epochChanged"
    | "snapshotChanged"
    | "schemaChanged"
    | "revocationEpochChanged"
    | "executionClaimChanged";
}> {}

export class StoredAttemptEnvelopeMismatchV1Error extends Data.TaggedError(
  "StoredAttemptEnvelopeMismatchV1Error",
)<{
  readonly reason:
    | "attempt"
    | "protocol"
    | "sequence"
    | "journalDigest"
    | "successfulResult";
}> {}

export class StoredAttemptStorageCorruptionV1Error extends Data.TaggedError(
  "StoredAttemptStorageCorruptionV1Error",
)<{
  readonly reason: StoredAttemptStorageCorruptionReasonV1;
  readonly cause?: unknown;
}> {}

export class StoredAttemptPersistenceV1Error extends Data.TaggedError(
  "StoredAttemptPersistenceV1Error",
)<{
  readonly cause: unknown;
}> {}

export type StoredAttemptAuthenticationV1Error =
  | CommitProtocolV1Error
  | InvalidStoredAttemptAuthorityV1Error
  | StoredAttemptAlreadyCommittedV1Error
  | StoredAttemptNotPlannableV1Error
  | StoredAttemptAuthorityMismatchV1Error
  | StoredAttemptEnvelopeMismatchV1Error
  | StoredAttemptStorageCorruptionV1Error
  | StoredAttemptPersistenceV1Error;
