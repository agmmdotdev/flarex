import { Clock, Data, Effect } from "effect";
import {
  decodeApplicationActionWorkerRequestV1Effect,
  decodeApplicationTransactionWorkerRequestV1Effect,
  decodeApplicationWorkerResultV1Effect,
  type ApplicationActionWorkerRequestV1,
  type ApplicationWorkerApplicationErrorV1,
  type ApplicationTransactionWorkerRequestV1,
} from "flarex-protocol/internal/application-worker-v1";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";
import {
  canonicalizeApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";

import {
  APPLICATION_ACTION_WORKER_ENTRYPOINT,
  APPLICATION_TRANSACTION_WORKER_ENTRYPOINT,
  type ApplicationWorkerDefinition,
} from "./ApplicationWorkerDefinition";
import { callOwnedWorkerRpc } from "./WorkerRpcResult";

export type ApplicationExecutionHostFailureReason =
  | "invalidRequest"
  | "workerLoadFailed"
  | "workerDefinitionFailed"
  | "readBoundaryFailed"
  | "journalBoundaryFailed"
  | "callbackFailed"
  | "applicationError"
  | "userCodeFailed"
  | "terminalFailed"
  | "invalidResult"
  | "timedOut";

export class ApplicationExecutionHostError extends Data.TaggedError(
  "ApplicationExecutionHostError",
)<{
  readonly operation: "transaction" | "action";
  readonly reason: ApplicationExecutionHostFailureReason;
  readonly cause?: unknown;
  readonly applicationError?: ApplicationWorkerApplicationErrorV1;
}> {}

export interface ApplicationTransactionExecutionHostInput {
  readonly definition: ApplicationWorkerDefinition;
  readonly request: unknown;
  readonly capability: object;
}

export interface ApplicationActionExecutionHostInput {
  readonly definition: ApplicationWorkerDefinition;
  readonly request: unknown;
  readonly callback: object;
  readonly outbound: Fetcher;
}

export interface ApplicationExecutionHost {
  readonly runTransaction: (
    input: ApplicationTransactionExecutionHostInput,
  ) => Effect.Effect<
    CanonicalFlarexRuntimeValueV1,
    ApplicationExecutionHostError
  >;
  readonly runAction: (
    input: ApplicationActionExecutionHostInput,
  ) => Effect.Effect<
    CanonicalFlarexRuntimeValueV1,
    ApplicationExecutionHostError
  >;
}

interface ApplicationTransactionEntrypoint
  extends Rpc.WorkerEntrypointBranded {
  readonly run: (
    request: ApplicationTransactionWorkerRequestV1,
    capability: object,
  ) => PromiseLike<unknown>;
}

interface ApplicationActionEntrypoint extends Rpc.WorkerEntrypointBranded {
  readonly run: (
    request: ApplicationActionWorkerRequestV1,
    callback: object,
  ) => PromiseLike<unknown>;
}

export function makeApplicationExecutionHost(
  loader: WorkerLoader,
): ApplicationExecutionHost {
  const runTransaction: ApplicationExecutionHost["runTransaction"] = Effect.fn(
    "ApplicationExecutionHost.runTransaction",
  )(function* (input) {
    const request = yield* decodeApplicationTransactionWorkerRequestV1Effect(
      input.request,
    ).pipe(Effect.mapError(cause => hostError(
      "transaction",
      "invalidRequest",
      cause,
    )));
    yield* requireTarget(
      "transaction",
      request.target,
      input.definition,
    );
    return yield* runWorker(
      "transaction",
      loader,
      transactionWorkerCode(input.definition),
      APPLICATION_TRANSACTION_WORKER_ENTRYPOINT,
      input.definition.transactionWallMilliseconds,
      stub => (stub as ApplicationTransactionEntrypoint).run(
        request,
        input.capability,
      ),
    );
  });

  const runAction: ApplicationExecutionHost["runAction"] = Effect.fn(
    "ApplicationExecutionHost.runAction",
  )(function* (input) {
    const request = yield* decodeApplicationActionWorkerRequestV1Effect(
      input.request,
    ).pipe(Effect.mapError(cause => hostError(
      "action",
      "invalidRequest",
      cause,
    )));
    yield* requireTarget("action", request.target, input.definition);
    if (hex(request.context.hostPolicySha256) !==
      input.definition.hostPolicySha256Hex) {
      return yield* Effect.fail(hostError("action", "invalidRequest"));
    }
    const now = yield* Clock.currentTimeMillis;
    const remaining = request.context.executionDeadline - now;
    if (remaining <= 0) {
      return yield* Effect.fail(hostError("action", "timedOut"));
    }
    const wallMilliseconds = Math.min(
      input.definition.actionWallMilliseconds,
      Math.max(1, Math.floor(remaining)),
    );
    return yield* runWorker(
      "action",
      loader,
      actionWorkerCode(input.definition, input.outbound),
      APPLICATION_ACTION_WORKER_ENTRYPOINT,
      wallMilliseconds,
      stub => (stub as ApplicationActionEntrypoint).run(
        request,
        input.callback,
      ),
    );
  });

  return Object.freeze({ runTransaction, runAction });
}

function requireTarget(
  operation: ApplicationExecutionHostError["operation"],
  target: ApplicationTransactionWorkerRequestV1["target"],
  definition: ApplicationWorkerDefinition,
): Effect.Effect<void, ApplicationExecutionHostError> {
  return Effect.fromResult(canonicalizeApplicationRuntimeTargetV1(target)).pipe(
    Effect.mapError(cause => hostError(operation, "invalidRequest", cause)),
    Effect.flatMap(canonical => canonical.canonicalText ===
        definition.targetCanonicalText
      ? Effect.void
      : Effect.fail(hostError(operation, "invalidRequest"))),
  );
}

function runWorker(
  operation: ApplicationExecutionHostError["operation"],
  loader: WorkerLoader,
  code: WorkerLoaderWorkerCode,
  entrypointName: string,
  wallMilliseconds: number,
  invoke: (entrypoint: Rpc.WorkerEntrypointBranded) => PromiseLike<unknown>,
): Effect.Effect<
  CanonicalFlarexRuntimeValueV1,
  ApplicationExecutionHostError
> {
  return Effect.try({
      try: () => loader.load(code).getEntrypoint<
        Rpc.WorkerEntrypointBranded
      >(entrypointName),
      catch: cause => hostError(operation, "workerLoadFailed", cause),
    }).pipe(Effect.flatMap(entrypoint => callWorker(
      operation,
      entrypoint,
      wallMilliseconds,
      invoke,
    )));
}

function callWorker(
  operation: ApplicationExecutionHostError["operation"],
  entrypoint: Rpc.WorkerEntrypointBranded,
  wallMilliseconds: number,
  invoke: (entrypoint: Rpc.WorkerEntrypointBranded) => PromiseLike<unknown>,
): Effect.Effect<
  CanonicalFlarexRuntimeValueV1,
  ApplicationExecutionHostError
> {
  return callOwnedWorkerRpc({
    wallMilliseconds,
    invoke: () => invoke(entrypoint),
    mapExpectedFailure: cause => {
      const reason = expectedWorkerFailureReason(cause);
      return reason === undefined
        ? undefined
        : hostError(operation, reason, cause);
    },
    timedOut: () => hostError(operation, "timedOut"),
    invalidResult: cause => hostError(operation, "invalidResult", cause),
  }).pipe(
    Effect.flatMap(detached => decodeApplicationWorkerResultV1Effect(detached)),
    Effect.mapError(cause => cause instanceof ApplicationExecutionHostError
      ? cause
      : hostError(operation, "invalidResult", cause)),
    Effect.flatMap(result => "kind" in result
      ? Effect.fail(new ApplicationExecutionHostError({
          operation,
          reason: "applicationError",
          applicationError: result.error,
        }))
      : Effect.succeed(result.value)),
  );
}

function transactionWorkerCode(
  definition: ApplicationWorkerDefinition,
): WorkerLoaderWorkerCode {
  return {
    compatibilityDate: definition.compatibilityDate,
    mainModule: definition.mainModule,
    modules: definition.modules,
    env: definition.env,
    limits: definition.transactionLimits,
    globalOutbound: null,
  };
}

function actionWorkerCode(
  definition: ApplicationWorkerDefinition,
  outbound: Fetcher,
): WorkerLoaderWorkerCode {
  return {
    compatibilityDate: definition.compatibilityDate,
    mainModule: definition.mainModule,
    modules: definition.modules,
    env: definition.env,
    limits: definition.actionLimits,
    globalOutbound: outbound,
  };
}

function expectedWorkerFailureReason(
  cause: unknown,
): ApplicationExecutionHostFailureReason | undefined {
  if (cause === null || typeof cause !== "object") return undefined;
  let name: unknown;
  try {
    name = Reflect.get(cause, "name");
  } catch {
    return undefined;
  }
  switch (name) {
    case "ApplicationWorkerInvalidRequestV1Error": return "invalidRequest";
    case "ApplicationWorkerDefinitionV1Error": return "workerDefinitionFailed";
    case "ApplicationWorkerReadBoundaryV1Error": return "readBoundaryFailed";
    case "ApplicationWorkerJournalBoundaryV1Error": return "journalBoundaryFailed";
    case "ApplicationWorkerCallbackBoundaryV1Error": return "callbackFailed";
    case "ApplicationWorkerUserCodeV1Error": return "userCodeFailed";
    case "ApplicationWorkerTerminalV1Error": return "terminalFailed";
    default: return undefined;
  }
}

function hostError(
  operation: ApplicationExecutionHostError["operation"],
  reason: ApplicationExecutionHostFailureReason,
  cause?: unknown,
): ApplicationExecutionHostError {
  return new ApplicationExecutionHostError({
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function hex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}
