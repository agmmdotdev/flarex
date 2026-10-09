import { Data, type Effect } from "effect";
import type {
  SessionJournalRelationConflictV1,
  SessionJournalStorePersistence,
  SessionJournalAttemptUnavailableV1Error,
} from "@flarex/persistence-postgres/internal/session-journal";


export class InvalidPointMutationJournalCapabilityV1Error
  extends Data.TaggedError("InvalidPointMutationJournalCapabilityV1Error")<{
    readonly capability:
      | "attempt"
      | "table"
      | "index"
      | "relation"
      | "relationConflict";
  }> {}


export class PointMutationJournalRelationConflictError extends Data.TaggedError(
  "PointMutationJournalRelationConflictError",
)<{
  readonly conflict: SessionJournalRelationConflictV1;
}> {}


export class UnsupportedPointMutationJournalOperationV1Error
  extends Data.TaggedError(
    "UnsupportedPointMutationJournalOperationV1Error",
  )<{
    readonly reason:
      | "notPlainObject"
      | "invalidKind"
      | "unexpectedFields"
      | "invalidFieldShape"
      | "invalidSequence";
    readonly operationKind?: unknown;
    readonly cause?: unknown;
  }> {}


export class PointMutationJournalPersistenceV1Error extends Data.TaggedError(
  "PointMutationJournalPersistenceV1Error",
)<{
  readonly cause: unknown;
}> {}


export class PointMutationJournalAdmittedOperationRejectedV1Error extends Data.TaggedError(
  "PointMutationJournalAdmittedOperationRejectedV1Error",
)<{ readonly result: Exclude<Awaited<Effect.Success<ReturnType<
  SessionJournalStorePersistence["runAdmittedOperationEffect"]>>>, { readonly kind: "completed" }> }> {}


/** A selected framework method failed after the journal had admitted it.
 * The store owns the sticky root state; this error keeps the native cause
 * distinct from a database persistence or transport failure. */
export class PointMutationJournalParticipantRejectedV1Error extends Data.TaggedError(
  "PointMutationJournalParticipantRejectedV1Error",
)<{ readonly cause: unknown }> {}


export class PointMutationJournalParticipantSetV1Error extends Data.TaggedError(
  "PointMutationJournalParticipantSetV1Error",
)<{ readonly reason: "tooMany" | "duplicate" | "invalidSelector"; readonly participant?: string }> {}


export class PointMutationJournalParticipantSelectionV1Error extends Data.TaggedError(
  "PointMutationJournalParticipantSelectionV1Error",
)<{ readonly participant: string }> {}


export class PointMutationJournalAttemptPinsV1Error extends Data.TaggedError(
  "PointMutationJournalAttemptPinsV1Error",
)<{
  readonly reason: "immutablePinsMismatch";
}> {}


export class PointMutationJournalAttemptUnavailableV1Error
  extends Data.TaggedError("PointMutationJournalAttemptUnavailableV1Error")<{
    readonly issue: SessionJournalAttemptUnavailableV1Error["issue"];
  }> {}
