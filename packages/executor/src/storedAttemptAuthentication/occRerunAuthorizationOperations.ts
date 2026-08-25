import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Duration, Effect, Random, Result } from "effect";

import type {
  CommittedPointOutcomeResolutionV1,
  PointCommitDecisionUncertainV1Error,
  PointCommitOutcomeResolutionV1Error,
  PointCommitPublicationCommandV1,
  PointCommitConflictV1Error,
} from "@flarex/persistence-postgres/point-commit-transaction";
import type { PointMutationSessionAttemptSelectorV1 } from
  "@flarex/persistence-postgres/transaction-session-activation";
import type { TransactionAttemptFence } from
  "flarex-protocol/transaction-session";

import type {
  PointMutationJournalRelationConflictError,
} from "../pointMutationJournal";
import type {
  AuthorizedPointMutationOccRerunInspectionV1,
  StoredPointMutationAttemptReplacementV1,
  StoredPointMutationOccRerunAuthorizationV1,
} from "../storedAttemptAuthentication";
import type {
  HandoffFreshPointMutationAttemptV1,
} from "./attemptReplacementOperations";
import {
  PointMutationOccRerunAuthorityCorruptionV1Error,
} from "./attemptReplacementOperations";
import type {
  AuthorizedPointMutationOccRerunStateV1,
  CapturedPointMutationOccConflictV1,
  PointCommitDecisionUncertainTicketStateV1,
  PointMutationOccConflictTicketStateV1,
  PointMutationOccRetryLineage,
  PointMutationRunningRelationConflictTicketInput,
  PreparedPointCommitCapabilityStateV1,
  StoredPointMutationCapabilityVaultV1,
} from "./capabilityState";
import { capturePointMutationOccRetryLineage } from "./pointCommitRuntimeModel";
import type { FinishingPreparedPointCommitV1 } from "./planningOperations";

export class InvalidPointMutationOccConflictV1Error extends Data.TaggedError(
  "InvalidPointMutationOccConflictV1Error",
)<{
  readonly reason: "notCaptured" | "alreadyConsumed" | "evidenceInvalid";
}> {}

export class PointMutationOccRerunExhaustedV1Error extends Data.TaggedError(
  "PointMutationOccRerunExhaustedV1Error",
)<{
  readonly attemptFence: TransactionAttemptFence;
  readonly maximumReruns: 4;
}> {}

export class InvalidAuthorizedPointMutationOccRerunV1Error
  extends Data.TaggedError("InvalidAuthorizedPointMutationOccRerunV1Error")<{
    readonly reason: "notSameFactory" | "alreadyConsumed";
  }> {}

export interface PointCommitOutcomeTicketCaptureOperationsV1 {
  readonly captureOccConflictTicket: (
    finishing: FinishingPreparedPointCommitV1,
    prepared: PreparedPointCommitCapabilityStateV1,
    error: PointCommitConflictV1Error,
  ) => void;
  readonly captureRunningRelationConflictTicket: (
    error: PointMutationJournalRelationConflictError,
    input: PointMutationRunningRelationConflictTicketInput,
  ) => void;
  readonly captureAndClaimDecisionUncertainTicket: (
    error: PointCommitDecisionUncertainV1Error,
    finishing: FinishingPreparedPointCommitV1,
    prepared: PreparedPointCommitCapabilityStateV1,
    command: PointCommitPublicationCommandV1,
  ) => PointCommitDecisionUncertainTicketStateV1;
}

export interface PointCommitOutcomeTicketCaptureDependenciesV1 {
  readonly decisionUncertainTickets: StoredPointMutationCapabilityVaultV1[
    "decisionUncertainTickets"
  ];
  readonly capturedDecisionUncertainties:
    StoredPointMutationCapabilityVaultV1[
      "capturedDecisionUncertainties"
    ];
  readonly consumedDecisionUncertainties:
    StoredPointMutationCapabilityVaultV1[
      "consumedDecisionUncertainties"
    ];
  readonly occConflictTickets: StoredPointMutationCapabilityVaultV1[
    "occConflictTickets"
  ];
  readonly capturedOccConflicts: StoredPointMutationCapabilityVaultV1[
    "capturedOccConflicts"
  ];
  readonly captureAttemptSelector: (
    prepared: PreparedPointCommitCapabilityStateV1,
  ) => PointMutationSessionAttemptSelectorV1;
}

export function makePointCommitOutcomeTicketCaptureOperationsV1(
  dependencies: PointCommitOutcomeTicketCaptureDependenciesV1,
): PointCommitOutcomeTicketCaptureOperationsV1 {
  const {
    decisionUncertainTickets,
    capturedDecisionUncertainties,
    consumedDecisionUncertainties,
    occConflictTickets,
    capturedOccConflicts,
    captureAttemptSelector,
  } = dependencies;

  const captureOccConflictTicket:
    PointCommitOutcomeTicketCaptureOperationsV1[
      "captureOccConflictTicket"
    ] = (finishing, prepared, error) => {
      if (capturedOccConflicts.has(error)) return;
      capturedOccConflicts.add(error);
      occConflictTickets.set(error, Object.freeze({
        source: "finishingCommit" as const,
        lineage: capturePointMutationOccRetryLineage(prepared),
        finishing,
        prepared,
        conflict: Object.freeze({
          conflict: Object.freeze(structuredClone(error.conflict)),
          snapshotCommitSeq: error.snapshotCommitSeq,
          currentCommitSeq: error.currentCommitSeq,
        }),
      }));
    };

  const captureRunningRelationConflictTicket:
    PointCommitOutcomeTicketCaptureOperationsV1[
      "captureRunningRelationConflictTicket"
    ] = (error, input) => {
      if (capturedOccConflicts.has(error)) return;
      capturedOccConflicts.add(error);
      occConflictTickets.set(error, Object.freeze({
        source: "runningRelation" as const,
        lineage: input.lineage,
        replacement: input.replacement,
        conflict: input.conflict,
      }));
    };

  const captureAndClaimDecisionUncertainTicket:
    PointCommitOutcomeTicketCaptureOperationsV1[
      "captureAndClaimDecisionUncertainTicket"
    ] = (error, finishing, prepared, command) => {
      if (
        capturedDecisionUncertainties.has(error) ||
        consumedDecisionUncertainties.has(error)
      ) {
        throw new Error(
          "A point-commit decision-uncertainty ticket was already consumed.",
        );
      }
      const ticket = Object.freeze({
        finishing,
        prepared,
        selector: captureAttemptSelector(prepared),
        command,
      });
      capturedDecisionUncertainties.add(error);
      decisionUncertainTickets.set(error, ticket);
      const claimed = decisionUncertainTickets.get(error);
      decisionUncertainTickets.delete(error);
      consumedDecisionUncertainties.add(error);
      if (claimed === undefined) {
        throw new Error(
          "A point-commit decision-uncertainty ticket could not be claimed.",
        );
      }
      return claimed;
    };

  return Object.freeze({
    captureOccConflictTicket,
    captureRunningRelationConflictTicket,
    captureAndClaimDecisionUncertainTicket,
  } satisfies PointCommitOutcomeTicketCaptureOperationsV1);
}

export type ResolvePointMutationOccOutcomeObservationV1 = (
  lineage: PointMutationOccRetryLineage,
) => Effect.Effect<
  CommittedPointOutcomeResolutionV1,
  PointCommitOutcomeResolutionV1Error,
  never
>;

export type ClaimAuthorizedPointMutationOccRerunV1 = (
  input: unknown,
) => Result.Result<
  AuthorizedPointMutationOccRerunStateV1,
  InvalidAuthorizedPointMutationOccRerunV1Error
>;

export type ResolvePointMutationOccOutcomeV1 = (
  lineage: PointMutationOccRetryLineage,
) => Effect.Effect<
  CommittedPointOutcomeResolutionV1,
  | PointCommitOutcomeResolutionV1Error
  | PointMutationOccRerunAuthorityCorruptionV1Error,
  never
>;

export interface StoredPointMutationOccRerunAuthorizationOperationsV1 {
  readonly facade: StoredPointMutationOccRerunAuthorizationV1;
  readonly claimAuthorizedPointMutationOccRerun:
    ClaimAuthorizedPointMutationOccRerunV1;
  readonly resolvePointMutationOccOutcome:
    ResolvePointMutationOccOutcomeV1;
}

export interface StoredPointMutationOccRerunAuthorizationDependenciesV1 {
  readonly base: StoredPointMutationAttemptReplacementV1;
  readonly resolvePointMutationOccOutcomeObservation:
    ResolvePointMutationOccOutcomeObservationV1;
  readonly handoffFreshPointMutationAttempt:
    HandoffFreshPointMutationAttemptV1;
  readonly occConflictTickets: StoredPointMutationCapabilityVaultV1[
    "occConflictTickets"
  ];
  readonly consumedOccConflicts: StoredPointMutationCapabilityVaultV1[
    "consumedOccConflicts"
  ];
  readonly authorizedOccRerunStates: StoredPointMutationCapabilityVaultV1[
    "authorizedOccRerunStates"
  ];
  readonly mintedAuthorizedOccReruns: StoredPointMutationCapabilityVaultV1[
    "mintedAuthorizedOccReruns"
  ];
  readonly consumedAuthorizedOccReruns:
    StoredPointMutationCapabilityVaultV1[
      "consumedAuthorizedOccReruns"
    ];
}

export function makeStoredPointMutationOccRerunAuthorizationOperationsV1(
  dependencies: StoredPointMutationOccRerunAuthorizationDependenciesV1,
): StoredPointMutationOccRerunAuthorizationOperationsV1 {
  const {
    base,
    resolvePointMutationOccOutcomeObservation,
    handoffFreshPointMutationAttempt,
    occConflictTickets,
    consumedOccConflicts,
    authorizedOccRerunStates,
    mintedAuthorizedOccReruns,
    consumedAuthorizedOccReruns,
  } = dependencies;

  const resolvePointMutationOccOutcome = Effect.fn(
    "StoredAttemptAuthentication.resolvePointMutationOccOutcome",
  )(function* (lineage: PointMutationOccRetryLineage) {
    const outcome = yield* resolvePointMutationOccOutcomeObservation(lineage);
    if (
      !isNonArrayRecord(outcome) ||
      (outcome.kind !== "missing" &&
        outcome.kind !== "available" &&
        outcome.kind !== "expired")
    ) {
      return yield* Effect.fail(
        new PointMutationOccRerunAuthorityCorruptionV1Error({
          reason: "outcomeObservationInvalid",
        }),
      );
    }
    return outcome;
  });

  const authorizePointMutationOccRerun:
    StoredPointMutationOccRerunAuthorizationV1[
      "authorizePointMutationOccRerun"
    ] = Effect.fn(
      "StoredAttemptAuthentication.authorizePointMutationOccRerun",
    )(function* (input) {
      // The exact error ticket is irreversibly claimed before the first yield.
      const conflictTicket =
        typeof input === "object" && input !== null ? input : undefined;
      if (conflictTicket === undefined) {
        return yield* Effect.fail(
          new InvalidPointMutationOccConflictV1Error({
            reason: "notCaptured",
          }),
        );
      }
      const ticket = occConflictTickets.get(conflictTicket);
      if (ticket === undefined) {
        const alreadyConsumed = consumedOccConflicts.has(conflictTicket);
        return yield* Effect.fail(
          new InvalidPointMutationOccConflictV1Error({
            reason: alreadyConsumed ? "alreadyConsumed" : "notCaptured",
          }),
        );
      }
      occConflictTickets.delete(conflictTicket);
      consumedOccConflicts.add(conflictTicket);

      const lineage = ticket.lineage;
      const pins = lineage.authorityPins;
      const previousSnapshot = pins.snapshotToken;
      const conflict = ticket.conflict;
      const conflictCause = conflict.conflict;
      const sourceEvidenceIsValid = ticket.source === "finishingCommit"
        ? finishingConflictCauseIsBound(ticket, conflictCause)
        : runningRelationConflictEvidenceIsBound(ticket, conflict);
      if (
        conflict.snapshotCommitSeq !== previousSnapshot.commitSeq ||
        conflict.currentCommitSeq <= conflict.snapshotCommitSeq ||
        !sourceEvidenceIsValid
      ) {
        return yield* Effect.fail(
          new InvalidPointMutationOccConflictV1Error({
            reason: "evidenceInvalid",
          }),
        );
      }

      const previousAttemptFence = pins.attemptFence;
      if (previousAttemptFence >= 5n) {
        return yield* Effect.fail(
          new PointMutationOccRerunExhaustedV1Error({
            attemptFence: previousAttemptFence,
            maximumReruns: 4,
          }),
        );
      }
      const consumedReruns = Number(previousAttemptFence - 1n);
      const backoffUpperBoundMilliseconds = Math.min(
        100 * 2 ** consumedReruns,
        2_000,
      );
      const random = yield* Random.next;
      const backoffMilliseconds = random * backoffUpperBoundMilliseconds;
      yield* Effect.sleep(Duration.millis(backoffMilliseconds));

      const outcome = yield* resolvePointMutationOccOutcome(lineage);
      const outcomeKind = outcome.kind;
      if (outcomeKind === "available") {
        return Object.freeze({ kind: "replayed", outcome });
      }
      if (outcomeKind === "expired") {
        return Object.freeze({ kind: "expired", outcome });
      }
      if (outcomeKind !== "missing") {
        return yield* Effect.die(
          new Error("Validated OCC outcome union was not exhaustive."),
        );
      }
      return yield* handoffFreshPointMutationAttempt({
        ticket,
        backoffUpperBoundMilliseconds,
        backoffMilliseconds,
      });
    });

  const claimAuthorizedPointMutationOccRerun:
    ClaimAuthorizedPointMutationOccRerunV1 = (input) => {
      if (typeof input !== "object" || input === null) {
        return Result.fail(
          new InvalidAuthorizedPointMutationOccRerunV1Error({
            reason: "notSameFactory",
          }),
        );
      }
      const state = authorizedOccRerunStates.get(input);
      if (state === undefined) {
        return Result.fail(
          new InvalidAuthorizedPointMutationOccRerunV1Error({
            reason:
              mintedAuthorizedOccReruns.has(input) ||
                consumedAuthorizedOccReruns.has(input)
                ? "alreadyConsumed"
                : "notSameFactory",
          }),
        );
      }
      authorizedOccRerunStates.delete(input);
      consumedAuthorizedOccReruns.add(input);
      return Result.succeed(state);
    };

  const consumeAuthorizedPointMutationOccRerunForTest:
    StoredPointMutationOccRerunAuthorizationV1[
      "consumeAuthorizedPointMutationOccRerunForTest"
    ] = (input) => {
      const state = Result.getOrThrow(
        claimAuthorizedPointMutationOccRerun(input),
      );
      return Object.freeze({
        ...state.inspection,
        previousSnapshotToken: Object.freeze({
          ...state.inspection.previousSnapshotToken,
        }),
        snapshotToken: Object.freeze({ ...state.inspection.snapshotToken }),
      } satisfies AuthorizedPointMutationOccRerunInspectionV1);
    };

  return Object.freeze({
    facade: Object.freeze({
      ...base,
      authorizePointMutationOccRerun,
      consumeAuthorizedPointMutationOccRerunForTest,
    } satisfies StoredPointMutationOccRerunAuthorizationV1),
    claimAuthorizedPointMutationOccRerun,
    resolvePointMutationOccOutcome,
  } satisfies StoredPointMutationOccRerunAuthorizationOperationsV1);
}

function finishingConflictCauseIsBound(
  ticket: Extract<
    PointMutationOccConflictTicketStateV1,
    { readonly source: "finishingCommit" }
  >,
  conflictCause: CapturedPointMutationOccConflictV1["conflict"],
): boolean {
  const prepared = ticket.prepared;
  return conflictCause.kind === "appRowPoint"
    ? prepared.plan.dependencies.some(
        (dependency) => dependency.documentId === conflictCause.documentId,
      )
    : conflictCause.kind === "appIndexRange"
    ? prepared.plan.indexRangeDependencies.some((dependency, ordinal) =>
        ordinal === conflictCause.dependencyOrdinal &&
        dependency.tableId === conflictCause.tableId &&
        dependency.indexDefinitionId === conflictCause.indexDefinitionId
      )
    : prepared.plan.relationDependencies.some((dependency) =>
        dependency.edgeDefinitionId === conflictCause.edgeDefinitionId &&
        dependency.targetRowId === conflictCause.targetRowId
      );
}

function runningRelationConflictEvidenceIsBound(
  ticket: Extract<
    PointMutationOccConflictTicketStateV1,
    { readonly source: "runningRelation" }
  >,
  conflict: CapturedPointMutationOccConflictV1,
): boolean {
  const replacement = ticket.replacement;
  const relationConflict = replacement.conflict;
  const cause = conflict.conflict;
  return cause.kind === "appRelationIncoming" &&
    replacement.authorityPins === ticket.lineage.authorityPins &&
    replacement.session === ticket.lineage.previousSession &&
    replacement.session.lifecycle === "running" &&
    cause.edgeDefinitionId === relationConflict.edgeDefinitionId &&
    cause.targetRowId === relationConflict.targetRowId &&
    conflict.snapshotCommitSeq === relationConflict.snapshotCommitSeq &&
    conflict.currentCommitSeq === relationConflict.actualAdjacencyVersion &&
    relationConflict.expectedAdjacencyVersion <=
      relationConflict.snapshotCommitSeq;
}
