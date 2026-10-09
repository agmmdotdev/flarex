import { Data } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { TransactionExecutionClaimCorruptionReasonV1 } from "./transactionExecutionClaimPersistence";

export class TransactionExecutionClaimCorruptionV1Error extends Data.TaggedError(
  "TransactionExecutionClaimCorruptionV1Error"
)<{
  readonly scopeId: ScopeId;
  readonly reason: TransactionExecutionClaimCorruptionReasonV1;
  readonly cause?: unknown;
}> {}

export class TransactionExecutionClaimStaleV1Error extends Data.TaggedError(
  "TransactionExecutionClaimStaleV1Error"
)<{
  readonly scopeId: ScopeId;
  readonly reason:  | "claimOwnerMismatch" | "claimFenceMismatch" | "claimExpired";
}> {}
