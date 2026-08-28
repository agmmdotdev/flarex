import {
  bytesEqualFullScan,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Context, Data, Deferred, Effect, Ref, Result, Scope } from "effect";

import {
  NODE_TASK_CALLBACK_ATTACHMENT_ACK_FORMAT_V1,
  NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
  decodeNodeTaskCallbackAttachmentV1,
  type NodeTaskCallbackAttachmentAckV1,
  type NodeTaskCallbackAttachmentV1,
  type NodeTaskCallbackResponseV1,
} from "./NodeTaskCallbackProtocolV1.js";

import {
  NODE_TASK_EXECUTOR_CLEANUP_FORMAT_V1,
  NODE_TASK_EXECUTOR_GENERATION_V1,
  NODE_TASK_EXECUTOR_HEALTH_FORMAT_V1,
  NODE_TASK_EXECUTOR_INTERRUPTION_FORMAT_V1,
  NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
  NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
  NODE_TASK_EXECUTOR_SETTLEMENT_FORMAT_V1,
  NODE_TASK_EXECUTOR_START_FORMAT_V1,
  authenticateNodeTaskExecutorStartRequestV1,
  decodeNodeTaskExecutorInterruptionRequestV1,
  decodeNodeTaskExecutorRecoveryRequestV1,
  decodeNodeTaskExecutorSettlementV1,
  makeNodeTaskExecutorInterruptionKeyV1,
  type NodeTaskExecutorAcceptanceV1,
  type NodeTaskExecutorCleanupOutcomeV1,
  type NodeTaskExecutorHealthEvidenceV1,
  type NodeTaskExecutorHealthRequestV1,
  type NodeTaskExecutorInterruptionRequestV1,
  type NodeTaskExecutorInterruptionResponseV1,
  type NodeTaskExecutorRecoveryRequestV1,
  type NodeTaskExecutorRecoveryResponseV1,
  type NodeTaskExecutorProtocolSha256,
  type NodeTaskExecutorSessionIdV1,
  type NodeTaskExecutorSettlementV1,
  type NodeTaskExecutorStartKeyV1,
  type NodeTaskExecutorStartRequestV1,
  type NodeTaskExecutorStartResponseV1,
} from "./NodeTaskExecutorProtocolV1.js";

export type NodeTaskExecutorClientOperation =
  | "start"
  | "attachCallbackCapability"
  | "recover"
  | "health"
  | "requestInterruption"
  | "settlement"
  | "close";

export class NodeTaskExecutorClientError extends Data.TaggedError(
  "NodeTaskExecutorClientError",
)<{
  readonly operation: NodeTaskExecutorClientOperation;
  readonly reason:
    | "invalidRequest"
    | "transportBeforeAcceptance"
    | "acceptanceUnknown"
    | "transportAfterAcceptance"
    | "invalidResponse"
    | "idempotencyConflict"
    | "sessionLost"
    | "clientClosed"
    | "cleanupFailed";
  readonly retryable: boolean;
  readonly recoveryKey?: NodeTaskExecutorRecoveryRequestV1["recoveryKey"];
  readonly cause?: unknown;
}> {}

/** One accepted dynamic execution. Its owning Scope closes it. */
export interface NodeTaskExecutorSession {
  readonly acceptance: NodeTaskExecutorAcceptanceV1;
  readonly attachCallbackCapability: (
    attachment: NodeTaskCallbackAttachmentV1,
    invoke: NodeTaskExecutorCallbackChannel,
  ) => Effect.Effect<
    NodeTaskCallbackAttachmentAckV1,
    NodeTaskExecutorClientError
  >;
  readonly health: Effect.Effect<
    NodeTaskExecutorHealthEvidenceV1,
    NodeTaskExecutorClientError
  >;
  readonly requestInterruption: (
    request: NodeTaskExecutorInterruptionRequestV1,
  ) => Effect.Effect<
    NodeTaskExecutorInterruptionResponseV1,
    NodeTaskExecutorClientError
  >;
  readonly settlement: Effect.Effect<
    NodeTaskExecutorSettlementV1,
    NodeTaskExecutorClientError
  >;
  readonly close: Effect.Effect<
    NodeTaskExecutorCleanupOutcomeV1,
    NodeTaskExecutorClientError
  >;
}

/** Private provider channel installed with the launch-bound capability. */
export type NodeTaskExecutorCallbackChannel = (
  request: unknown,
) => Effect.Effect<NodeTaskCallbackResponseV1, unknown>;

export type NodeTaskExecutorStartResult =
  | Readonly<{
      readonly kind: "accepted";
      readonly response: Extract<NodeTaskExecutorStartResponseV1, {
        readonly kind: "accepted";
      }>;
      readonly session: NodeTaskExecutorSession;
    }>
  | Readonly<{
      readonly kind: "rejected";
      readonly response: Extract<NodeTaskExecutorStartResponseV1, {
        readonly kind: "rejected";
      }>;
    }>;

export type NodeTaskExecutorRecoveryResult =
  | Readonly<{
      readonly kind: "accepted";
      readonly response: Extract<NodeTaskExecutorRecoveryResponseV1, {
        readonly kind: "accepted";
      }>;
      readonly session: NodeTaskExecutorSession;
    }>
  | Readonly<{
      readonly kind: "not_found";
      readonly response: Extract<NodeTaskExecutorRecoveryResponseV1, {
        readonly kind: "not_found";
      }>;
    }>
  | Readonly<{
      readonly kind: "session_lost";
      readonly response: Extract<NodeTaskExecutorRecoveryResponseV1, {
        readonly kind: "session_lost";
      }>;
    }>;

export interface NodeTaskExecutorClientApi {
  readonly start: (
    request: NodeTaskExecutorStartRequestV1,
  ) => Effect.Effect<
    NodeTaskExecutorStartResult,
    NodeTaskExecutorClientError,
    Scope.Scope
  >;
  readonly recover: (
    request: NodeTaskExecutorRecoveryRequestV1,
  ) => Effect.Effect<
    NodeTaskExecutorRecoveryResult,
    NodeTaskExecutorClientError,
    Scope.Scope
  >;
}

export class NodeTaskExecutorClient extends Context.Service<
  NodeTaskExecutorClient,
  NodeTaskExecutorClientApi
>()("flarex/backend/taskComputeDelivery/NodeTaskExecutorClient") {}

export type DeterministicNodeTaskExecutorStartFailure =
  | "transportBeforeAcceptance"
  | "acceptanceUnknown";

export interface DeterministicNodeTaskExecutorStartRejection {
  readonly reason: Extract<NodeTaskExecutorStartResponseV1, {
    readonly kind: "rejected";
  }>["reason"];
  readonly retryable: boolean;
}

export interface DeterministicNodeTaskExecutorEvent {
  readonly operation: NodeTaskExecutorClientOperation;
  readonly startKey: NodeTaskExecutorStartKeyV1;
  readonly cancellationGeneration?: bigint;
}

export interface DeterministicNodeTaskExecutorSnapshot {
  readonly closed: boolean;
  readonly activeSessionCount: number;
  readonly events: ReadonlyArray<DeterministicNodeTaskExecutorEvent>;
}

export interface DeterministicNodeTaskExecutorControl {
  readonly failNextStart: (
    failure: DeterministicNodeTaskExecutorStartFailure,
  ) => Effect.Effect<void>;
  readonly rejectNextStart: (
    rejection: DeterministicNodeTaskExecutorStartRejection,
  ) => Effect.Effect<void>;
  readonly settle: (
    settlement: NodeTaskExecutorSettlementV1,
  ) => Effect.Effect<boolean>;
  readonly lose: (
    startKey: NodeTaskExecutorStartKeyV1,
  ) => Effect.Effect<boolean>;
  readonly snapshot: Effect.Effect<DeterministicNodeTaskExecutorSnapshot>;
}

export interface DeterministicNodeTaskExecutorBundle {
  readonly client: NodeTaskExecutorClientApi;
  readonly control: DeterministicNodeTaskExecutorControl;
}

interface FakeSessionState {
  readonly request: NodeTaskExecutorStartRequestV1;
  readonly acceptance: NodeTaskExecutorAcceptanceV1;
  readonly settlement: Deferred.Deferred<
    NodeTaskExecutorSettlementV1,
    NodeTaskExecutorClientError
  >;
  readonly status: "active" | "settled" | "lost" | "closed";
  readonly heartbeatSequence: bigint;
  readonly activeLeaseCount: number;
  readonly acceptedCancellationGeneration: bigint;
  readonly callbackAttachment?: NodeTaskCallbackAttachmentV1;
  readonly interruptionReason?: NodeTaskExecutorInterruptionRequestV1["reason"];
}

interface FakeState {
  readonly closed: boolean;
  readonly nextSessionOrdinal: number;
  readonly nextStartFailure: DeterministicNodeTaskExecutorStartFailure | undefined;
  readonly nextStartRejection:
    | DeterministicNodeTaskExecutorStartRejection
    | undefined;
  readonly sessions: ReadonlyMap<NodeTaskExecutorStartKeyV1, FakeSessionState>;
  readonly events: ReadonlyArray<DeterministicNodeTaskExecutorEvent>;
}

type StartDecision =
  | Readonly<{ readonly kind: "closed" }>
  | Readonly<{ readonly kind: "accepted"; readonly state: FakeSessionState }>
  | Readonly<{
      readonly kind: "rejected";
      readonly response: Extract<NodeTaskExecutorStartResponseV1, {
        readonly kind: "rejected";
      }>;
    }>
  | Readonly<{
      readonly kind: "failed";
      readonly failure: DeterministicNodeTaskExecutorStartFailure;
      readonly recoveryKey: NodeTaskExecutorStartRequestV1["recoveryKey"];
    }>
  | Readonly<{ readonly kind: "conflict" }>;

type RecoveryDecision =
  | Readonly<{ readonly kind: "closed" }>
  | Readonly<{ readonly kind: "conflict" }>
  | Readonly<{ readonly kind: "not_found" }>
  | Readonly<{ readonly kind: "found"; readonly session: FakeSessionState }>;

type InterruptionDecision =
  | Readonly<{ readonly kind: "conflict" }>
  | Readonly<{ readonly kind: "lost" }>
  | Readonly<{
      readonly kind: "response";
      readonly response: NodeTaskExecutorInterruptionResponseV1;
    }>;

type AttachmentDecision = Readonly<{
  readonly kind: "attached" | "conflict" | "lost";
}>;

type CloseDecision = Readonly<{
  readonly kind: NodeTaskExecutorCleanupOutcomeV1["kind"];
  readonly pendingSettlement:
    | FakeSessionState["settlement"]
    | undefined;
}>;

/**
 * Scoped, deterministic protocol fake. It never loads an artifact or executes
 * user code; tests explicitly settle or lose accepted sessions.
 */
export const makeDeterministicNodeTaskExecutor = Effect.fn(
  "DeterministicNodeTaskExecutor.make",
)(function* (
  sha256: NodeTaskExecutorProtocolSha256,
): Effect.fn.Return<
  DeterministicNodeTaskExecutorBundle,
  never,
  Scope.Scope
> {
  const stateRef = yield* Ref.make<FakeState>(Object.freeze({
    closed: false,
    nextSessionOrdinal: 1,
    nextStartFailure: undefined,
    nextStartRejection: undefined,
    sessions: new Map(),
    events: Object.freeze([]),
  }));

  yield* Effect.addFinalizer(() => Ref.modify(stateRef, state => {
    const sessions = new Map(state.sessions);
    const toFail: Array<FakeSessionState["settlement"]> = [];
    for (const [key, session] of sessions) {
      if (session.status === "active") toFail.push(session.settlement);
      sessions.set(key, Object.freeze({ ...session, status: "closed" }));
    }
    return [toFail, Object.freeze({
      ...state,
      closed: true,
      sessions,
    })] as const;
  }).pipe(Effect.flatMap(deferreds => Effect.forEach(
    deferreds,
    deferred => Deferred.fail(deferred, clientFailure(
      "settlement",
      "clientClosed",
      false,
    )),
    { discard: true },
  ))));

  const start: NodeTaskExecutorClientApi["start"] = Effect.fn(
    "NodeTaskExecutorClient.start",
  )(requestInput => Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    if ((yield* Ref.get(stateRef)).closed) {
      return yield* clientFailure("start", "clientClosed", false);
    }
    const request = yield* restore(authenticateNodeTaskExecutorStartRequestV1(
        requestInput,
        sha256,
      )).pipe(Effect.mapError(cause => clientFailure(
        "start", "invalidRequest", false, cause,
      )));
    const decision = yield* Ref.modify(stateRef, state =>
      claimStart(state, request)
    );
    switch (decision.kind) {
      case "closed":
        return yield* clientFailure("start", "clientClosed", false);
      case "conflict":
        return yield* clientFailure("start", "idempotencyConflict", false);
      case "failed":
        return yield* clientFailure(
          "start",
          decision.failure,
          true,
          undefined,
          decision.recoveryKey,
        );
      case "rejected":
        return Object.freeze({
          kind: "rejected" as const,
          response: decision.response,
        });
      case "accepted": {
        const session = makeFakeSession(stateRef, decision.state.acceptance);
        yield* Effect.addFinalizer(() => Effect.exit(session.close).pipe(
          Effect.asVoid,
        ));
        return Object.freeze({
          kind: "accepted" as const,
          response: decision.state.acceptance,
          session,
        });
      }
    }
  })));

  const recover: NodeTaskExecutorClientApi["recover"] = Effect.fn(
    "NodeTaskExecutorClient.recover",
  )(requestInput => Effect.uninterruptible(Effect.gen(function* () {
    const request = yield* Effect.fromResult(
      decodeNodeTaskExecutorRecoveryRequestV1(requestInput),
    ).pipe(Effect.mapError(cause => clientFailure(
      "recover", "invalidRequest", false, cause,
    )));
    const decision = yield* Ref.modify(stateRef, (
      state,
    ): readonly [RecoveryDecision, FakeState] => {
      if (state.closed) {
        return [Object.freeze({ kind: "closed" }), state];
      }
      const session = state.sessions.get(request.startKey);
      const events = appendEvent(state.events, {
        operation: "recover",
        startKey: request.startKey,
      });
      if (session === undefined) {
        return [Object.freeze({ kind: "not_found" }), Object.freeze({
          ...state,
          events,
        })];
      }
      if (!requestsCorrelate(session.request, request) ||
        session.request.recoveryKey !== request.recoveryKey) {
        return [Object.freeze({ kind: "conflict" }), Object.freeze({
          ...state,
          events,
        })];
      }
      if (session.status === "lost" || session.status === "closed") {
        return [Object.freeze({ kind: "found", session }), Object.freeze({
          ...state,
          events,
        })];
      }
      const acquired = Object.freeze({
        ...session,
        activeLeaseCount: session.activeLeaseCount + 1,
      });
      const sessions = new Map(state.sessions);
      sessions.set(request.startKey, acquired);
      return [
        Object.freeze({ kind: "found", session: acquired }),
        Object.freeze({ ...state, events, sessions }),
      ];
    });
    if (decision.kind === "closed") {
      return yield* clientFailure("recover", "clientClosed", false);
    }
    if (decision.kind === "not_found") {
      const response: Extract<NodeTaskExecutorRecoveryResponseV1, {
        readonly kind: "not_found";
      }> = Object.freeze({
        format: NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
        version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
        kind: "not_found",
        startKey: request.startKey,
        recoveryKey: request.recoveryKey,
      });
      return Object.freeze({ kind: "not_found" as const, response });
    }
    if (decision.kind === "conflict") {
      return yield* clientFailure("recover", "idempotencyConflict", false);
    }
    const recovered = decision.session;
    if (recovered.status === "lost" || recovered.status === "closed") {
      const response: Extract<NodeTaskExecutorRecoveryResponseV1, {
        readonly kind: "session_lost";
      }> = Object.freeze({
        format: NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
        version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
        kind: "session_lost",
        startKey: request.startKey,
        recoveryKey: request.recoveryKey,
      });
      return Object.freeze({ kind: "session_lost" as const, response });
    }
    const session = makeFakeSession(stateRef, recovered.acceptance);
    yield* Effect.addFinalizer(() => Effect.exit(session.close).pipe(
      Effect.asVoid,
    ));
    return Object.freeze({
      kind: "accepted" as const,
      response: Object.freeze({
        format: NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
        version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
        kind: "accepted" as const,
        acceptance: recovered.acceptance,
      }),
      session,
    });
  })));

  const control: DeterministicNodeTaskExecutorControl = Object.freeze({
    failNextStart: Effect.fn("DeterministicNodeTaskExecutor.failNextStart")(
      failure => Ref.update(stateRef, state => Object.freeze({
        ...state,
        nextStartFailure: failure,
        nextStartRejection: undefined,
      })),
    ),
    rejectNextStart: Effect.fn("DeterministicNodeTaskExecutor.rejectNextStart")(
      rejection => Ref.update(stateRef, state => Object.freeze({
        ...state,
        nextStartFailure: undefined,
        nextStartRejection: Object.freeze(rejection),
      })),
    ),
    settle: Effect.fn("DeterministicNodeTaskExecutor.settle")(
      settlementInput => {
        const decoded = decodeNodeTaskExecutorSettlementV1(settlementInput);
        return Result.match(decoded, {
          onFailure: () => Effect.succeed(false),
          onSuccess: settlement => Effect.gen(function* () {
            const deferred = yield* Ref.modify(stateRef, state => {
              const entry = [...state.sessions.entries()].find(([, session]) =>
                session.acceptance.sessionId === settlement.sessionId
              );
              if (entry === undefined || entry[1].status !== "active") {
                return [undefined, state] as const;
              }
              const [key, session] = entry;
              if (!settlementCorrelates(session, settlement)) {
                return [undefined, state] as const;
              }
              const sessions = new Map(state.sessions);
              sessions.set(key, Object.freeze({
                ...session,
                status: "settled",
              }));
              return [session.settlement, Object.freeze({
                ...state,
                sessions,
              })] as const;
            });
            return deferred === undefined
              ? false
              : yield* Deferred.succeed(deferred, settlement);
          }),
        });
      },
    ),
    lose: Effect.fn("DeterministicNodeTaskExecutor.lose")(
      startKey => Effect.gen(function* () {
        const deferred = yield* Ref.modify(stateRef, state => {
          const session = state.sessions.get(startKey);
          if (session === undefined || session.status !== "active") {
            return [undefined, state] as const;
          }
          const sessions = new Map(state.sessions);
          sessions.set(startKey, Object.freeze({ ...session, status: "lost" }));
          return [session.settlement, Object.freeze({ ...state, sessions })] as const;
        });
        return deferred === undefined
          ? false
          : yield* Deferred.fail(deferred, clientFailure(
            "settlement", "sessionLost", true,
          ));
      }),
    ),
    snapshot: Ref.get(stateRef).pipe(Effect.map(state => Object.freeze({
      closed: state.closed,
      activeSessionCount: [...state.sessions.values()].filter(
        session => session.status === "active",
      ).length,
      events: Object.freeze([...state.events]),
    }))),
  });

  return Object.freeze({
    client: NodeTaskExecutorClient.of({ start, recover }),
    control,
  });
});

function claimStart(
  state: FakeState,
  request: NodeTaskExecutorStartRequestV1,
): readonly [StartDecision, FakeState] {
  if (state.closed) {
    return [Object.freeze({ kind: "closed" }), state];
  }
  const previous = state.sessions.get(request.startKey);
  if (previous !== undefined) {
    const events = appendEvent(state.events, {
      operation: "start",
      startKey: request.startKey,
    });
    if (!nodeTaskExecutorStartRequestsEquivalentV1(previous.request, request)) {
      return [
        Object.freeze({ kind: "conflict" }),
        Object.freeze({ ...state, events }),
      ];
    }
    const acquired = previous.status === "active" || previous.status === "settled"
      ? Object.freeze({
        ...previous,
        activeLeaseCount: previous.activeLeaseCount + 1,
      })
      : previous;
    const sessions = new Map(state.sessions);
    sessions.set(request.startKey, acquired);
    return [
      Object.freeze({ kind: "accepted", state: acquired }),
      Object.freeze({ ...state, events, sessions }),
    ];
  }
  if (state.nextStartRejection !== undefined) {
    const rejection = state.nextStartRejection;
    const response: Extract<NodeTaskExecutorStartResponseV1, {
      readonly kind: "rejected";
    }> = Object.freeze({
      format: NODE_TASK_EXECUTOR_START_FORMAT_V1,
      version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
      kind: "rejected",
      startKey: request.startKey,
      recoveryKey: request.recoveryKey,
      reason: rejection.reason,
      retryable: rejection.retryable,
    });
    return [
      Object.freeze({ kind: "rejected", response }),
      Object.freeze({
        ...state,
        nextStartRejection: undefined,
        events: appendEvent(state.events, {
          operation: "start",
          startKey: request.startKey,
        }),
      }),
    ];
  }
  const failure = state.nextStartFailure;
  if (failure === "transportBeforeAcceptance") {
    return [
      Object.freeze({ kind: "failed", failure, recoveryKey: request.recoveryKey }),
      Object.freeze({
        ...state,
        nextStartFailure: undefined,
        events: appendEvent(state.events, {
          operation: "start",
          startKey: request.startKey,
        }),
      }),
    ];
  }
  const session = makeSessionState(
    request,
    state.nextSessionOrdinal,
    failure === "acceptanceUnknown" ? 0 : 1,
  );
  const sessions = new Map(state.sessions);
  sessions.set(request.startKey, session);
  const next = Object.freeze({
    ...state,
    nextSessionOrdinal: state.nextSessionOrdinal + 1,
    nextStartFailure: undefined,
    sessions,
    events: appendEvent(state.events, {
      operation: "start",
      startKey: request.startKey,
    }),
  });
  return failure === "acceptanceUnknown"
    ? [Object.freeze({ failure, kind: "failed", recoveryKey: request.recoveryKey }), next]
    : [Object.freeze({ kind: "accepted", state: session }), next];
}

function makeSessionState(
  request: NodeTaskExecutorStartRequestV1,
  ordinal: number,
  activeLeaseCount: number,
): FakeSessionState {
  const sessionId = `deterministic-node-session-${ordinal}` as
    NodeTaskExecutorSessionIdV1;
  return Object.freeze({
    request,
    acceptance: Object.freeze({
      format: NODE_TASK_EXECUTOR_START_FORMAT_V1,
      version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
      kind: "accepted" as const,
      generation: NODE_TASK_EXECUTOR_GENERATION_V1,
      startKey: request.startKey,
      recoveryKey: request.recoveryKey,
      identity: request.dispatch.identity,
      executionId: request.executionId,
      sessionId,
      cancellationGeneration: request.dispatch.cancellation.generation,
    }),
    settlement: Deferred.makeUnsafe<
      NodeTaskExecutorSettlementV1,
      NodeTaskExecutorClientError
    >(),
    status: "active" as const,
    heartbeatSequence: 0n,
    activeLeaseCount,
    acceptedCancellationGeneration: request.dispatch.cancellation.generation,
    ...(request.dispatch.cancellation.kind === "requested"
      ? { interruptionReason: "cancellation_requested" as const }
      : {}),
  });
}

function makeFakeSession(
  stateRef: Ref.Ref<FakeState>,
  acceptance: NodeTaskExecutorAcceptanceV1,
): NodeTaskExecutorSession {
  const handleClosedRef = Ref.makeUnsafe(false);
  const attachCallbackCapability:
    NodeTaskExecutorSession["attachCallbackCapability"] = Effect.fn(
      "NodeTaskExecutorSession.attachCallbackCapability",
    )((attachmentInput, _invoke) => Effect.gen(function* () {
      if (yield* Ref.get(handleClosedRef)) {
        return yield* clientFailure(
          "attachCallbackCapability", "clientClosed", false,
        );
      }
      const attachment = yield* Effect.fromResult(
        decodeNodeTaskCallbackAttachmentV1(attachmentInput),
      ).pipe(Effect.mapError(cause => clientFailure(
        "attachCallbackCapability", "invalidRequest", false, cause,
      )));
      const accepted = yield* Ref.modify(stateRef, (
        state,
      ): readonly [AttachmentDecision, FakeState] => {
        const session = state.sessions.get(acceptance.startKey);
        if (state.closed || session === undefined || session.status !== "active") {
          return [{ kind: "lost" as const }, state] as const;
        }
        if (!attachmentCorrelates(session, attachment)) {
          return [{ kind: "conflict" as const }, state] as const;
        }
        if (session.callbackAttachment !== undefined) {
          return [attachmentsEqual(session.callbackAttachment, attachment)
            ? { kind: "attached" as const }
            : { kind: "conflict" as const }, state] as const;
        }
        const sessions = new Map(state.sessions);
        sessions.set(acceptance.startKey, Object.freeze({
          ...session,
          callbackAttachment: attachment,
        }));
        return [{ kind: "attached" as const }, Object.freeze({
          ...state,
          sessions,
          events: appendEvent(state.events, {
            operation: "attachCallbackCapability",
            startKey: acceptance.startKey,
          }),
        })] as const;
      });
      if (accepted.kind === "lost") {
        return yield* clientFailure(
          "attachCallbackCapability", "sessionLost", true,
        );
      }
      if (accepted.kind === "conflict") {
        return yield* clientFailure(
          "attachCallbackCapability", "idempotencyConflict", false,
        );
      }
      return Object.freeze({
        format: NODE_TASK_CALLBACK_ATTACHMENT_ACK_FORMAT_V1,
        version: NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
        kind: "attached" as const,
        capabilityId: attachment.capabilityId,
        startKey: attachment.startKey,
        sessionId: attachment.sessionId,
        executionId: attachment.executionId,
        expiresAtEpochMilliseconds: attachment.expiresAtEpochMilliseconds,
      });
    }));
  const sharedHealth = Ref.modify(stateRef, state => {
    const session = state.sessions.get(acceptance.startKey);
    if (state.closed || session === undefined || session.status !== "active") {
      return [undefined, state] as const;
    }
    const heartbeatSequence = session.heartbeatSequence + 1n;
    const updated = Object.freeze({ ...session, heartbeatSequence });
    const sessions = new Map(state.sessions);
    sessions.set(acceptance.startKey, updated);
    const evidence: NodeTaskExecutorHealthEvidenceV1 = Object.freeze({
      format: NODE_TASK_EXECUTOR_HEALTH_FORMAT_V1,
      version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
      kind: "healthy",
      sessionId: acceptance.sessionId,
      recoveryKey: acceptance.recoveryKey,
      heartbeatSequence,
      observedAtEpochMilliseconds: Number(heartbeatSequence),
      state: updated.interruptionReason === undefined
        ? "running"
        : "interruption_requested",
    });
    return [evidence, Object.freeze({
      ...state,
      sessions,
      events: appendEvent(state.events, {
        operation: "health",
        startKey: acceptance.startKey,
      }),
    })] as const;
  }).pipe(Effect.flatMap(evidence => evidence === undefined
    ? Effect.fail(clientFailure("health", "sessionLost", true))
    : Effect.succeed(evidence)));
  const health = Ref.get(handleClosedRef).pipe(
    Effect.flatMap(closed => closed
      ? Effect.fail(clientFailure("health", "clientClosed", false))
      : sharedHealth),
  );

  const requestInterruption: NodeTaskExecutorSession["requestInterruption"] =
    Effect.fn("NodeTaskExecutorSession.requestInterruption")(
      requestInput => Effect.gen(function* () {
        if (yield* Ref.get(handleClosedRef)) {
          return yield* clientFailure(
            "requestInterruption", "clientClosed", false,
          );
        }
        const request = yield* Effect.fromResult(
          decodeNodeTaskExecutorInterruptionRequestV1(requestInput),
        ).pipe(Effect.mapError(cause => clientFailure(
          "requestInterruption", "invalidRequest", false, cause,
        )));
        const decision = yield* Ref.modify(stateRef, (
          state,
        ): readonly [InterruptionDecision, FakeState] => {
          const session = state.sessions.get(acceptance.startKey);
          if (
            state.closed || session === undefined || session.status !== "active"
          ) return [Object.freeze({ kind: "lost" }), state];
          if (
            request.sessionId !== acceptance.sessionId ||
            request.recoveryKey !== acceptance.recoveryKey ||
            request.executionId !== acceptance.executionId ||
            !identitiesEqual(request.identity, acceptance.identity)
          ) return [Object.freeze({ kind: "conflict" }), state];
          const stale = request.cancellationGeneration <
            session.acceptedCancellationGeneration;
          if (
            request.cancellationGeneration ===
              session.acceptedCancellationGeneration &&
            session.interruptionReason !== request.reason
          ) return [Object.freeze({ kind: "conflict" }), state];
          const acceptedCancellationGeneration = stale
            ? session.acceptedCancellationGeneration
            : request.cancellationGeneration;
          const updated = stale ? session : Object.freeze({
            ...session,
            acceptedCancellationGeneration,
            interruptionReason: request.reason,
          });
          const sessions = new Map(state.sessions);
          sessions.set(acceptance.startKey, updated);
          const response: NodeTaskExecutorInterruptionResponseV1 = Object.freeze({
            format: NODE_TASK_EXECUTOR_INTERRUPTION_FORMAT_V1,
            version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
            kind: stale ? "stale_generation" : "interruption_requested",
            interruptionKey: request.interruptionKey,
            sessionId: acceptance.sessionId,
            cancellationGeneration: request.cancellationGeneration,
            reason: request.reason,
          });
          return [Object.freeze({ kind: "response", response }), Object.freeze({
            ...state,
            sessions,
            events: appendEvent(state.events, {
              operation: "requestInterruption",
              startKey: acceptance.startKey,
              cancellationGeneration: request.cancellationGeneration,
            }),
          })];
        });
        switch (decision.kind) {
          case "conflict":
            return yield* clientFailure(
              "requestInterruption", "idempotencyConflict", false,
            );
          case "lost":
            return yield* clientFailure(
              "requestInterruption", "sessionLost", true,
            );
          case "response":
            return decision.response;
        }
      }),
    );

  const settlement = Ref.get(handleClosedRef).pipe(
    Effect.flatMap(handleClosed => handleClosed
      ? Effect.fail(clientFailure("settlement", "clientClosed", false))
      : Ref.get(stateRef).pipe(Effect.flatMap(state => {
        const session = state.sessions.get(acceptance.startKey);
        if (state.closed || session?.status === "closed") {
          return Effect.fail(clientFailure(
            "settlement", "clientClosed", false,
          ));
        }
        return session === undefined || session.status === "lost"
          ? Effect.fail(clientFailure("settlement", "sessionLost", true))
          : Deferred.await(session.settlement);
      }))),
  );

  const close = Effect.uninterruptible(Effect.gen(function* () {
    const firstClose = yield* Ref.modify(
      handleClosedRef,
      closed => [!closed, true] as const,
    );
    if (!firstClose) return cleanupOutcome(acceptance, "already_clean");
    const decision = yield* Ref.modify(stateRef, (
      state,
    ): readonly [CloseDecision, FakeState] => {
      const session = state.sessions.get(acceptance.startKey);
      if (session === undefined || session.status === "lost") {
        return [Object.freeze({
          kind: "session_lost" as const,
          pendingSettlement: undefined,
        }), state] as const;
      }
      if (session.status === "closed") {
        return [Object.freeze({
          kind: "already_clean" as const,
          pendingSettlement: undefined,
        }), state] as const;
      }
      const lastLease = session.activeLeaseCount === 1;
      const updated = Object.freeze({
        ...session,
        activeLeaseCount: session.activeLeaseCount - 1,
        ...(lastLease ? { status: "closed" as const } : {}),
      });
      const sessions = new Map(state.sessions);
      sessions.set(acceptance.startKey, updated);
      return [Object.freeze({
        kind: "cleaned" as const,
        pendingSettlement: lastLease && session.status === "active"
          ? session.settlement
          : undefined,
      }), Object.freeze({
        ...state,
        sessions,
        events: appendEvent(state.events, {
          operation: "close",
          startKey: acceptance.startKey,
        }),
      })] as const;
    });
    if (decision.pendingSettlement !== undefined) {
      yield* Deferred.fail(decision.pendingSettlement, clientFailure(
        "settlement", "clientClosed", false,
      ));
    }
    return cleanupOutcome(acceptance, decision.kind);
  }));

  return Object.freeze({
    acceptance,
    attachCallbackCapability,
    health,
    requestInterruption,
    settlement,
    close,
  });
}

function attachmentCorrelates(
  session: FakeSessionState,
  attachment: NodeTaskCallbackAttachmentV1,
): boolean {
  return attachment.capabilityId === session.request.launchCapability.capabilityId &&
    attachment.startKey === session.acceptance.startKey &&
    attachment.sessionId === session.acceptance.sessionId &&
    attachment.executionId === session.acceptance.executionId &&
    attachment.expiresAtEpochMilliseconds ===
      session.request.launchCapability.expiresAtEpochMilliseconds;
}

function attachmentsEqual(
  left: NodeTaskCallbackAttachmentV1,
  right: NodeTaskCallbackAttachmentV1,
): boolean {
  return attachmentCorrelatesFields(left, right) &&
    bytesEqualFullScan(left.credential, right.credential);
}

function attachmentCorrelatesFields(
  left: Omit<NodeTaskCallbackAttachmentV1, "credential">,
  right: Omit<NodeTaskCallbackAttachmentV1, "credential">,
): boolean {
  return left.format === right.format && left.version === right.version &&
    left.capabilityId === right.capabilityId && left.startKey === right.startKey &&
    left.sessionId === right.sessionId && left.executionId === right.executionId &&
    left.expiresAtEpochMilliseconds === right.expiresAtEpochMilliseconds;
}

function cleanupOutcome(
  acceptance: NodeTaskExecutorAcceptanceV1,
  kind: NodeTaskExecutorCleanupOutcomeV1["kind"],
): NodeTaskExecutorCleanupOutcomeV1 {
  return Object.freeze({
    format: NODE_TASK_EXECUTOR_CLEANUP_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    kind,
    sessionId: acceptance.sessionId,
    recoveryKey: acceptance.recoveryKey,
  });
}

export function nodeTaskExecutorStartRequestsEquivalentV1(
  left: NodeTaskExecutorStartRequestV1,
  right: NodeTaskExecutorStartRequestV1,
): boolean {
  return requestsCorrelate(left, {
    identity: right.dispatch.identity,
    executionId: right.executionId,
    startKey: right.startKey,
    recoveryKey: right.recoveryKey,
  }) && dispatchesEquivalent(left.dispatch, right.dispatch) &&
    left.nodeArtifactSha256Hex === right.nodeArtifactSha256Hex &&
    bytesEqualFullScan(
      left.nodeArtifactCanonicalBytes,
      right.nodeArtifactCanonicalBytes,
    ) && left.input.objectKey === right.input.objectKey &&
    left.input.byteLength === right.input.byteLength &&
    bytesEqualFullScan(left.input.sha256, right.input.sha256) &&
    unknownDataEqual(left.principal, right.principal) &&
    left.absoluteDeadlineEpochMilliseconds === right.absoluteDeadlineEpochMilliseconds &&
    unknownDataEqual(left.resourcePolicy, right.resourcePolicy) &&
    left.launchCapability.capabilityId === right.launchCapability.capabilityId &&
    left.launchCapability.expiresAtEpochMilliseconds ===
      right.launchCapability.expiresAtEpochMilliseconds &&
    left.trace.traceId === right.trace.traceId &&
    left.trace.parentSpanId === right.trace.parentSpanId;
}

/**
 * Stable preimage for compact provider-local idempotency records. This mirrors
 * the authenticated start equivalence contract while ignoring record key order.
 */
export function nodeTaskExecutorStartRequestEquivalencePreimageV1(
  request: NodeTaskExecutorStartRequestV1,
): string {
  return JSON.stringify(stableEquivalenceNode(request));
}

function stableEquivalenceNode(input: unknown): unknown {
  if (input === undefined) return ["undefined"];
  if (input === null) return ["null"];
  if (typeof input === "boolean") return ["boolean", input];
  if (typeof input === "string") return ["string", input];
  if (typeof input === "bigint") return ["bigint", input.toString(10)];
  if (typeof input === "number") {
    const spelling = Number.isNaN(input)
      ? "nan"
      : input === Number.POSITIVE_INFINITY
      ? "positive_infinity"
      : input === Number.NEGATIVE_INFINITY
      ? "negative_infinity"
      : Object.is(input, -0)
      ? "negative_zero"
      : input;
    return ["number", spelling];
  }
  if (input instanceof Uint8Array) {
    return ["bytes", encodeBytesToLowercaseHex(input)];
  }
  if (Array.isArray(input)) {
    return ["array", input.map(stableEquivalenceNode)];
  }
  if (isNonArrayRecord(input)) {
    return ["record", Object.keys(input).toSorted().map(key => [
      key,
      stableEquivalenceNode(input[key]),
    ])];
  }
  throw new Error("Authenticated Node Task start contains unsupported data.");
}

function dispatchesEquivalent(
  left: NodeTaskExecutorStartRequestV1["dispatch"],
  right: NodeTaskExecutorStartRequestV1["dispatch"],
): boolean {
  return left.attemptNumber === right.attemptNumber &&
    left.leaseVersion === right.leaseVersion &&
    left.computeProfile === right.computeProfile &&
    left.maximumDurationMs === right.maximumDurationMs &&
    left.cancellation.kind === right.cancellation.kind &&
    left.cancellation.generation === right.cancellation.generation &&
    bytesEqualFullScan(
      left.applicationTaskRuntimeTargetSha256,
      right.applicationTaskRuntimeTargetSha256,
    );
}

function unknownDataEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((member, index) => unknownDataEqual(member, right[index]));
  }
  if (!isNonArrayRecord(left) || !isNonArrayRecord(right)) return false;
  const leftKeys = Object.keys(left).toSorted();
  const rightKeys = Object.keys(right).toSorted();
  return leftKeys.length === rightKeys.length && leftKeys.every(
    (key, index) => key === rightKeys[index] &&
      unknownDataEqual(left[key], right[key]),
  );
}

function requestsCorrelate(
  left: NodeTaskExecutorStartRequestV1,
  right: Pick<NodeTaskExecutorRecoveryRequestV1, "identity" | "executionId" | "startKey" | "recoveryKey">,
): boolean {
  const leftIdentity = left.dispatch.identity;
  const rightIdentity = right.identity;
  return left.startKey === right.startKey && left.recoveryKey === right.recoveryKey &&
    left.executionId === right.executionId &&
    identitiesEqual(leftIdentity, rightIdentity);
}

function identitiesEqual(
  left: NodeTaskExecutorAcceptanceV1["identity"],
  right: NodeTaskExecutorAcceptanceV1["identity"],
): boolean {
  return left.scopeId === right.scopeId && left.runId === right.runId &&
    left.requestedEffectSequence === right.requestedEffectSequence &&
    left.attemptId === right.attemptId &&
    left.executionFence === right.executionFence;
}

function settlementCorrelates(
  session: FakeSessionState,
  settlement: NodeTaskExecutorSettlementV1,
): boolean {
  return session.acceptance.sessionId === settlement.sessionId &&
    session.acceptance.recoveryKey === settlement.recoveryKey &&
    session.acceptance.executionId === settlement.executionId &&
    session.acceptance.identity.scopeId === settlement.identity.scopeId &&
    session.acceptance.identity.runId === settlement.identity.runId &&
    session.acceptance.identity.requestedEffectSequence ===
      settlement.identity.requestedEffectSequence &&
    session.acceptance.identity.attemptId === settlement.identity.attemptId &&
    session.acceptance.identity.executionFence === settlement.identity.executionFence;
}

function appendEvent(
  events: ReadonlyArray<DeterministicNodeTaskExecutorEvent>,
  event: DeterministicNodeTaskExecutorEvent,
): ReadonlyArray<DeterministicNodeTaskExecutorEvent> {
  return Object.freeze([...events, Object.freeze(event)]);
}

function clientFailure(
  operation: NodeTaskExecutorClientOperation,
  reason: NodeTaskExecutorClientError["reason"],
  retryable: boolean,
  cause?: unknown,
  recoveryKey?: NodeTaskExecutorRecoveryRequestV1["recoveryKey"],
): NodeTaskExecutorClientError {
  return new NodeTaskExecutorClientError({
    operation,
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
    ...(recoveryKey === undefined ? {} : { recoveryKey }),
  });
}

export function makeNodeTaskExecutorHealthRequestV1(
  session: NodeTaskExecutorAcceptanceV1,
): NodeTaskExecutorHealthRequestV1 {
  return Object.freeze({
    format: NODE_TASK_EXECUTOR_HEALTH_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    sessionId: session.sessionId,
    recoveryKey: session.recoveryKey,
  });
}

export function makeNodeTaskExecutorInterruptionRequestV1(
  session: NodeTaskExecutorAcceptanceV1,
  cancellationGeneration: NodeTaskExecutorInterruptionRequestV1["cancellationGeneration"],
  reason: NodeTaskExecutorInterruptionRequestV1["reason"],
): NodeTaskExecutorInterruptionRequestV1 {
  return Object.freeze({
    format: NODE_TASK_EXECUTOR_INTERRUPTION_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    interruptionKey: makeNodeTaskExecutorInterruptionKeyV1(
      session.identity,
      session.executionId,
      cancellationGeneration,
    ),
    sessionId: session.sessionId,
    recoveryKey: session.recoveryKey,
    identity: session.identity,
    executionId: session.executionId,
    cancellationGeneration,
    reason,
  });
}

export function makeNodeTaskExecutorSettlementV1(
  acceptance: NodeTaskExecutorAcceptanceV1,
  outcome: NodeTaskExecutorSettlementV1["outcome"],
): NodeTaskExecutorSettlementV1 {
  return Object.freeze({
    format: NODE_TASK_EXECUTOR_SETTLEMENT_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    kind: "settled",
    generation: NODE_TASK_EXECUTOR_GENERATION_V1,
    sessionId: acceptance.sessionId,
    recoveryKey: acceptance.recoveryKey,
    identity: acceptance.identity,
    executionId: acceptance.executionId,
    outcome,
  });
}
