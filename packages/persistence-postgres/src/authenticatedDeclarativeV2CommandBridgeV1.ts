import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { Data, Effect, Result } from "effect";
import {
  decodeDeclarativeV2TerminalAuthorityProofV1,
} from "flarex-protocol/internal/declarative-v2-terminal-authority-proof-v1";
import type {
  DeclarativeV2VerifierBudgetFrameV2,
  DeclarativeV2VerifierCommandOutputManifestFrameV2,
  DeclarativeV2VerifierCommandReceiptFrameV2,
  DeclarativeV2VerifierCommandReservationFrameV2,
  DeclarativeV2VerifierProgressCursorFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import {
  type DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  type DeclarativeV2VerifierProgressRepositoryOperationUsageV2,
  type DeclarativeV2VerifierProgressRepositoryPageOperationBudgetV2,
  type DeclarativeV2VerifierProgressRepositoryPageOperationUsageV2,
  type DeclarativeV2VerifierProgressAppendEvidencePageInputV2,
  type DeclarativeV2VerifierProgressEvidencePageSnapshotV2,
  type DeclarativeV2VerifierProgressReadEvidencePageBatchInputV2,
  type DeclarativeV2VerifierProgressRepositoryV2,
  type DeclarativeV2VerifierProgressRepositoryV2Error,
  type DeclarativeV2VerifierProgressRunV2,
  type DeclarativeV2VerifierProgressCommandDecisionV2,
  type DeclarativeV2VerifierProgressSettlementSnapshotV2,
  type DeclarativeV2VerifierProgressWorkV2,
} from "./declarativeV2VerifierProgressRepositoryV2";

export interface AuthenticatedDeclarativeV2CommandSessionV1 {
  readonly _tag: "AuthenticatedDeclarativeV2CommandSessionV1";
}

export interface AuthenticatedDeclarativeV2CommandWorkV1 {
  readonly _tag: "AuthenticatedDeclarativeV2CommandWorkV1";
}

export class AuthenticatedDeclarativeV2CommandBridgeV1Error
  extends Data.TaggedError("AuthenticatedDeclarativeV2CommandBridgeV1Error")<{
    readonly operation:
      | "reserve"
      | "resume"
      | "appendEvidencePage"
      | "readEvidencePageBatch"
      | "settle"
      | "observeDecision"
      | "release";
    readonly reason:
      | "invalidSession"
      | "invalidWork"
      | "closed"
      | "settlementNotAttempted"
      | "decisionMismatch";
  }> {}

export type AuthenticatedDeclarativeV2CommandBridgeV1Failure =
  | AuthenticatedDeclarativeV2CommandBridgeV1Error
  | DeclarativeV2VerifierProgressRepositoryV2Error;

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

export interface AuthenticatedDeclarativeV2CommandBridgeV1 {
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
  closed: boolean;
}

interface WorkState {
  readonly session: AuthenticatedDeclarativeV2CommandSessionV1;
  readonly work: DeclarativeV2VerifierProgressWorkV2;
  readonly sequence: bigint;
  readonly reservationSha256: Uint8Array;
  terminalProofBytes: Uint8Array | undefined;
  closed: boolean;
}

export function makeAuthenticatedDeclarativeV2CommandBridgeV1(
  repository: DeclarativeV2VerifierProgressRepositoryV2,
): AuthenticatedDeclarativeV2CommandBridgeV1 {
  const sessions = new WeakMap<object, SessionState>();
  const works = new WeakMap<object, WorkState>();

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
          closed: false,
        });
        return Object.freeze({
          session,
          operationUsage: acquired.operationUsage,
        });
      },
    );

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
    reserve,
    resume,
    appendEvidencePage,
    readEvidencePageBatch,
    settle,
    observeDecision,
    release,
  });
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
