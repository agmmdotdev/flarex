import { Clock, Data, Effect, Exit, Fiber, Result } from "effect";
import {
  TASK_WORKER_SESSION_START_FORMAT_V1,
  TASK_WORKER_SESSION_START_VERSION_V1,
  TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
  TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
  decodeTaskWorkerSessionAcceptanceV1,
  decodeTaskWorkerSessionInterruptionAcceptanceV1,
  decodeTaskWorkerSessionInterruptionRequestV1,
  decodeTaskWorkerSessionSettlementV1,
  decodeTaskWorkerSessionStartRequestV1,
  taskWorkerSessionIdentitiesEqualV1,
  type TaskWorkerSessionAcceptanceV1,
  type TaskWorkerSessionInterruptionAcceptanceV1,
  type TaskWorkerSessionInterruptionReasonV1,
  type TaskWorkerSessionSettlementV1,
  type TaskWorkerSessionStartRequestV1,
} from "flarex-protocol/internal/task-worker-session-v1";
import type { ApplicationTaskWorkerInputCapabilityV1 } from
  "flarex-protocol/internal/application-task-worker-v1";
import type { LegacyTaskWorkerInputCapabilityV1 } from
  "flarex-protocol/internal/legacy-task-worker-v1";

import {
  APPLICATION_TASK_WORKER_ENTRYPOINT,
  type ApplicationTaskWorkerDefinition,
} from "./ApplicationTaskWorkerDefinition";
import {
  LEGACY_TASK_WORKER_ENTRYPOINT,
  type LegacyTaskWorkerDefinition,
} from "./LegacyTaskWorkerDefinition";
import { callOwnedWorkerRpc } from "./WorkerRpcResult";

const DEFAULT_HANDSHAKE_MILLISECONDS = 10_000;

export class TaskWorkerSessionHostError extends Data.TaggedError(
  "TaskWorkerSessionHostError",
)<{
  readonly operation: "start" | "requestInterruption" | "settlement" | "close";
  readonly reason:
    | "invalidRequest"
    | "workerLoadFailed"
    | "workerStartFailed"
    | "invalidResponse"
    | "sessionLost"
    | "staleCancellation"
    | "workerDefinitionFailed"
    | "inputBoundaryFailed"
    | "userCodeFailed"
    | "terminalFailed"
    | "timedOut"
    | "cleanupFailed";
  readonly cause?: unknown;
}> {}

type ApplicationStartInput = Readonly<{
  readonly generation: "application_v1";
  readonly definition: ApplicationTaskWorkerDefinition;
  readonly request: unknown;
  readonly capability: ApplicationTaskWorkerInputCapabilityV1;
  readonly executionId: string;
}>;

type LegacyStartInput = Readonly<{
  readonly generation: "legacy_dynamic_worker_v1";
  readonly definition: LegacyTaskWorkerDefinition;
  readonly request: unknown;
  readonly capability: LegacyTaskWorkerInputCapabilityV1;
  readonly executionId: string;
}>;

export type TaskWorkerSessionHostStartInput = ApplicationStartInput | LegacyStartInput;

export interface TaskWorkerSession {
  readonly acceptance: TaskWorkerSessionAcceptanceV1;
  readonly requestInterruption: (
    request: unknown,
  ) => Effect.Effect<
    TaskWorkerSessionInterruptionAcceptanceV1,
    TaskWorkerSessionHostError
  >;
  readonly settlement: Effect.Effect<
    TaskWorkerSessionSettlementV1,
    TaskWorkerSessionHostError
  >;
  readonly close: Effect.Effect<void, TaskWorkerSessionHostError>;
}

export interface TaskWorkerSessionHost {
  readonly start: (
    input: TaskWorkerSessionHostStartInput,
  ) => Effect.Effect<TaskWorkerSession, TaskWorkerSessionHostError>;
}

interface RemoteTaskWorkerSession {
  readonly receiver: object;
  readonly acceptance: () => PromiseLike<unknown>;
  readonly requestInterruption: (request: unknown) => PromiseLike<unknown>;
  readonly settlement: () => PromiseLike<unknown>;
}

interface TaskWorkerSessionEntrypoint extends Rpc.WorkerEntrypointBranded {
  readonly start: (
    request: TaskWorkerSessionStartRequestV1,
    capability: unknown,
  ) => PromiseLike<unknown>;
}

export function makeTaskWorkerSessionHost(
  loader: WorkerLoader,
  options: Readonly<{ readonly handshakeMilliseconds?: number }> = {},
): TaskWorkerSessionHost {
  const handshakeMilliseconds = options.handshakeMilliseconds ??
    DEFAULT_HANDSHAKE_MILLISECONDS;
  if (!Number.isSafeInteger(handshakeMilliseconds) || handshakeMilliseconds <= 0) {
    throw new Error("Task Worker session handshake duration must be a positive safe integer.");
  }
  const start: TaskWorkerSessionHost["start"] = Effect.fn(
    "TaskWorkerSessionHost.start",
  )(input => Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    const startRequest = yield* decodeStartInput(input);
    const startedAt = yield* Clock.currentTimeMillis;
    const deadline = startedAt + startRequest.request.dispatch.maximumDurationMs;
    const code = workerCode(input);
    const entrypoint = yield* Effect.try({
      try: () => loader.load(code).getEntrypoint<TaskWorkerSessionEntrypoint>(
        input.generation === "application_v1"
          ? APPLICATION_TASK_WORKER_ENTRYPOINT
          : LEGACY_TASK_WORKER_ENTRYPOINT,
      ),
      catch: cause => hostError("start", "workerLoadFailed", cause),
    });
    const startWallMilliseconds = yield* remainingWallMilliseconds(
      deadline,
      "start",
      handshakeMilliseconds,
    );
    const lease = createRpcTargetLease();
    let transferred = false;
    return yield* Effect.gen(function* () {
      const rawSession = yield* restore(Effect.tryPromise({
        try: signal => awaitRpcTarget(
          () => entrypoint.start(startRequest, input.capability),
          signal,
          lease,
        ),
        catch: cause => expectedWorkerFailure("start", cause) ??
          hostError("start", "workerStartFailed", cause),
      }).pipe(
        Effect.timeoutOrElse({
          duration: `${startWallMilliseconds} millis`,
          orElse: () => Effect.fail(hostError("start", "timedOut")),
        }),
      ));
      const remote = yield* Effect.fromResult(captureRemoteSession(rawSession));
      const acceptanceWallMilliseconds = yield* remainingWallMilliseconds(
        deadline,
        "start",
        handshakeMilliseconds,
      );
      const rawAcceptance = yield* restore(callOwnedWorkerRpc({
        wallMilliseconds: acceptanceWallMilliseconds,
        invoke: remote.acceptance,
        mapExpectedFailure: cause => expectedWorkerFailure("start", cause) ??
          hostError("start", "workerStartFailed", cause),
        timedOut: () => hostError("start", "timedOut"),
        invalidResult: cause => hostError("start", "invalidResponse", cause),
      }));
      const acceptance = yield* Effect.fromResult(
        decodeTaskWorkerSessionAcceptanceV1(rawAcceptance),
      ).pipe(Effect.mapError(cause => hostError("start", "invalidResponse", cause)));
      if (!acceptanceMatchesStart(acceptance, startRequest)) {
        return yield* hostError("start", "invalidResponse");
      }
      lease.transfer();
      transferred = true;
      return yield* makeSession(
        remote,
        acceptance,
        startRequest,
        handshakeMilliseconds,
        deadline,
      );
    }).pipe(Effect.ensuring(Effect.sync(() => {
      if (!transferred) lease.dispose();
    })));
  })));
  return Object.freeze({ start });
}

function decodeStartInput(
  input: TaskWorkerSessionHostStartInput,
): Effect.Effect<TaskWorkerSessionStartRequestV1, TaskWorkerSessionHostError> {
  const supplied = {
    format: TASK_WORKER_SESSION_START_FORMAT_V1,
    version: TASK_WORKER_SESSION_START_VERSION_V1,
    generation: input.generation,
    executionId: input.executionId,
    request: input.request,
  };
  return Effect.fromResult(decodeTaskWorkerSessionStartRequestV1(supplied)).pipe(
    Effect.mapError(cause => hostError("start", "invalidRequest", cause)),
    Effect.filterOrFail(
      request => definitionMatchesStart(input, request),
      () => hostError("start", "invalidRequest"),
    ),
  );
}

function definitionMatchesStart(
  input: TaskWorkerSessionHostStartInput,
  start: TaskWorkerSessionStartRequestV1,
): boolean {
  if (input.generation !== start.generation) return false;
  if (start.generation === "application_v1" && input.generation === "application_v1") {
    return hex(start.request.dispatch.applicationTaskRuntimeTargetSha256) ===
        input.definition.runtimeTargetSha256Hex &&
      start.request.dispatch.computeProfile === input.definition.computeProfile &&
      start.request.dispatch.maximumDurationMs <= input.definition.wallMilliseconds;
  }
  if (start.generation === "legacy_dynamic_worker_v1" &&
    input.generation === "legacy_dynamic_worker_v1") {
    return start.request.dispatch.taskDefinitionRevisionId ===
        input.definition.taskDefinitionRevisionId &&
      start.request.dispatch.computeProfile === input.definition.computeProfile &&
      start.request.dispatch.maximumDurationMs <= input.definition.wallMilliseconds;
  }
  return false;
}

function workerCode(input: TaskWorkerSessionHostStartInput): WorkerLoaderWorkerCode {
  const shared = {
    compatibilityDate: input.definition.compatibilityDate,
    mainModule: input.definition.mainModule,
    modules: input.definition.modules,
    env: input.definition.env,
    limits: input.definition.limits,
    globalOutbound: null,
  };
  return input.generation === "application_v1"
    ? shared
    : { ...shared, compatibilityFlags: [...input.definition.compatibilityFlags] };
}

function makeSession(
  remote: RemoteTaskWorkerSession,
  acceptance: TaskWorkerSessionAcceptanceV1,
  startRequest: TaskWorkerSessionStartRequestV1,
  handshakeMilliseconds: number,
  deadline: number,
): Effect.Effect<TaskWorkerSession, TaskWorkerSessionHostError> {
  return Effect.gen(function* () {
  let closed = false;
  let closeReason: "sessionLost" | "timedOut" = "sessionLost";
  let acceptedCancellationGeneration = acceptance.cancellationGeneration;
  let acceptedInterruptionReason: TaskWorkerSessionInterruptionReasonV1 | undefined =
    startRequest.request.dispatch.cancellation.kind === "requested"
      ? "cancellation_requested"
      : undefined;
  const interruptionCandidates: Array<Readonly<{
    readonly cancellationGeneration: bigint;
    readonly reason: TaskWorkerSessionInterruptionReasonV1;
  }>> = startRequest.request.dispatch.cancellation.kind === "requested"
    ? [Object.freeze({
        cancellationGeneration: startRequest.request.dispatch.cancellation.generation,
        reason: "cancellation_requested" as const,
      })]
    : [];
  const recordInterruptionCandidate = (
    cancellationGeneration: bigint,
    reason: TaskWorkerSessionInterruptionReasonV1,
  ): void => {
    if (interruptionCandidates.some(candidate =>
      candidate.cancellationGeneration === cancellationGeneration &&
      candidate.reason === reason
    )) return;
    interruptionCandidates.push(Object.freeze({ cancellationGeneration, reason }));
  };
  let terminalObserved = false;
  let cleanupCause: unknown;
  let backgroundCause: unknown;
  let closeDeliveryCause: unknown;
  let expiryStarted = false;
  let expiryFinished = false;
  let inFlight = 0;
  let disposed = false;
  let resolveDrained!: () => void;
  const drained = new Promise<void>(resolve => { resolveDrained = resolve; });
  const finishClose = (): void => {
    if (disposed) return;
    disposed = true;
    try {
      disposeRpcValue(remote.receiver);
    } catch (cause) {
      cleanupCause = cause;
    } finally {
      resolveDrained();
    }
  };
  const beginClose = (reason: "sessionLost" | "timedOut"): void => {
    if (closed) return;
    closed = true;
    closeReason = reason;
    if (inFlight === 0) finishClose();
  };
  const beginOperation = (
    operation: TaskWorkerSessionHostError["operation"],
  ): void => {
    if (closed) throw hostError(operation, closeReason, cleanupCause ?? backgroundCause);
    inFlight += 1;
  };
  const endOperation = (): void => {
    inFlight -= 1;
    if (closed && inFlight === 0) finishClose();
  };
  const withOperation = <Success>(
    operation: TaskWorkerSessionHostError["operation"],
    effect: Effect.Effect<Success, TaskWorkerSessionHostError>,
  ): Effect.Effect<Success, TaskWorkerSessionHostError> => Effect.acquireUseRelease(
    Effect.try({
      try: () => beginOperation(operation),
      catch: cause => cause instanceof TaskWorkerSessionHostError
        ? cause
        : hostError(operation, "sessionLost", cause),
    }),
    () => effect,
    () => Effect.sync(endOperation),
  );
  const requestInterruption: TaskWorkerSession["requestInterruption"] = Effect.fn(
    "TaskWorkerSession.requestInterruption",
  )(input => withOperation("requestInterruption", Effect.gen(function* () {
    const request = yield* Effect.fromResult(
      decodeTaskWorkerSessionInterruptionRequestV1(input),
    ).pipe(Effect.mapError(cause => hostError(
      "requestInterruption", "invalidRequest", cause,
    )));
    if (request.generation !== acceptance.generation ||
      request.executionId !== acceptance.executionId ||
      !taskWorkerSessionIdentitiesEqualV1(request.identity, acceptance.identity)) {
      return yield* hostError("requestInterruption", "invalidRequest");
    }
    if (request.cancellationGeneration < acceptedCancellationGeneration) {
      return yield* hostError("requestInterruption", "staleCancellation");
    }
    if (
      request.cancellationGeneration === acceptedCancellationGeneration &&
      acceptedInterruptionReason !== undefined &&
      request.reason !== acceptedInterruptionReason
    ) return yield* hostError("requestInterruption", "invalidRequest");
    if (request.cancellationGeneration > acceptedCancellationGeneration) {
      acceptedCancellationGeneration = request.cancellationGeneration;
      acceptedInterruptionReason = request.reason;
    }
    const wallMilliseconds = yield* remainingWallMilliseconds(
      deadline,
      "requestInterruption",
      handshakeMilliseconds,
    );
    const raw = yield* callOwnedWorkerRpc({
      wallMilliseconds,
      invoke: () => {
        recordInterruptionCandidate(request.cancellationGeneration, request.reason);
        return remote.requestInterruption(request);
      },
      mapExpectedFailure: cause => expectedWorkerFailure("requestInterruption", cause) ??
        hostError("requestInterruption", "sessionLost", cause),
      timedOut: () => hostError("requestInterruption", "timedOut"),
      invalidResult: cause => hostError("requestInterruption", "invalidResponse", cause),
    });
    const receipt = yield* Effect.fromResult(
      decodeTaskWorkerSessionInterruptionAcceptanceV1(raw),
    ).pipe(Effect.mapError(cause => hostError(
      "requestInterruption", "invalidResponse", cause,
    )));
    if (receipt.generation !== request.generation ||
      receipt.executionId !== request.executionId ||
      receipt.cancellationGeneration !== request.cancellationGeneration ||
      receipt.reason !== request.reason ||
      !taskWorkerSessionIdentitiesEqualV1(receipt.identity, request.identity)) {
      return yield* hostError("requestInterruption", "invalidResponse");
    }
    if (receipt.cancellationGeneration > acceptedCancellationGeneration) {
      acceptedCancellationGeneration = receipt.cancellationGeneration;
      acceptedInterruptionReason = receipt.reason;
    }
    return receipt;
  })));
  const settlement = Effect.fn("TaskWorkerSession.settlement")(() =>
    withOperation("settlement", Effect.gen(function* () {
    const wallMilliseconds = yield* remainingWallMilliseconds(
      deadline,
      "settlement",
    );
    const raw = yield* callOwnedWorkerRpc({
      wallMilliseconds,
      invoke: remote.settlement,
      mapExpectedFailure: cause => expectedWorkerFailure("settlement", cause) ??
        hostError("settlement", "sessionLost", cause),
      timedOut: () => hostError("settlement", "timedOut"),
      invalidResult: cause => hostError("settlement", "invalidResponse", cause),
    }).pipe(Effect.tapError(error => isTerminalWorkerFailure(error)
      ? Effect.sync(() => { terminalObserved = true; })
      : Effect.void));
    const receipt = yield* Effect.fromResult(decodeTaskWorkerSessionSettlementV1(raw)).pipe(
      Effect.mapError(cause => hostError("settlement", "invalidResponse", cause)),
    );
    if (receipt.generation !== acceptance.generation ||
      receipt.executionId !== acceptance.executionId ||
      !taskWorkerSessionIdentitiesEqualV1(receipt.identity, acceptance.identity)) {
      return yield* hostError("settlement", "invalidResponse");
    }
    if (
      receipt.outcome.kind === "interrupted" &&
      !interruptionCandidates.some(candidate =>
        receipt.outcome.kind === "interrupted" &&
        receipt.outcome.interruption.cancellationGeneration ===
          candidate.cancellationGeneration &&
        receipt.outcome.interruption.reason === candidate.reason
      )
    ) return yield* hostError("settlement", "invalidResponse");
    terminalObserved = true;
    return receipt;
  })));
  const expirationMilliseconds = Math.max(0, deadline - (yield* Clock.currentTimeMillis));
  const expiryFiber = yield* Effect.sleep(`${expirationMilliseconds} millis`).pipe(
    Effect.andThen(Effect.suspend(() => {
      if (closed) return Effect.void;
      expiryStarted = true;
      inFlight += 1;
      beginClose("timedOut");
      const expiryInterruptionRequest = Object.freeze({
        format: TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
        version: TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
        generation: acceptance.generation,
        identity: acceptance.identity,
        executionId: acceptance.executionId,
        cancellationGeneration:
          acceptedCancellationGeneration === 9_223_372_036_854_775_807n
            ? acceptedCancellationGeneration
            : acceptedCancellationGeneration + 1n,
        reason: "maximum_duration" as const,
      });
      acceptedCancellationGeneration = expiryInterruptionRequest.cancellationGeneration;
      acceptedInterruptionReason = expiryInterruptionRequest.reason;
      return callOwnedWorkerRpc({
        wallMilliseconds: handshakeMilliseconds,
        invoke: () => {
          recordInterruptionCandidate(
            expiryInterruptionRequest.cancellationGeneration,
            expiryInterruptionRequest.reason,
          );
          return remote.requestInterruption(expiryInterruptionRequest);
        },
        mapExpectedFailure: cause => expectedWorkerFailure("requestInterruption", cause) ??
          hostError("requestInterruption", "sessionLost", cause),
        timedOut: () => hostError("requestInterruption", "timedOut"),
        invalidResult: cause => hostError("requestInterruption", "invalidResponse", cause),
      }).pipe(
        Effect.asVoid,
        Effect.catch(() => Effect.void),
        Effect.catchCause(cause => Effect.sync(() => { backgroundCause = cause; })),
        Effect.ensuring(Effect.sync(() => {
          expiryFinished = true;
          endOperation();
        })),
      );
    })),
    Effect.forkDetach,
  );
  const close = Effect.fn("TaskWorkerSession.close")(() =>
    Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const deliverCloseInterruption = !closed && !terminalObserved;
      if (deliverCloseInterruption) {
        inFlight += 1;
      }
      beginClose("sessionLost");
      if (deliverCloseInterruption) {
        const request = Object.freeze({
          format: TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
          version: TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
          generation: acceptance.generation,
          identity: acceptance.identity,
          executionId: acceptance.executionId,
          cancellationGeneration:
            acceptedCancellationGeneration === 9_223_372_036_854_775_807n
              ? acceptedCancellationGeneration
              : acceptedCancellationGeneration + 1n,
          reason: "host_shutdown" as const,
        });
        acceptedCancellationGeneration = request.cancellationGeneration;
        acceptedInterruptionReason = request.reason;
        const delivery = callOwnedWorkerRpc({
          wallMilliseconds: handshakeMilliseconds,
          invoke: () => {
            recordInterruptionCandidate(request.cancellationGeneration, request.reason);
            return remote.requestInterruption(request);
          },
          mapExpectedFailure: cause =>
            expectedWorkerFailure("requestInterruption", cause) ??
            hostError("requestInterruption", "sessionLost", cause),
          timedOut: () => hostError("requestInterruption", "timedOut"),
          invalidResult: cause => hostError(
            "requestInterruption",
            "invalidResponse",
            cause,
          ),
        }).pipe(
          Effect.flatMap(raw => Effect.fromResult(
            decodeTaskWorkerSessionInterruptionAcceptanceV1(raw),
          ).pipe(Effect.mapError(cause => hostError(
            "requestInterruption",
            "invalidResponse",
            cause,
          )))),
          Effect.filterOrFail(
            receipt => receipt.generation === request.generation &&
              receipt.executionId === request.executionId &&
              receipt.cancellationGeneration === request.cancellationGeneration &&
              receipt.reason === request.reason &&
              taskWorkerSessionIdentitiesEqualV1(receipt.identity, request.identity),
            () => hostError("requestInterruption", "invalidResponse"),
          ),
          Effect.catchIf(
            isAlreadySettledSessionLoss,
            () => Effect.sync(() => { terminalObserved = true; }),
          ),
          Effect.ensuring(Effect.sync(endOperation)),
        );
        const deliveryExit = yield* Effect.exit(restore(delivery));
        if (Exit.isFailure(deliveryExit)) closeDeliveryCause = deliveryExit.cause;
      }
      if (!expiryStarted && !expiryFinished) yield* Fiber.interrupt(expiryFiber);
      yield* Effect.promise(() => drained);
      const failure = cleanupCause ?? backgroundCause ?? closeDeliveryCause;
      if (failure !== undefined) {
        return yield* hostError("close", "cleanupFailed", failure);
      }
    })),
  );
  return Object.freeze({
    acceptance,
    requestInterruption,
    settlement: settlement(),
    close: close(),
  });
  });
}

function remainingWallMilliseconds(
  deadline: number,
  operation: TaskWorkerSessionHostError["operation"],
  ceiling = Number.MAX_SAFE_INTEGER,
): Effect.Effect<number, TaskWorkerSessionHostError> {
  return Clock.currentTimeMillis.pipe(Effect.flatMap(now => {
    const remaining = Math.min(ceiling, Math.floor(deadline - now));
    return remaining > 0
      ? Effect.succeed(remaining)
      : Effect.fail(hostError(operation, "timedOut"));
  }));
}

function captureRemoteSession(
  input: unknown,
): Result.Result<RemoteTaskWorkerSession, TaskWorkerSessionHostError> {
  return Result.try({
    try: () => {
      if ((typeof input !== "object" && typeof input !== "function") || input === null) {
        throw new Error("Task Worker start did not return an RPC session.");
      }
      const acceptance = Reflect.get(input, "acceptance");
      const requestInterruption = Reflect.get(input, "requestInterruption");
      const settlement = Reflect.get(input, "settlement");
      if (typeof acceptance !== "function" || typeof requestInterruption !== "function" ||
        typeof settlement !== "function") {
        throw new Error("Task Worker RPC session is missing a required method.");
      }
      return Object.freeze({
        receiver: input,
        acceptance: () => Promise.resolve(Reflect.apply(acceptance, input, [])),
        requestInterruption: (request: unknown) =>
          Promise.resolve(Reflect.apply(requestInterruption, input, [request])),
        settlement: () => Promise.resolve(Reflect.apply(settlement, input, [])),
      });
    },
    catch: cause => hostError("start", "invalidResponse", cause),
  });
}

function acceptanceMatchesStart(
  acceptance: TaskWorkerSessionAcceptanceV1,
  start: TaskWorkerSessionStartRequestV1,
): boolean {
  return acceptance.generation === start.generation &&
    acceptance.executionId === start.executionId &&
    acceptance.cancellationGeneration === start.request.dispatch.cancellation.generation &&
    taskWorkerSessionIdentitiesEqualV1(
      acceptance.identity,
      start.request.dispatch.identity,
    );
}

function expectedWorkerFailure(
  operation: TaskWorkerSessionHostError["operation"],
  cause: unknown,
): TaskWorkerSessionHostError | undefined {
  const name = foreignErrorName(cause);
  switch (name) {
    case "ApplicationTaskWorkerInvalidRequestV1Error":
    case "LegacyTaskWorkerInvalidRequestV1Error":
      return hostError(operation, "invalidRequest", cause);
    case "TaskWorkerSessionLostV1Error":
      return hostError(operation, "sessionLost", cause);
    case "TaskWorkerSessionStaleCancellationV1Error":
      return hostError(operation, "staleCancellation", cause);
    case "ApplicationTaskWorkerDefinitionV1Error":
    case "LegacyTaskWorkerDefinitionV1Error":
      return hostError(operation, "workerDefinitionFailed", cause);
    case "ApplicationTaskWorkerInputBoundaryV1Error":
    case "LegacyTaskWorkerInputBoundaryV1Error":
      return hostError(operation, "inputBoundaryFailed", cause);
    case "ApplicationTaskWorkerUserCodeV1Error":
    case "LegacyTaskWorkerUserCodeV1Error":
      return hostError(operation, "userCodeFailed", cause);
    case "ApplicationTaskWorkerTerminalV1Error":
    case "LegacyTaskWorkerTerminalV1Error":
      return hostError(operation, "terminalFailed", cause);
    default:
      return undefined;
  }
}

function isTerminalWorkerFailure(error: TaskWorkerSessionHostError): boolean {
  return error.reason === "invalidRequest" ||
    error.reason === "workerDefinitionFailed" ||
    error.reason === "inputBoundaryFailed" ||
    error.reason === "userCodeFailed" ||
    error.reason === "terminalFailed";
}

function isAlreadySettledSessionLoss(error: TaskWorkerSessionHostError): boolean {
  return error.reason === "sessionLost" &&
    foreignErrorName(error.cause) === "TaskWorkerSessionLostV1Error";
}

function foreignErrorName(cause: unknown): unknown {
  if (cause === null || typeof cause !== "object") return undefined;
  return Result.try({
    try: () => Reflect.get(cause, "name"),
    catch: () => undefined,
  }).pipe(Result.getOrElse(() => undefined));
}

interface RpcTargetLease {
  readonly accept: (value: unknown) => boolean;
  readonly transfer: () => void;
  readonly dispose: () => void;
}

function createRpcTargetLease(): RpcTargetLease {
  let value: unknown;
  let attached = false;
  let transferred = false;
  let closed = false;
  return Object.freeze({
    accept: (next: unknown): boolean => {
      if (attached) {
        disposeRpcValue(next);
        throw new Error("Task Worker RPC session lease is already attached.");
      }
      if (closed) {
        disposeRpcValue(next);
        return false;
      }
      attached = true;
      value = next;
      return true;
    },
    transfer: (): void => {
      if (!attached || closed) throw new Error("Task Worker RPC session is unavailable.");
      transferred = true;
      closed = true;
    },
    dispose: (): void => {
      if (closed) return;
      closed = true;
      if (attached && !transferred) disposeRpcValue(value);
    },
  });
}

function awaitRpcTarget(
  invoke: () => PromiseLike<unknown>,
  signal: AbortSignal,
  lease: RpcTargetLease,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let abandoned = false;
    const onAbort = (): void => {
      if (abandoned) return;
      abandoned = true;
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(invoke());
    } catch (cause) {
      signal.removeEventListener("abort", onAbort);
      reject(cause);
      return;
    }
    pending.then(value => {
      signal.removeEventListener("abort", onAbort);
      try {
        if (lease.accept(value) && !abandoned) resolve(value);
      } catch (cause) {
        if (!abandoned) reject(cause);
      }
    }, cause => {
      signal.removeEventListener("abort", onAbort);
      if (!abandoned) reject(cause);
    });
  });
}

function disposeRpcValue(value: unknown): void {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return;
  const dispose = Reflect.get(value, Symbol.dispose);
  if (typeof dispose === "function") Reflect.apply(dispose, value, []);
}

function hex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

function hostError(
  operation: TaskWorkerSessionHostError["operation"],
  reason: TaskWorkerSessionHostError["reason"],
  cause?: unknown,
): TaskWorkerSessionHostError {
  return new TaskWorkerSessionHostError({
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
