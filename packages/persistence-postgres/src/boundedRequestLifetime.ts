import { Cause, Clock, Effect, Option, Result } from "effect";

declare const requestBrand: unique symbol;
export interface BoundedRequestContext { readonly [requestBrand]: true }
export type PresentedTransactionId = string | Promise<string> | null | undefined;
export type RequestFailureReason = "invalidInput" | "invalidAuthority" | "closed" | "rollbackOnly" |
  "limitExceeded" | "deadlineExceeded" | "overlappingOperation" | "borrowedSettlement";
export interface RequestLimits { readonly calls: number; readonly commandBytes: number; readonly commandMs: number }
interface RequestState<Failure> {
  readonly owner: object;
  readonly requestIdentity: object;
  readonly id: string;
  readonly mode: "read" | "write";
  readonly expiresAt: number;
  phase: "open" | "rollbackOnly" | "closing" | "closed";
  active: BoundedRequestContext;
  busy: boolean;
  children: number;
  activeCalls: number;
  calls: number;
  bytes: number;
  failure: Option.Option<Cause.Cause<Failure>>;
  readonly pending: WeakMap<Promise<string>, Effect.Effect<string, Failure>>;
}

interface ContextState<Failure> {
  readonly request: RequestState<Failure>;
  readonly mode: "read" | "write";
  live: boolean;
}


/** Source-private per-request owner. It conveys no database or publication authority. */
export interface BoundedRequestLifetime<Failure> {
  readonly context: BoundedRequestContext;
  readonly begin: (context: BoundedRequestContext, id?: PresentedTransactionId) => Effect.Effect<string, Failure>;
  readonly adapterCommit: (context: BoundedRequestContext, id: PresentedTransactionId) => Effect.Effect<never, Failure>;
  readonly rollback: (context: BoundedRequestContext, id: PresentedTransactionId) => Effect.Effect<never, Failure>;
  readonly operation: <Value>(context: BoundedRequestContext, id: PresentedTransactionId, mode: "read" | "write",
    work: Effect.Effect<Value, Failure>) => Effect.Effect<Value, Failure>;
  readonly nested: <Value>(context: BoundedRequestContext, id: PresentedTransactionId,
    work: (child: BoundedRequestContext) => Effect.Effect<Value, Failure>, mode?: "read" | "write") => Effect.Effect<Value, Failure>;
  readonly charge: (bytes: number) => Result.Result<void, Failure>;
  readonly seal: Effect.Effect<void, Failure>;
  readonly close: Effect.Effect<void>;
  readonly isClosing: () => boolean;
  readonly remainingBytes: () => number;
}

export const makeBoundedRequestLifetime = Effect.fn("BoundedRequest.makeLifetime")(function* <Failure, Owner extends object, RequestIdentity extends object>(
  failure: (reason: RequestFailureReason, cause?: unknown) => Failure,
  limits: RequestLimits,
  owner: Owner,
  requestIdentity: RequestIdentity,
  id: string,
  mode: "read" | "write",
): Effect.fn.Return<BoundedRequestLifetime<Failure>, Failure> {
  const contexts = new WeakMap<object, ContextState<Failure>>();
  if (id.trim().length === 0 || id.length > 256 || id.includes("\0")) {
    return yield* Effect.fail(failure("invalidInput"));
  }
  // SAFETY: the brand is inert; the private registry and bound owner methods authenticate it.
  const context = Object.freeze({}) as BoundedRequestContext;
  const request: RequestState<Failure> = {
    owner, requestIdentity, id, mode,
    expiresAt: (yield* Clock.currentTimeMillis) + limits.commandMs,
    phase: "open", active: context, busy: false, children: 0, activeCalls: 0, calls: 1, bytes: 0,
    failure: Option.none(), pending: new WeakMap(),
  };
  contexts.set(context, { request, live: true, mode });

  const latch = (cause: Cause.Cause<Failure>): void => {
    if (request.phase === "closed") return;
    if (Option.isNone(request.failure)) request.failure = Option.some(cause);
    if (request.phase === "open") request.phase = "rollbackOnly";
  };
  const fail = (reason: RequestFailureReason): Result.Result<never, Failure> => {
    const error = failure(reason);
    latch(Cause.fail(error));
    return Result.fail(error);
  };
  const charge = (bytes: number): Result.Result<void, Failure> => {
    if (request.phase !== "open" && request.phase !== "closing") return fail("closed");
    if (!Number.isSafeInteger(bytes) || bytes < 0 || request.bytes + bytes > limits.commandBytes) return fail("limitExceeded");
    request.bytes += bytes;
    return Result.succeed(undefined);
  };
  const check = Effect.fn("BoundedRequest.checkContext")(function* (supplied: BoundedRequestContext) {
    const state = contexts.get(supplied);
    if (state === undefined || !state.live || state.request !== request ||
      state.request.owner !== owner || state.request.requestIdentity !== requestIdentity) {
      return yield* Effect.fromResult(fail("invalidAuthority"));
    }
    if (request.phase !== "open") return yield* Effect.fail(failure(request.phase === "rollbackOnly" ? "rollbackOnly" : "closed"));
    if ((yield* Clock.currentTimeMillis) >= request.expiresAt) return yield* Effect.fromResult(fail("deadlineExceeded"));
    if (request.active !== supplied) return yield* Effect.fromResult(fail("overlappingOperation"));
  });
  const resolveId = Effect.fn("BoundedRequest.resolveId")(function* (presented: PresentedTransactionId, missingAllowed: boolean) {
    if (presented === undefined || presented === null) {
      if (missingAllowed) return request.id;
      return yield* Effect.fromResult(fail("invalidAuthority"));
    }
    let value: string;
    if (presented instanceof Promise) {
      let resolved = request.pending.get(presented);
      if (resolved === undefined) {
        resolved = yield* Effect.cached(Effect.tryPromise({
          try: () => presented,
          catch: cause => failure("invalidAuthority", cause),
        }));
        request.pending.set(presented, resolved);
      }
      value = yield* resolved;
    } else value = presented;
    if (typeof value !== "string" || value.length === 0 || value !== request.id) {
      return yield* Effect.fromResult(fail("invalidAuthority"));
    }
    return value;
  });
  const enter = Effect.fn("BoundedRequest.enter")(function* (supplied: BoundedRequestContext,
    presented: PresentedTransactionId, missingAllowed: boolean) {
    yield* check(supplied);
    request.calls += 1;
    if (request.calls > limits.calls) return yield* Effect.fromResult(fail("limitExceeded"));
    yield* resolveId(presented, missingAllowed);
    // Pending IDs may settle after revocation, closure, timeout or child entry.
    yield* check(supplied);
  });
  const observe = <Value>(work: Effect.Effect<Value, Failure>) => Effect.suspend(() => {
    request.activeCalls += 1;
    return work.pipe(Effect.tapCause(cause => Effect.sync(() => latch(cause))),
      Effect.ensuring(Effect.sync(() => { request.activeCalls -= 1; })));
  });
  const begin = Effect.fn("BoundedRequest.begin")((supplied: BoundedRequestContext, presented?: PresentedTransactionId) =>
    observe(enter(supplied, presented, true).pipe(Effect.as(request.id))));
  const operation: BoundedRequestLifetime<Failure>["operation"] = Effect.fn("BoundedRequest.operation")(
    (supplied, presented, operationMode, work) => observe(Effect.gen(function* () {
      yield* enter(supplied, presented, operationMode === "read");
      if (contexts.get(supplied)?.mode === "read" && operationMode === "write") return yield* Effect.fromResult(fail("invalidAuthority"));
      if (request.busy) return yield* Effect.fromResult(fail("overlappingOperation"));
      request.busy = true;
      return yield* work.pipe(Effect.ensuring(Effect.sync(() => { request.busy = false; })));
    })),
  );
  const nested: BoundedRequestLifetime<Failure>["nested"] = Effect.fn("BoundedRequest.nested")(
    (supplied, presented, work, nestedMode) => observe(Effect.gen(function* () {
      yield* enter(supplied, presented, false);
      if (request.busy) return yield* Effect.fromResult(fail("overlappingOperation"));
      const parentMode = contexts.get(supplied)?.mode ?? request.mode;
      if (parentMode === "read" && nestedMode === "write") return yield* Effect.fromResult(fail("invalidAuthority"));
      // SAFETY: this child is registered only for this exact outer lifetime.
      const child = Object.freeze({}) as BoundedRequestContext;
      const childState: ContextState<Failure> = { request, live: true, mode: nestedMode ?? parentMode };
      contexts.set(child, childState);
      request.active = child;
      request.children += 1;
      return yield* Effect.suspend(() => work(child)).pipe(Effect.ensuring(Effect.sync(() => {
        childState.live = false;
        contexts.delete(child);
        request.children -= 1;
        request.active = supplied;
      })));
    })),
  );
  const settleFromAdapter = Effect.fn("BoundedRequest.adapterSettlement")((supplied: BoundedRequestContext,
    presented: PresentedTransactionId, reason: "borrowedSettlement" | "rollbackOnly") =>
    observe(enter(supplied, presented, false).pipe(Effect.andThen(() => Effect.fromResult(fail(reason))))));
  const seal = Effect.gen(function* () {
    if (request.phase === "closed" || request.phase === "closing") return yield* Effect.fail(failure("closed"));
    if (request.busy || request.children !== 0 || request.activeCalls !== 0) latch(Cause.fail(failure("overlappingOperation")));
    if ((yield* Clock.currentTimeMillis) >= request.expiresAt) latch(Cause.fail(failure("deadlineExceeded")));
    if (Option.isSome(request.failure)) {
      return yield* Effect.failCause(Cause.combine(Cause.fail(failure("rollbackOnly")), request.failure.value));
    }
    request.phase = "closing";
  });
  const close = Effect.sync(() => {
    request.phase = "closed";
    contexts.delete(context);
  });
  return Object.freeze({ context, begin, operation, nested, charge, seal, close,
    remainingBytes: () => limits.commandBytes - request.bytes,
    isClosing: () => request.phase === "closing" && !request.busy && request.children === 0 && request.activeCalls === 0 && Option.isNone(request.failure),
    adapterCommit: (supplied: BoundedRequestContext, presented: PresentedTransactionId) => settleFromAdapter(supplied, presented, "borrowedSettlement"),
    rollback: (supplied: BoundedRequestContext, presented: PresentedTransactionId) => settleFromAdapter(supplied, presented, "rollbackOnly"),
  });
});
