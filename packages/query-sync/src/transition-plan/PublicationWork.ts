import type {
  PublicationAttemptInstant,
  PublicationAttemptOrdinal,
  QueryResultDigest,
} from "../kernel/CanonicalValue.js";
import { QuerySyncInvariantDefect } from "../kernel/Errors.js";
import type {
  InFlightQueryPublication,
  PublicationAttemptOutcome as PublicationAttemptOutcomeModel,
  PublicationBlockReason,
} from "../kernel/Model.js";
import {
  freezeQueryPublicationIdentity,
  makePendingQueryPublication,
} from "../kernel/Publication.js";

export const MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS = 604_800_000;
import type {
  PendingQueryPublication,
  QueryPublicationIdentity,
} from "../kernel/Publication.js";

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

export type ClaimPublicationReceipt =
  | Readonly<{
      readonly _tag: "claimed";
      readonly attempt: PublicationAttempt;
    }>
  | Readonly<{
      readonly _tag: "replayed";
      readonly attempt: PublicationAttempt;
    }>
  | Readonly<{
      readonly _tag: "blocked";
      readonly identity: QueryPublicationIdentity;
      readonly attemptOrdinal: PublicationAttemptOrdinal;
      readonly reason: PublicationBlockReason;
      readonly resetRequired: true;
    }>
  | Readonly<{ readonly _tag: "none" }>;

export type RecordPublicationAttemptOutcomeReceipt =
  | Readonly<{
      readonly _tag: "recorded";
      readonly identity: QueryPublicationIdentity;
      readonly attemptOrdinal: PublicationAttemptOrdinal;
      readonly nextAttemptOrdinal: PublicationAttemptOrdinal;
      readonly nextDisposition: "ready" | "uncertain";
    }>
  | Readonly<{
      readonly _tag: "blocked";
      readonly identity: QueryPublicationIdentity;
      readonly attemptOrdinal: PublicationAttemptOrdinal;
      readonly reason: PublicationBlockReason;
      readonly resetRequired: true;
    }>
  | Readonly<{
      readonly _tag: "superseded";
      readonly identity: QueryPublicationIdentity;
      readonly attemptOrdinal: PublicationAttemptOrdinal;
    }>
  | Readonly<{
      readonly _tag: "recoveryEvidenceExpired";
      readonly identity: QueryPublicationIdentity;
      readonly attemptOrdinal: PublicationAttemptOrdinal;
    }>;

export type CompletePublicationReceipt =
  | Readonly<{
      readonly _tag: "completed";
      readonly identity: QueryPublicationIdentity;
    }>
  | Readonly<{
      readonly _tag: "replayed";
      readonly identity: QueryPublicationIdentity;
    }>
  | Readonly<{
      readonly _tag: "superseded";
      readonly identity: QueryPublicationIdentity;
    }>;

export function issuePublicationAttempt(
  inFlight: InFlightQueryPublication,
): PublicationAttempt {
  return new IssuedPublicationAttempt({
    publication: inFlight.publication,
    attemptOrdinal: inFlight.attemptOrdinal,
    firstAttemptAt: inFlight.firstAttemptAt,
    lastAttemptAt: inFlight.lastAttemptAt,
  });
}

export function isIssuedPublicationAttempt(
  value: unknown,
): value is PublicationAttempt {
  return typeof value === "object"
    && value !== null
    && issuedPublicationAttempts.has(value);
}

export function makeAcceptedQueryPublicationEvidenceForTesting(
  fields: AcceptedQueryPublicationEvidenceFields,
): AcceptedQueryPublicationEvidence {
  return new AdmittedQueryPublicationEvidence(fields);
}

export function admitAcceptedQueryPublicationAttempt(
  attempt: PublicationAttempt,
): AcceptedQueryPublicationEvidence {
  if (!isIssuedPublicationAttempt(attempt)) {
    throw new QuerySyncInvariantDefect({
      operation: "completePublication",
      invariant: "publicationAttemptStateInvalid",
    });
  }
  return new AdmittedQueryPublicationEvidence({
    identity: attempt.publication.identity,
    resultDigest: attempt.publication.resultDigest,
  });
}

export function isAdmittedAcceptedQueryPublicationEvidence(
  value: unknown,
): value is AcceptedQueryPublicationEvidence {
  return typeof value === "object"
    && value !== null
    && admittedPublicationEvidence.has(value);
}

export function attemptedPublicationReceipt(
  tag: "claimed" | "replayed",
  attempt: PublicationAttempt,
): ClaimPublicationReceipt {
  return Object.freeze({ _tag: tag, attempt });
}

export function blockedClaimPublicationReceipt(
  identity: QueryPublicationIdentity,
  attemptOrdinal: PublicationAttemptOrdinal,
  reason: PublicationBlockReason,
): ClaimPublicationReceipt {
  return Object.freeze({
    _tag: "blocked",
    identity: freezeQueryPublicationIdentity(identity),
    attemptOrdinal,
    reason,
    resetRequired: true,
  });
}

export function nonePublicationReceipt(): ClaimPublicationReceipt {
  return Object.freeze({ _tag: "none" });
}

export function recordedPublicationAttemptOutcomeReceipt(input: {
  readonly identity: QueryPublicationIdentity;
  readonly attemptOrdinal: PublicationAttemptOrdinal;
  readonly nextAttemptOrdinal: PublicationAttemptOrdinal;
  readonly nextDisposition: "ready" | "uncertain";
}): RecordPublicationAttemptOutcomeReceipt {
  return Object.freeze({
    _tag: "recorded",
    identity: freezeQueryPublicationIdentity(input.identity),
    attemptOrdinal: input.attemptOrdinal,
    nextAttemptOrdinal: input.nextAttemptOrdinal,
    nextDisposition: input.nextDisposition,
  });
}

export function blockedPublicationAttemptOutcomeReceipt(
  identity: QueryPublicationIdentity,
  attemptOrdinal: PublicationAttemptOrdinal,
  reason: PublicationBlockReason,
): RecordPublicationAttemptOutcomeReceipt {
  return Object.freeze({
    _tag: "blocked",
    identity: freezeQueryPublicationIdentity(identity),
    attemptOrdinal,
    reason,
    resetRequired: true,
  });
}

export function historicalPublicationAttemptOutcomeReceipt(
  tag: "superseded" | "recoveryEvidenceExpired",
  identity: QueryPublicationIdentity,
  attemptOrdinal: PublicationAttemptOrdinal,
): RecordPublicationAttemptOutcomeReceipt {
  return Object.freeze({
    _tag: tag,
    identity: freezeQueryPublicationIdentity(identity),
    attemptOrdinal,
  });
}

export function publicationCompletionReceipt(
  tag: CompletePublicationReceipt["_tag"],
  identity: QueryPublicationIdentity,
): CompletePublicationReceipt {
  return Object.freeze({
    _tag: tag,
    identity: freezeQueryPublicationIdentity(identity),
  });
}
