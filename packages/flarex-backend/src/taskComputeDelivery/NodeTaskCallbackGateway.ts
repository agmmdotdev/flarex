import {
  bytesEqualFullScan,
  copyBytes,
  isUint8Array,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  Clock,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Ref,
  Result,
  Scope,
} from "effect";
import {
  MAX_APPLICATION_TASK_MUTATION_CALLS_V1,
  MAX_APPLICATION_TASK_MUTATION_MILLISECONDS_V1,
  normalizeApplicationTaskMutationCallbackValueV1,
  type ApplicationTaskMutationCallbackFailureReasonV1,
  type ApplicationTaskMutationCallbackResultV1,
} from "flarex-protocol/internal/application-task-mutation-callback-v1";
import {
  MAX_APPLICATION_TASK_QUERY_CALLS_V1,
  MAX_APPLICATION_TASK_QUERY_MILLISECONDS_V1,
  normalizeApplicationTaskQueryCallbackValueV1,
  type ApplicationTaskQueryCallbackFailureReasonV1,
  type ApplicationTaskQueryCallbackResultV1,
} from "flarex-protocol/internal/application-task-query-callback-v1";

import type {
  ApplicationTaskMutationCallbackSession,
  ApplicationTaskMutationCallbackSessionFailure,
} from "./ApplicationTaskMutationCallback.js";
import type {
  ApplicationTaskQueryCallbackSession,
  ApplicationTaskQueryCallbackSessionFailure,
} from "./ApplicationTaskQueryCallback.js";
import {
  NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
  NODE_TASK_CALLBACK_ATTACHMENT_FORMAT_V1,
  NODE_TASK_CALLBACK_RESPONSE_FORMAT_V1,
  captureNodeTaskCallbackCredentialV1,
  decodeNodeTaskCallbackAttachmentAckForRequestV1,
  decodeNodeTaskCallbackRequestV1,
  type NodeTaskCallbackCredentialV1,
  type NodeTaskCallbackAttachmentV1,
  type NodeTaskCallbackRequestV1,
  type NodeTaskCallbackResponseV1,
} from "./NodeTaskCallbackProtocolV1.js";
import type { NodeTaskExecutorSession } from "./NodeTaskExecutorClient.js";
import type {
  NodeTaskExecutorAcceptanceV1,
  NodeTaskExecutorStartRequestV1,
} from "./NodeTaskExecutorProtocolV1.js";
import {
  decodeNodeTaskExecutorStartRequestV1,
  decodeNodeTaskExecutorStartResponseV1,
} from "./NodeTaskExecutorProtocolV1.js";

export interface NodeTaskCallbackGatewayOptions {
  readonly start: NodeTaskExecutorStartRequestV1;
  readonly executorSession: Pick<
    NodeTaskExecutorSession,
    "acceptance" | "attachCallbackCapability"
  >;
  /** Session already bound by the existing query authority to this launch. */
  readonly querySession: ApplicationTaskQueryCallbackSession;
  /** Session already bound by the existing mutation authority to this launch. */
  readonly mutationSession: ApplicationTaskMutationCallbackSession;
  /** Pre-issued launch credential. Reuse it for uncertain attachment retry. */
  readonly credential: Uint8Array;
  readonly maximumOperationMilliseconds?: number;
}

export type NodeTaskCallbackCapabilityV1 = NodeTaskCallbackAttachmentV1;

export interface NodeTaskCallbackGatewayLease {
  readonly capability: NodeTaskCallbackCapabilityV1;
  readonly invoke: (
    input: unknown,
  ) => Effect.Effect<NodeTaskCallbackResponseV1, NodeTaskCallbackGatewayError>;
  readonly close: Effect.Effect<void, NodeTaskCallbackGatewayError>;
}

export class NodeTaskCallbackGatewayError extends Data.TaggedError(
  "NodeTaskCallbackGatewayError",
)<{
  readonly operation: "bind" | "invoke" | "close";
  readonly reason:
    | "invalidBinding"
    | "invalidCredential"
    | "attachmentFailed"
    | "invalidRequest"
    | "authenticationFailed"
    | "correlationMismatch"
    | "sequenceMismatch"
    | "replayConflict"
    | "resourceExceeded"
    | "revoked"
    | "closeFailed";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

interface GatewayState {
  readonly closed: boolean;
  readonly nextSequence: bigint;
  readonly admittedCalls: number;
  readonly inFlightCalls: number;
  readonly inFlightMutations: number;
  readonly queryOrdinal: number;
  readonly mutationOrdinal: bigint;
  readonly entries: ReadonlyMap<bigint, InvocationEntry>;
}

interface InvocationEntry {
  readonly request: NodeTaskCallbackRequestV1;
  readonly queryOrdinal?: number;
  readonly completion: Deferred.Deferred<
    NodeTaskCallbackResponseV1,
    NodeTaskCallbackGatewayError
  >;
}

type AdmissionDecision =
  | Readonly<{ readonly kind: "new"; readonly entry: InvocationEntry }>
  | Readonly<{ readonly kind: "replay"; readonly entry: InvocationEntry }>
  | Readonly<{
      readonly kind: "rejected";
      readonly reason:
        | "revoked"
        | "sequenceMismatch"
        | "replayConflict"
        | "resourceExceeded";
      readonly retryable: boolean;
    }>;

class InvocationBoundaryFailure extends Data.TaggedError(
  "NodeTaskCallbackInvocationBoundaryFailure",
)<{ readonly reason: "timedOut" | "revoked" }> {}

/**
 * Scoped private provider channel. It issues no public route and executes no
 * database authority itself; every unique call delegates once to the query or
 * mutation session already bound by the existing Application authority.
 */
export const makeNodeTaskCallbackGateway = Effect.fn(
  "NodeTaskCallbackGateway.make",
)(function* (
  options: NodeTaskCallbackGatewayOptions,
): Effect.fn.Return<
  NodeTaskCallbackGatewayLease,
  NodeTaskCallbackGatewayError,
  Scope.Scope
> {
  const stableOptions: NodeTaskCallbackGatewayOptions = Object.freeze({
    start: options.start,
    executorSession: options.executorSession,
    querySession: options.querySession,
    mutationSession: options.mutationSession,
    credential: options.credential,
    ...(options.maximumOperationMilliseconds === undefined
      ? {}
      : { maximumOperationMilliseconds: options.maximumOperationMilliseconds }),
  });
  const querySession = captureQuerySession(stableOptions.querySession);
  const mutationSession = captureMutationSession(stableOptions.mutationSession);
  const mutationOwner = yield* makeMutationSessionOwner(mutationSession);
  yield* Effect.addFinalizer(() => mutationOwner.close.pipe(
    Effect.catchCause(cause => Effect.logError(
      "Node Task callback gateway cleanup failed.",
      cause,
    )),
  ));
  const captured = yield* Effect.fromResult(captureGatewayBinding(
    stableOptions,
    querySession,
    mutationSession,
  ));
  const credential = captureNodeTaskCallbackCredentialV1(
    stableOptions.credential,
  );
  if (credential === undefined) {
    return yield* gatewayFailure("bind", "invalidCredential", false);
  }
  const exposedCredential = captureNodeTaskCallbackCredentialV1(
    copyBytes(credential),
  );
  if (exposedCredential === undefined) {
    return yield* Effect.die(new Error(
      "Owned Node callback credential could not be captured.",
    ));
  }
  const gatewayScope = yield* Scope.Scope;
  const revoked = yield* Deferred.make<void, never>();
  const stateRef = yield* Ref.make<GatewayState>(Object.freeze({
    closed: false,
    nextSequence: 1n,
    admittedCalls: 0,
    inFlightCalls: 0,
    inFlightMutations: 0,
    queryOrdinal: 0,
    mutationOrdinal: 0n,
    entries: new Map(),
  }));
  const capability: NodeTaskCallbackCapabilityV1 = Object.freeze({
    format: NODE_TASK_CALLBACK_ATTACHMENT_FORMAT_V1,
    version: NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
    capabilityId: captured.capabilityId,
    credential: exposedCredential,
    startKey: captured.start.startKey,
    sessionId: captured.acceptance.sessionId,
    executionId: captured.acceptance.executionId,
    expiresAtEpochMilliseconds: captured.expiresAtEpochMilliseconds,
  });
  const invoke: NodeTaskCallbackGatewayLease["invoke"] = Effect.fn(
    "NodeTaskCallbackGateway.invoke",
  )(input => Effect.gen(function* () {
    const request = yield* Effect.fromResult(
      decodeNodeTaskCallbackRequestV1(input),
    ).pipe(Effect.mapError(cause => gatewayFailure(
      "invoke", "invalidRequest", false, cause,
    )));
    yield* authenticateRequest(request, capability, credential);
    return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const candidate: InvocationEntry = Object.freeze({
        request,
        completion: Deferred.makeUnsafe<
          NodeTaskCallbackResponseV1,
          NodeTaskCallbackGatewayError
        >(),
      });
      const decision = yield* Ref.modify(stateRef, state => admitInvocation(
        state,
        candidate,
        captured.maximumCalls,
        captured.maximumConcurrentCalls,
      ));
      if (decision.kind === "rejected") {
        return yield* gatewayFailure(
          "invoke",
          decision.reason,
          decision.retryable,
        );
      }
      if (decision.kind === "new") {
        yield* Effect.forkIn(
          completeInvocation(
            decision.entry,
            captured,
            stateRef,
            revoked,
            mutationOwner.close,
          ),
          gatewayScope,
          { startImmediately: true },
        );
      }
      return yield* restore(Deferred.await(decision.entry.completion));
    }));
  }));

  const attachmentAck = yield* stableOptions.executorSession
    .attachCallbackCapability(capability, invoke).pipe(
      Effect.mapError(cause => gatewayFailure(
        "bind", "attachmentFailed", cause.retryable, cause,
      )),
    );
  yield* Effect.fromResult(decodeNodeTaskCallbackAttachmentAckForRequestV1(
    attachmentAck,
    capability,
  )).pipe(Effect.mapError(cause => gatewayFailure(
    "bind", "attachmentFailed", false, cause,
  )));

  const close = Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    const first = yield* Ref.modify(stateRef, state => state.closed
      ? [false, state] as const
      : [true, Object.freeze({ ...state, closed: true })] as const);
    if (first) yield* Deferred.succeed(revoked, undefined);
    return yield* restore(mutationOwner.close);
  }));

  yield* Effect.addFinalizer(() => close.pipe(
    Effect.catchCause(cause => Effect.logError(
      "Node Task callback gateway cleanup failed.",
      cause,
    )),
  ));
  return Object.freeze({ capability, invoke, close });
});

function captureQuerySession(
  session: ApplicationTaskQueryCallbackSession,
): ApplicationTaskQueryCallbackSession {
  const runQuery = session.runQuery;
  const capturedRunQuery: ApplicationTaskQueryCallbackSession["runQuery"] =
    (functionPath, argumentsValue) => runQuery.call(
      session,
      functionPath,
      argumentsValue,
    );
  return Object.freeze({
    runQuery: capturedRunQuery,
  });
}

function captureMutationSession(
  session: ApplicationTaskMutationCallbackSession,
): ApplicationTaskMutationCallbackSession {
  const maximumCloseMilliseconds = session.maximumCloseMilliseconds;
  const runMutation = session.runMutation;
  const close = session.close;
  const capturedRunMutation:
    ApplicationTaskMutationCallbackSession["runMutation"] =
      (ordinal, functionPath, argumentsValue) => runMutation.call(
        session,
        ordinal,
        functionPath,
        argumentsValue,
      );
  return Object.freeze({
    maximumCloseMilliseconds,
    runMutation: capturedRunMutation,
    close,
  });
}

function makeMutationSessionOwner(
  session: ApplicationTaskMutationCallbackSession,
): Effect.Effect<
  Readonly<{ readonly close: Effect.Effect<void, NodeTaskCallbackGatewayError> }>
> {
  return Effect.gen(function* () {
    const started = yield* Ref.make(false);
    const completion = yield* Deferred.make<
      void,
      NodeTaskCallbackGatewayError
    >();
    const closeTimeout = Number.isSafeInteger(session.maximumCloseMilliseconds) &&
        session.maximumCloseMilliseconds > 0
      ? Math.min(
          session.maximumCloseMilliseconds,
          MAX_APPLICATION_TASK_MUTATION_MILLISECONDS_V1,
        )
      : MAX_APPLICATION_TASK_MUTATION_MILLISECONDS_V1;
    const close = Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const first = yield* Ref.modify(started, value => [!value, true] as const);
      if (!first) return yield* restore(Deferred.await(completion));
      const settle = session.close.pipe(
        Effect.mapError(cause => gatewayFailure(
          "close", "closeFailed", false, cause,
        )),
        Effect.timeoutOrElse({
          duration: `${closeTimeout} millis`,
          orElse: () => Effect.fail(gatewayFailure(
            "close", "closeFailed", false,
          )),
        }),
        Effect.exit,
        Effect.flatMap(exit => Deferred.done(completion, exit)),
      );
      yield* Effect.forkDetach(settle, {
        startImmediately: true,
      });
      return yield* restore(Deferred.await(completion));
    }));
    return Object.freeze({ close });
  });
}

function captureGatewayBinding(
  options: NodeTaskCallbackGatewayOptions,
  querySession: ApplicationTaskQueryCallbackSession,
  mutationSession: ApplicationTaskMutationCallbackSession,
): Result.Result<
  Readonly<{
    readonly start: NodeTaskExecutorStartRequestV1;
    readonly acceptance: NodeTaskExecutorAcceptanceV1;
    readonly capabilityId: string;
    readonly expiresAtEpochMilliseconds: number;
    readonly maximumCalls: number;
    readonly maximumConcurrentCalls: number;
    readonly maximumOperationMilliseconds: number;
    readonly querySession: ApplicationTaskQueryCallbackSession;
    readonly mutationSession: ApplicationTaskMutationCallbackSession;
  }>,
  NodeTaskCallbackGatewayError
> {
  return Result.gen(function* () {
    const start = yield* decodeNodeTaskExecutorStartRequestV1(
      options.start,
    ).pipe(Result.mapError(cause => gatewayFailure(
      "bind", "invalidBinding", false, cause,
    )));
    const startResponse = yield* decodeNodeTaskExecutorStartResponseV1(
      options.executorSession.acceptance,
    ).pipe(Result.mapError(cause => gatewayFailure(
      "bind", "invalidBinding", false, cause,
    )));
    if (startResponse.kind !== "accepted") {
      return yield* Result.fail(gatewayFailure(
        "bind", "invalidBinding", false,
      ));
    }
    const acceptance = startResponse;
    const maximumOperationMilliseconds = options.maximumOperationMilliseconds ??
      Math.min(
        MAX_APPLICATION_TASK_QUERY_MILLISECONDS_V1,
        MAX_APPLICATION_TASK_MUTATION_MILLISECONDS_V1,
      );
    if (
      acceptance.startKey !== start.startKey ||
      acceptance.recoveryKey !== start.recoveryKey ||
      acceptance.executionId !== start.executionId ||
      !identitiesEqual(acceptance.identity, start.dispatch.identity) ||
      acceptance.cancellationGeneration !==
        start.dispatch.cancellation.generation ||
      start.launchCapability.boundStartKey !== start.startKey ||
      start.launchCapability.expiresAtEpochMilliseconds >
        start.absoluteDeadlineEpochMilliseconds ||
      !Number.isSafeInteger(maximumOperationMilliseconds) ||
      maximumOperationMilliseconds <= 0 ||
      maximumOperationMilliseconds >
        MAX_APPLICATION_TASK_QUERY_MILLISECONDS_V1 ||
      maximumOperationMilliseconds >
        MAX_APPLICATION_TASK_MUTATION_MILLISECONDS_V1 ||
      !Number.isSafeInteger(mutationSession.maximumCloseMilliseconds) ||
      mutationSession.maximumCloseMilliseconds <= 0 ||
      mutationSession.maximumCloseMilliseconds >
        MAX_APPLICATION_TASK_MUTATION_MILLISECONDS_V1
    ) return yield* Result.fail(gatewayFailure(
      "bind", "invalidBinding", false,
    ));
    return Object.freeze({
      start,
      acceptance,
      capabilityId: start.launchCapability.capabilityId,
      expiresAtEpochMilliseconds:
        start.launchCapability.expiresAtEpochMilliseconds,
      maximumCalls: start.resourcePolicy.maximumCallbackCalls,
      maximumConcurrentCalls:
        start.resourcePolicy.maximumCallbackConcurrency,
      maximumOperationMilliseconds,
      querySession,
      mutationSession,
    });
  });
}

function authenticateRequest(
  request: NodeTaskCallbackRequestV1,
  capability: NodeTaskCallbackCapabilityV1,
  credential: NodeTaskCallbackCredentialV1,
): Effect.Effect<void, NodeTaskCallbackGatewayError> {
  return Clock.currentTimeMillis.pipe(Effect.flatMap(observedNow => {
    if (observedNow >= capability.expiresAtEpochMilliseconds) {
      return Effect.fail(gatewayFailure("invoke", "revoked", false));
    }
    if (request.capabilityId !== capability.capabilityId ||
      !bytesEqualFullScan(request.credential, credential)) {
      return Effect.fail(gatewayFailure(
        "invoke", "authenticationFailed", false,
      ));
    }
    if (request.startKey !== capability.startKey ||
      request.sessionId !== capability.sessionId ||
      request.executionId !== capability.executionId) {
      return Effect.fail(gatewayFailure(
        "invoke", "correlationMismatch", false,
      ));
    }
    return Effect.void;
  }));
}

function admitInvocation(
  state: GatewayState,
  candidate: InvocationEntry,
  maximumCalls: number,
  maximumConcurrentCalls: number,
): readonly [AdmissionDecision, GatewayState] {
  const sequence = candidate.request.sequence;
  const previous = state.entries.get(sequence);
  if (previous !== undefined) {
    return [
      requestsEqual(previous.request, candidate.request)
        ? Object.freeze({ kind: "replay", entry: previous })
        : Object.freeze({
            kind: "rejected", reason: "replayConflict", retryable: false,
          }),
      state,
    ];
  }
  if (state.closed) {
    return [Object.freeze({
      kind: "rejected", reason: "revoked", retryable: false,
    }), state];
  }
  if (sequence !== state.nextSequence) {
    return [Object.freeze({
      kind: "rejected",
      reason: "sequenceMismatch",
      retryable: false,
    }), state];
  }
  if (state.admittedCalls >= maximumCalls ||
    candidate.request.operation === "runQuery" &&
      state.queryOrdinal >= MAX_APPLICATION_TASK_QUERY_CALLS_V1 ||
    candidate.request.operation === "runMutation" &&
      state.mutationOrdinal >=
        BigInt(MAX_APPLICATION_TASK_MUTATION_CALLS_V1)) {
    return [Object.freeze({
      kind: "rejected",
      reason: "resourceExceeded",
      retryable: false,
    }), state];
  }
  if (state.inFlightCalls >= maximumConcurrentCalls ||
    candidate.request.operation === "runMutation" &&
      state.inFlightMutations >= 1) {
    return [Object.freeze({
      kind: "rejected",
      reason: "resourceExceeded",
      retryable: true,
    }), state];
  }
  if (candidate.request.operation === "runMutation" &&
    candidate.request.payload.ordinal !== state.mutationOrdinal + 1n) {
    return [Object.freeze({
      kind: "rejected",
      reason: "sequenceMismatch",
      retryable: false,
    }), state];
  }
  const queryOrdinal = candidate.request.operation === "runQuery"
    ? state.queryOrdinal + 1
    : undefined;
  const entry: InvocationEntry = Object.freeze({
    ...candidate,
    ...(queryOrdinal === undefined ? {} : { queryOrdinal }),
  });
  const entries = new Map(state.entries);
  entries.set(sequence, entry);
  return [Object.freeze({ kind: "new", entry }), Object.freeze({
    ...state,
    nextSequence: state.nextSequence + 1n,
    admittedCalls: state.admittedCalls + 1,
    inFlightCalls: state.inFlightCalls + 1,
    inFlightMutations: state.inFlightMutations +
      (candidate.request.operation === "runMutation" ? 1 : 0),
    queryOrdinal: queryOrdinal ?? state.queryOrdinal,
    mutationOrdinal: candidate.request.operation === "runMutation"
      ? candidate.request.payload.ordinal
      : state.mutationOrdinal,
    entries,
  })];
}

const completeInvocation = Effect.fn(
  "NodeTaskCallbackGateway.completeInvocation",
)(function* (
  entry: InvocationEntry,
  captured: Readonly<{
    readonly expiresAtEpochMilliseconds: number;
    readonly maximumOperationMilliseconds: number;
    readonly querySession: ApplicationTaskQueryCallbackSession;
    readonly mutationSession: ApplicationTaskMutationCallbackSession;
  }>,
  stateRef: Ref.Ref<GatewayState>,
  revoked: Deferred.Deferred<void, never>,
  closeMutationSession: Effect.Effect<void, NodeTaskCallbackGatewayError>,
) {
  const completed = yield* executeInvocation(
    entry,
    captured,
    stateRef,
    revoked,
    closeMutationSession,
  ).pipe(
    Effect.exit,
  );
  yield* Effect.uninterruptible(Ref.update(stateRef, state => Object.freeze({
    ...state,
    inFlightCalls: state.inFlightCalls - 1,
    inFlightMutations: state.inFlightMutations -
      (entry.request.operation === "runMutation" ? 1 : 0),
  })).pipe(Effect.andThen(Deferred.done(entry.completion, completed))));
});

function executeInvocation(
  entry: InvocationEntry,
  captured: Readonly<{
    readonly expiresAtEpochMilliseconds: number;
    readonly maximumOperationMilliseconds: number;
    readonly querySession: ApplicationTaskQueryCallbackSession;
    readonly mutationSession: ApplicationTaskMutationCallbackSession;
  }>,
  stateRef: Ref.Ref<GatewayState>,
  revoked: Deferred.Deferred<void, never>,
  closeMutationSession: Effect.Effect<void, NodeTaskCallbackGatewayError>,
): Effect.Effect<NodeTaskCallbackResponseV1, NodeTaskCallbackGatewayError> {
  const request = entry.request;
  return Effect.gen(function* () {
    const observedNow = yield* Clock.currentTimeMillis;
    const deadline = Math.min(
      captured.expiresAtEpochMilliseconds,
      observedNow + captured.maximumOperationMilliseconds,
    );
    if (deadline <= observedNow) {
      return makeBoundaryFailureResponse(
        entry,
        Math.max(1, deadline),
        "timed_out",
      );
    }
    if (request.operation === "runMutation") {
      return yield* superviseMutationInvocation(
        entry,
        captured.mutationSession,
        deadline,
        observedNow,
        stateRef,
        revoked,
        closeMutationSession,
      );
    }
    return yield* Effect.raceFirst(
      runQuery(entry, captured.querySession, deadline),
      Deferred.await(revoked).pipe(Effect.andThen(Effect.fail(
        new InvocationBoundaryFailure({ reason: "revoked" }),
      ))),
    ).pipe(
      Effect.timeoutOrElse({
        duration: `${deadline - observedNow} millis`,
        orElse: () => Effect.fail(
          new InvocationBoundaryFailure({ reason: "timedOut" }),
        ),
      }),
      Effect.catchTag("NodeTaskCallbackInvocationBoundaryFailure", failure =>
        Effect.succeed(makeBoundaryFailureResponse(
          entry,
          deadline,
          failure.reason === "revoked" ? "interrupted" : "timed_out",
        ))),
    );
  });
}

function superviseMutationInvocation(
  entry: InvocationEntry,
  session: ApplicationTaskMutationCallbackSession,
  deadline: number,
  observedNow: number,
  stateRef: Ref.Ref<GatewayState>,
  revoked: Deferred.Deferred<void, never>,
  closeMutationSession: Effect.Effect<void, NodeTaskCallbackGatewayError>,
): Effect.Effect<NodeTaskCallbackResponseV1> {
  if (entry.request.operation !== "runMutation") {
    return Effect.die(new Error("Invalid Node mutation callback entry."));
  }
  const operation = runMutation(entry, session, deadline).pipe(
    Effect.forkChild,
  );
  return Effect.gen(function* () {
    const fiber = yield* operation;
    const winner = yield* Effect.raceFirst(
      Fiber.await(fiber).pipe(Effect.map(exit => Object.freeze({
        kind: "completed" as const,
        exit,
      }))),
      Effect.raceFirst(
        Effect.sleep(`${deadline - observedNow} millis`).pipe(
          Effect.as(Object.freeze({ kind: "timedOut" as const })),
        ),
        Deferred.await(revoked).pipe(
          Effect.as(Object.freeze({ kind: "revoked" as const })),
        ),
      ),
    );
    if (winner.kind === "completed") {
      return yield* Exit.match(winner.exit, {
        onFailure: () => Effect.succeed(mutationUncertainResponse(entry, deadline)),
        onSuccess: Effect.succeed,
      });
    }
    if (winner.kind === "timedOut") {
      yield* Ref.update(stateRef, state => state.closed
        ? state
        : Object.freeze({ ...state, closed: true }));
      yield* Deferred.succeed(revoked, undefined);
    }
    const closeExit = yield* Effect.exit(closeMutationSession);
    if (Exit.isFailure(closeExit)) {
      yield* Effect.yieldNow;
      const settled = fiber.pollUnsafe();
      if (settled !== undefined) {
        return yield* Exit.match(settled, {
          onFailure: () => Effect.succeed(
            mutationUncertainResponse(entry, deadline),
          ),
          onSuccess: Effect.succeed,
        });
      }
      return mutationUncertainResponse(entry, deadline);
    }
    const settled = yield* Fiber.await(fiber);
    return yield* Exit.match(settled, {
      onFailure: () => Effect.succeed(mutationUncertainResponse(entry, deadline)),
      onSuccess: Effect.succeed,
    });
  });
}

function mutationUncertainResponse(
  entry: InvocationEntry,
  deadline: number,
): NodeTaskCallbackResponseV1 {
  if (entry.request.operation !== "runMutation") {
    throw new Error("Invalid Node mutation callback entry.");
  }
  return makeMutationResponse(entry.request, mutationFailureResult(
    `${entry.request.executionId}:mutation:${entry.request.payload.ordinal}`,
    deadline,
    "outcome_uncertain",
  ));
}

function runQuery(
  entry: InvocationEntry,
  session: ApplicationTaskQueryCallbackSession,
  deadline: number,
): Effect.Effect<NodeTaskCallbackResponseV1> {
  if (entry.request.operation !== "runQuery" || entry.queryOrdinal === undefined) {
    return Effect.die(new Error("Invalid Node query callback entry."));
  }
  const request = entry.request;
  const callId = `${request.executionId}:query:${entry.queryOrdinal}`;
  return session.runQuery(
    request.payload.functionPath,
    request.payload.arguments,
  ).pipe(
    Effect.match({
      onFailure: failure => makeQueryResponse(request, queryFailureResult(
        callId,
        deadline,
        mapQueryFailure(failure),
      )),
      onSuccess: value => normalizeApplicationTaskQueryCallbackValueV1(
        value,
        "result",
      ).pipe(Result.match({
        onFailure: cause => makeQueryResponse(request, queryFailureResult(
          callId,
          deadline,
          cause.reason === "resource_exceeded"
            ? "resource_exceeded"
            : "invalid_result",
        )),
        onSuccess: normalized => makeQueryResponse(
          request,
          Object.freeze({
            format: "flarex.application-task-query-callback" as const,
            version: 1 as const,
            kind: "success" as const,
            callId,
            deadlineMs: deadline,
            value: normalized.value,
            valueSemanticBytes: normalized.semanticSizeBytes,
          }),
        ),
      })),
    }),
  );
}

function runMutation(
  entry: InvocationEntry,
  session: ApplicationTaskMutationCallbackSession,
  deadline: number,
): Effect.Effect<NodeTaskCallbackResponseV1> {
  if (entry.request.operation !== "runMutation") {
    return Effect.die(new Error("Invalid Node mutation callback entry."));
  }
  const request = entry.request;
  const callId = `${request.executionId}:mutation:${request.payload.ordinal}`;
  return session.runMutation(
    request.payload.ordinal,
    request.payload.functionPath,
    request.payload.arguments,
  ).pipe(
    Effect.match({
      onFailure: failure => makeMutationResponse(request, mutationFailureResult(
        callId,
        deadline,
        mapMutationFailure(failure),
      )),
      onSuccess: value => normalizeApplicationTaskMutationCallbackValueV1(
        value,
        "result",
      ).pipe(Result.match({
        onFailure: cause => makeMutationResponse(request, mutationFailureResult(
          callId,
          deadline,
          cause.reason === "resource_exceeded"
            ? "resource_exceeded"
            : "invalid_result",
        )),
        onSuccess: normalized => makeMutationResponse(
          request,
          Object.freeze({
            format: "flarex.application-task-mutation-callback" as const,
            version: 1 as const,
            kind: "success" as const,
            callId,
            deadlineMs: deadline,
            value: normalized.value,
            valueSemanticBytes: normalized.semanticSizeBytes,
          }),
        ),
      })),
    }),
  );
}

function makeBoundaryFailureResponse(
  entry: InvocationEntry,
  deadline: number,
  reason: "interrupted" | "timed_out",
): NodeTaskCallbackResponseV1 {
  const request = entry.request;
  return request.operation === "runQuery"
    ? makeQueryResponse(request, queryFailureResult(
        `${request.executionId}:query:${entry.queryOrdinal ?? 1}`,
        deadline,
        reason,
      ))
    : makeMutationResponse(request, mutationFailureResult(
        `${request.executionId}:mutation:${request.payload.ordinal}`,
        deadline,
        reason,
      ));
}

function responseCommon(request: NodeTaskCallbackRequestV1) {
  return Object.freeze({
    format: NODE_TASK_CALLBACK_RESPONSE_FORMAT_V1,
    version: NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
    capabilityId: request.capabilityId,
    startKey: request.startKey,
    sessionId: request.sessionId,
    executionId: request.executionId,
    sequence: request.sequence,
    requestId: request.requestId,
  });
}

function makeQueryResponse(
  request: Extract<NodeTaskCallbackRequestV1, { readonly operation: "runQuery" }>,
  result: ApplicationTaskQueryCallbackResultV1,
): NodeTaskCallbackResponseV1 {
  return Object.freeze({
    ...responseCommon(request),
    operation: "runQuery" as const,
    result,
  });
}

function makeMutationResponse(
  request: Extract<
    NodeTaskCallbackRequestV1,
    { readonly operation: "runMutation" }
  >,
  result: ApplicationTaskMutationCallbackResultV1,
): NodeTaskCallbackResponseV1 {
  return Object.freeze({
    ...responseCommon(request),
    operation: "runMutation" as const,
    result,
  });
}

function queryFailureResult(
  callId: string,
  deadlineMs: number,
  reason: ApplicationTaskQueryCallbackFailureReasonV1,
): ApplicationTaskQueryCallbackResultV1 {
  return Object.freeze({
    format: "flarex.application-task-query-callback" as const,
    version: 1 as const,
    kind: "failure" as const,
    callId,
    deadlineMs,
    reason,
  });
}

function mutationFailureResult(
  callId: string,
  deadlineMs: number,
  reason: ApplicationTaskMutationCallbackFailureReasonV1,
): ApplicationTaskMutationCallbackResultV1 {
  return Object.freeze({
    format: "flarex.application-task-mutation-callback" as const,
    version: 1 as const,
    kind: "failure" as const,
    callId,
    deadlineMs,
    reason,
  });
}

function mapQueryFailure(
  failure: ApplicationTaskQueryCallbackSessionFailure,
): ApplicationTaskQueryCallbackFailureReasonV1 {
  switch (failure.reason) {
    case "invalidInput": return "invalid_request";
    case "staleLaunch": return "stale_launch";
    case "invalidResult": return "invalid_result";
    case "activationUnavailable":
    case "invalidComposition":
    case "queryFailed": return "query_failed";
  }
}

function mapMutationFailure(
  failure: ApplicationTaskMutationCallbackSessionFailure,
): ApplicationTaskMutationCallbackFailureReasonV1 {
  switch (failure.reason) {
    case "invalidInput": return "invalid_request";
    case "staleLaunch": return "stale_launch";
    case "sequenceMismatch": return "sequence_mismatch";
    case "replayConflict": return "replay_conflict";
    case "mutationFailed": return "mutation_failed";
    case "outcomeUncertain": return "outcome_uncertain";
    case "invalidResult": return "invalid_result";
    case "resourceExceeded": return "resource_exceeded";
  }
}

function requestsEqual(
  left: NodeTaskCallbackRequestV1,
  right: NodeTaskCallbackRequestV1,
): boolean {
  return left.operation === right.operation &&
    left.capabilityId === right.capabilityId &&
    bytesEqualFullScan(left.credential, right.credential) &&
    left.startKey === right.startKey && left.sessionId === right.sessionId &&
    left.executionId === right.executionId && left.sequence === right.sequence &&
    left.requestId === right.requestId &&
    unknownDataEqual(left.payload, right.payload);
}

function unknownDataEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (isUint8Array(left) || isUint8Array(right)) {
    return isUint8Array(left) && isUint8Array(right) &&
      bytesEqualFullScan(left, right);
  }
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

function identitiesEqual(
  left: NodeTaskExecutorAcceptanceV1["identity"],
  right: NodeTaskExecutorStartRequestV1["dispatch"]["identity"],
): boolean {
  return left.scopeId === right.scopeId && left.runId === right.runId &&
    left.requestedEffectSequence === right.requestedEffectSequence &&
    left.attemptId === right.attemptId &&
    left.executionFence === right.executionFence;
}

function gatewayFailure(
  operation: NodeTaskCallbackGatewayError["operation"],
  reason: NodeTaskCallbackGatewayError["reason"],
  retryable: boolean,
  cause?: unknown,
): NodeTaskCallbackGatewayError {
  return new NodeTaskCallbackGatewayError({
    operation,
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}
