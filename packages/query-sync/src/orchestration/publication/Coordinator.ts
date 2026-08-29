import { Clock, Effect, Result } from "effect";

import type {
  PublicationAttemptOrdinal,
} from "../../kernel/CanonicalValue.js";
import {
  QuerySyncInvariantDefect,
} from "../../kernel/Errors.js";
import type { PublicationBlockReason } from "../../kernel/Model.js";
import {
  freezeQueryPublicationIdentity,
} from "../../kernel/Publication.js";
import type {
  QueryPublicationIdentity,
} from "../../kernel/Publication.js";
import {
  admitAcceptedQueryPublicationAttempt,
} from "../../kernel/PublicationWork.js";
import type {
  PublicationAttempt,
  PublicationAttemptOutcome,
} from "../../kernel/PublicationWork.js";
import type {
  ClaimPublicationReceipt,
  CompletePublicationReceipt,
  RecordPublicationAttemptOutcomeReceipt,
} from "../../state/Receipts.js";
import {
  canStartBefore,
  makeTurnWindow,
  remainingAdmissionMilliseconds,
  runStateOperationWithRetry,
} from "../Turn.js";
import {
  PublicationAuthorityMismatchError,
  PublicationSettlementDeadlineError,
} from "./Errors.js";
import type {
  NamespacePublicationSyncConstructionError,
  PendingPublicationSettlement,
  PublicationWorkTurnError,
} from "./Errors.js";
import {
  captureNamespacePublicationBinding,
  captureNamespacePublicationSyncPolicy,
  capturePublicationTurnBudget,
  freezePublicationWorkTurnProgress,
  makePublicationWorkTurnLedger,
  publicationResetRequiredOutcome,
} from "./Model.js";
import type {
  NamespacePublicationBinding,
  NamespacePublicationSyncPolicy,
  PublicationTurnBudget,
  PublicationWorkContinuationReason,
  PublicationWorkTurnLedger,
  PublicationWorkTurnOutcome,
} from "./Model.js";
import type {
  PublicationDeliveryBudget,
  QuerySyncPublicationState,
  ResultPublisher,
} from "./Ports.js";

export interface NamespacePublicationSyncInput {
  readonly binding: NamespacePublicationBinding;
  readonly state: QuerySyncPublicationState;
  readonly publisher: ResultPublisher;
  readonly policy: NamespacePublicationSyncPolicy;
}

export interface NamespacePublicationSync {
  readonly runPublicationWork: (
    budget: PublicationTurnBudget,
  ) => Effect.Effect<
    PublicationWorkTurnOutcome,
    PublicationWorkTurnError,
    never
  >;
}

type PublisherCallResult =
  | Readonly<{
    readonly _tag: "accepted";
  }>
  | Readonly<{
    readonly _tag: "failed";
    readonly outcome: PublicationAttemptOutcome;
  }>;

function capturePublicationState(
  state: QuerySyncPublicationState,
): QuerySyncPublicationState {
  const claimPublication = state.claimPublication;
  const recordPublicationAttemptOutcome =
    state.recordPublicationAttemptOutcome;
  const completePublication = state.completePublication;
  return Object.freeze({
    claimPublication: () => claimPublication.call(state),
    recordPublicationAttemptOutcome: (attempt, outcome) =>
      recordPublicationAttemptOutcome.call(state, attempt, outcome),
    completePublication: (evidence) =>
      completePublication.call(state, evidence),
  });
}

function captureResultPublisher(publisher: ResultPublisher): ResultPublisher {
  const publish = publisher.publish;
  const capturedPublish: ResultPublisher["publish"] = (
    publication,
    budget,
  ) => publish.call(publisher, publication, budget);
  return Object.freeze({ publish: capturedPublish });
}

function continuation(
  ledger: PublicationWorkTurnLedger,
  reason: PublicationWorkContinuationReason,
): PublicationWorkTurnOutcome {
  return Object.freeze({
    _tag: "continuationRequired",
    reason,
    progress: freezePublicationWorkTurnProgress(ledger),
  });
}

function idle(
  ledger: PublicationWorkTurnLedger,
): PublicationWorkTurnOutcome {
  return Object.freeze({
    _tag: "idle",
    progress: freezePublicationWorkTurnProgress(ledger),
  });
}

function resetRequired(
  ledger: PublicationWorkTurnLedger,
  receipt: Readonly<{
    readonly identity: QueryPublicationIdentity;
    readonly attemptOrdinal: PublicationAttemptOrdinal;
    readonly reason: PublicationBlockReason;
  }>,
): PublicationWorkTurnOutcome {
  return publicationResetRequiredOutcome({
    identity: receipt.identity,
    attemptOrdinal: receipt.attemptOrdinal,
    reason: receipt.reason,
    progress: freezePublicationWorkTurnProgress(ledger),
  });
}

function firstAuthorityMismatch(
  binding: NamespacePublicationBinding,
  identity: QueryPublicationIdentity,
): keyof NamespacePublicationBinding | null {
  if (identity.namespaceId !== binding.namespaceId) return "namespaceId";
  if (identity.syncModelId !== binding.syncModelId) return "syncModelId";
  if (identity.sourceEpoch !== binding.sourceEpoch) return "sourceEpoch";
  return null;
}

function settlementDeadlineError(
  attempt: PublicationAttempt,
  pending: PendingPublicationSettlement,
): PublicationSettlementDeadlineError {
  const capturedPending: PendingPublicationSettlement = pending._tag
      === "completePublication"
    ? Object.freeze({ _tag: "completePublication" })
    : Object.freeze({
      _tag: "recordPublicationAttemptOutcome",
      outcome: pending.outcome,
    });
  return new PublicationSettlementDeadlineError({
    operation: "runPublicationWork",
    reason: "settlementWindowElapsed",
    identity: freezeQueryPublicationIdentity(attempt.publication.identity),
    attemptOrdinal: attempt.attemptOrdinal,
    pending: capturedPending,
  });
}

function observePublisherResult(
  ledger: PublicationWorkTurnLedger,
  result: PublisherCallResult,
): void {
  if (result._tag === "accepted") {
    ledger.acceptedPublisherCalls += 1;
    return;
  }
  switch (result.outcome) {
    case "knownNotAppended":
      ledger.knownNotAppendedPublisherCalls += 1;
      return;
    case "outcomeUnknown":
      ledger.outcomeUnknownPublisherCalls += 1;
      return;
    case "terminalRefusal":
      ledger.terminalRefusalPublisherCalls += 1;
      return;
  }
}

function observeClaim(
  ledger: PublicationWorkTurnLedger,
  claim: Extract<ClaimPublicationReceipt, { readonly _tag: "claimed" | "replayed" }>,
): void {
  if (claim._tag === "claimed") ledger.newlyClaimedAttempts += 1;
  else ledger.replayedAttempts += 1;
}

function observeCompletion(
  ledger: PublicationWorkTurnLedger,
  receipt: CompletePublicationReceipt,
): void {
  switch (receipt._tag) {
    case "completed":
      ledger.completedPublications += 1;
      return;
    case "replayed":
      ledger.replayedCompletions += 1;
      return;
    case "superseded":
      ledger.supersededSettlements += 1;
      return;
  }
}

function observeStaleOutcomeSettlement(
  ledger: PublicationWorkTurnLedger,
  receipt: Extract<
    RecordPublicationAttemptOutcomeReceipt,
    { readonly _tag: "superseded" | "recoveryEvidenceExpired" }
  >,
): void {
  if (receipt._tag === "superseded") {
    ledger.supersededSettlements += 1;
  } else {
    ledger.recoveryEvidenceExpiredSettlements += 1;
  }
}

export function makeNamespacePublicationSync(
  input: NamespacePublicationSyncInput,
): Result.Result<
  NamespacePublicationSync,
  NamespacePublicationSyncConstructionError
> {
  return Result.gen(function* () {
    const binding = yield* captureNamespacePublicationBinding(input.binding);
    const policy = yield* captureNamespacePublicationSyncPolicy(input.policy);
    const state = capturePublicationState(input.state);
    const publisher = captureResultPublisher(input.publisher);

    const runPublicationWork: NamespacePublicationSync["runPublicationWork"] =
      Effect.fn("QuerySync.Namespace.runPublicationWork")(
        function*(budgetInput): Effect.fn.Return<
          PublicationWorkTurnOutcome,
          PublicationWorkTurnError,
          never
        > {
          const budget = yield* Effect.fromResult(capturePublicationTurnBudget(
            budgetInput,
            policy.settlementReserveMilliseconds,
          ));
          const startNanos = yield* Clock.currentTimeNanos;
          const window = makeTurnWindow(
            startNanos,
            budget.newWorkWindowMilliseconds,
            policy.settlementReserveMilliseconds,
          );
          const ledger = makePublicationWorkTurnLedger();

          while (true) {
            if (ledger.publisherCalls >= budget.publisherCalls) {
              return continuation(ledger, "publisherCallLimitReached");
            }
            if (!(yield* canStartBefore(window.admissionCutoffNanos))) {
              return continuation(ledger, "deadlineReached");
            }

            const claim = yield* runStateOperationWithRetry({
              operation: "claimPublication",
              invoke: (): ReturnType<QuerySyncPublicationState["claimPublication"]> =>
                state.claimPublication(),
              policy,
              cutoffNanos: window.admissionCutoffNanos,
              replayUnknown: true,
            });
            if (claim._tag === "none") return idle(ledger);
            if (claim._tag === "blocked") {
              ledger.blockedPublications += 1;
              return resetRequired(ledger, claim);
            }

            observeClaim(ledger, claim);
            const attempt = claim.attempt;
            const mismatch = firstAuthorityMismatch(
              binding,
              attempt.publication.identity,
            );
            if (mismatch !== null) {
              return yield* Effect.fail(new PublicationAuthorityMismatchError({
                operation: "runPublicationWork",
                reason: "boundAuthorityMismatch",
                field: mismatch,
                identity: freezeQueryPublicationIdentity(
                  attempt.publication.identity,
                ),
              }));
            }

            const nowNanos = yield* Clock.currentTimeNanos;
            const maximumSettlementMilliseconds =
              remainingAdmissionMilliseconds(
                window.admissionCutoffNanos,
                nowNanos,
              );
            if (maximumSettlementMilliseconds < 1) {
              return continuation(ledger, "deadlineReached");
            }
            const deliveryBudget: PublicationDeliveryBudget = Object.freeze({
              remainingPublisherCallsIncludingThisCall:
                budget.publisherCalls - ledger.publisherCalls,
              maximumSettlementMilliseconds,
            });
            ledger.publisherCalls += 1;
            const publisherResult = yield* publisher.publish(
              attempt.publication,
              deliveryBudget,
            ).pipe(
              Effect.as(Object.freeze({
                _tag: "accepted",
              }) satisfies PublisherCallResult),
              Effect.catchTags({
                ResultPublisherKnownNotAppendedError: () => Effect.succeed(
                  Object.freeze({
                    _tag: "failed",
                    outcome: "knownNotAppended",
                  }) satisfies PublisherCallResult,
                ),
                ResultPublisherOutcomeUnknownError: () => Effect.succeed(
                  Object.freeze({
                    _tag: "failed",
                    outcome: "outcomeUnknown",
                  }) satisfies PublisherCallResult,
                ),
                ResultPublisherTerminalRefusalError: () => Effect.succeed(
                  Object.freeze({
                    _tag: "failed",
                    outcome: "terminalRefusal",
                  }) satisfies PublisherCallResult,
                ),
              }),
            );
            observePublisherResult(ledger, publisherResult);

            const settlementNowNanos = yield* Clock.currentTimeNanos;
            if (settlementNowNanos >= window.settlementCutoffNanos) {
              const pending: PendingPublicationSettlement =
                publisherResult._tag === "accepted"
                  ? Object.freeze({ _tag: "completePublication" })
                  : Object.freeze({
                    _tag: "recordPublicationAttemptOutcome",
                    outcome: publisherResult.outcome,
                  });
              return yield* Effect.fail(
                settlementDeadlineError(attempt, pending),
              );
            }

            if (publisherResult._tag === "accepted") {
              const evidence = admitAcceptedQueryPublicationAttempt(attempt);
              const receipt = yield* runStateOperationWithRetry({
                operation: "completePublication",
                invoke: (): ReturnType<QuerySyncPublicationState["completePublication"]> =>
                  state.completePublication(evidence),
                policy,
                cutoffNanos: window.settlementCutoffNanos,
                replayUnknown: true,
              });
              observeCompletion(ledger, receipt);
              continue;
            }

            const outcome = publisherResult.outcome;
            const receipt = yield* runStateOperationWithRetry({
              operation: "recordPublicationAttemptOutcome",
              invoke: (): ReturnType<
                QuerySyncPublicationState["recordPublicationAttemptOutcome"]
              > => state.recordPublicationAttemptOutcome(attempt, outcome),
              policy,
              cutoffNanos: window.settlementCutoffNanos,
              replayUnknown: true,
            });
            switch (receipt._tag) {
              case "recorded":
                ledger.recordedAttemptOutcomes += 1;
                if (outcome === "terminalRefusal") {
                  return yield* Effect.die(new QuerySyncInvariantDefect({
                    operation: "recordPublicationAttemptOutcome",
                    invariant: "publicationAttemptStateInvalid",
                  }));
                }
                return continuation(ledger, "publicationOutcomeRecorded");
              case "blocked":
                ledger.blockedPublications += 1;
                return resetRequired(ledger, receipt);
              case "superseded":
              case "recoveryEvidenceExpired":
                observeStaleOutcomeSettlement(ledger, receipt);
                continue;
            }
          }
        },
      );

    return Object.freeze({ runPublicationWork });
  });
}
