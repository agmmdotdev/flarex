import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { Data, Effect, Result } from "effect";
import {
  decodeDeclarativeV2TerminalAuthorityProofV1,
} from "flarex-protocol/internal/declarative-v2-terminal-authority-proof-v1";
import {
  encodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierDurableCommandKindV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierCommandReceiptFrameV2,
  type DeclarativeV2VerifierCommandReservationFrameV2,
  type DeclarativeV2VerifierProgressCursorFrameV2,
  type DeclarativeV2VerifierProgressV2Error,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import {
  makeLiveDeclarativeV2Sha256V1,
  type DeclarativeV2Sha256V1,
  type DeclarativeV2Sha256V1Error,
} from "./declarativeV2Sha256";
import {
  type DeclarativeV2VerifierProgressAttemptSnapshotV2,
  type DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  type DeclarativeV2VerifierProgressRepositoryOperationUsageV2,
  type DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  type DeclarativeV2VerifierProgressRepositoryPageOperationUsageV2,
  type DeclarativeV2VerifierProgressAppendEvidencePageInputV2,
  type DeclarativeV2VerifierProgressEvidencePageSnapshotV2,
  type DeclarativeV2VerifierProgressReadEvidencePageBatchInputV2,
  type DeclarativeV2VerifierProgressReadSettledEvidencePageBatchInputV2,
  type DeclarativeV2VerifierProgressRepositoryV2,
  type DeclarativeV2VerifierProgressRepositoryV2Error,
  type DeclarativeV2VerifierProgressRunV2,
  type DeclarativeV2VerifierProgressCommandDecisionV2,
  type DeclarativeV2VerifierProgressSettlementSnapshotV2,
  type DeclarativeV2VerifierProgressWorkV2,
} from "./declarativeV2VerifierProgressRepositoryV2";

export type {
  DeclarativeV2VerifierProgressEvidencePageSnapshotV2,
  DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  DeclarativeV2VerifierProgressSettlementSnapshotV2,
} from "./declarativeV2VerifierProgressRepositoryV2";
export {
  DeclarativeV2VerifierProgressRepositoryConfirmedRollbackV2Error,
} from "./declarativeV2VerifierProgressRepositoryV2";

const PROPOSAL_MARKER =
  Symbol("AuthenticatedDeclarativeV2CommandReservationProposalV1");
const READY_RESERVATION_MARKER =
  Symbol("AuthenticatedDeclarativeV2CommandReadyReservationV1");
const FRAME_BUDGET = Object.freeze({
  maximumFrameBytes: 1_048_576,
  maximumCanonicalBytes: 1_048_576,
});

export interface AuthenticatedDeclarativeV2CommandSessionV1 {
  readonly _tag: "AuthenticatedDeclarativeV2CommandSessionV1";
}

export interface AuthenticatedDeclarativeV2CommandWorkV1 {
  readonly _tag: "AuthenticatedDeclarativeV2CommandWorkV1";
}

export interface AuthenticatedDeclarativeV2CommandReservationProposalV1 {
  readonly [PROPOSAL_MARKER]: true;
}

export interface AuthenticatedDeclarativeV2CommandReadyReservationV1 {
  readonly [READY_RESERVATION_MARKER]: true;
}

export interface AuthenticatedDeclarativeV2CommandReservationLineageV1 {
  readonly attemptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly commandKind: DeclarativeV2VerifierDurableCommandKindV2;
  readonly sequence: bigint;
  readonly currentProgressSha256: Uint8Array;
  readonly predecessorReceiptSha256: Uint8Array | null;
}

export interface AuthenticatedDeclarativeV2PreparedReservationClaimV1 {
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  };
  readonly commitments: Readonly<{
    readonly commandBudgetSha256: Uint8Array;
    readonly commandInputSha256: Uint8Array;
    readonly freshAuthenticatedInputSha256: Uint8Array;
    readonly analyzerIdentitySha256: Uint8Array;
    readonly verifierIdentitySha256: Uint8Array;
    readonly rangeAndPredecessorTailsSha256: Uint8Array;
  }>;
}

export interface AuthenticatedDeclarativeV2PreparedReservationClaimPortV1<
  ClaimFailure,
> {
  readonly claim: (
    authority: unknown,
    lineage: AuthenticatedDeclarativeV2CommandReservationLineageV1,
  ) => Effect.Effect<
    AuthenticatedDeclarativeV2PreparedReservationClaimV1,
    ClaimFailure,
    never
  >;
}

export class AuthenticatedDeclarativeV2CommandBridgeV1Error
  extends Data.TaggedError("AuthenticatedDeclarativeV2CommandBridgeV1Error")<{
    readonly operation:
      | "reserve"
      | "resume"
      | "proposeReservation"
      | "prepareReservation"
      | "reservePrepared"
      | "appendEvidencePage"
      | "readEvidencePageBatch"
      | "readSettledEvidencePageBatch"
      | "settle"
      | "observeDecision"
      | "release";
    readonly reason:
      | "invalidSession"
      | "invalidWork"
      | "invalidProposal"
      | "invalidReadyReservation"
      | "missingClaimPort"
      | "commandMismatch"
      | "closed"
      | "settlementNotAttempted"
      | "decisionMismatch";
  }> {}

export type AuthenticatedDeclarativeV2CommandBridgeV1Failure<
  ClaimFailure = never,
> =
  | AuthenticatedDeclarativeV2CommandBridgeV1Error
  | DeclarativeV2VerifierProgressRepositoryV2Error
  | DeclarativeV2VerifierProgressV2Error
  | DeclarativeV2Sha256V1Error
  | ClaimFailure;

export interface AuthenticatedDeclarativeV2CommandReserveInputV1 {
  readonly reservation: DeclarativeV2VerifierCommandReservationFrameV2;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  };
  readonly futureRegistrationIntentBytes: Uint8Array | null;
}

export interface AuthenticatedDeclarativeV2CommandSettlementInputV1 {
  readonly outputManifest: DeclarativeV2VerifierCommandOutputManifestFrameV2;
  readonly commandUsage: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  };
  readonly resultingUsage: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_usage";
  };
  readonly nextProgress: DeclarativeV2VerifierProgressCursorFrameV2;
  readonly receipt: DeclarativeV2VerifierCommandReceiptFrameV2;
  readonly terminalProofBytes: Uint8Array;
}

export interface AuthenticatedDeclarativeV2CommandBridgeV1<
  ClaimFailure = never,
> {
  readonly acquire: (
    scopeId: string,
    attemptSha256: Uint8Array,
    budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  ) => Effect.Effect<
    Readonly<{
      readonly session: AuthenticatedDeclarativeV2CommandSessionV1;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
    }>,
    DeclarativeV2VerifierProgressRepositoryV2Error,
    never
  >;
  readonly proposeReservation: (
    session: AuthenticatedDeclarativeV2CommandSessionV1,
    commandKind: DeclarativeV2VerifierDurableCommandKindV2,
  ) => Effect.Effect<
    Readonly<{
      readonly proposal:
        AuthenticatedDeclarativeV2CommandReservationProposalV1;
      readonly lineage:
        AuthenticatedDeclarativeV2CommandReservationLineageV1;
    }>,
    AuthenticatedDeclarativeV2CommandBridgeV1Error,
    never
  >;
  readonly prepareReservation: (
    session: AuthenticatedDeclarativeV2CommandSessionV1,
    proposal: AuthenticatedDeclarativeV2CommandReservationProposalV1,
    preparedAuthority: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly ready:
        AuthenticatedDeclarativeV2CommandReadyReservationV1;
      readonly reservation: DeclarativeV2VerifierCommandReservationFrameV2;
      readonly reservationSha256: Uint8Array;
    }>,
    AuthenticatedDeclarativeV2CommandBridgeV1Failure<ClaimFailure>,
    never
  >;
  readonly reservePrepared: (
    ready: AuthenticatedDeclarativeV2CommandReadyReservationV1,
    futureRegistrationIntentBytes: Uint8Array | null,
    budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  ) => Effect.Effect<
    Readonly<{
      readonly kind: "reserved" | "pendingReplay";
      readonly work: AuthenticatedDeclarativeV2CommandWorkV1;
      readonly reservation: DeclarativeV2VerifierCommandReservationFrameV2;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
    }>,
    AuthenticatedDeclarativeV2CommandBridgeV1Failure,
    never
  >;
  readonly reserve: (
    session: AuthenticatedDeclarativeV2CommandSessionV1,
    input: AuthenticatedDeclarativeV2CommandReserveInputV1,
    budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  ) => Effect.Effect<
    Readonly<{
      readonly kind: "reserved" | "pendingReplay";
      readonly work: AuthenticatedDeclarativeV2CommandWorkV1;
      readonly reservation: DeclarativeV2VerifierCommandReservationFrameV2;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
    }>,
    AuthenticatedDeclarativeV2CommandBridgeV1Failure,
    never
  >;
  readonly resume: (
    session: AuthenticatedDeclarativeV2CommandSessionV1,
    input: AuthenticatedDeclarativeV2CommandReserveInputV1,
    budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  ) => Effect.Effect<
    Readonly<{
      readonly work: AuthenticatedDeclarativeV2CommandWorkV1;
      readonly reservation: DeclarativeV2VerifierCommandReservationFrameV2;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
    }>,
    AuthenticatedDeclarativeV2CommandBridgeV1Failure,
    never
  >;
  readonly appendEvidencePage: (
    work: AuthenticatedDeclarativeV2CommandWorkV1,
    input: DeclarativeV2VerifierProgressAppendEvidencePageInputV2,
    budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  ) => Effect.Effect<
    Readonly<{
      readonly pageSha256: Uint8Array;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryPageOperationUsageV2;
    }>,
    AuthenticatedDeclarativeV2CommandBridgeV1Failure,
    never
  >;
  readonly readEvidencePageBatch: (
    work: AuthenticatedDeclarativeV2CommandWorkV1,
    input: DeclarativeV2VerifierProgressReadEvidencePageBatchInputV2,
    budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  ) => Effect.Effect<
    Readonly<{
      readonly pages:
        ReadonlyArray<DeclarativeV2VerifierProgressEvidencePageSnapshotV2>;
      readonly nextPageOrdinal: bigint | null;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryPageOperationUsageV2;
    }>,
    AuthenticatedDeclarativeV2CommandBridgeV1Failure,
    never
  >;
  readonly readSettledEvidencePageBatch: (
    session: AuthenticatedDeclarativeV2CommandSessionV1,
    input: Omit<
      DeclarativeV2VerifierProgressReadSettledEvidencePageBatchInputV2,
      "scopeId" | "attemptSha256"
    >,
    budget: DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  ) => Effect.Effect<
    Readonly<{
      readonly settlement:
        DeclarativeV2VerifierProgressSettlementSnapshotV2;
      readonly pages:
        ReadonlyArray<DeclarativeV2VerifierProgressEvidencePageSnapshotV2>;
      readonly next: Readonly<{
        readonly startPageOrdinal: bigint;
        readonly expectedPredecessorPageSha256: Uint8Array;
      }> | null;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryPageOperationUsageV2;
    }>,
    AuthenticatedDeclarativeV2CommandBridgeV1Failure,
    never
  >;
  readonly settle: (
    work: AuthenticatedDeclarativeV2CommandWorkV1,
    input: AuthenticatedDeclarativeV2CommandSettlementInputV1,
    budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  ) => Effect.Effect<
    Readonly<{
      readonly settlement:
        DeclarativeV2VerifierProgressSettlementSnapshotV2;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
    }>,
    AuthenticatedDeclarativeV2CommandBridgeV1Failure,
    never
  >;
  readonly observeDecision: (
    work: AuthenticatedDeclarativeV2CommandWorkV1,
    budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  ) => Effect.Effect<
    Readonly<{
      readonly decision: DeclarativeV2VerifierProgressCommandDecisionV2;
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
    }>,
    AuthenticatedDeclarativeV2CommandBridgeV1Failure,
    never
  >;
  readonly release: (
    session: AuthenticatedDeclarativeV2CommandSessionV1,
    budget: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  ) => Effect.Effect<
    Readonly<{
      readonly operationUsage:
        DeclarativeV2VerifierProgressRepositoryOperationUsageV2;
    }>,
    AuthenticatedDeclarativeV2CommandBridgeV1Failure,
    never
  >;
}

interface SessionState {
  readonly run: DeclarativeV2VerifierProgressRunV2;
  readonly scopeId: string;
  readonly attemptSha256: Uint8Array;
  attempt: DeclarativeV2VerifierProgressAttemptSnapshotV2;
  closed: boolean;
}

interface ProposalState {
  readonly session: AuthenticatedDeclarativeV2CommandSessionV1;
  readonly lineage: AuthenticatedDeclarativeV2CommandReservationLineageV1;
  readonly pendingReplay: boolean;
  consumed: boolean;
}

interface ReadyReservationState {
  readonly session: AuthenticatedDeclarativeV2CommandSessionV1;
  readonly reservation: DeclarativeV2VerifierCommandReservationFrameV2;
  readonly commandBudget: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  };
  readonly pendingReplay: boolean;
  consumed: boolean;
}

interface WorkState {
  readonly session: AuthenticatedDeclarativeV2CommandSessionV1;
  readonly work: DeclarativeV2VerifierProgressWorkV2;
  readonly sequence: bigint;
  readonly reservationSha256: Uint8Array;
  terminalProofBytes: Uint8Array | undefined;
  closed: boolean;
}

export function makeAuthenticatedDeclarativeV2CommandBridgeV1<
  ClaimFailure = never,
>(
  repository: DeclarativeV2VerifierProgressRepositoryV2,
  options: Readonly<{
    readonly preparedReservations?:
      AuthenticatedDeclarativeV2PreparedReservationClaimPortV1<ClaimFailure>;
    readonly sha256?: DeclarativeV2Sha256V1;
  }> = {},
): AuthenticatedDeclarativeV2CommandBridgeV1<ClaimFailure> {
  const sessions = new WeakMap<object, SessionState>();
  const works = new WeakMap<object, WorkState>();
  const proposals = new WeakMap<object, ProposalState>();
  const readyReservations = new WeakMap<object, ReadyReservationState>();
  const sha256 = options.sha256 ?? makeLiveDeclarativeV2Sha256V1();

  const acquire: AuthenticatedDeclarativeV2CommandBridgeV1["acquire"] =
    Effect.fn("AuthenticatedDeclarativeV2CommandBridgeV1.acquire")(
      function* (scopeId, attemptSha256, budget) {
        const selectorAttemptSha256 = new Uint8Array(attemptSha256);
        const acquired = yield* repository.acquire(
          scopeId,
          selectorAttemptSha256,
          budget,
        );
        const session = Object.freeze({
          _tag: "AuthenticatedDeclarativeV2CommandSessionV1" as const,
        });
        sessions.set(session, {
          run: acquired.run,
          scopeId,
          attemptSha256: selectorAttemptSha256,
          attempt: acquired.attempt,
          closed: false,
        });
        return Object.freeze({
          session,
          operationUsage: acquired.operationUsage,
        });
      },
    );

  const proposeReservation:
    AuthenticatedDeclarativeV2CommandBridgeV1<ClaimFailure>[
      "proposeReservation"
    ] = Effect.fn(
      "AuthenticatedDeclarativeV2CommandBridgeV1.proposeReservation",
    )(function* (session, commandKind) {
      const state = yield* lookupSession(
        sessions,
        session,
        "proposeReservation",
      );
      if (
        state.attempt.pendingKind !== null &&
        state.attempt.pendingKind !== commandKind
      ) {
        return yield* new AuthenticatedDeclarativeV2CommandBridgeV1Error({
          operation: "proposeReservation",
          reason: "commandMismatch",
        });
      }
      const pendingReplay = state.attempt.pendingKind !== null;
      const sequence = pendingReplay
        ? state.attempt.pendingSequence
        : state.attempt.settledSequence + 1n;
      if (sequence === null) {
        return yield* new AuthenticatedDeclarativeV2CommandBridgeV1Error({
          operation: "proposeReservation",
          reason: "commandMismatch",
        });
      }
      const lineage = ownLineage({
        attemptSha256: state.attempt.attemptSha256,
        candidateSha256: state.attempt.candidateSha256,
        commandKind,
        sequence,
        currentProgressSha256: state.attempt.progressSha256,
        predecessorReceiptSha256: state.attempt.lastReceiptSha256,
      });
      const proposal = Object.freeze({
        [PROPOSAL_MARKER]: true as const,
      }) satisfies AuthenticatedDeclarativeV2CommandReservationProposalV1;
      proposals.set(proposal, {
        session,
        lineage,
        pendingReplay,
        consumed: false,
      });
      return Object.freeze({
        proposal,
        lineage: ownLineage(lineage),
      });
    });

  const prepareReservation:
    AuthenticatedDeclarativeV2CommandBridgeV1<ClaimFailure>[
      "prepareReservation"
    ] = Effect.fn(
      "AuthenticatedDeclarativeV2CommandBridgeV1.prepareReservation",
    )(function* (session, proposal, preparedAuthority) {
      const sessionState = yield* lookupSession(
        sessions,
        session,
        "prepareReservation",
      );
      const proposalState = yield* lookupProposal(
        proposals,
        proposal,
        "prepareReservation",
      );
      if (proposalState.session !== session || proposalState.consumed) {
        return yield* new AuthenticatedDeclarativeV2CommandBridgeV1Error({
          operation: "prepareReservation",
          reason: "invalidProposal",
        });
      }
      if (options.preparedReservations === undefined) {
        return yield* new AuthenticatedDeclarativeV2CommandBridgeV1Error({
          operation: "prepareReservation",
          reason: "missingClaimPort",
        });
      }
      const claimed = yield* options.preparedReservations.claim(
        preparedAuthority,
        ownLineage(proposalState.lineage),
      );
      const encodedBudget = yield* Effect.fromResult(
        encodeDeclarativeV2VerifierProgressFrameV2(
          claimed.commandBudget,
          FRAME_BUDGET,
        ),
      );
      const commandBudgetSha256 = yield* sha256(
        encodedBudget.canonicalBytes,
        { maximumInputBytes: encodedBudget.canonicalBytes.byteLength },
      );
      if (
        !bytesEqualFullScan(
          commandBudgetSha256,
          claimed.commitments.commandBudgetSha256,
        )
      ) {
        return yield* new AuthenticatedDeclarativeV2CommandBridgeV1Error({
          operation: "prepareReservation",
          reason: "commandMismatch",
        });
      }
      const reservation = ownReservation({
        kind: "command_reservation",
        ...proposalState.lineage,
        commandBudgetSha256: claimed.commitments.commandBudgetSha256,
        commandInputSha256: claimed.commitments.commandInputSha256,
        freshAuthenticatedInputSha256:
          claimed.commitments.freshAuthenticatedInputSha256,
        analyzerIdentitySha256:
          claimed.commitments.analyzerIdentitySha256,
        verifierIdentitySha256:
          claimed.commitments.verifierIdentitySha256,
        rangeAndPredecessorTailsSha256:
          claimed.commitments.rangeAndPredecessorTailsSha256,
      });
      const encodedReservation = yield* Effect.fromResult(
        encodeDeclarativeV2VerifierProgressFrameV2(
          reservation,
          FRAME_BUDGET,
        ),
      );
      const reservationSha256 = yield* sha256(
        encodedReservation.canonicalBytes,
        { maximumInputBytes: encodedReservation.canonicalBytes.byteLength },
      );
      const ready = Object.freeze({
        [READY_RESERVATION_MARKER]: true as const,
      }) satisfies AuthenticatedDeclarativeV2CommandReadyReservationV1;
      readyReservations.set(ready, {
        session,
        reservation,
        commandBudget: Object.freeze({ ...claimed.commandBudget }),
        pendingReplay: proposalState.pendingReplay,
        consumed: false,
      });
      proposalState.consumed = true;
      proposals.delete(proposal);
      return Object.freeze({
        ready,
        reservation: ownReservation(reservation),
        reservationSha256: new Uint8Array(reservationSha256),
      });
    });

  const reservePrepared:
    AuthenticatedDeclarativeV2CommandBridgeV1<ClaimFailure>[
      "reservePrepared"
    ] = Effect.fn(
      "AuthenticatedDeclarativeV2CommandBridgeV1.reservePrepared",
    )(function* (ready, futureRegistrationIntentBytes, budget) {
      const readyState = yield* lookupReadyReservation(
        readyReservations,
        ready,
      );
      const sessionState = yield* lookupSession(
        sessions,
        readyState.session,
        "reservePrepared",
      );
      const input = {
        reservation: readyState.reservation,
        commandBudget: readyState.commandBudget,
        authority: { futureRegistrationIntentBytes },
      } as const;
      let reserved:
        Effect.Success<ReturnType<typeof repository.resumePending>>;
      let kind: "reserved" | "pendingReplay";
      if (readyState.pendingReplay) {
        reserved = yield* repository.resumePending(
          sessionState.run,
          input,
          budget,
        );
        kind = "pendingReplay";
      } else {
        const fresh = yield* repository.reserveCommand(
          sessionState.run,
          input,
          budget,
        );
        reserved = fresh;
        kind = fresh.kind;
      }
      const work = makeWork(
        works,
        readyState.session,
        reserved.work,
        reserved.reservation,
        reserved.reservationSha256,
      );
      readyState.consumed = true;
      readyReservations.delete(ready);
      sessionState.attempt = projectReservedAttemptForBridge(
        sessionState.attempt,
        reserved.reservation,
        sessionState.attempt.writerFence,
      );
      return Object.freeze({
        kind,
        work,
        reservation: reserved.reservation,
        operationUsage: reserved.operationUsage,
      });
    });

  const reserve: AuthenticatedDeclarativeV2CommandBridgeV1["reserve"] =
    Effect.fn("AuthenticatedDeclarativeV2CommandBridgeV1.reserve")(
      function* (session, input, budget) {
        const state = yield* lookupSession(sessions, session, "reserve");
        const reserved = yield* repository.reserveCommand(state.run, {
          reservation: input.reservation,
          commandBudget: input.commandBudget,
          authority: {
            futureRegistrationIntentBytes:
              input.futureRegistrationIntentBytes,
          },
        }, budget);
        const work = Object.freeze({
          _tag: "AuthenticatedDeclarativeV2CommandWorkV1" as const,
        });
        works.set(work, {
          session,
          work: reserved.work,
          sequence: reserved.reservation.sequence,
          reservationSha256:
            new Uint8Array(reserved.reservationSha256),
          terminalProofBytes: undefined,
          closed: false,
        });
        return Object.freeze({
          kind: reserved.kind,
          work,
          reservation: reserved.reservation,
          operationUsage: reserved.operationUsage,
        });
      },
    );

  const resume: AuthenticatedDeclarativeV2CommandBridgeV1["resume"] =
    Effect.fn("AuthenticatedDeclarativeV2CommandBridgeV1.resume")(
      function* (session, input, budget) {
        const state = yield* lookupSession(sessions, session, "resume");
        const resumed = yield* repository.resumePending(state.run, {
          reservation: input.reservation,
          commandBudget: input.commandBudget,
          authority: {
            futureRegistrationIntentBytes:
              input.futureRegistrationIntentBytes,
          },
        }, budget);
        const work = Object.freeze({
          _tag: "AuthenticatedDeclarativeV2CommandWorkV1" as const,
        });
        works.set(work, {
          session,
          work: resumed.work,
          sequence: resumed.reservation.sequence,
          reservationSha256:
            new Uint8Array(resumed.reservationSha256),
          terminalProofBytes: undefined,
          closed: false,
        });
        return Object.freeze({
          work,
          reservation: resumed.reservation,
          operationUsage: resumed.operationUsage,
        });
      },
    );

  const settle: AuthenticatedDeclarativeV2CommandBridgeV1["settle"] =
    Effect.fn("AuthenticatedDeclarativeV2CommandBridgeV1.settle")(
      function* (work, input, budget) {
        const state = yield* lookupWork(works, work, "settle");
        yield* lookupSession(sessions, state.session, "settle");
        if (state.terminalProofBytes === undefined) {
          state.terminalProofBytes = new Uint8Array(input.terminalProofBytes);
        } else if (
          !bytesEqualFullScan(
            state.terminalProofBytes,
            input.terminalProofBytes,
          )
        ) {
          return yield* new AuthenticatedDeclarativeV2CommandBridgeV1Error({
            operation: "settle",
            reason: "decisionMismatch",
          });
        }
        const settled = yield* repository.settleCommand(state.work, {
          outputManifest: input.outputManifest,
          commandUsage: input.commandUsage,
          resultingUsage: input.resultingUsage,
          nextProgress: input.nextProgress,
          receipt: input.receipt,
          authority: {
            terminalProofBytes: state.terminalProofBytes,
          },
        }, budget);
        const session = yield* lookupSession(
          sessions,
          state.session,
          "settle",
        );
        session.attempt = projectSettledAttemptForBridge(
          session.attempt,
          settled.settlement,
        );
        state.closed = true;
        works.delete(work);
        return Object.freeze({
          settlement: settled.settlement,
          operationUsage: settled.operationUsage,
        });
      },
    );

  const observeDecision:
    AuthenticatedDeclarativeV2CommandBridgeV1["observeDecision"] =
      Effect.fn("AuthenticatedDeclarativeV2CommandBridgeV1.observeDecision")(
        function* (work, budget) {
          const state = yield* lookupWorkForDecision(works, work);
          const session = yield* lookupSession(
            sessions,
            state.session,
            "observeDecision",
          );
          if (state.terminalProofBytes === undefined) {
            return yield* new AuthenticatedDeclarativeV2CommandBridgeV1Error({
              operation: "observeDecision",
              reason: "settlementNotAttempted",
            });
          }
          const observed = yield* repository.observeCommandDecision({
            scopeId: session.scopeId,
            attemptSha256: session.attemptSha256,
            sequence: state.sequence,
            reservationSha256: state.reservationSha256,
            terminalProofBytes: state.terminalProofBytes,
          }, budget);
          if (observed.decision.kind === "settled") {
            const decoded = decodeDeclarativeV2TerminalAuthorityProofV1(
              state.terminalProofBytes,
            );
            if (
              Result.isFailure(decoded) ||
              decoded.success.proof.commandKind !==
                observed.decision.settlement.commandKind ||
              decoded.success.proof.sequence !==
                observed.decision.settlement.sequence ||
              !bytesEqualFullScan(
                decoded.success.proof.reservationSha256,
                observed.decision.settlement.reservationSha256,
              ) ||
              !bytesEqualFullScan(
                decoded.success.proof.receiptSha256,
                observed.decision.settlement.receiptSha256,
              )
            ) {
              return yield*
                new AuthenticatedDeclarativeV2CommandBridgeV1Error({
                  operation: "observeDecision",
                  reason: "decisionMismatch",
                });
            }
          }
          state.closed = true;
          works.delete(work);
          session.closed = true;
          sessions.delete(state.session);
          return observed;
        },
      );

  const appendEvidencePage:
    AuthenticatedDeclarativeV2CommandBridgeV1["appendEvidencePage"] =
      Effect.fn("AuthenticatedDeclarativeV2CommandBridgeV1.appendEvidencePage")(
        function* (work, input, budget) {
          const state = yield* lookupWork(
            works,
            work,
            "appendEvidencePage",
          );
          yield* lookupSession(sessions, state.session, "appendEvidencePage");
          return yield* repository.appendEvidencePage(
            state.work,
            input,
            budget,
          );
        },
      );

  const readEvidencePageBatch:
    AuthenticatedDeclarativeV2CommandBridgeV1["readEvidencePageBatch"] =
      Effect.fn(
        "AuthenticatedDeclarativeV2CommandBridgeV1.readEvidencePageBatch",
      )(function* (work, input, budget) {
        const state = yield* lookupWork(
          works,
          work,
          "readEvidencePageBatch",
        );
        yield* lookupSession(
          sessions,
          state.session,
          "readEvidencePageBatch",
        );
        return yield* repository.readEvidencePageBatch(
          state.work,
          input,
          budget,
        );
      });

  const readSettledEvidencePageBatch:
    AuthenticatedDeclarativeV2CommandBridgeV1<ClaimFailure>[
      "readSettledEvidencePageBatch"
    ] = Effect.fn(
      "AuthenticatedDeclarativeV2CommandBridgeV1.readSettledEvidencePageBatch",
    )(function* (session, input, budget) {
      const state = yield* lookupSession(
        sessions,
        session,
        "readSettledEvidencePageBatch",
      );
      return yield* repository.readSettledEvidencePageBatch({
        scopeId: state.scopeId,
        attemptSha256: state.attemptSha256,
        commandKind: input.commandKind,
        sequence: input.sequence,
        reservationSha256: input.reservationSha256,
        outputManifestSha256: input.outputManifestSha256,
        receiptSha256: input.receiptSha256,
        startPageOrdinal: input.startPageOrdinal,
        expectedPredecessorPageSha256:
          input.expectedPredecessorPageSha256,
      }, budget);
    });

  const release: AuthenticatedDeclarativeV2CommandBridgeV1["release"] =
    Effect.fn("AuthenticatedDeclarativeV2CommandBridgeV1.release")(
      function* (session, budget) {
        const state = yield* lookupSession(sessions, session, "release");
        const released = yield* repository.release(state.run, budget);
        state.closed = true;
        sessions.delete(session);
        return Object.freeze({
          operationUsage: released.operationUsage,
        });
      },
    );

  return Object.freeze({
    acquire,
    proposeReservation,
    prepareReservation,
    reservePrepared,
    reserve,
    resume,
    appendEvidencePage,
    readEvidencePageBatch,
    readSettledEvidencePageBatch,
    settle,
    observeDecision,
    release,
  });
}

function makeWork(
  works: WeakMap<object, WorkState>,
  session: AuthenticatedDeclarativeV2CommandSessionV1,
  repositoryWork: DeclarativeV2VerifierProgressWorkV2,
  reservation: DeclarativeV2VerifierCommandReservationFrameV2,
  reservationSha256: Uint8Array,
): AuthenticatedDeclarativeV2CommandWorkV1 {
  const work = Object.freeze({
    _tag: "AuthenticatedDeclarativeV2CommandWorkV1" as const,
  });
  works.set(work, {
    session,
    work: repositoryWork,
    sequence: reservation.sequence,
    reservationSha256: new Uint8Array(reservationSha256),
    terminalProofBytes: undefined,
    closed: false,
  });
  return work;
}

function lookupProposal(
  proposals: WeakMap<object, ProposalState>,
  proposal: unknown,
  operation: "prepareReservation",
): Effect.Effect<
  ProposalState,
  AuthenticatedDeclarativeV2CommandBridgeV1Error
> {
  const state = proposal !== null && typeof proposal === "object"
    ? proposals.get(proposal)
    : undefined;
  return state === undefined || state.consumed
    ? Effect.fail(new AuthenticatedDeclarativeV2CommandBridgeV1Error({
        operation,
        reason: "invalidProposal",
      }))
    : Effect.succeed(state);
}

function lookupReadyReservation(
  readyReservations: WeakMap<object, ReadyReservationState>,
  ready: unknown,
): Effect.Effect<
  ReadyReservationState,
  AuthenticatedDeclarativeV2CommandBridgeV1Error
> {
  const state = ready !== null && typeof ready === "object"
    ? readyReservations.get(ready)
    : undefined;
  return state === undefined || state.consumed
    ? Effect.fail(new AuthenticatedDeclarativeV2CommandBridgeV1Error({
        operation: "reservePrepared",
        reason: "invalidReadyReservation",
      }))
    : Effect.succeed(state);
}

function ownLineage(
  lineage: AuthenticatedDeclarativeV2CommandReservationLineageV1,
): AuthenticatedDeclarativeV2CommandReservationLineageV1 {
  return Object.freeze({
    attemptSha256: new Uint8Array(lineage.attemptSha256),
    candidateSha256: new Uint8Array(lineage.candidateSha256),
    commandKind: lineage.commandKind,
    sequence: lineage.sequence,
    currentProgressSha256: new Uint8Array(lineage.currentProgressSha256),
    predecessorReceiptSha256: lineage.predecessorReceiptSha256 === null
      ? null
      : new Uint8Array(lineage.predecessorReceiptSha256),
  });
}

function ownReservation(
  reservation: DeclarativeV2VerifierCommandReservationFrameV2,
): DeclarativeV2VerifierCommandReservationFrameV2 {
  return Object.freeze({
    ...reservation,
    attemptSha256: new Uint8Array(reservation.attemptSha256),
    candidateSha256: new Uint8Array(reservation.candidateSha256),
    currentProgressSha256: new Uint8Array(reservation.currentProgressSha256),
    predecessorReceiptSha256: reservation.predecessorReceiptSha256 === null
      ? null
      : new Uint8Array(reservation.predecessorReceiptSha256),
    commandBudgetSha256: new Uint8Array(reservation.commandBudgetSha256),
    commandInputSha256: new Uint8Array(reservation.commandInputSha256),
    freshAuthenticatedInputSha256:
      new Uint8Array(reservation.freshAuthenticatedInputSha256),
    analyzerIdentitySha256:
      new Uint8Array(reservation.analyzerIdentitySha256),
    verifierIdentitySha256:
      new Uint8Array(reservation.verifierIdentitySha256),
    rangeAndPredecessorTailsSha256:
      new Uint8Array(reservation.rangeAndPredecessorTailsSha256),
  });
}

function projectReservedAttemptForBridge(
  attempt: DeclarativeV2VerifierProgressAttemptSnapshotV2,
  reservation: DeclarativeV2VerifierCommandReservationFrameV2,
  writerFence: bigint,
): DeclarativeV2VerifierProgressAttemptSnapshotV2 {
  return Object.freeze({
    ...attempt,
    pendingKind: reservation.commandKind,
    pendingSequence: reservation.sequence,
    pendingReservationSha256: null,
    pendingReservedByFence: writerFence,
  });
}

function projectSettledAttemptForBridge(
  attempt: DeclarativeV2VerifierProgressAttemptSnapshotV2,
  settlement: DeclarativeV2VerifierProgressSettlementSnapshotV2,
): DeclarativeV2VerifierProgressAttemptSnapshotV2 {
  return Object.freeze({
    ...attempt,
    lifecycle: lifecycleForPhase(settlement.nextProgress.phase),
    settledSequence: settlement.sequence,
    lastReceiptSha256: new Uint8Array(settlement.receiptSha256),
    progressSha256:
      new Uint8Array(settlement.receipt.nextProgressSha256),
    pendingKind: null,
    pendingSequence: null,
    pendingReservationSha256: null,
    pendingReservedByFence: null,
    usage: Object.freeze({ ...settlement.resultingUsage }),
    progress: Object.freeze({ ...settlement.nextProgress }),
  });
}

function lifecycleForPhase(
  phase: DeclarativeV2VerifierProgressCursorFrameV2["phase"],
): DeclarativeV2VerifierProgressAttemptSnapshotV2["lifecycle"] {
  switch (phase) {
    case "source":
      return "open";
    case "parse":
      return "parsing";
    case "link":
      return "parse_complete";
    case "registration":
      return "link_complete";
    case "verdict":
      return "registering";
  }
}

function lookupSession(
  sessions: WeakMap<object, SessionState>,
  session: unknown,
  operation: AuthenticatedDeclarativeV2CommandBridgeV1Error["operation"],
): Effect.Effect<
  SessionState,
  AuthenticatedDeclarativeV2CommandBridgeV1Error
> {
  const state = session !== null && typeof session === "object"
    ? sessions.get(session)
    : undefined;
  if (state === undefined) {
    return Effect.fail(new AuthenticatedDeclarativeV2CommandBridgeV1Error({
      operation,
      reason: "invalidSession",
    }));
  }
  return state.closed
    ? Effect.fail(new AuthenticatedDeclarativeV2CommandBridgeV1Error({
      operation,
      reason: "closed",
    }))
    : Effect.succeed(state);
}

function lookupWork(
  works: WeakMap<object, WorkState>,
  work: unknown,
  operation:
    | "appendEvidencePage"
    | "readEvidencePageBatch"
    | "settle",
): Effect.Effect<WorkState, AuthenticatedDeclarativeV2CommandBridgeV1Error> {
  const state = work !== null && typeof work === "object"
    ? works.get(work)
    : undefined;
  if (state === undefined) {
    return Effect.fail(new AuthenticatedDeclarativeV2CommandBridgeV1Error({
      operation,
      reason: "invalidWork",
    }));
  }
  return state.closed
    ? Effect.fail(new AuthenticatedDeclarativeV2CommandBridgeV1Error({
      operation,
      reason: "closed",
    }))
    : Effect.succeed(state);
}

function lookupWorkForDecision(
  works: WeakMap<object, WorkState>,
  work: unknown,
): Effect.Effect<WorkState, AuthenticatedDeclarativeV2CommandBridgeV1Error> {
  const state = work !== null && typeof work === "object"
    ? works.get(work)
    : undefined;
  return state === undefined
    ? Effect.fail(new AuthenticatedDeclarativeV2CommandBridgeV1Error({
      operation: "observeDecision",
      reason: "invalidWork",
    }))
    : Effect.succeed(state);
}
