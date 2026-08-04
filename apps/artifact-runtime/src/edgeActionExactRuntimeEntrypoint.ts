import { WorkerEntrypoint } from "cloudflare:workers";
import { Effect, Exit } from "effect";
import type { EdgeActionExactRuntimeWorkerDefinitionV1 } from
  "flarex-backend/internal/candidate-bound-edge-action-runtime-target-v1";
import {
  decodeEdgeActionExactRuntimeRequestV1Effect,
  decodeEdgeActionExactRuntimeResultV1Effect,
  EDGE_ACTION_EXACT_RUNTIME_ENTRYPOINT_V1,
  type EdgeActionExactRuntimeRequestV1,
  type EdgeActionExactRuntimeResultV1,
} from "flarex-protocol/edge-action-exact-runtime";

interface ReceivedRpcStub {
  readonly [Symbol.dispose]?: () => void;
}

interface EdgeActionLifecycleRpcStubV1 extends ReceivedRpcStub {
  readonly close: () => unknown | PromiseLike<unknown>;
  readonly drain: () => unknown | PromiseLike<unknown>;
}

export interface EdgeActionCallbackBridgeRpcStubV1
  extends EdgeActionLifecycleRpcStubV1 {
  readonly invoke: (input: unknown) => unknown | PromiseLike<unknown>;
}

export interface EdgeActionOutboundGatewayRpcStubV1 extends Fetcher,
  EdgeActionLifecycleRpcStubV1 {}

export interface EdgeActionExactRuntimeDispatchAuthorityRpcV1 {
  /**
   * Claims one already-admitted AAV-A1 invocation and returns only capabilities
   * and a candidate target derived by the trusted private coordinator. The
   * artifact host deliberately does not accept these values from its caller.
   */
  readonly claim: (input: unknown) => unknown | PromiseLike<unknown>;
}

interface ClaimedEdgeActionExactRuntimeDispatchV1 {
  readonly request: unknown;
  readonly definition: EdgeActionExactRuntimeWorkerDefinitionV1;
  readonly callback: EdgeActionCallbackBridgeRpcStubV1;
  readonly outbound: EdgeActionOutboundGatewayRpcStubV1;
}

interface EdgeActionDynamicWorkerEntrypointV1
  extends Rpc.WorkerEntrypointBranded {
  readonly run: (
    input: EdgeActionExactRuntimeRequestV1,
    callback: EdgeActionCallbackBridgeRpcStubV1,
  ) => Promise<unknown>;
}

export interface EdgeActionExactRuntimeArtifactHostEnvV1 {
  readonly LOADER?: WorkerLoader;
  readonly FLAREX_EDGE_ACTION_DISPATCH_AUTHORITY?:
    EdgeActionExactRuntimeDispatchAuthorityRpcV1;
}

export type EdgeActionExactRuntimeArtifactHostResultV1 =
  | Readonly<{
      readonly kind: "success";
      readonly result: EdgeActionExactRuntimeResultV1;
    }>
  | Readonly<{
      readonly kind: "failure";
      readonly reason:
        | "authorityFailed"
        | "invalidRequest"
        | "workerLoadFailed"
        | "callbackFailed"
        | "userCodeFailed"
        | "invalidResult"
        | "timedOut"
        | "cancelled"
        | "cleanupUncertain";
    }>;

interface ExpectedHostError {
  readonly _tag: "EdgeActionArtifactHostExpectedError";
  readonly reason: Extract<
    EdgeActionExactRuntimeArtifactHostResultV1,
    { readonly kind: "failure" }
  >["reason"];
}

export async function runEdgeActionExactRuntimeArtifactHostV1(
  env: EdgeActionExactRuntimeArtifactHostEnvV1,
  input: unknown,
  options?: Readonly<{ readonly signal?: AbortSignal }>,
): Promise<EdgeActionExactRuntimeArtifactHostResultV1> {
  return await Effect.runPromise(
    runEdgeActionExactRuntimeArtifactHostEffectV1(env, input, options),
  );
}

export class FlarexEdgeActionExactRuntimeArtifactHostV1
  extends WorkerEntrypoint<EdgeActionExactRuntimeArtifactHostEnvV1> {
  run(input: unknown): Promise<EdgeActionExactRuntimeArtifactHostResultV1> {
    return runEdgeActionExactRuntimeArtifactHostV1(this.env, input);
  }
}

const runHostEffect = Effect.fn("EdgeActionExactRuntimeArtifactHost.run")(
  function* (
    env: EdgeActionExactRuntimeArtifactHostEnvV1,
    input: unknown,
    callerSignal: AbortSignal | undefined,
  ): Effect.fn.Return<
    EdgeActionExactRuntimeArtifactHostResultV1,
    ExpectedHostError
  > {
    const authority = yield* env.FLAREX_EDGE_ACTION_DISPATCH_AUTHORITY ===
        undefined
      ? Effect.fail(expected("authorityFailed"))
      : Effect.succeed(env.FLAREX_EDGE_ACTION_DISPATCH_AUTHORITY);
    const rawClaim = yield* Effect.tryPromise({
      try: signal => awaitAuthorityClaimWithCleanup(
        () => authority.claim(input),
        signal,
        callerSignal,
      ),
      catch: cause => isExpectedHostError(cause)
        ? cause
        : expected("authorityFailed"),
    });
    const claim = yield* Effect.try({
      try: () => captureClaim(rawClaim),
      catch: () => expected("authorityFailed"),
    });
    return yield* runClaimedDispatchEffect(env, claim, callerSignal);
  },
);

export function runEdgeActionExactRuntimeArtifactHostEffectV1(
  env: EdgeActionExactRuntimeArtifactHostEnvV1,
  input: unknown,
  options?: Readonly<{ readonly signal?: AbortSignal }>,
): Effect.Effect<EdgeActionExactRuntimeArtifactHostResultV1> {
  return runHostEffect(env, input, options?.signal).pipe(
    Effect.catch((error: ExpectedHostError) =>
      Effect.succeed(Object.freeze({
        kind: "failure" as const,
        reason: error.reason,
      }))
    ),
  );
}

const runClaimedDispatchEffect = Effect.fn(
  "EdgeActionExactRuntimeArtifactHost.runClaimedDispatch",
)(function* (
  env: EdgeActionExactRuntimeArtifactHostEnvV1,
  claim: ClaimedEdgeActionExactRuntimeDispatchV1,
  callerSignal: AbortSignal | undefined,
): Effect.fn.Return<
  EdgeActionExactRuntimeArtifactHostResultV1,
  ExpectedHostError
> {
  const workerLease = createOwnedRpcLease();
  return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    const executionExit = yield* Effect.exit(restore(
      executeClaimedDispatchEffect(env, claim, callerSignal, workerLease),
    ));
    const cleanupExit = yield* Effect.exit(
      cleanupClaimedCapabilitiesEffect(claim, workerLease),
    );
    if (Exit.isFailure(cleanupExit)) {
      return yield* Effect.fail(expected("cleanupUncertain"));
    }
    if (Exit.isSuccess(executionExit)) return executionExit.value;
    return yield* Effect.failCause(executionExit.cause);
  }));
});

const executeClaimedDispatchEffect = Effect.fn(
  "EdgeActionExactRuntimeArtifactHost.executeClaimedDispatch",
)(function* (
  env: EdgeActionExactRuntimeArtifactHostEnvV1,
  claim: ClaimedEdgeActionExactRuntimeDispatchV1,
  callerSignal: AbortSignal | undefined,
  workerLease: OwnedRpcLease,
): Effect.fn.Return<
  EdgeActionExactRuntimeArtifactHostResultV1,
  ExpectedHostError
> {
  const request = yield* decodeEdgeActionExactRuntimeRequestV1Effect(
    claim.request,
  ).pipe(Effect.mapError(() => expected("invalidRequest")));
  yield* Effect.try({
    try: () => validateClaimBinding(request, claim.definition),
    catch: () => expected("authorityFailed"),
  });
  const remainingInvocationMilliseconds =
    request.context.executionDeadline - Date.now();
  if (remainingInvocationMilliseconds <= 0) {
    return yield* Effect.fail(expected("timedOut"));
  }
  const wallMilliseconds = Math.min(
    claim.definition.wallMilliseconds,
    Math.max(1, Math.floor(remainingInvocationMilliseconds)),
  );
  const loader = yield* env.LOADER === undefined
    ? Effect.fail(expected("workerLoadFailed"))
    : Effect.succeed(env.LOADER);
  const entrypoint = yield* Effect.try({
    try: () => loader.load(workerCode(claim.definition, claim.outbound))
      .getEntrypoint<EdgeActionDynamicWorkerEntrypointV1>(
        EDGE_ACTION_EXACT_RUNTIME_ENTRYPOINT_V1,
      ),
    catch: () => expected("workerLoadFailed"),
  });
  workerLease.attach(entrypoint);
  const rawResult = yield* Effect.tryPromise({
    try: signal => awaitRpcWithAbort(
      entrypoint.run(request, claim.callback),
      signal,
      callerSignal,
      wallMilliseconds,
    ),
    catch: cause => cause,
  }).pipe(
    Effect.catch((cause: unknown) => {
      if (isExpectedHostError(cause)) return Effect.fail(cause);
      const reason = dynamicWorkerFailureReason(cause);
      return reason === undefined
        ? Effect.die(cause)
        : Effect.fail(expected(reason));
    }),
  );
  const decoded = yield* Effect.acquireUseRelease(
    Effect.succeed(rawResult),
    value => decodeEdgeActionExactRuntimeResultV1Effect(
      detachRpcResult(value),
    ).pipe(Effect.mapError(() => expected("invalidResult"))),
    value => disposeRpcValueEffect(value),
  );
  return Object.freeze({ kind: "success" as const, result: decoded });
});

function cleanupClaimedCapabilitiesEffect(
  claim: ClaimedEdgeActionExactRuntimeDispatchV1,
  workerLease: OwnedRpcLease,
): Effect.Effect<void, unknown> {
  const capabilities = [claim.callback, claim.outbound] as const;
  return Effect.tryPromise({
    try: signal => cleanupClaimedCapabilities(
      capabilities,
      workerLease,
      signal,
    ),
    catch: cause => cause,
  }).pipe(
    Effect.timeout(`${claim.definition.cleanupDrainMilliseconds} millis`),
    Effect.ensuring(disposeRpcValuesEffect([
      workerLease,
      ...capabilities,
    ])),
  );
}

function workerCode(
  definition: EdgeActionExactRuntimeWorkerDefinitionV1,
  outbound: EdgeActionOutboundGatewayRpcStubV1,
): WorkerLoaderWorkerCode {
  return {
    compatibilityDate: definition.compatibilityDate,
    mainModule: definition.mainModule,
    modules: definition.modules,
    env: definition.env,
    limits: definition.limits,
    globalOutbound: outbound,
  };
}

function captureClaim(input: unknown): ClaimedEdgeActionExactRuntimeDispatchV1 {
  if (!isRecord(input) || !hasExactKeys(input, [
    "request",
    "definition",
    "callback",
    "outbound",
  ])) throw new Error("Trusted edge-action dispatch claim is malformed.");
  if (!isWorkerDefinition(input.definition)) {
    throw new Error("Trusted edge-action worker definition is malformed.");
  }
  if (!isCallback(input.callback) || !isOutbound(input.outbound)) {
    throw new Error("Trusted edge-action capability set is malformed.");
  }
  return Object.freeze({
    request: input.request,
    definition: input.definition,
    callback: input.callback,
    outbound: input.outbound,
  });
}

function isWorkerDefinition(
  value: unknown,
): value is EdgeActionExactRuntimeWorkerDefinitionV1 {
  if (!isRecord(value) || !hasExactKeys(value, [
    "compatibilityDate",
    "mainModule",
    "modules",
    "env",
    "limits",
    "runtimeTargetSha256Hex",
    "hostPolicySha256Hex",
    "artifact",
    "function",
    "wallMilliseconds",
    "cleanupDrainMilliseconds",
    "entrypoint",
  ])) return false;
  const modules = value.modules;
  const limits = value.limits;
  if (
    typeof value.compatibilityDate !== "string" ||
    typeof value.mainModule !== "string" || value.mainModule.length === 0 ||
    value.entrypoint !== EDGE_ACTION_EXACT_RUNTIME_ENTRYPOINT_V1 ||
    !isLowercaseSha256(value.runtimeTargetSha256Hex) ||
    !isLowercaseSha256(value.hostPolicySha256Hex) ||
    !isPositiveSafeInteger(value.wallMilliseconds) ||
    !isPositiveSafeInteger(value.cleanupDrainMilliseconds) ||
    !isRecord(value.env) || Reflect.ownKeys(value.env).length !== 0 ||
    !isRecord(modules) || !Object.hasOwn(modules, value.mainModule) ||
    Reflect.ownKeys(modules).some(key =>
      typeof key !== "string" || typeof Reflect.get(modules, key) !== "string"
    ) ||
    !isRecord(limits) || !hasExactKeys(limits, ["cpuMs", "subRequests"]) ||
    !isPositiveSafeInteger(limits.cpuMs) ||
    !isPositiveSafeInteger(limits.subRequests) ||
    !isRecord(value.artifact) || !isRecord(value.function)
  ) return false;
  return true;
}

function validateClaimBinding(
  request: EdgeActionExactRuntimeRequestV1,
  definition: EdgeActionExactRuntimeWorkerDefinitionV1,
): void {
  if (
    bytesToHex(request.context.runtimeTargetSha256) !==
      definition.runtimeTargetSha256Hex ||
    bytesToHex(request.context.hostPolicySha256) !==
      definition.hostPolicySha256Hex ||
    !plainDataEqual(request.artifact, definition.artifact) ||
    !plainDataEqual(request.function, definition.function)
  ) throw new Error("Trusted edge-action dispatch binding is inconsistent.");
}

function isCallback(value: unknown): value is EdgeActionCallbackBridgeRpcStubV1 {
  return isRecord(value) && typeof value.invoke === "function" &&
    hasLifecycle(value);
}

function isOutbound(value: unknown): value is EdgeActionOutboundGatewayRpcStubV1 {
  return isRecord(value) && typeof value.fetch === "function" &&
    hasLifecycle(value);
}

function hasLifecycle(
  value: Readonly<Record<string, unknown>>,
): value is Readonly<Record<string, unknown>> & EdgeActionLifecycleRpcStubV1 {
  return typeof value.close === "function" && typeof value.drain === "function";
}

async function settleCapabilityCalls(
  capabilities: ReadonlyArray<EdgeActionLifecycleRpcStubV1>,
  method: "close" | "drain",
  signal: AbortSignal,
): Promise<void> {
  const drained = Promise.allSettled(capabilities.map(capability =>
    Promise.resolve().then(() =>
      Reflect.apply(capability[method], capability, [])
    )
  ));
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  const outcomes = await Promise.race([drained, aborted]).finally(() => {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  });
  const rejected = outcomes.find(
    (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
  );
  if (rejected !== undefined) throw rejected.reason;
}

async function cleanupClaimedCapabilities(
  capabilities: ReadonlyArray<EdgeActionLifecycleRpcStubV1>,
  workerLease: OwnedRpcLease,
  signal: AbortSignal,
): Promise<void> {
  let failed = false;
  let firstFailure: unknown;
  const capture = (cause: unknown): void => {
    if (!failed) firstFailure = cause;
    failed = true;
  };
  try {
    await settleCapabilityCalls(capabilities, "close", signal);
  } catch (cause) {
    capture(cause);
  }
  try {
    workerLease.dispose();
  } catch (cause) {
    capture(cause);
  }
  try {
    await settleCapabilityCalls(capabilities, "drain", signal);
  } catch (cause) {
    capture(cause);
  }
  if (failed) throw firstFailure;
}

async function awaitRpcWithAbort<A>(
  operation: PromiseLike<A>,
  effectSignal: AbortSignal,
  callerSignal?: AbortSignal,
  timeoutMilliseconds?: number,
): Promise<A> {
  const listeners: Array<readonly [AbortSignal, () => void]> = [];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const register = (signal: AbortSignal, cause: unknown): void => {
      const onAbort = () => reject(cause);
      if (signal.aborted) onAbort();
      else {
        signal.addEventListener("abort", onAbort, { once: true });
        listeners.push([signal, onAbort]);
      }
    };
    register(effectSignal, effectSignal.reason);
    if (callerSignal !== undefined) {
      register(callerSignal, expected("cancelled"));
    }
    if (timeoutMilliseconds !== undefined) {
      timeout = setTimeout(
        () => reject(expected("timedOut")),
        timeoutMilliseconds,
      );
    }
  });
  return await Promise.race([Promise.resolve(operation), aborted]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
    for (const [signal, listener] of listeners) {
      signal.removeEventListener("abort", listener);
    }
  });
}

async function awaitAuthorityClaimWithCleanup(
  operation: () => unknown | PromiseLike<unknown>,
  effectSignal: AbortSignal,
  callerSignal?: AbortSignal,
): Promise<unknown> {
  const pending = Promise.resolve().then(operation);
  try {
    return await awaitRpcWithAbort(pending, effectSignal, callerSignal);
  } catch (cause) {
    void pending.then(releaseLateAuthorityClaim).catch(() => {});
    throw cause;
  }
}

async function releaseLateAuthorityClaim(value: unknown): Promise<void> {
  if (!isRecord(value)) return;
  const capabilities = Array.from(new Set(
    [value.callback, value.outbound].filter(
      (candidate): candidate is EdgeActionLifecycleRpcStubV1 =>
        isRecord(candidate) && hasLifecycle(candidate),
    ),
  ));
  if (capabilities.length === 0) return;
  const definition = value.definition;
  const cleanupMilliseconds = isRecord(definition) &&
      isPositiveSafeInteger(definition.cleanupDrainMilliseconds)
    ? definition.cleanupDrainMilliseconds
    : 5_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cleanupMilliseconds);
  try {
    await cleanupClaimedCapabilities(
      capabilities,
      createOwnedRpcLease(),
      controller.signal,
    );
  } catch {
    // A late cancelled claim has no caller to receive cleanup uncertainty.
  } finally {
    clearTimeout(timeout);
    for (const capability of capabilities) {
      try {
        disposeRpcValue(capability);
      } catch {
        // Best-effort disposal is the last available ownership boundary.
      }
    }
  }
}

interface OwnedRpcLease {
  readonly attach: (value: unknown) => void;
  readonly dispose: () => void;
  readonly [Symbol.dispose]: () => void;
}

function createOwnedRpcLease(): OwnedRpcLease {
  let value: unknown;
  let attached = false;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (attached) disposeRpcValue(value);
  };
  return Object.freeze({
    attach: (next: unknown): void => {
      if (attached || disposed) {
        throw new Error("Edge-action Worker lease is no longer attachable.");
      }
      value = next;
      attached = true;
    },
    dispose,
    [Symbol.dispose]: dispose,
  });
}

function expected(reason: ExpectedHostError["reason"]): ExpectedHostError {
  return Object.freeze({
    _tag: "EdgeActionArtifactHostExpectedError",
    reason,
  });
}

function isExpectedHostError(value: unknown): value is ExpectedHostError {
  return value !== null && typeof value === "object" &&
    Reflect.get(value, "_tag") === "EdgeActionArtifactHostExpectedError";
}

function dynamicWorkerFailureReason(
  cause: unknown,
): ExpectedHostError["reason"] | undefined {
  if (
    cause === null || typeof cause !== "object" ||
    typeof Reflect.get(cause, "name") !== "string"
  ) return undefined;
  switch (Reflect.get(cause, "name")) {
    case "EdgeActionExactRuntimeInvalidRequestV1Error": return "invalidRequest";
    case "EdgeActionExactRuntimeCallbackBoundaryV1Error": return "callbackFailed";
    case "EdgeActionExactRuntimeUserCodeV1Error": return "userCodeFailed";
    default: return undefined;
  }
}

function disposeRpcValuesEffect(
  values: ReadonlyArray<unknown>,
): Effect.Effect<void> {
  return Effect.sync(() => {
    let firstFailure: unknown = undefined;
    let failed = false;
    for (const value of values) {
      try {
        disposeRpcValue(value);
      } catch (cause) {
        if (!failed) firstFailure = cause;
        failed = true;
      }
    }
    if (failed) throw firstFailure;
  });
}

function disposeRpcValueEffect(value: unknown): Effect.Effect<void> {
  return Effect.sync(() => disposeRpcValue(value));
}

function disposeRpcValue(value: unknown): void {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) return;
  const dispose = Reflect.get(value, Symbol.dispose);
  if (typeof dispose === "function") Reflect.apply(dispose, value, []);
}

function detachRpcResult(value: unknown): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) return value;
  const detached: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (key === Symbol.dispose) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error("Edge-action RPC result must contain only data properties.");
    }
    Object.defineProperty(detached, key, descriptor);
  }
  return detached;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: ReadonlyArray<string>,
): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && keys.every(key =>
    Object.hasOwn(value, key)
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isLowercaseSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function plainDataEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (
    left === null || right === null || typeof left !== "object" ||
    typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)
  ) return false;
  if (left instanceof Uint8Array || right instanceof Uint8Array) {
    return left instanceof Uint8Array && right instanceof Uint8Array &&
      bytesToHex(left) === bytesToHex(right);
  }
  const leftKeys = Reflect.ownKeys(left);
  const rightKeys = Reflect.ownKeys(right);
  if (
    leftKeys.length !== rightKeys.length ||
    leftKeys.some(key => typeof key !== "string") ||
    rightKeys.some(key => typeof key !== "string")
  ) return false;
  const rightSet = new Set(rightKeys);
  return leftKeys.every(key => rightSet.has(key) &&
    plainDataEqual(Reflect.get(left, key), Reflect.get(right, key)));
}
