import { Cause, Clock, Effect, Exit, Option, Result } from "effect";
import { observeExecution } from "../diagnostics/operation";

declare const requestBrand: unique symbol;
export interface BoundedRequestContext { readonly [requestBrand]: true }
export type PresentedTransactionId = string | Promise<string> | null | undefined;
export type ReadIdPolicy = "allowMissing" | "require";
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
  readonly mode: "read" | "write";
  readonly begin: (context: BoundedRequestContext, id?: PresentedTransactionId) => Effect.Effect<string, Failure>;
  readonly adapterCommit: (context: BoundedRequestContext, id: PresentedTransactionId) => Effect.Effect<never, Failure>;
  readonly rollback: (context: BoundedRequestContext, id: PresentedTransactionId) => Effect.Effect<never, Failure>;
  readonly operation: <Value>(context: BoundedRequestContext, id: PresentedTransactionId, mode: "read" | "write",
    work: Effect.Effect<Value, Failure>) => Effect.Effect<Value, Failure>;
  readonly nested: <Value>(context: BoundedRequestContext, id: PresentedTransactionId,
    work: (child: BoundedRequestContext) => Effect.Effect<Value, Failure>, mode?: "read" | "write") => Effect.Effect<Value, Failure>;
  /** Interrupt one full native invocation at this request's original deadline. */
  readonly withinDeadline: <Value>(work: Effect.Effect<Value, Failure>) => Effect.Effect<Value, Failure>;
  /** Recheck the active borrowed context after a callback without a second call charge. */
  readonly checkpoint: (context: BoundedRequestContext) => Effect.Effect<void, Failure>;
  readonly charge: (bytes: number) => Result.Result<void, Failure>;
  readonly seal: Effect.Effect<void, Failure>;
  readonly close: Effect.Effect<void>;
  readonly isClosing: () => boolean;
  readonly remainingBytes: () => number;
  readonly usedCalls: () => number;
}

/** Domain projection over one root lifetime; budgets, contexts and failure latch are shared. */
export function projectBoundedRequestLifetime<Outer, Inner extends Outer>(
  root: BoundedRequestLifetime<Outer>, project: (failure: Outer) => Inner,
): BoundedRequestLifetime<Inner> {
  return Object.freeze({
    context: root.context, mode: root.mode, isClosing: root.isClosing, remainingBytes: root.remainingBytes, usedCalls: root.usedCalls, close: root.close,
    begin: (context, id) => root.begin(context, id).pipe(Effect.mapError(project)),
    adapterCommit: (context, id) => root.adapterCommit(context, id).pipe(Effect.mapError(project)),
    rollback: (context, id) => root.rollback(context, id).pipe(Effect.mapError(project)),
    operation: (context, id, mode, work) => root.operation(context, id, mode, work).pipe(Effect.mapError(project)),
    nested: (context, id, work, mode) => root.nested(context, id, work, mode).pipe(Effect.mapError(project)),
    withinDeadline: work => root.withinDeadline(work).pipe(Effect.mapError(project)),
    checkpoint: context => root.checkpoint(context).pipe(Effect.mapError(project)),
    charge: bytes => root.charge(bytes).pipe(Result.mapError(project)),
    seal: root.seal.pipe(Effect.mapError(project)),
  } satisfies BoundedRequestLifetime<Inner>);
}

export const makeBoundedRequestLifetime = Effect.fnUntraced(function* <Failure, Owner extends object, RequestIdentity extends object>(
  failure: (reason: RequestFailureReason, cause?: unknown) => Failure,
  limits: RequestLimits,
  owner: Owner,
  requestIdentity: RequestIdentity,
  id: string,
  mode: "read" | "write",
  readIdPolicy: ReadIdPolicy = "allowMissing",
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
  const check = Effect.fnUntraced(function* (supplied: BoundedRequestContext) {
    const state = contexts.get(supplied);
    if (state === undefined || !state.live || state.request !== request ||
      state.request.owner !== owner || state.request.requestIdentity !== requestIdentity) {
      return yield* Effect.fromResult(fail("invalidAuthority"));
    }
    if (request.phase !== "open") {
      // A framework refusal may re-enter before seal. Keep its rollback-only
      // verdict while retaining the original complete cause for the owner.
      return yield* Effect.fail(request.phase === "rollbackOnly"
        ? failure("rollbackOnly", Option.getOrUndefined(request.failure))
        : failure("closed"));
    }
    if ((yield* Clock.currentTimeMillis) >= request.expiresAt) return yield* Effect.fromResult(fail("deadlineExceeded"));
    if (request.active !== supplied) return yield* Effect.fromResult(fail("overlappingOperation"));
  }, work => observeExecution("BoundedRequest.checkContext", work));
  const resolveId = Effect.fnUntraced(function* (presented: PresentedTransactionId, missingAllowed: boolean) {
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
  }, work => observeExecution("BoundedRequest.resolveId", work));
  const enter = Effect.fnUntraced(function* (supplied: BoundedRequestContext,
    presented: PresentedTransactionId, missingAllowed: boolean) {
    yield* check(supplied);
    request.calls += 1;
    if (request.calls > limits.calls) return yield* Effect.fromResult(fail("limitExceeded"));
    yield* resolveId(presented, missingAllowed);
    // Pending IDs may settle after revocation, closure, timeout or child entry.
    yield* check(supplied);
  }, work => observeExecution("BoundedRequest.enter", work));
  const observe = <Value>(work: Effect.Effect<Value, Failure>) => Effect.suspend(() => {
    request.activeCalls += 1;
    return work.pipe(Effect.onExit(exit => Exit.isFailure(exit)
      ? Effect.sync(() => latch(exit.cause)) : Effect.void),
      Effect.ensuring(Effect.sync(() => { request.activeCalls -= 1; })));
  });
  const begin = Effect.fnUntraced(function* (supplied: BoundedRequestContext, presented?: PresentedTransactionId) {
    return yield* (observe(enter(supplied, presented, true).pipe(Effect.as(request.id))));
  }, work => observeExecution("BoundedRequest.begin", work));
  const operation: BoundedRequestLifetime<Failure>["operation"] = Effect.fnUntraced(
    function* <Value>(supplied: BoundedRequestContext, presented: PresentedTransactionId, operationMode: "read" | "write", work: Effect.Effect<Value, Failure>) {
    return yield* (observe(Effect.gen(function* () {
      yield* enter(supplied, presented, operationMode === "read" && readIdPolicy === "allowMissing");
      if (contexts.get(supplied)?.mode === "read" && operationMode === "write") return yield* Effect.fromResult(fail("invalidAuthority"));
      if (request.busy) return yield* Effect.fromResult(fail("overlappingOperation"));
      request.busy = true;
      return yield* work.pipe(Effect.ensuring(Effect.sync(() => { request.busy = false; })));
    })));
  },
    work => observeExecution("BoundedRequest.operation", work));
  const nested: BoundedRequestLifetime<Failure>["nested"] = Effect.fnUntraced(
    function* <Value>(supplied: BoundedRequestContext, presented: PresentedTransactionId, work: (child: BoundedRequestContext) => Effect.Effect<Value, Failure>, nestedMode?: "read" | "write") {
    return yield* (observe(Effect.gen(function* () {
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
    })));
  },
    work => observeExecution("BoundedRequest.nested", work));
  const withinDeadline: BoundedRequestLifetime<Failure>["withinDeadline"] = Effect.fnUntraced(
    function* <Value>(work: Effect.Effect<Value, Failure>) {
    return yield* (observe(Effect.gen(function* () {
      if (request.phase !== "open") return yield* Effect.fail(request.phase === "rollbackOnly"
        ? failure("rollbackOnly", Option.getOrUndefined(request.failure)) : failure("closed"));
      const remaining = request.expiresAt - (yield* Clock.currentTimeMillis);
      if (remaining <= 0) return yield* Effect.fromResult(fail("deadlineExceeded"));
      // The deadline branch latches its failure before the race interrupts
      // native work. Nested observed operations must not latch that internal
      // interruption ahead of the owning deadline cause.
      return yield* Effect.raceFirst(work, Effect.sleep(remaining).pipe(
        Effect.andThen(() => Effect.fromResult(fail("deadlineExceeded")))));
    })));
  },
    work => observeExecution("BoundedRequest.withinDeadline", work));
  const settleFromAdapter = Effect.fnUntraced(function* (supplied: BoundedRequestContext, presented: PresentedTransactionId, reason: "borrowedSettlement" | "rollbackOnly") {
    return yield* (observe(enter(supplied, presented, false).pipe(Effect.andThen(() => Effect.fromResult(fail(reason))))));
  }, work => observeExecution("BoundedRequest.adapterSettlement", work));
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
  return Object.freeze({ context, mode, begin, operation, nested, withinDeadline,
    checkpoint: (supplied: BoundedRequestContext) => observe(check(supplied)), charge, seal, close,
    remainingBytes: () => limits.commandBytes - request.bytes,
    usedCalls: () => request.calls,
    isClosing: () => request.phase === "closing" && !request.busy && request.children === 0 && request.activeCalls === 0 && Option.isNone(request.failure),
    adapterCommit: (supplied: BoundedRequestContext, presented: PresentedTransactionId) => settleFromAdapter(supplied, presented, "borrowedSettlement"),
    rollback: (supplied: BoundedRequestContext, presented: PresentedTransactionId) => settleFromAdapter(supplied, presented, "rollbackOnly"),
  });
}, work => observeExecution("BoundedRequest.makeLifetime", work));
