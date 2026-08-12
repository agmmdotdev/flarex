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
  return Effect.acquireUseRelease(
    Effect.sync(createOwnedRpcResultLease),
    lease => Effect.tryPromise({
      try: signal => awaitRpcSettlement(
        () => invoke(entrypoint),
        signal,
        lease,
      ),
      catch: cause => cause,
    }).pipe(
      Effect.catch((cause: unknown) => {
        const reason = expectedWorkerFailureReason(cause);
        return reason === undefined
          ? Effect.die(cause)
          : Effect.fail(hostError(operation, reason, cause));
      }),
      Effect.timeoutOrElse({
        duration: `${wallMilliseconds} millis`,
        orElse: () => Effect.fail(hostError(operation, "timedOut")),
      }),
      Effect.flatMap(value => Effect.try({
        try: () => detachRpcResult(value),
        catch: cause => hostError(operation, "invalidResult", cause),
      }).pipe(
        Effect.flatMap(detached => decodeApplicationWorkerResultV1Effect(
          detached,
        )),
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
      )),
    ),
    lease => Effect.sync(() => lease.dispose()),
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

function awaitRpcSettlement(
  invoke: () => PromiseLike<unknown>,
  signal: AbortSignal,
  lease: OwnedRpcResultLease,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let abandoned = false;
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      signal.removeEventListener("abort", onAbort);
    };
    const abandon = (cause: unknown): void => {
      if (abandoned) return;
      abandoned = true;
      cleanup();
      reject(cause);
    };
    const onAbort = (): void => {
      abandon(signal.reason);
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
      cleanup();
      reject(cause);
      return;
    }
    pending.then(value => {
      cleanup();
      if (abandoned) {
        try {
          lease.accept(value);
        } catch {
          // No live caller remains to receive late-result disposal failure.
        }
        return;
      }
      try {
        if (lease.accept(value)) resolve(value);
      } catch (cause) {
        reject(cause);
      }
    }, cause => {
      cleanup();
      if (!abandoned) reject(cause);
    });
  });
}

interface OwnedRpcResultLease {
  readonly accept: (value: unknown) => boolean;
  readonly dispose: () => void;
}

function createOwnedRpcResultLease(): OwnedRpcResultLease {
  let value: unknown;
  let attached = false;
  let closed = false;
  const dispose = (): void => {
    if (closed) return;
    closed = true;
    if (attached) disposeRpcValue(value);
  };
  return Object.freeze({
    accept: (next: unknown): boolean => {
      if (attached) {
        disposeRpcValue(next);
        throw new Error("Application Worker RPC result lease is already attached.");
      }
      if (closed) {
        disposeRpcValue(next);
        return false;
      }
      attached = true;
      value = next;
      return true;
    },
    dispose,
  });
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

function detachRpcResult(value: unknown): unknown {
  if (value === null ||
    (typeof value !== "object" && typeof value !== "function")) return value;
  const detached: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (key === Symbol.dispose) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error("Application Worker RPC result must contain data properties.");
    }
    Object.defineProperty(detached, key, descriptor);
  }
  return detached;
}

function disposeRpcValue(value: unknown): void {
  if (value === null ||
    (typeof value !== "object" && typeof value !== "function")) return;
  const dispose = Reflect.get(value, Symbol.dispose);
  if (typeof dispose === "function") Reflect.apply(dispose, value, []);
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
