import { Data, Effect, Result } from "effect";
import {
  decodeApplicationTaskWorkerRequestV1Effect,
  decodeApplicationTaskWorkerResultV1Effect,
  type ApplicationTaskWorkerInputCapabilityV1,
  type ApplicationTaskWorkerRequestV1,
} from "flarex-protocol/internal/application-task-worker-v1";
import type { CanonicalFlarexRuntimeValueV1 } from
  "flarex-protocol/internal/value-runtime-core";

import {
  APPLICATION_TASK_WORKER_ENTRYPOINT,
  type ApplicationTaskWorkerDefinition,
} from "./ApplicationTaskWorkerDefinition";
import { callOwnedWorkerRpc } from "./WorkerRpcResult";

export type ApplicationTaskExecutionHostFailureReason =
  | "invalidRequest"
  | "workerLoadFailed"
  | "workerDefinitionFailed"
  | "inputBoundaryFailed"
  | "userCodeFailed"
  | "terminalFailed"
  | "invalidResult"
  | "timedOut";

export class ApplicationTaskExecutionHostError extends Data.TaggedError(
  "ApplicationTaskExecutionHostError",
)<{
  readonly reason: ApplicationTaskExecutionHostFailureReason;
  readonly cause?: unknown;
}> {}

export interface ApplicationTaskExecutionHostInput {
  readonly definition: ApplicationTaskWorkerDefinition;
  readonly request: unknown;
  readonly capability: ApplicationTaskWorkerInputCapabilityV1;
}

export interface ApplicationTaskExecutionHost {
  readonly run: (
    input: ApplicationTaskExecutionHostInput,
  ) => Effect.Effect<
    CanonicalFlarexRuntimeValueV1,
    ApplicationTaskExecutionHostError
  >;
}

interface ApplicationTaskEntrypoint extends Rpc.WorkerEntrypointBranded {
  readonly run: (
    request: ApplicationTaskWorkerRequestV1,
    capability: ApplicationTaskWorkerInputCapabilityV1,
  ) => PromiseLike<unknown>;
}

export function makeApplicationTaskExecutionHost(
  loader: WorkerLoader,
): ApplicationTaskExecutionHost {
  const run: ApplicationTaskExecutionHost["run"] = Effect.fn(
    "ApplicationTaskExecutionHost.run",
  )(function* (input) {
    const request = yield* decodeApplicationTaskWorkerRequestV1Effect(
      input.request,
    ).pipe(Effect.mapError(cause => hostError("invalidRequest", cause)));
    if (
      hex(request.dispatch.applicationTaskRuntimeTargetSha256) !==
        input.definition.runtimeTargetSha256Hex ||
      request.dispatch.computeProfile !== input.definition.computeProfile ||
      request.dispatch.maximumDurationMs > input.definition.wallMilliseconds
    ) return yield* hostError("invalidRequest");
    const wallMilliseconds = request.dispatch.maximumDurationMs;
    const entrypoint = yield* Effect.try({
      try: () => loader.load(workerCode(input.definition)).getEntrypoint<
        ApplicationTaskEntrypoint
      >(APPLICATION_TASK_WORKER_ENTRYPOINT),
      catch: cause => hostError("workerLoadFailed", cause),
    });
    const result = yield* callOwnedWorkerRpc({
      wallMilliseconds,
      invoke: () => entrypoint.run(request, input.capability),
      mapExpectedFailure: cause => expectedWorkerFailure(cause),
      timedOut: () => hostError("timedOut"),
      invalidResult: cause => hostError("invalidResult", cause),
    }).pipe(
      Effect.flatMap(decodeApplicationTaskWorkerResultV1Effect),
      Effect.mapError(cause => cause instanceof ApplicationTaskExecutionHostError
        ? cause
        : hostError("invalidResult", cause)),
    );
    if (!dispatchIdentityEqual(result.identity, request.dispatch.identity)) {
      return yield* hostError("invalidResult");
    }
    return result.value;
  });
  return Object.freeze({ run });
}

function workerCode(
  definition: ApplicationTaskWorkerDefinition,
): WorkerLoaderWorkerCode {
  return {
    compatibilityDate: definition.compatibilityDate,
    mainModule: definition.mainModule,
    modules: definition.modules,
    env: definition.env,
    limits: definition.limits,
    globalOutbound: null,
  };
}

function expectedWorkerFailure(
  cause: unknown,
): ApplicationTaskExecutionHostError | undefined {
  if (cause === null || typeof cause !== "object") return undefined;
  const name = Result.try({
    try: () => Reflect.get(cause, "name"),
    catch: () => undefined,
  }).pipe(Result.getOrElse(() => undefined));
  switch (name) {
    case "ApplicationTaskWorkerInvalidRequestV1Error":
      return hostError("invalidRequest", cause);
    case "ApplicationTaskWorkerDefinitionV1Error":
      return hostError("workerDefinitionFailed", cause);
    case "ApplicationTaskWorkerInputBoundaryV1Error":
      return hostError("inputBoundaryFailed", cause);
    case "ApplicationTaskWorkerUserCodeV1Error":
      return hostError("userCodeFailed", cause);
    case "ApplicationTaskWorkerTerminalV1Error":
      return hostError("terminalFailed", cause);
    default: return undefined;
  }
}

function hostError(
  reason: ApplicationTaskExecutionHostFailureReason,
  cause?: unknown,
): ApplicationTaskExecutionHostError {
  return new ApplicationTaskExecutionHostError({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function hex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

function dispatchIdentityEqual(
  left: ApplicationTaskWorkerRequestV1["dispatch"]["identity"],
  right: ApplicationTaskWorkerRequestV1["dispatch"]["identity"],
): boolean {
  return left.version === right.version && left.scopeId === right.scopeId &&
    left.runId === right.runId &&
    left.requestedEffectSequence === right.requestedEffectSequence &&
    left.attemptId === right.attemptId &&
    left.executionFence === right.executionFence;
}
