import { Data } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";

export type ScopeExecutionAuthorityReason =
  | "targetPlacementMismatch"
  | "scopeMismatch"
  | "unsupportedStorageGeneration"
  | "storageGenerationChanged"
  | "storageGenerationFenceChanged"
  | "scopeEpochChanged";

/**
 * Fail-closed authority rejection emitted before a scoped operation can touch
 * application data. The resolver remains the owner of metadata and target
 * discovery; this error owns the final in-transaction clock comparison.
 */
export class ScopeExecutionAuthorityError extends Data.TaggedError(
  "ScopeExecutionAuthorityError",
)<{
  readonly scopeId: ScopeId;
  readonly reason: ScopeExecutionAuthorityReason;
}> {}

/** Internal defect: a transaction capability was forged or used after close. */
export class ScopedTransactionCapabilityError extends Error {
  readonly _tag = "ScopedTransactionCapabilityError" as const;
  readonly name = "ScopedTransactionCapabilityError";

  constructor(readonly reason: "invalid" | "closed") {
    super(`Scoped transaction capability is ${reason}.`);
  }
}
