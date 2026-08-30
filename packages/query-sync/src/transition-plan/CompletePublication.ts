import { Result } from "effect";

import {
  InvalidAcceptedPublicationEvidenceError,
} from "../kernel/Errors.js";
import type { QuerySyncAuthorityError } from "../kernel/Errors.js";
import type {
  DeliveredQueryPublication,
  InFlightQueryPublication,
} from "../kernel/Model.js";
import { validateQuerySyncAuthority } from "../kernel/Authority.js";
import {
  queryPublicationIdentityEquals,
} from "../kernel/Publication.js";
import {
  applyMetricReplacement,
  emptyMetricContribution,
  publicationLifecycleMetricContribution,
  retainedPublicationMetricContribution,
} from "./Accounting.js";
import { QuerySyncTransitionFactError } from "./Errors.js";
import {
  freezeDeliveredQueryPublicationFacts,
  freezePublicationLifecycleFacts,
  freezePublicationOwnerQueryFacts,
} from "./PublicationFacts.js";
import type {
  PublicationLifecycleFacts,
  PublicationOwnerQueryFacts,
} from "./PublicationFacts.js";
import {
  validatePublicationLifecycleFacts,
  validatePublicationOwnerFacts,
} from "./PublicationInvariants.js";
import {
  isAdmittedAcceptedQueryPublicationEvidence,
  publicationCompletionReceipt,
} from "./PublicationWork.js";
import type {
  AcceptedQueryPublicationEvidence,
  CompletePublicationReceipt,
} from "./PublicationWork.js";
import { freezeScopeFacts } from "./Model.js";
import type {
  QuerySyncScopeFacts,
  TransitionPlan,
} from "./Model.js";

export interface CompletePublicationExpectation {
  readonly scope: QuerySyncScopeFacts;
  readonly lifecycle: PublicationLifecycleFacts;
  readonly owner: PublicationOwnerQueryFacts | null;
}

export interface CompleteInFlightPublicationChange {
  readonly _tag: "completeInFlightPublication";
  readonly inFlight: InFlightQueryPublication;
  readonly latestDelivered: DeliveredQueryPublication;
}

export type CompletePublicationPlan = TransitionPlan<
  CompletePublicationReceipt,
  CompletePublicationExpectation,
  CompleteInFlightPublicationChange
>;

export type PlanCompletePublicationError =
  | QuerySyncAuthorityError<"completePublication">
  | InvalidAcceptedPublicationEvidenceError
  | QuerySyncTransitionFactError;

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

export interface AuthenticatedCompletePublicationTarget {
  readonly evidence: AcceptedQueryPublicationEvidence;
  readonly queryKey: AcceptedQueryPublicationEvidence["identity"]["queryKey"];
}

export function authenticateCompletePublicationEvidence(
  value: unknown,
): Result.Result<
  AuthenticatedCompletePublicationTarget,
  InvalidAcceptedPublicationEvidenceError
> {
  if (!isAdmittedAcceptedQueryPublicationEvidence(value)) {
    return Result.fail(invalidUnissuedAcceptanceEvidence());
  }
  return Result.succeed(Object.freeze({
    evidence: value,
    queryKey: value.identity.queryKey,
  }));
}

function noWritePlan(
  receipt: CompletePublicationReceipt,
): CompletePublicationPlan {
  return Object.freeze({ _tag: "noWrite", receipt });
}

function ownerFactFailure(): QuerySyncTransitionFactError {
  return new QuerySyncTransitionFactError({
    operation: "completePublication",
    reason: "publicationOwnerFactsInvalid",
  });
}

function requireMatchingOwner(
  scope: QuerySyncScopeFacts,
  lifecycle: PublicationLifecycleFacts,
  ownerInput: PublicationOwnerQueryFacts | null,
  evidence: AcceptedQueryPublicationEvidence,
): Result.Result<PublicationOwnerQueryFacts, QuerySyncTransitionFactError> {
  if (ownerInput === null) return Result.fail(ownerFactFailure());
  const owner = freezePublicationOwnerQueryFacts(ownerInput);
  return validatePublicationOwnerFacts(
    "completePublication",
    scope,
    lifecycle,
    owner,
    evidence.identity,
  ).pipe(Result.map(() => owner));
}

export function planCompletePublication(input: {
  readonly scope: QuerySyncScopeFacts;
  readonly lifecycle: PublicationLifecycleFacts;
  readonly owner: PublicationOwnerQueryFacts | null;
  readonly evidence: AcceptedQueryPublicationEvidence;
}): Result.Result<
  CompletePublicationPlan,
  PlanCompletePublicationError
> {
  return Result.gen(function* () {
    // Capability authenticity deliberately precedes every evidence field read.
    const authenticated = yield* authenticateCompletePublicationEvidence(
      input.evidence,
    );
    const evidence = authenticated.evidence;
    const scope = freezeScopeFacts(input.scope);
    const lifecycle = freezePublicationLifecycleFacts(input.lifecycle);
    yield* validateQuerySyncAuthority(
      "completePublication",
      scope.cursor,
      evidence.identity,
    );
    yield* validatePublicationLifecycleFacts(
      "completePublication",
      scope,
      lifecycle,
    );

    const current = lifecycle.inFlight;
    if (
      current !== null
      && queryPublicationIdentityEquals(
        current.publication.identity,
        evidence.identity,
      )
    ) {
      const owner = yield* requireMatchingOwner(
        scope,
        lifecycle,
        input.owner,
        evidence,
      );
      if (current.publication.resultDigest !== evidence.resultDigest) {
        return yield* Result.fail(invalidAcceptanceDigest(evidence));
      }
      const latestDelivered = freezeDeliveredQueryPublicationFacts({
        identity: current.publication.identity,
        resultDigest: current.publication.resultDigest,
      });
      const nextLifecycle = freezePublicationLifecycleFacts({
        ...lifecycle,
        inFlight: null,
        latestDelivered,
      });
      let nextMetrics = applyMetricReplacement(
        scope.metrics,
        retainedPublicationMetricContribution(
          current.publication,
          "inFlight",
        ),
        emptyMetricContribution(),
      );
      nextMetrics = applyMetricReplacement(
        nextMetrics,
        publicationLifecycleMetricContribution(lifecycle),
        publicationLifecycleMetricContribution(nextLifecycle),
      );
      const nextScope = freezeScopeFacts({
        cursor: scope.cursor,
        evaluationWork: scope.evaluationWork,
        metrics: nextMetrics,
      });
      yield* validatePublicationLifecycleFacts(
        "completePublication",
        nextScope,
        nextLifecycle,
      );
      return Object.freeze({
        _tag: "write",
        receipt: publicationCompletionReceipt(
          "completed",
          current.publication.identity,
        ),
        expected: Object.freeze({ scope, lifecycle, owner }),
        nextScope,
        change: Object.freeze({
          _tag: "completeInFlightPublication",
          inFlight: current,
          latestDelivered,
        }),
      });
    }

    const delivered = lifecycle.latestDelivered;
    if (
      delivered !== null
      && queryPublicationIdentityEquals(delivered.identity, evidence.identity)
    ) {
      yield* requireMatchingOwner(scope, lifecycle, input.owner, evidence);
      if (delivered.resultDigest !== evidence.resultDigest) {
        return yield* Result.fail(invalidAcceptanceDigest(evidence));
      }
      return noWritePlan(publicationCompletionReceipt(
        "replayed",
        delivered.identity,
      ));
    }
    return noWritePlan(publicationCompletionReceipt(
      "superseded",
      evidence.identity,
    ));
  });
}
