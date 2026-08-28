import { Result } from "effect";

import {
  initialPublicationAttemptOrdinal,
  MAX_PUBLICATION_ATTEMPT_ORDINAL,
  successorPublicationAttemptOrdinal,
} from "./CanonicalValue.js";
import type {
  PublicationAttemptInstant,
  PublicationAttemptOrdinal,
  QueryResultDigest,
} from "./CanonicalValue.js";
import {
  InvalidAcceptedPublicationEvidenceError,
  InvalidPublicationAttemptError,
  InvalidPublicationAttemptOutcomeReplayError,
  QuerySyncInvariantDefect,
} from "./Errors.js";
import type { QuerySyncAuthorityError } from "./Errors.js";
import {
  blockedPublicationAttemptDisposition,
  readyPublicationAttemptDisposition,
  rebuildQuerySyncState,
  uncertainPublicationAttemptDisposition,
} from "./Model.js";
import type {
  BuildQuerySyncStateError,
  InFlightQueryPublication,
  PrecedingPublicationAttemptOutcome,
  PublicationAttemptOutcome as PublicationAttemptOutcomeModel,
  PublicationAttemptOutcomeReceiptCore,
  PublicationBlockReason,
  QuerySyncState,
} from "./Model.js";
import { validateQuerySyncAuthority } from "./Policy.js";
import {
  compareQueryPublicationIdentity,
  freezeQueryPublicationIdentity,
  makePendingQueryPublication,
  queryPublicationIdentityEquals,
} from "./Publication.js";
import type {
  PendingQueryPublication,
  QueryPublicationIdentity,
} from "./Publication.js";

export const MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS = 604_800_000;

interface PublicationAttemptFields {
  readonly publication: PendingQueryPublication;
  readonly attemptOrdinal: PublicationAttemptOrdinal;
  readonly firstAttemptAt: PublicationAttemptInstant;
  readonly lastAttemptAt: PublicationAttemptInstant;
}

const issuedPublicationAttempts = new WeakSet<object>();

class IssuedPublicationAttempt implements PublicationAttemptFields {
  declare private readonly issuedPublicationAttempt: void;

  readonly publication: PendingQueryPublication;
  readonly attemptOrdinal: PublicationAttemptOrdinal;
  readonly firstAttemptAt: PublicationAttemptInstant;
  readonly lastAttemptAt: PublicationAttemptInstant;

  constructor(fields: PublicationAttemptFields) {
    this.publication = makePendingQueryPublication(fields.publication);
    this.attemptOrdinal = fields.attemptOrdinal;
    this.firstAttemptAt = fields.firstAttemptAt;
    this.lastAttemptAt = fields.lastAttemptAt;
    issuedPublicationAttempts.add(this);
    Object.freeze(this);
  }
}

export type PublicationAttempt = IssuedPublicationAttempt;
export type PublicationAttemptOutcome = PublicationAttemptOutcomeModel;

interface AcceptedQueryPublicationEvidenceFields {
  readonly identity: QueryPublicationIdentity;
  readonly resultDigest: QueryResultDigest;
}

const admittedPublicationEvidence = new WeakSet<object>();

class AdmittedQueryPublicationEvidence
  implements AcceptedQueryPublicationEvidenceFields
{
  declare private readonly admittedQueryPublicationEvidence: void;

  readonly identity: QueryPublicationIdentity;
  readonly resultDigest: QueryResultDigest;

  constructor(fields: AcceptedQueryPublicationEvidenceFields) {
    this.identity = freezeQueryPublicationIdentity(fields.identity);
    this.resultDigest = fields.resultDigest;
    admittedPublicationEvidence.add(this);
    Object.freeze(this);
  }
}

export type AcceptedQueryPublicationEvidence =
  AdmittedQueryPublicationEvidence;

export type ClaimPublicationDecision =
  | Readonly<{
    readonly _tag: "claimed";
    readonly state: QuerySyncState;
    readonly attempt: PublicationAttempt;
  }>
  | Readonly<{
    readonly _tag: "replayed";
    readonly state: QuerySyncState;
    readonly attempt: PublicationAttempt;
  }>
  | Readonly<{
    readonly _tag: "blocked";
    readonly state: QuerySyncState;
    readonly identity: QueryPublicationIdentity;
    readonly attemptOrdinal: PublicationAttemptOrdinal;
    readonly reason: PublicationBlockReason;
    readonly resetRequired: true;
  }>
  | Readonly<{
    readonly _tag: "none";
    readonly state: QuerySyncState;
  }>;

export type RecordPublicationAttemptOutcomeDecision =
  | Readonly<{
    readonly _tag: "recorded";
    readonly state: QuerySyncState;
    readonly identity: QueryPublicationIdentity;
    readonly attemptOrdinal: PublicationAttemptOrdinal;
    readonly nextAttemptOrdinal: PublicationAttemptOrdinal;
    readonly nextDisposition: "ready" | "uncertain";
  }>
  | Readonly<{
    readonly _tag: "blocked";
    readonly state: QuerySyncState;
    readonly identity: QueryPublicationIdentity;
    readonly attemptOrdinal: PublicationAttemptOrdinal;
    readonly reason: PublicationBlockReason;
    readonly resetRequired: true;
  }>
  | Readonly<{
    readonly _tag: "superseded";
    readonly state: QuerySyncState;
    readonly identity: QueryPublicationIdentity;
    readonly attemptOrdinal: PublicationAttemptOrdinal;
  }>
  | Readonly<{
    readonly _tag: "recoveryEvidenceExpired";
    readonly state: QuerySyncState;
    readonly identity: QueryPublicationIdentity;
    readonly attemptOrdinal: PublicationAttemptOrdinal;
  }>;

export type CompletePublicationDecision =
  | Readonly<{
    readonly _tag: "completed";
    readonly state: QuerySyncState;
    readonly identity: QueryPublicationIdentity;
  }>
  | Readonly<{
    readonly _tag: "replayed";
    readonly state: QuerySyncState;
    readonly identity: QueryPublicationIdentity;
  }>
  | Readonly<{
    readonly _tag: "superseded";
    readonly state: QuerySyncState;
    readonly identity: QueryPublicationIdentity;
  }>;

export type ClaimPublicationError = BuildQuerySyncStateError;

export type RecordPublicationAttemptOutcomeError =
  | QuerySyncAuthorityError<"recordPublicationAttemptOutcome">
  | InvalidPublicationAttemptError
  | InvalidPublicationAttemptOutcomeReplayError
  | BuildQuerySyncStateError;

export type CompletePublicationError =
  | QuerySyncAuthorityError<"completePublication">
  | InvalidAcceptedPublicationEvidenceError
  | BuildQuerySyncStateError;

function makePublicationAttempt(
  inFlight: InFlightQueryPublication,
): PublicationAttempt {
  return new IssuedPublicationAttempt({
    publication: inFlight.publication,
    attemptOrdinal: inFlight.attemptOrdinal,
    firstAttemptAt: inFlight.firstAttemptAt,
    lastAttemptAt: inFlight.lastAttemptAt,
  });
}

function freezeClaimDecision(
  decision: ClaimPublicationDecision,
): ClaimPublicationDecision {
  return Object.freeze(decision);
}

function freezeOutcomeDecision(
  decision: RecordPublicationAttemptOutcomeDecision,
): RecordPublicationAttemptOutcomeDecision {
  return Object.freeze(decision);
}

function freezeCompleteDecision(
  decision: CompletePublicationDecision,
): CompletePublicationDecision {
  return Object.freeze(decision);
}

function clampedPublicationInstant(
  observedNow: PublicationAttemptInstant,
  lastAttemptAt: PublicationAttemptInstant,
): PublicationAttemptInstant {
  return observedNow < lastAttemptAt ? lastAttemptAt : observedNow;
}

function publicationAgeLimitReached(
  firstAttemptAt: PublicationAttemptInstant,
  clampedNow: PublicationAttemptInstant,
): boolean {
  return clampedNow - firstAttemptAt
    >= MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS;
}

function blockedClaimDecision(
  state: QuerySyncState,
  inFlight: InFlightQueryPublication,
  reason: PublicationBlockReason,
): ClaimPublicationDecision {
  return freezeClaimDecision({
    _tag: "blocked",
    state,
    identity: inFlight.publication.identity,
    attemptOrdinal: inFlight.attemptOrdinal,
    reason,
    resetRequired: true,
  });
}

function blockedOutcomeDecision(
  state: QuerySyncState,
  identity: QueryPublicationIdentity,
  attemptOrdinal: PublicationAttemptOrdinal,
  reason: PublicationBlockReason,
): RecordPublicationAttemptOutcomeDecision {
  return freezeOutcomeDecision({
    _tag: "blocked",
    state,
    identity,
    attemptOrdinal,
    reason,
    resetRequired: true,
  });
}

function decisionFromRetainedOutcome(
  state: QuerySyncState,
  preceding: PrecedingPublicationAttemptOutcome,
): RecordPublicationAttemptOutcomeDecision {
  return preceding.receipt._tag === "recorded"
    ? freezeOutcomeDecision({
      _tag: "recorded",
      state,
      identity: preceding.identity,
      attemptOrdinal: preceding.attemptOrdinal,
      nextAttemptOrdinal: preceding.receipt.nextAttemptOrdinal,
      nextDisposition: preceding.receipt.nextDisposition,
    })
    : blockedOutcomeDecision(
      state,
      preceding.identity,
      preceding.attemptOrdinal,
      preceding.receipt.reason,
    );
}

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
  reason: Exclude<
    InvalidPublicationAttemptError["reason"],
    "notStateIssued"
  >,
): InvalidPublicationAttemptError {
  return new InvalidPublicationAttemptError({
    operation: "recordPublicationAttemptOutcome",
    reason,
    queryKey: attempt.publication.identity.queryKey,
    generation: attempt.publication.identity.generation,
    ordinal: attempt.attemptOrdinal,
  });
}

function attemptPublicationMatches(
  attempt: PublicationAttempt,
  inFlight: InFlightQueryPublication,
): Result.Result<void, InvalidPublicationAttemptError> {
  if (!queryPublicationIdentityEquals(
    attempt.publication.identity,
    inFlight.publication.identity,
  )) {
    return Result.fail(invalidPublicationAttempt(
      attempt,
      "publicationIdentityMismatch",
    ));
  }
  if (attempt.publication.queryIdentity !== inFlight.publication.queryIdentity) {
    return Result.fail(invalidPublicationAttempt(
      attempt,
      "queryIdentityMismatch",
    ));
  }
  if (attempt.publication.content !== inFlight.publication.content) {
    return Result.fail(invalidPublicationAttempt(
      attempt,
      "publicationContentMismatch",
    ));
  }
  if (attempt.publication.resultDigest !== inFlight.publication.resultDigest) {
    return Result.fail(invalidPublicationAttempt(
      attempt,
      "resultDigestMismatch",
    ));
  }
  if (attempt.attemptOrdinal !== inFlight.attemptOrdinal) {
    return Result.fail(invalidPublicationAttempt(attempt, "ordinalMismatch"));
  }
  if (attempt.firstAttemptAt !== inFlight.firstAttemptAt) {
    return Result.fail(invalidPublicationAttempt(
      attempt,
      "firstAttemptInstantMismatch",
    ));
  }
  if (attempt.lastAttemptAt !== inFlight.lastAttemptAt) {
    return Result.fail(invalidPublicationAttempt(
      attempt,
      "attemptInstantMismatch",
    ));
  }
  return Result.succeed(undefined);
}

function precedingOutcomeFingerprintMatches(
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

function findLowestPendingPublication(
  pending: readonly PendingQueryPublication[],
): PendingQueryPublication | undefined {
  let lowest: PendingQueryPublication | undefined;
  for (const candidate of pending) {
    if (
      lowest === undefined
      || compareQueryPublicationIdentity(candidate.identity, lowest.identity) < 0
    ) {
      lowest = candidate;
    }
  }
  return lowest;
}

export function claimPublication(
  state: QuerySyncState,
  capturedNow: PublicationAttemptInstant,
): Result.Result<ClaimPublicationDecision, ClaimPublicationError> {
  return Result.gen(function* () {
    const current = state.publicationWork.inFlight;
    if (current !== null) {
      if (current.disposition._tag === "blocked") {
        return blockedClaimDecision(state, current, current.disposition.reason);
      }
      const clampedNow = clampedPublicationInstant(
        capturedNow,
        current.lastAttemptAt,
      );
      if (publicationAgeLimitReached(current.firstAttemptAt, clampedNow)) {
        const nextState = yield* rebuildQuerySyncState(state, {
          publicationWork: {
            ...state.publicationWork,
            inFlight: {
              ...current,
              disposition: blockedPublicationAttemptDisposition(
                "ageLimitReached",
              ),
            },
          },
        });
        const blocked = nextState.publicationWork.inFlight;
        if (blocked === null || blocked.disposition._tag !== "blocked") {
          throw new QuerySyncInvariantDefect({
            operation: "claimPublication",
            invariant: "publicationLifecycleLinkInvalid",
          });
        }
        return blockedClaimDecision(
          nextState,
          blocked,
          blocked.disposition.reason,
        );
      }
      return freezeClaimDecision({
        _tag: "replayed",
        state,
        attempt: makePublicationAttempt(current),
      });
    }

    const selected = findLowestPendingPublication(
      state.publicationWork.pending,
    );
    if (selected === undefined) {
      return freezeClaimDecision({ _tag: "none", state });
    }

    const nextState = yield* rebuildQuerySyncState(state, {
      publicationWork: {
        ...state.publicationWork,
        pending: state.publicationWork.pending.filter((candidate) => (
          !queryPublicationIdentityEquals(candidate.identity, selected.identity)
        )),
        inFlight: {
          publication: selected,
          attemptOrdinal: initialPublicationAttemptOrdinal(),
          firstAttemptAt: capturedNow,
          lastAttemptAt: capturedNow,
          disposition: readyPublicationAttemptDisposition(),
        },
      },
    });
    const claimed = nextState.publicationWork.inFlight;
    if (claimed === null) {
      throw new QuerySyncInvariantDefect({
        operation: "claimPublication",
        invariant: "publicationLifecycleLinkInvalid",
      });
    }
    return freezeClaimDecision({
      _tag: "claimed",
      state: nextState,
      attempt: makePublicationAttempt(claimed),
    });
  });
}

export function recordPublicationAttemptOutcome(
  state: QuerySyncState,
  attempt: PublicationAttempt,
  outcome: PublicationAttemptOutcome,
  capturedNow: PublicationAttemptInstant,
): Result.Result<
  RecordPublicationAttemptOutcomeDecision,
  RecordPublicationAttemptOutcomeError
> {
  return Result.gen(function* () {
    if (
      !(attempt instanceof IssuedPublicationAttempt)
      || !issuedPublicationAttempts.has(attempt)
    ) {
      return yield* Result.fail(invalidUnissuedPublicationAttempt());
    }
    yield* validateQuerySyncAuthority(
      "recordPublicationAttemptOutcome",
      state.cursor,
      attempt.publication.identity,
    );

    const preceding = state.publicationWork.precedingAttemptOutcome;
    if (
      preceding !== null
      && precedingOutcomeFingerprintMatches(preceding, attempt)
    ) {
      if (preceding.outcome !== outcome) {
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
      return decisionFromRetainedOutcome(state, preceding);
    }

    const current = state.publicationWork.inFlight;
    if (
      current !== null
      && queryPublicationIdentityEquals(
        current.publication.identity,
        attempt.publication.identity,
      )
    ) {
      if (attempt.publication.resultDigest !== current.publication.resultDigest) {
        return yield* Result.fail(invalidPublicationAttempt(
          attempt,
          "resultDigestMismatch",
        ));
      }
      if (attempt.attemptOrdinal < current.attemptOrdinal) {
        return freezeOutcomeDecision({
          _tag: "recoveryEvidenceExpired",
          state,
          identity: attempt.publication.identity,
          attemptOrdinal: attempt.attemptOrdinal,
        });
      }
      yield* attemptPublicationMatches(attempt, current);

      if (current.disposition._tag === "blocked") {
        return blockedOutcomeDecision(
          state,
          current.publication.identity,
          current.attemptOrdinal,
          current.disposition.reason,
        );
      }

      const clampedNow = clampedPublicationInstant(
        capturedNow,
        current.lastAttemptAt,
      );
      const blockReason: PublicationBlockReason | null =
        outcome === "terminalRefusal"
          ? "terminalPublisherRefusal"
          : current.attemptOrdinal === MAX_PUBLICATION_ATTEMPT_ORDINAL
            ? "attemptLimitReached"
            : publicationAgeLimitReached(current.firstAttemptAt, clampedNow)
              ? "ageLimitReached"
              : null;

      if (blockReason !== null) {
        const receipt: PublicationAttemptOutcomeReceiptCore = Object.freeze({
          _tag: "blocked",
          reason: blockReason,
          resetRequired: true,
        });
        const nextState = yield* rebuildQuerySyncState(state, {
          publicationWork: {
            ...state.publicationWork,
            inFlight: {
              ...current,
              disposition: blockedPublicationAttemptDisposition(blockReason),
            },
            precedingAttemptOutcome: {
              identity: current.publication.identity,
              resultDigest: current.publication.resultDigest,
              attemptOrdinal: current.attemptOrdinal,
              outcome,
              receipt,
            },
          },
        });
        return blockedOutcomeDecision(
          nextState,
          current.publication.identity,
          current.attemptOrdinal,
          blockReason,
        );
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
      const nextDisposition = outcome === "outcomeUnknown"
        ? "uncertain"
        : "ready";
      const receipt: PublicationAttemptOutcomeReceiptCore = Object.freeze({
        _tag: "recorded",
        nextAttemptOrdinal,
        nextDisposition,
      });
      const nextState = yield* rebuildQuerySyncState(state, {
        publicationWork: {
          ...state.publicationWork,
          inFlight: {
            ...current,
            attemptOrdinal: nextAttemptOrdinal,
            lastAttemptAt: clampedNow,
            disposition: nextDisposition === "ready"
              ? readyPublicationAttemptDisposition()
              : uncertainPublicationAttemptDisposition(),
          },
          precedingAttemptOutcome: {
            identity: current.publication.identity,
            resultDigest: current.publication.resultDigest,
            attemptOrdinal: current.attemptOrdinal,
            outcome,
            receipt,
          },
        },
      });
      return freezeOutcomeDecision({
        _tag: "recorded",
        state: nextState,
        identity: current.publication.identity,
        attemptOrdinal: current.attemptOrdinal,
        nextAttemptOrdinal,
        nextDisposition,
      });
    }

    const delivered = state.publicationWork.latestDelivered;
    if (
      delivered !== null
      && queryPublicationIdentityEquals(
        delivered.identity,
        attempt.publication.identity,
      )
    ) {
      const retainedOutcomeIsLater = preceding !== null && (
        (
          queryPublicationIdentityEquals(
            preceding.identity,
            attempt.publication.identity,
          )
          && preceding.attemptOrdinal > attempt.attemptOrdinal
        )
        || (
          current !== null
          && queryPublicationIdentityEquals(
            preceding.identity,
            current.publication.identity,
          )
        )
      );
      if (retainedOutcomeIsLater) {
        return freezeOutcomeDecision({
          _tag: "recoveryEvidenceExpired",
          state,
          identity: attempt.publication.identity,
          attemptOrdinal: attempt.attemptOrdinal,
        });
      }
      return freezeOutcomeDecision({
        _tag: "superseded",
        state,
        identity: attempt.publication.identity,
        attemptOrdinal: attempt.attemptOrdinal,
      });
    }
    return freezeOutcomeDecision({
      _tag: "recoveryEvidenceExpired",
      state,
      identity: attempt.publication.identity,
      attemptOrdinal: attempt.attemptOrdinal,
    });
  });
}

export function makeAcceptedQueryPublicationEvidenceForTesting(
  fields: AcceptedQueryPublicationEvidenceFields,
): AcceptedQueryPublicationEvidence {
  return new AdmittedQueryPublicationEvidence(fields);
}

function invalidUnissuedAcceptanceEvidence():
  InvalidAcceptedPublicationEvidenceError {
  return new InvalidAcceptedPublicationEvidenceError({
    operation: "completePublication",
    reason: "notStateIssued",
    queryKey: "",
    generation: 0n,
  });
}

function invalidAcceptanceDigest(
  evidence: AcceptedQueryPublicationEvidence,
): InvalidAcceptedPublicationEvidenceError {
  return new InvalidAcceptedPublicationEvidenceError({
    operation: "completePublication",
    reason: "resultDigestMismatch",
    queryKey: evidence.identity.queryKey,
    generation: evidence.identity.generation,
  });
}

export function completePublication(
  state: QuerySyncState,
  evidence: AcceptedQueryPublicationEvidence,
): Result.Result<CompletePublicationDecision, CompletePublicationError> {
  return Result.gen(function* () {
    if (
      !(evidence instanceof AdmittedQueryPublicationEvidence)
      || !admittedPublicationEvidence.has(evidence)
    ) {
      return yield* Result.fail(invalidUnissuedAcceptanceEvidence());
    }
    yield* validateQuerySyncAuthority(
      "completePublication",
      state.cursor,
      evidence.identity,
    );

    const current = state.publicationWork.inFlight;
    if (
      current !== null
      && queryPublicationIdentityEquals(
        current.publication.identity,
        evidence.identity,
      )
    ) {
      if (current.publication.resultDigest !== evidence.resultDigest) {
        return yield* Result.fail(invalidAcceptanceDigest(evidence));
      }
      const nextState = yield* rebuildQuerySyncState(state, {
        publicationWork: {
          ...state.publicationWork,
          inFlight: null,
          latestDelivered: {
            identity: current.publication.identity,
            resultDigest: current.publication.resultDigest,
          },
        },
      });
      return freezeCompleteDecision({
        _tag: "completed",
        state: nextState,
        identity: current.publication.identity,
      });
    }

    const delivered = state.publicationWork.latestDelivered;
    if (
      delivered !== null
      && queryPublicationIdentityEquals(delivered.identity, evidence.identity)
    ) {
      if (delivered.resultDigest !== evidence.resultDigest) {
        return yield* Result.fail(invalidAcceptanceDigest(evidence));
      }
      return freezeCompleteDecision({
        _tag: "replayed",
        state,
        identity: delivered.identity,
      });
    }
    return freezeCompleteDecision({
      _tag: "superseded",
      state,
      identity: evidence.identity,
    });
  });
}
