import { Data, Effect, Result } from "effect";
import {
  decodeLegacyTaskWorkerRequestV1Effect,
  decodeLegacyTaskWorkerResultV1Effect,
  type LegacyTaskWorkerInputCapabilityV1,
  type LegacyTaskWorkerRequestV1,
} from "flarex-protocol/internal/legacy-task-worker-v1";
import type { CanonicalFlarexRuntimeValueV1 } from
  "flarex-protocol/internal/value-runtime-core";

import {
  LEGACY_TASK_WORKER_ENTRYPOINT,
  type LegacyTaskWorkerDefinition,
} from "./LegacyTaskWorkerDefinition";
import { callOwnedWorkerRpc } from "./WorkerRpcResult";

export class LegacyTaskExecutionHostError extends Data.TaggedError(
  "LegacyTaskExecutionHostError",
)<{
  readonly reason:
    | "invalidRequest" | "workerLoadFailed" | "workerDefinitionFailed"
    | "inputBoundaryFailed" | "userCodeFailed" | "terminalFailed"
    | "invalidResult" | "timedOut";
  readonly cause?: unknown;
}> {}

export interface LegacyTaskExecutionHost {
  readonly run: (input: Readonly<{
    readonly definition: LegacyTaskWorkerDefinition;
    readonly request: unknown;
    readonly capability: LegacyTaskWorkerInputCapabilityV1;
  }>) => Effect.Effect<CanonicalFlarexRuntimeValueV1, LegacyTaskExecutionHostError>;
}

interface LegacyTaskEntrypoint extends Rpc.WorkerEntrypointBranded {
  readonly run: (
    request: LegacyTaskWorkerRequestV1,
    capability: LegacyTaskWorkerInputCapabilityV1,
  ) => PromiseLike<unknown>;
}

export function makeLegacyTaskExecutionHost(loader: WorkerLoader): LegacyTaskExecutionHost {
  const run: LegacyTaskExecutionHost["run"] = Effect.fn(
    "LegacyTaskExecutionHost.run",
  )(function* (input) {
    const request = yield* decodeLegacyTaskWorkerRequestV1Effect(input.request).pipe(
      Effect.mapError(cause => hostError("invalidRequest", cause)),
    );
    if (request.dispatch.taskDefinitionRevisionId !== input.definition.taskDefinitionRevisionId ||
      request.dispatch.computeProfile !== input.definition.computeProfile ||
      request.dispatch.maximumDurationMs > input.definition.wallMilliseconds) {
      return yield* hostError("invalidRequest");
    }
    const entrypoint = yield* Effect.try({
      try: () => loader.load(workerCode(input.definition)).getEntrypoint<LegacyTaskEntrypoint>(
        LEGACY_TASK_WORKER_ENTRYPOINT,
      ),
      catch: cause => hostError("workerLoadFailed", cause),
    });
    const result = yield* callOwnedWorkerRpc({
      wallMilliseconds: request.dispatch.maximumDurationMs,
      invoke: () => entrypoint.run(request, input.capability),
      mapExpectedFailure: expectedWorkerFailure,
      timedOut: () => hostError("timedOut"),
      invalidResult: cause => hostError("invalidResult", cause),
    }).pipe(
      Effect.flatMap(decodeLegacyTaskWorkerResultV1Effect),
      Effect.mapError(cause => cause instanceof LegacyTaskExecutionHostError
        ? cause
        : hostError("invalidResult", cause)),
    );
    if (!identitiesEqual(result.identity, request.dispatch.identity)) {
      return yield* hostError("invalidResult");
    }
    return result.value;
  });
  return Object.freeze({ run });
}

function workerCode(definition: LegacyTaskWorkerDefinition): WorkerLoaderWorkerCode {
  return {
    compatibilityDate: definition.compatibilityDate,
    compatibilityFlags: [...definition.compatibilityFlags],
    mainModule: definition.mainModule,
    modules: definition.modules,
    env: definition.env,
    limits: definition.limits,
    globalOutbound: null,
  };
}

function expectedWorkerFailure(cause: unknown): LegacyTaskExecutionHostError | undefined {
  if (cause === null || typeof cause !== "object") return undefined;
  const name = Result.try({
    try: () => Reflect.get(cause, "name"),
    catch: () => undefined,
  }).pipe(Result.getOrElse(() => undefined));
  switch (name) {
    case "LegacyTaskWorkerInvalidRequestV1Error": return hostError("invalidRequest", cause);
    case "LegacyTaskWorkerDefinitionV1Error": return hostError("workerDefinitionFailed", cause);
    case "LegacyTaskWorkerInputBoundaryV1Error": return hostError("inputBoundaryFailed", cause);
    case "LegacyTaskWorkerUserCodeV1Error": return hostError("userCodeFailed", cause);
    case "LegacyTaskWorkerTerminalV1Error": return hostError("terminalFailed", cause);
    default: return undefined;
  }
}

function identitiesEqual(
  left: LegacyTaskWorkerRequestV1["dispatch"]["identity"],
  right: LegacyTaskWorkerRequestV1["dispatch"]["identity"],
): boolean {
  return left.version === right.version && left.scopeId === right.scopeId &&
    left.runId === right.runId &&
    left.requestedEffectSequence === right.requestedEffectSequence &&
    left.attemptId === right.attemptId && left.executionFence === right.executionFence;
}

function hostError(
  reason: LegacyTaskExecutionHostError["reason"],
  cause?: unknown,
): LegacyTaskExecutionHostError {
  return new LegacyTaskExecutionHostError({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
