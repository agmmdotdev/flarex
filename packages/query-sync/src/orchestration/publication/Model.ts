import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { Result } from "effect";

import {
  captureSyncEpoch,
  captureSyncModelId,
  captureSyncNamespaceId,
} from "../../kernel/CanonicalValue.js";
import type {
  PublicationAttemptOrdinal,
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
} from "../../kernel/CanonicalValue.js";
import type { PublicationBlockReason } from "../../kernel/Model.js";
import type { QuerySyncCanonicalValueError } from "../../kernel/Errors.js";
import {
  freezeQueryPublicationIdentity,
} from "../../kernel/Publication.js";
import type {
  QueryPublicationIdentity,
} from "../../kernel/Publication.js";
import {
  MAX_RETRY_DELAY_MILLISECONDS,
  MAX_STATE_ATTEMPTS_PER_OPERATION,
  MAX_TURN_WINDOW_MILLISECONDS,
} from "../Model.js";
import {
  InvalidNamespacePublicationSyncPolicyError,
  InvalidPublicationTurnBudgetError,
} from "./Errors.js";

export const MAX_TURN_PUBLISHER_CALLS = 32;

export interface NamespacePublicationBinding {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
}

export interface NamespacePublicationSyncPolicy {
  readonly stateAttemptsPerOperation: number;
  readonly retryDelayMilliseconds: readonly [number, number];
  readonly settlementReserveMilliseconds: number;
}

export interface PublicationTurnBudget {
  readonly publisherCalls: number;
  readonly newWorkWindowMilliseconds: number;
}

export type PublicationWorkContinuationReason =
  | "deadlineReached"
  | "publisherCallLimitReached"
  | "publicationOutcomeRecorded";

export interface PublicationWorkTurnProgress {
  readonly newlyClaimedAttempts: number;
  readonly replayedAttempts: number;
  readonly publisherCalls: number;
  readonly acceptedPublisherCalls: number;
  readonly knownNotAppendedPublisherCalls: number;
  readonly outcomeUnknownPublisherCalls: number;
  readonly terminalRefusalPublisherCalls: number;
  readonly recordedAttemptOutcomes: number;
  readonly completedPublications: number;
  readonly replayedCompletions: number;
  readonly supersededSettlements: number;
  readonly recoveryEvidenceExpiredSettlements: number;
  readonly blockedPublications: number;
}

export interface PublicationWorkTurnLedger {
  newlyClaimedAttempts: number;
  replayedAttempts: number;
  publisherCalls: number;
  acceptedPublisherCalls: number;
  knownNotAppendedPublisherCalls: number;
  outcomeUnknownPublisherCalls: number;
  terminalRefusalPublisherCalls: number;
  recordedAttemptOutcomes: number;
  completedPublications: number;
  replayedCompletions: number;
  supersededSettlements: number;
  recoveryEvidenceExpiredSettlements: number;
  blockedPublications: number;
}

export type PublicationWorkTurnOutcome =
  | Readonly<{
    readonly _tag: "idle";
    readonly progress: PublicationWorkTurnProgress;
  }>
  | Readonly<{
    readonly _tag: "continuationRequired";
    readonly reason: PublicationWorkContinuationReason;
    readonly progress: PublicationWorkTurnProgress;
  }>
  | Readonly<{
    readonly _tag: "publicationResetRequired";
    readonly identity: QueryPublicationIdentity;
    readonly attemptOrdinal: PublicationAttemptOrdinal;
    readonly reason: PublicationBlockReason;
    readonly resetRequired: true;
    readonly progress: PublicationWorkTurnProgress;
  }>;

function policyFailure(
  field: keyof NamespacePublicationSyncPolicy,
  reason: InvalidNamespacePublicationSyncPolicyError["reason"],
): Result.Result<never, InvalidNamespacePublicationSyncPolicyError> {
  return Result.fail(new InvalidNamespacePublicationSyncPolicyError({
    operation: "makeNamespacePublicationSync",
    field,
    reason,
  }));
}

export function captureNamespacePublicationBinding(
  input: NamespacePublicationBinding,
): Result.Result<NamespacePublicationBinding, QuerySyncCanonicalValueError> {
  return Result.gen(function* () {
    const namespaceId = yield* captureSyncNamespaceId(input.namespaceId);
    const syncModelId = yield* captureSyncModelId(input.syncModelId);
    const sourceEpoch = yield* captureSyncEpoch(input.sourceEpoch);
    return Object.freeze({ namespaceId, syncModelId, sourceEpoch });
  });
}

export function captureNamespacePublicationSyncPolicy(
  input: NamespacePublicationSyncPolicy,
): Result.Result<
  NamespacePublicationSyncPolicy,
  InvalidNamespacePublicationSyncPolicyError
> {
  const stateAttemptsPerOperation = input.stateAttemptsPerOperation;
  if (!isPositiveSafeInteger(stateAttemptsPerOperation)) {
    return policyFailure("stateAttemptsPerOperation", "invalidValue");
  }
  if (stateAttemptsPerOperation > MAX_STATE_ATTEMPTS_PER_OPERATION) {
    return policyFailure("stateAttemptsPerOperation", "aboveHardMaximum");
  }

  const delays = input.retryDelayMilliseconds;
  if (!Array.isArray(delays) || delays.length !== 2) {
    return policyFailure("retryDelayMilliseconds", "invalidPair");
  }
  const firstDelay = delays[0];
  const secondDelay = delays[1];
  if (
    !isNonNegativeSafeInteger(firstDelay)
    || !isNonNegativeSafeInteger(secondDelay)
  ) {
    return policyFailure("retryDelayMilliseconds", "invalidPair");
  }
  if (
    firstDelay > MAX_RETRY_DELAY_MILLISECONDS
    || secondDelay > MAX_RETRY_DELAY_MILLISECONDS
  ) {
    return policyFailure("retryDelayMilliseconds", "aboveHardMaximum");
  }

  const settlementReserveMilliseconds = input.settlementReserveMilliseconds;
  if (!isPositiveSafeInteger(settlementReserveMilliseconds)) {
    return policyFailure("settlementReserveMilliseconds", "invalidValue");
  }
  if (settlementReserveMilliseconds >= MAX_TURN_WINDOW_MILLISECONDS) {
    return policyFailure(
      "settlementReserveMilliseconds",
      "aboveHardMaximum",
    );
  }

  const retryDelayMilliseconds: readonly [number, number] = Object.freeze([
    firstDelay,
    secondDelay,
  ]);
  return Result.succeed(Object.freeze({
    stateAttemptsPerOperation,
    retryDelayMilliseconds,
    settlementReserveMilliseconds,
  }));
}

function budgetFailure(
  field: keyof PublicationTurnBudget,
  reason: InvalidPublicationTurnBudgetError["reason"],
  observed: number,
): Result.Result<never, InvalidPublicationTurnBudgetError> {
  return Result.fail(new InvalidPublicationTurnBudgetError({
    operation: "runPublicationWork",
    field,
    reason,
    observed,
  }));
}

export function capturePublicationTurnBudget(
  input: PublicationTurnBudget,
  settlementReserveMilliseconds: number,
): Result.Result<PublicationTurnBudget, InvalidPublicationTurnBudgetError> {
  const publisherCalls = input.publisherCalls;
  if (!isPositiveSafeInteger(publisherCalls)) {
    return budgetFailure("publisherCalls", "invalidValue", publisherCalls);
  }
  if (publisherCalls > MAX_TURN_PUBLISHER_CALLS) {
    return budgetFailure(
      "publisherCalls",
      "aboveHardMaximum",
      publisherCalls,
    );
  }

  const newWorkWindowMilliseconds = input.newWorkWindowMilliseconds;
  if (!isPositiveSafeInteger(newWorkWindowMilliseconds)) {
    return budgetFailure(
      "newWorkWindowMilliseconds",
      "invalidValue",
      newWorkWindowMilliseconds,
    );
  }
  if (newWorkWindowMilliseconds > MAX_TURN_WINDOW_MILLISECONDS) {
    return budgetFailure(
      "newWorkWindowMilliseconds",
      "aboveHardMaximum",
      newWorkWindowMilliseconds,
    );
  }
  if (newWorkWindowMilliseconds <= settlementReserveMilliseconds) {
    return budgetFailure(
      "newWorkWindowMilliseconds",
      "notGreaterThanSettlementReserve",
      newWorkWindowMilliseconds,
    );
  }
  return Result.succeed(Object.freeze({
    publisherCalls,
    newWorkWindowMilliseconds,
  }));
}

export function makePublicationWorkTurnLedger(): PublicationWorkTurnLedger {
  return {
    newlyClaimedAttempts: 0,
    replayedAttempts: 0,
    publisherCalls: 0,
    acceptedPublisherCalls: 0,
    knownNotAppendedPublisherCalls: 0,
    outcomeUnknownPublisherCalls: 0,
    terminalRefusalPublisherCalls: 0,
    recordedAttemptOutcomes: 0,
    completedPublications: 0,
    replayedCompletions: 0,
    supersededSettlements: 0,
    recoveryEvidenceExpiredSettlements: 0,
    blockedPublications: 0,
  };
}

export function freezePublicationWorkTurnProgress(
  ledger: PublicationWorkTurnLedger,
): PublicationWorkTurnProgress {
  return Object.freeze({
    newlyClaimedAttempts: ledger.newlyClaimedAttempts,
    replayedAttempts: ledger.replayedAttempts,
    publisherCalls: ledger.publisherCalls,
    acceptedPublisherCalls: ledger.acceptedPublisherCalls,
    knownNotAppendedPublisherCalls:
      ledger.knownNotAppendedPublisherCalls,
    outcomeUnknownPublisherCalls: ledger.outcomeUnknownPublisherCalls,
    terminalRefusalPublisherCalls: ledger.terminalRefusalPublisherCalls,
    recordedAttemptOutcomes: ledger.recordedAttemptOutcomes,
    completedPublications: ledger.completedPublications,
    replayedCompletions: ledger.replayedCompletions,
    supersededSettlements: ledger.supersededSettlements,
    recoveryEvidenceExpiredSettlements:
      ledger.recoveryEvidenceExpiredSettlements,
    blockedPublications: ledger.blockedPublications,
  });
}

export function publicationResetRequiredOutcome(input: {
  readonly identity: QueryPublicationIdentity;
  readonly attemptOrdinal: PublicationAttemptOrdinal;
  readonly reason: PublicationBlockReason;
  readonly progress: PublicationWorkTurnProgress;
}): PublicationWorkTurnOutcome {
  return Object.freeze({
    _tag: "publicationResetRequired",
    identity: freezeQueryPublicationIdentity(input.identity),
    attemptOrdinal: input.attemptOrdinal,
    reason: input.reason,
    resetRequired: true,
    progress: input.progress,
  });
}
