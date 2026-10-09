import { Data, Schema } from "effect";
import { ApplicationSchemaWritePolicyBindingSchema } from "flarex-protocol/internal/application-schema-binding";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";

export const MAX_WRITE_OWNERSHIP_CLAIMS = 64;
export const MAX_WRITE_OWNERSHIP_HISTORY_RECORDS = 64;
export const MAX_WRITE_OWNERSHIP_HISTORY_BYTES = 1_048_576;

/** Recoverable syscall denial; it does not consume a journal sequence or poison the attempt. */
export class ApplicationTableWriteDeniedError extends Data.TaggedError("ApplicationTableWriteDeniedError")<{
  readonly operation: "insert" | "patch" | "replace" | "delete";
  readonly tableName: string;
  readonly message: "Ordinary Application mutations cannot write this managed table.";
}> {}

export class ApplicationWriteOwnershipError extends Data.TaggedError("ApplicationWriteOwnershipError")<{
  readonly reason: "invalidEvidence" | "historyLimit" | "ownershipChanged" | "previouslyWritable" | "authorityChanged" | "writeDenied" | "resourceFailure";
  readonly cause?: unknown;
}> {}

const identity = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256),
  Schema.makeFilter(value => value.trim().length > 0 && !value.includes("\0") ? undefined : "Invalid identity"));
const positiveSequence = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,18}$/));
const digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
export const ApplicationManagedTableClaimSchema = Schema.Struct({
  policy: ApplicationSchemaWritePolicyBindingSchema.check(Schema.makeFilter(policy =>
    policy.owner === "payload" ? undefined : "A retained managed claim must be Payload-owned")),
  establishingRevisionId: identity,
  establishingActivationSequence: positiveSequence,
});
export type ApplicationManagedTableClaim = typeof ApplicationManagedTableClaimSchema.Type;

export const ApplicationWriteOwnershipFrameSchema = Schema.Struct({
  format: Schema.Literal("flarex.application-write-ownership"),
  version: Schema.Literal(1),
  scopeId: ScopeIdSchema,
  storageGeneration: Schema.Literal("flarexdb_v1"),
  activationSequence: positiveSequence,
  revisionId: identity,
  writePolicySetSha256: digest,
  predecessor: Schema.NullOr(Schema.Struct({ activationSequence: positiveSequence, claimsSha256: digest })),
  claims: Schema.Array(ApplicationManagedTableClaimSchema).check(Schema.isMaxLength(MAX_WRITE_OWNERSHIP_CLAIMS)),
}).check(Schema.makeFilter(frame => {
  const sequence = BigInt(frame.activationSequence);
  if (sequence > 9_223_372_036_854_775_807n) return "Activation sequence exceeds storage range";
  if (frame.predecessor !== null && BigInt(frame.predecessor.activationSequence) >= sequence) return "Invalid predecessor";
  let previousTableId = 0;
  for (const claim of frame.claims) {
    if (claim.policy.tableId <= previousTableId || BigInt(claim.establishingActivationSequence) > sequence) return "Invalid claim identity or order";
    previousTableId = claim.policy.tableId;
  }
  return undefined;
}));
export type ApplicationWriteOwnershipFrame = typeof ApplicationWriteOwnershipFrameSchema.Type;

export interface CanonicalApplicationWriteOwnership {
  readonly frame: ApplicationWriteOwnershipFrame;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
  readonly sha256Hex: string;
}
