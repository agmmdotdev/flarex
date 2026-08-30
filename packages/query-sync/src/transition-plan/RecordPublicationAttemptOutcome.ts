import { Result } from "effect";

import {
  MAX_PUBLICATION_ATTEMPT_ORDINAL,
  successorPublicationAttemptOrdinal,
} from "../kernel/CanonicalValue.js";
import type {
  PublicationAttemptInstant,
} from "../kernel/CanonicalValue.js";
import {
  InvalidPublicationAttemptError,
  InvalidPublicationAttemptOutcomeReplayError,
  QuerySyncInvariantDefect,
} from "../kernel/Errors.js";
import type { QuerySyncAuthorityError } from "../kernel/Errors.js";
import {
  blockedPublicationAttemptDisposition,
  readyPublicationAttemptDisposition,
  uncertainPublicationAttemptDisposition,
} from "../kernel/Model.js";
import type {
  InFlightQueryPublication,
  PrecedingPublicationAttemptOutcome,
  PublicationAttemptOutcomeReceiptCore,
  PublicationBlockReason,
} from "../kernel/Model.js";
import { validateQuerySyncAuthority } from "../kernel/Authority.js";
import {
  queryPublicationIdentityEquals,
} from "../kernel/Publication.js";
import type {
  QueryPublicationIdentity,
} from "../kernel/Publication.js";
import {
  applyMetricReplacement,
  publicationLifecycleMetricContribution,
} from "./Accounting.js";
import { QuerySyncTransitionFactError } from "./Errors.js";
import {
  freezeInFlightQueryPublicationFacts,
  freezePrecedingPublicationAttemptOutcomeFacts,
  freezePublicationLifecycleFacts,
  freezePublicationOwnerQueryFacts,
} from "./PublicationFacts.js";
import type {
  PublicationLifecycleFacts,
  PublicationOwnerQueryFacts,
} from "./PublicationFacts.js";
import {
  clampedPublicationInstant,
  publicationAgeLimitReached,
  validatePublicationLifecycleFacts,
  validatePublicationOwnerFacts,
} from "./PublicationInvariants.js";
import {
  blockedPublicationAttemptOutcomeReceipt,
  historicalPublicationAttemptOutcomeReceipt,
  isIssuedPublicationAttempt,
  MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS,
  recordedPublicationAttemptOutcomeReceipt,
} from "./PublicationWork.js";
import type {
  PublicationAttempt,
  PublicationAttemptOutcome,
  RecordPublicationAttemptOutcomeReceipt,
} from "./PublicationWork.js";
import { freezeScopeFacts } from "./Model.js";
import type {
  QuerySyncScopeFacts,
  TransitionPlan,
} from "./Model.js";

export interface RecordPublicationAttemptOutcomeExpectation {
  readonly scope: QuerySyncScopeFacts;
  readonly lifecycle: PublicationLifecycleFacts;
  readonly owner: PublicationOwnerQueryFacts | null;
}

export interface ReplacePublicationAttemptLifecycleChange {
  readonly _tag: "replacePublicationAttemptLifecycle";
  readonly inFlight: InFlightQueryPublication;
  readonly precedingAttemptOutcome: PrecedingPublicationAttemptOutcome;
}

export type RecordPublicationAttemptOutcomePlan = TransitionPlan<
  RecordPublicationAttemptOutcomeReceipt,
  RecordPublicationAttemptOutcomeExpectation,
  ReplacePublicationAttemptLifecycleChange
>;

export type PlanRecordPublicationAttemptOutcomeError =
  | QuerySyncAuthorityError<"recordPublicationAttemptOutcome">
  | InvalidPublicationAttemptError
  | InvalidPublicationAttemptOutcomeReplayError
  | QuerySyncTransitionFactError;

type IssuedPublicationAttemptMismatch = Exclude<
  InvalidPublicationAttemptError["reason"],
  "notStateIssued"
>;

function invalidUnissuedPublicationAttempt(): InvalidPublicationAttemptError {
  return new InvalidPublicationAttemptError({
    operation: "recordPublicationAttemptOutcome",
    reason: "notStateIssued",
    queryKey: "",
    generation: 0n,
    ordinal: 0,
  });
}

function invalidPublicationAttempt(
  attempt: PublicationAttempt,
  reason: IssuedPublicationAttemptMismatch,
): InvalidPublicationAttemptError {
  return new InvalidPublicationAttemptError({
    operation: "recordPublicationAttemptOutcome",
    reason,
    queryKey: attempt.publication.identity.queryKey,
    generation: attempt.publication.identity.generation,
    ordinal: attempt.attemptOrdinal,
  });
}

export interface AuthenticatedRecordPublicationAttemptOutcomeTarget {
  readonly attempt: PublicationAttempt;
  readonly queryKey: PublicationAttempt["publication"]["identity"]["queryKey"];
}

export function authenticateRecordPublicationAttemptOutcomeAttempt(
  value: unknown,
): Result.Result<
  AuthenticatedRecordPublicationAttemptOutcomeTarget,
  InvalidPublicationAttemptError
> {
  if (!isIssuedPublicationAttempt(value)) {
    return Result.fail(invalidUnissuedPublicationAttempt());
  }
  return Result.succeed(Object.freeze({
    attempt: value,
    queryKey: value.publication.identity.queryKey,
  }));
}

function noWritePlan(
  receipt: RecordPublicationAttemptOutcomeReceipt,
): RecordPublicationAttemptOutcomePlan {
  return Object.freeze({ _tag: "noWrite", receipt });
}

function ownerFactFailure(): QuerySyncTransitionFactError {
  return new QuerySyncTransitionFactError({
    operation: "recordPublicationAttemptOutcome",
    reason: "publicationOwnerFactsInvalid",
  });
}

function requireMatchingOwner(
  scope: QuerySyncScopeFacts,
  lifecycle: PublicationLifecycleFacts,
  ownerInput: PublicationOwnerQueryFacts | null,
  identity: QueryPublicationIdentity,
): Result.Result<PublicationOwnerQueryFacts, QuerySyncTransitionFactError> {
  if (ownerInput === null) return Result.fail(ownerFactFailure());
  const owner = freezePublicationOwnerQueryFacts(ownerInput);
  return validatePublicationOwnerFacts(
    "recordPublicationAttemptOutcome",
    scope,
    lifecycle,
    owner,
    identity,
  ).pipe(Result.map(() => owner));
}

function precedingFingerprintMatches(
  preceding: PrecedingPublicationAttemptOutcome,
  attempt: PublicationAttempt,
): boolean {
  return queryPublicationIdentityEquals(
    preceding.identity,
    attempt.publication.identity,
  )
    && preceding.resultDigest === attempt.publication.resultDigest
    && preceding.attemptOrdinal === attempt.attemptOrdinal;
}

function receiptFromRetainedOutcome(
  preceding: PrecedingPublicationAttemptOutcome,
): RecordPublicationAttemptOutcomeReceipt {
  return preceding.receipt._tag === "recorded"
    ? recordedPublicationAttemptOutcomeReceipt({
      identity: preceding.identity,
      attemptOrdinal: preceding.attemptOrdinal,
      nextAttemptOrdinal: preceding.receipt.nextAttemptOrdinal,
      nextDisposition: preceding.receipt.nextDisposition,
    })
    : blockedPublicationAttemptOutcomeReceipt(
      preceding.identity,
      preceding.attemptOrdinal,
      preceding.receipt.reason,
    );
}

function remainingAttemptMismatch(
  attempt: PublicationAttempt,
  current: InFlightQueryPublication,
): IssuedPublicationAttemptMismatch | null {
  if (attempt.publication.queryIdentity !== current.publication.queryIdentity) {
    return "queryIdentityMismatch";
  }
  if (attempt.publication.content !== current.publication.content) {
    return "publicationContentMismatch";
  }
  if (attempt.attemptOrdinal !== current.attemptOrdinal) {
    return "ordinalMismatch";
  }
  if (attempt.firstAttemptAt !== current.firstAttemptAt) {
    return "firstAttemptInstantMismatch";
  }
  return attempt.lastAttemptAt !== current.lastAttemptAt
    ? "attemptInstantMismatch"
    : null;
}

function nextScopeWithLifecycle(
  scope: QuerySyncScopeFacts,
  before: PublicationLifecycleFacts,
  after: PublicationLifecycleFacts,
): QuerySyncScopeFacts {
  return freezeScopeFacts({
    cursor: scope.cursor,
    evaluationWork: scope.evaluationWork,
    metrics: applyMetricReplacement(
      scope.metrics,
      publicationLifecycleMetricContribution(before),
      publicationLifecycleMetricContribution(after),
    ),
  });
}

function writePlan(input: {
  readonly scope: QuerySyncScopeFacts;
  readonly lifecycle: PublicationLifecycleFacts;
  readonly owner: PublicationOwnerQueryFacts | null;
  readonly inFlight: InFlightQueryPublication;
  readonly preceding: PrecedingPublicationAttemptOutcome;
  readonly receipt: RecordPublicationAttemptOutcomeReceipt;
}): RecordPublicationAttemptOutcomePlan {
  const nextLifecycle = freezePublicationLifecycleFacts({
    ...input.lifecycle,
    inFlight: input.inFlight,
    precedingAttemptOutcome: input.preceding,
  });
  return Object.freeze({
    _tag: "write",
    receipt: input.receipt,
    expected: Object.freeze({
      scope: input.scope,
      lifecycle: input.lifecycle,
      owner: input.owner,
    }),
    nextScope: nextScopeWithLifecycle(
      input.scope,
      input.lifecycle,
      nextLifecycle,
    ),
    change: Object.freeze({
      _tag: "replacePublicationAttemptLifecycle",
      inFlight: input.inFlight,
      precedingAttemptOutcome: input.preceding,
    }),
  });
}

function historicalOutcomeReceipt(
  tag: "superseded" | "recoveryEvidenceExpired",
  attempt: PublicationAttempt,
): RecordPublicationAttemptOutcomeReceipt {
  return historicalPublicationAttemptOutcomeReceipt(
    tag,
    attempt.publication.identity,
    attempt.attemptOrdinal,
  );
}

function retainedOutcomeIsLater(
  lifecycle: PublicationLifecycleFacts,
  attempt: PublicationAttempt,
): boolean {
  const preceding = lifecycle.precedingAttemptOutcome;
  if (preceding === null) return false;
  return (
    queryPublicationIdentityEquals(
      preceding.identity,
      attempt.publication.identity,
    )
    && preceding.attemptOrdinal > attempt.attemptOrdinal
  ) || (
    lifecycle.inFlight !== null
    && queryPublicationIdentityEquals(
      preceding.identity,
      lifecycle.inFlight.publication.identity,
    )
  );
}

export function planRecordPublicationAttemptOutcome(input: {
  readonly scope: QuerySyncScopeFacts;
  readonly lifecycle: PublicationLifecycleFacts;
  readonly owner: PublicationOwnerQueryFacts | null;
  readonly attempt: PublicationAttempt;
  readonly outcome: PublicationAttemptOutcome;
  readonly capturedNow: PublicationAttemptInstant;
}): Result.Result<
  RecordPublicationAttemptOutcomePlan,
  PlanRecordPublicationAttemptOutcomeError
> {
  return Result.gen(function* () {
    // Capability authenticity deliberately precedes every attempt field read.
    const authenticated =
      yield* authenticateRecordPublicationAttemptOutcomeAttempt(input.attempt);
    const attempt = authenticated.attempt;
    const scope = freezeScopeFacts(input.scope);
    const lifecycle = freezePublicationLifecycleFacts(input.lifecycle);
    yield* validateQuerySyncAuthority(
      "recordPublicationAttemptOutcome",
      scope.cursor,
      attempt.publication.identity,
    );
    yield* validatePublicationLifecycleFacts(
      "recordPublicationAttemptOutcome",
      scope,
      lifecycle,
    );

    const preceding = lifecycle.precedingAttemptOutcome;
    if (preceding !== null && precedingFingerprintMatches(preceding, attempt)) {
      yield* requireMatchingOwner(
        scope,
        lifecycle,
        input.owner,
        attempt.publication.identity,
      );
      if (preceding.outcome !== input.outcome) {
        return yield* Result.fail(
          new InvalidPublicationAttemptOutcomeReplayError({
            operation: "recordPublicationAttemptOutcome",
            reason: "outcomeMismatch",
            queryKey: attempt.publication.identity.queryKey,
            generation: attempt.publication.identity.generation,
            ordinal: attempt.attemptOrdinal,
          }),
        );
      }
      return noWritePlan(receiptFromRetainedOutcome(preceding));
    }

    const current = lifecycle.inFlight;
    if (
      current !== null
      && queryPublicationIdentityEquals(
        current.publication.identity,
        attempt.publication.identity,
      )
    ) {
      const owner = yield* requireMatchingOwner(
        scope,
        lifecycle,
        input.owner,
        attempt.publication.identity,
      );
      if (attempt.publication.resultDigest !== current.publication.resultDigest) {
        return yield* Result.fail(invalidPublicationAttempt(
          attempt,
          "resultDigestMismatch",
        ));
      }
      if (attempt.attemptOrdinal < current.attemptOrdinal) {
        return noWritePlan(historicalOutcomeReceipt(
          "recoveryEvidenceExpired",
          attempt,
        ));
      }
      const mismatch = remainingAttemptMismatch(attempt, current);
      if (mismatch !== null) {
        return yield* Result.fail(invalidPublicationAttempt(attempt, mismatch));
      }
      if (current.disposition._tag === "blocked") {
        return noWritePlan(blockedPublicationAttemptOutcomeReceipt(
          current.publication.identity,
          current.attemptOrdinal,
          current.disposition.reason,
        ));
      }

      const clampedNow = clampedPublicationInstant(
        input.capturedNow,
        current.lastAttemptAt,
      );
      const blockReason: PublicationBlockReason | null =
        input.outcome === "terminalRefusal"
          ? "terminalPublisherRefusal"
          : current.attemptOrdinal === MAX_PUBLICATION_ATTEMPT_ORDINAL
            ? "attemptLimitReached"
            : publicationAgeLimitReached(
                current.firstAttemptAt,
                clampedNow,
                MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS,
              )
              ? "ageLimitReached"
              : null;
      if (blockReason !== null) {
        const receiptCore: PublicationAttemptOutcomeReceiptCore = Object.freeze({
          _tag: "blocked",
          reason: blockReason,
          resetRequired: true,
        });
        const nextInFlight = freezeInFlightQueryPublicationFacts({
          ...current,
          disposition: blockedPublicationAttemptDisposition(blockReason),
        });
        const nextPreceding = freezePrecedingPublicationAttemptOutcomeFacts({
          identity: current.publication.identity,
          resultDigest: current.publication.resultDigest,
          attemptOrdinal: current.attemptOrdinal,
          outcome: input.outcome,
          receipt: receiptCore,
        });
        return writePlan({
          scope,
          lifecycle,
          owner,
          inFlight: nextInFlight,
          preceding: nextPreceding,
          receipt: blockedPublicationAttemptOutcomeReceipt(
            current.publication.identity,
            current.attemptOrdinal,
            blockReason,
          ),
        });
      }

      const nextAttemptOrdinal = successorPublicationAttemptOrdinal(
        current.attemptOrdinal,
      );
      if (nextAttemptOrdinal === null) {
        throw new QuerySyncInvariantDefect({
          operation: "recordPublicationAttemptOutcome",
          invariant: "publicationAttemptStateInvalid",
        });
      }
      const nextDisposition = input.outcome === "outcomeUnknown"
        ? "uncertain"
        : "ready";
      const receiptCore: PublicationAttemptOutcomeReceiptCore = Object.freeze({
        _tag: "recorded",
        nextAttemptOrdinal,
        nextDisposition,
      });
      const nextInFlight = freezeInFlightQueryPublicationFacts({
        ...current,
        attemptOrdinal: nextAttemptOrdinal,
        lastAttemptAt: clampedNow,
        disposition: nextDisposition === "ready"
          ? readyPublicationAttemptDisposition()
          : uncertainPublicationAttemptDisposition(),
      });
      const nextPreceding = freezePrecedingPublicationAttemptOutcomeFacts({
        identity: current.publication.identity,
        resultDigest: current.publication.resultDigest,
        attemptOrdinal: current.attemptOrdinal,
        outcome: input.outcome,
        receipt: receiptCore,
      });
      return writePlan({
        scope,
        lifecycle,
        owner,
        inFlight: nextInFlight,
        preceding: nextPreceding,
        receipt: recordedPublicationAttemptOutcomeReceipt({
          identity: current.publication.identity,
          attemptOrdinal: current.attemptOrdinal,
          nextAttemptOrdinal,
          nextDisposition,
        }),
      });
    }

    const delivered = lifecycle.latestDelivered;
    if (
      delivered !== null
      && queryPublicationIdentityEquals(
        delivered.identity,
        attempt.publication.identity,
      )
    ) {
      yield* requireMatchingOwner(
        scope,
        lifecycle,
        input.owner,
        attempt.publication.identity,
      );
      return noWritePlan(historicalOutcomeReceipt(
        retainedOutcomeIsLater(lifecycle, attempt)
          ? "recoveryEvidenceExpired"
          : "superseded",
        attempt,
      ));
    }
    return noWritePlan(historicalOutcomeReceipt(
      "recoveryEvidenceExpired",
      attempt,
    ));
  });
}
