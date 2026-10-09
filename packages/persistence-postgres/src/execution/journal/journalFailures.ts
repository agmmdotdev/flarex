import {
  InvalidSessionJournalCapabilityV1Error,
  InvalidSessionJournalInputV1Error,
  SessionJournalTargetUnavailableV1Error,
  SessionJournalAttemptUnavailableV1Error,
  SessionJournalPersistenceV1Error,
  SessionJournalDeveloperIndexUnavailableV1Error,
  SessionJournalStorageCorruptionV1Error,
  SessionJournalIdentityGenerationV1Error,
  SessionJournalLeasePromotionV1Error,
  SessionJournalSealV1Error,
} from "./errors";
import type {
  SessionJournalRunPointOperationV1Error,
  SessionJournalRunIndexedQueryV1Error,
  SessionJournalRunApplicationRelationReadError,
  SessionJournalPrepareSealV1Error,
  SessionJournalCompleteSealV1Error,
  SessionJournalStorageCorruptionReasonV1,
} from "./errors";
import type { SessionJournalAttemptStateV1 } from "./state";
import { ExactDecimalError } from "flarex-protocol/internal/exact-decimal";
import { Effect } from "effect";
import { ApplicationTableWriteDeniedError } from "../../application/ownership/Model";
import { OrderedIndexKeyTooLargeError } from "flarex-protocol/ordered-index";
import {
  ApplicationRelationReadOverlayError,
  ApplicationRelationReadUnavailableError,
} from "../../application/relations/applicationRelationRead";
import {
  PinnedDeveloperIndexNotFoundV1Error,
  PinnedDeveloperIndexPersistenceV1Error,
  PinnedPointTablePersistenceV1Error,
} from "../../storage/documents/pinnedPointTableErrors";
import type {
  PinnedDeveloperIndexCorruptionV1Error,
  PinnedPointTableCorruptionV1Error,
  PinnedPointTableNotFoundV1Error,
} from "../../storage/documents/pinnedPointTableErrors";
import {
  LogicalParticipantAdmissionError,
  LogicalParticipantInvocationError,
} from "../../storage/documents/logicalDocuments/participantErrors";
import { ExactRunningAttemptTransactionV1Error } from "../transactionSessionAttemptKernel";
import type { ExactRunningAttemptKernelContextV1 } from "../transactionSessionAttemptKernel";
import {
  PointMutationSessionAuthorityCorruptionV1Error,
  PointMutationSessionAttemptLoadV1Error,
} from "../transactionSessionActivation";

export function mapAdmittedKernelFailure(
  cause: unknown,
):
  | InvalidSessionJournalCapabilityV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalAttemptUnavailableV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error
  | LogicalParticipantAdmissionError
  | LogicalParticipantInvocationError {
  if (cause instanceof ExactRunningAttemptTransactionV1Error) {
    return mapExactAdmissionFailure("runAdmittedOperation", cause);
  }
  if (
    cause instanceof InvalidSessionJournalCapabilityV1Error ||
    cause instanceof SessionJournalAttemptUnavailableV1Error ||
    cause instanceof SessionJournalPersistenceV1Error ||
    cause instanceof SessionJournalStorageCorruptionV1Error ||
    cause instanceof SessionJournalTargetUnavailableV1Error ||
    cause instanceof LogicalParticipantAdmissionError ||
    cause instanceof LogicalParticipantInvocationError
  )
    return cause;
  return new SessionJournalPersistenceV1Error({
    operation: "runAdmittedOperation",
    cause,
  });
}

export function mapPointTableResolutionFailure(
  cause:
    | PinnedPointTableCorruptionV1Error
    | PinnedPointTableNotFoundV1Error
    | PinnedPointTablePersistenceV1Error,
):
  | PinnedPointTableCorruptionV1Error
  | PinnedPointTableNotFoundV1Error
  | SessionJournalPersistenceV1Error {
  return cause instanceof PinnedPointTablePersistenceV1Error
    ? new SessionJournalPersistenceV1Error({
        operation: "resolvePinnedPointTable",
        cause: cause.cause,
      })
    : cause;
}

export function mapDeveloperIndexResolutionFailure(
  cause:
    | PinnedDeveloperIndexCorruptionV1Error
    | PinnedDeveloperIndexNotFoundV1Error
    | PinnedDeveloperIndexPersistenceV1Error,
):
  | SessionJournalDeveloperIndexUnavailableV1Error
  | SessionJournalPersistenceV1Error {
  if (cause instanceof PinnedDeveloperIndexPersistenceV1Error) {
    return new SessionJournalPersistenceV1Error({
      operation: "resolveDeveloperIndex",
      cause: cause.cause,
    });
  }
  return new SessionJournalDeveloperIndexUnavailableV1Error({
    reason:
      cause instanceof PinnedDeveloperIndexNotFoundV1Error
        ? "definitionNotFound"
        : "definitionMismatch",
  });
}

export function mapPrepareSealSnapshotFailure(
  cause: unknown,
): SessionJournalPrepareSealV1Error {
  if (
    cause instanceof SessionJournalPersistenceV1Error ||
    cause instanceof SessionJournalSealV1Error ||
    cause instanceof SessionJournalStorageCorruptionV1Error ||
    cause instanceof SessionJournalTargetUnavailableV1Error
  ) {
    return cause;
  }
  return new SessionJournalPersistenceV1Error({
    operation: "prepareSealSnapshot",
    cause,
  });
}

export function mapCompleteSealTransactionFailure(
  cause: unknown,
): SessionJournalCompleteSealV1Error {
  if (cause instanceof PointMutationSessionAuthorityCorruptionV1Error) {
    return mapSessionAuthorityCorruption(cause);
  }
  if (cause instanceof PointMutationSessionAttemptLoadV1Error) {
    return new SessionJournalAttemptUnavailableV1Error({
      issue: cause.issue,
    });
  }
  if (
    cause instanceof InvalidSessionJournalCapabilityV1Error ||
    cause instanceof SessionJournalAttemptUnavailableV1Error ||
    cause instanceof SessionJournalLeasePromotionV1Error ||
    cause instanceof SessionJournalPersistenceV1Error ||
    cause instanceof SessionJournalSealV1Error ||
    cause instanceof SessionJournalStorageCorruptionV1Error ||
    cause instanceof SessionJournalTargetUnavailableV1Error
  ) {
    return cause;
  }
  return new SessionJournalPersistenceV1Error({
    operation: "completeSealTransaction",
    cause,
  });
}

export function mapExactRunningAttemptCompleteSealFailure(
  failure: ExactRunningAttemptTransactionV1Error,
): SessionJournalCompleteSealV1Error {
  if (failure.callbackCause === undefined) {
    return mapCompleteSealTransactionFailure(failure.cause);
  }
  return new SessionJournalPersistenceV1Error({
    operation: "completeSealTransaction",
    cause: failure,
  });
}

export function mapExactAdmissionFailure(
  operation:
    | "openAttempt"
    | "resolvePinnedPointTable"
    | "resolveApplicationRelation"
    | "prepareSealSnapshot"
    | "runAdmittedOperation",
  cause: ExactRunningAttemptTransactionV1Error,
):
  | SessionJournalAttemptUnavailableV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalPersistenceV1Error {
  if (
    cause.callbackCause === undefined &&
    cause.cause instanceof PointMutationSessionAttemptLoadV1Error
  ) {
    return new SessionJournalAttemptUnavailableV1Error({
      issue: cause.cause.issue,
    });
  }
  if (
    cause.callbackCause === undefined &&
    cause.cause instanceof PointMutationSessionAuthorityCorruptionV1Error
  ) {
    return mapSessionAuthorityCorruption(cause.cause);
  }
  return new SessionJournalPersistenceV1Error({ operation, cause });
}

export function mapRunPointOperationFailure(
  cause: unknown,
): SessionJournalRunPointOperationV1Error {
  if (cause instanceof PointMutationSessionAuthorityCorruptionV1Error) {
    return mapSessionAuthorityCorruption(cause);
  }
  if (cause instanceof PointMutationSessionAttemptLoadV1Error) {
    return new SessionJournalAttemptUnavailableV1Error({
      issue: cause.issue,
    });
  }
  if (
    cause instanceof ApplicationTableWriteDeniedError ||
    cause instanceof InvalidSessionJournalCapabilityV1Error ||
    cause instanceof InvalidSessionJournalInputV1Error ||
    cause instanceof SessionJournalAttemptUnavailableV1Error ||
    cause instanceof SessionJournalIdentityGenerationV1Error ||
    cause instanceof SessionJournalPersistenceV1Error ||
    cause instanceof SessionJournalStorageCorruptionV1Error ||
    cause instanceof SessionJournalTargetUnavailableV1Error
  ) {
    return cause;
  }
  return new SessionJournalPersistenceV1Error({
    operation: "runPointOperation",
    cause,
  });
}

function mapSessionAuthorityCorruption(
  cause: PointMutationSessionAuthorityCorruptionV1Error,
): SessionJournalStorageCorruptionV1Error {
  const reason =
    cause.issue === "executionClaimInvalid" ||
    cause.issue === "snapshotLeaseInvalid"
      ? cause.issue
      : "sessionRecordInvalid";
  return new SessionJournalStorageCorruptionV1Error({
    scopeId: cause.scopeId,
    reason,
    cause,
  });
}

export function fromPointOperationPromise<A>(
  run: () => PromiseLike<A>,
): Effect.Effect<A, SessionJournalRunPointOperationV1Error> {
  return Effect.tryPromise({
    try: run,
    catch: mapRunPointOperationFailure,
  });
}

export function mapExactRunningAttemptTransactionFailure(
  failure: ExactRunningAttemptTransactionV1Error,
): SessionJournalRunPointOperationV1Error {
  if (failure.callbackCause === undefined) {
    return mapRunPointOperationFailure(failure.cause);
  }
  return new SessionJournalPersistenceV1Error({
    operation: "runPointOperation",
    cause: failure,
  });
}

export function mapRunIndexedQueryFailure(
  cause: unknown,
): SessionJournalRunIndexedQueryV1Error {
  if (cause instanceof PointMutationSessionAuthorityCorruptionV1Error) {
    return mapSessionAuthorityCorruption(cause);
  }
  if (cause instanceof PointMutationSessionAttemptLoadV1Error) {
    return new SessionJournalAttemptUnavailableV1Error({ issue: cause.issue });
  }
  if (
    cause instanceof InvalidSessionJournalCapabilityV1Error ||
    cause instanceof InvalidSessionJournalInputV1Error ||
    cause instanceof SessionJournalAttemptUnavailableV1Error ||
    cause instanceof SessionJournalDeveloperIndexUnavailableV1Error ||
    cause instanceof SessionJournalPersistenceV1Error ||
    cause instanceof SessionJournalStorageCorruptionV1Error ||
    cause instanceof SessionJournalTargetUnavailableV1Error ||
    cause instanceof OrderedIndexKeyTooLargeError ||
    cause instanceof ExactDecimalError
  )
    return cause;
  return new SessionJournalPersistenceV1Error({
    operation: "runIndexedQuery",
    cause,
  });
}

export function fromIndexedQueryPromise<A>(
  run: () => PromiseLike<A>,
): Effect.Effect<A, SessionJournalRunIndexedQueryV1Error> {
  return Effect.uninterruptible(
    Effect.tryPromise({
      try: run,
      catch: mapRunIndexedQueryFailure,
    }),
  );
}

export function mapExactRunningIndexedQueryFailure(
  failure: ExactRunningAttemptTransactionV1Error,
): SessionJournalRunIndexedQueryV1Error {
  if (failure.callbackCause === undefined) {
    return mapRunIndexedQueryFailure(failure.cause);
  }
  return new SessionJournalPersistenceV1Error({
    operation: "runIndexedQuery",
    cause: failure,
  });
}

export function mapRunApplicationRelationFailure(
  cause: unknown,
): SessionJournalRunApplicationRelationReadError {
  if (cause instanceof PointMutationSessionAuthorityCorruptionV1Error) {
    return mapSessionAuthorityCorruption(cause);
  }
  if (cause instanceof PointMutationSessionAttemptLoadV1Error) {
    return new SessionJournalAttemptUnavailableV1Error({ issue: cause.issue });
  }
  if (
    cause instanceof InvalidSessionJournalCapabilityV1Error ||
    cause instanceof InvalidSessionJournalInputV1Error ||
    cause instanceof SessionJournalAttemptUnavailableV1Error ||
    cause instanceof SessionJournalPersistenceV1Error ||
    cause instanceof SessionJournalStorageCorruptionV1Error ||
    cause instanceof SessionJournalTargetUnavailableV1Error ||
    cause instanceof ApplicationRelationReadUnavailableError ||
    cause instanceof ApplicationRelationReadOverlayError
  )
    return cause;
  return new SessionJournalPersistenceV1Error({
    operation: "runApplicationRelationRead",
    cause,
  });
}

export function fromApplicationRelationPromise<A>(
  run: () => PromiseLike<A>,
): Effect.Effect<A, SessionJournalRunApplicationRelationReadError> {
  return Effect.uninterruptible(
    Effect.tryPromise({
      try: run,
      catch: mapRunApplicationRelationFailure,
    }),
  );
}

export function mapExactRunningApplicationRelationFailure(
  failure: ExactRunningAttemptTransactionV1Error,
): SessionJournalRunApplicationRelationReadError {
  if (failure.callbackCause === undefined) {
    return mapRunApplicationRelationFailure(failure.cause);
  }
  return new SessionJournalPersistenceV1Error({
    operation: "runApplicationRelationRead",
    cause: failure,
  });
}

export function kernelContextMatchesAttempt(
  context: Pick<ExactRunningAttemptKernelContextV1, "anchor" | "executionPin">,
  attempt: SessionJournalAttemptStateV1,
): boolean {
  const anchor = context.anchor;
  return (
    anchor.deploymentId === attempt.selector.deploymentId &&
    anchor.scopeId === attempt.selector.scopeId &&
    anchor.sessionId === attempt.selector.sessionId &&
    anchor.attemptFence === attempt.selector.attemptFence &&
    context.executionPin.schemaVersionId === attempt.schemaVersionId &&
    anchor.snapshotToken.scopeId === attempt.snapshotToken.scopeId &&
    anchor.snapshotToken.epoch === attempt.snapshotToken.epoch &&
    anchor.snapshotToken.commitSeq === attempt.snapshotToken.commitSeq
  );
}

export function attemptFromContext(
  context: ExactRunningAttemptKernelContextV1,
): SessionJournalAttemptStateV1 {
  return Object.freeze({
    selector: Object.freeze({
      deploymentId: context.anchor.deploymentId,
      scopeId: context.anchor.scopeId,
      sessionId: context.anchor.sessionId,
      attemptFence: context.anchor.attemptFence,
    }),
    snapshotToken: context.anchor.snapshotToken,
    schemaVersionId: context.executionPin.schemaVersionId,
    executionClaim: Object.freeze({ ...context.executionClaim }),
    executionProfile: context.journalRoot.executionProfile,
  });
}

export function corruption(
  attempt: SessionJournalAttemptStateV1,
  reason: SessionJournalStorageCorruptionReasonV1,
  cause?: unknown,
): SessionJournalStorageCorruptionV1Error {
  return new SessionJournalStorageCorruptionV1Error({
    scopeId: attempt.selector.scopeId,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
