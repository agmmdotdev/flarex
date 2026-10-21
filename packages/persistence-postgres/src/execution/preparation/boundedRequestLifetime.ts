import { Cause, Clock, Context, Effect, Option, Result } from "effect";
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
  /** Convert a preparation verdict, retaining the Cause of an exact charge-issued receipt. */
  readonly fromResult: <Value>(result: Result.Result<Value, Failure>) => Effect.Effect<Value, Failure>;
  /** Authenticate a live borrowed context and retain its first complete failure.
   * No call/byte charge, callback execution or settlement authority. */
  readonly recordFailure: (context: BoundedRequestContext, cause: Cause.Cause<Failure>) => Result.Result<Cause.Cause<Failure>, Failure>;
  readonly seal: Effect.Effect<void, Failure>;
  readonly close: Effect.Effect<void>;
  readonly isClosing: () => boolean;
  readonly remainingBytes: () => number;
  readonly usedCalls: () => number;
}

const requestRoots = new WeakMap<object, object>();
const FailureOrigin = Context.Service<object>("Flarex/BoundedRequestFailureOrigin");
/** Source-private authentic request identity; carries no storage authority. */
export const boundedRequestRootIdentity = <Failure>(lifetime: BoundedRequestLifetime<Failure>): object | undefined => requestRoots.get(lifetime);

/** Domain projection over one root lifetime; budgets, contexts and failure latch are shared. */
export function projectBoundedRequestLifetime<Outer, Inner extends Outer>(
  root: BoundedRequestLifetime<Outer>, project: (failure: Outer) => Inner,
): BoundedRequestLifetime<Inner> {
  // Projection owns these exact Reason translations. Stable forward identities
  // preserve repeated propagation; the reverse direction authenticates only
  // reasons actually issued here, never structural errors supplied by a caller.
  const forward = new WeakMap<Cause.Reason<Outer>, Cause.Reason<Inner>>();
  const reverse = new WeakMap<Cause.Reason<Inner>, Cause.Reason<Outer>>();
  const projectCause = (cause: Cause.Cause<Outer>): Cause.Cause<Inner> => Cause.fromReasons(cause.reasons.map(reason => {
    const known = forward.get(reason);
    if (known !== undefined) return known;
    // Cause.map preserves annotation representation with the installed runtime.
    // Its Reason.annotate Map overload is not implemented by RC112.
    const mapped = Cause.map(Cause.fromReasons([reason]), project).reasons[0];
    if (mapped === undefined) throw new Error("Cause projection lost its original reason");
    forward.set(reason, mapped);
    reverse.set(mapped, reason);
    return mapped;
  }));
  const projectEffect = <Value>(work: Effect.Effect<Value, Outer>) => work.pipe(
    Effect.catchCause(cause => Effect.failCause(projectCause(cause))));
  const chargeReceipts = new WeakMap<object, Effect.Effect<never, Inner>>();
  const projected = Object.freeze({
    context: root.context, mode: root.mode, isClosing: root.isClosing, remainingBytes: root.remainingBytes, usedCalls: root.usedCalls, close: root.close,
    begin: (context, id) => projectEffect(root.begin(context, id)),
    adapterCommit: (context, id) => projectEffect(root.adapterCommit(context, id)),
    rollback: (context, id) => projectEffect(root.rollback(context, id)),
    operation: (context, id, mode, work) => projectEffect(root.operation(context, id, mode, work)),
    nested: (context, id, work, mode) => projectEffect(root.nested(context, id, work, mode)),
    withinDeadline: work => projectEffect(root.withinDeadline(work)),
    checkpoint: context => projectEffect(root.checkpoint(context)),
    charge: bytes => {
      const original = root.charge(bytes);
      const mapped = original.pipe(Result.mapError(project));
      if (Result.isFailure(original) && Result.isFailure(mapped)) {
        // The exact source Result emits one failure. Bind its projected Reason
        // to the error already returned in this receipt, preserving identity.
        chargeReceipts.set(mapped, root.fromResult(original).pipe(
          Effect.flatMap(() => Effect.die(new Error("Charge failure receipt unexpectedly succeeded"))),
          Effect.catchCause(cause => {
            const receipt = Cause.map(cause, () => mapped.failure);
            receipt.reasons.forEach((reason, index) => {
              const source = cause.reasons[index];
              if (source !== undefined) reverse.set(reason, source);
            });
            return Effect.failCause(receipt);
          }),
        ));
      }
      return mapped;
    },
    fromResult: result => chargeReceipts.get(result) ?? Effect.fromResult(result),
    recordFailure: (context, cause) => root.recordFailure(context,
      Cause.fromReasons(cause.reasons.map(reason => reverse.get(reason) ?? reason)))
      .pipe(Result.map(projectCause), Result.mapError(project)),
    seal: projectEffect(root.seal),
  } satisfies BoundedRequestLifetime<Inner>);
  const identity = requestRoots.get(root);
  if (identity !== undefined) requestRoots.set(projected, identity);
  return projected;
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

  // Effect may clone Reasons when adding stack annotations. The private token
  // survives that official cloning; only this lifetime can authenticate it.
  type OriginEntry = { reason: Cause.Reason<Failure> };
  const origins = new WeakMap<object, OriginEntry>();
  const issued = new WeakMap<Cause.Reason<Failure>, OriginEntry>();
  const originOf = (reason: Cause.Reason<Failure>): OriginEntry | undefined => {
    const token = reason.annotations.get(FailureOrigin.key);
    return token !== null && typeof token === "object" ? origins.get(token) ?? issued.get(reason) : issued.get(reason);
  };
  const ownCause = (cause: Cause.Cause<Failure>): Cause.Cause<Failure> => {
    const entries: OriginEntry[] = [];
    for (const reason of cause.reasons) {
      let entry = originOf(reason);
      if (entry === undefined) {
        const token = Object.freeze({});
        const owned = reason.annotate(Context.make(FailureOrigin, token), { overwrite: true });
        entry = { reason: owned };
        origins.set(token, entry);
        issued.set(reason, entry);
        issued.set(owned, entry);
      } else {
        const retainedAnnotations = entry.reason.annotations;
        const changed = [...reason.annotations].some(([key, value]) => retainedAnnotations.get(key) !== value);
        if (changed) {
          // This Context carries existing diagnostic annotations only, with no
          // service requirements or business capabilities added to execution.
          entry.reason = entry.reason.annotate(Context.makeUnsafe(new Map(reason.annotations)), { overwrite: true });
          issued.set(entry.reason, entry);
        }
      }
      if (!entries.includes(entry)) entries.push(entry);
    }
    return Cause.fromReasons(entries.map(entry => entry.reason));
  };
  const latch = (cause: Cause.Cause<Failure>): void => {
    if (request.phase === "closed") return;
    const owned = ownCause(cause);
    if (Option.isNone(request.failure) || request.failure.value.reasons.every(reason =>
      owned.reasons.some(next => originOf(next) === originOf(reason)))) request.failure = Option.some(owned);
    if (request.phase === "open") request.phase = "rollbackOnly";
  };
  const refusal = (reason: RequestFailureReason) => {
    const error = failure(reason), cause = ownCause(Cause.fail(error));
    latch(cause);
    return { error, cause };
  };
  const chargeReceipts = new WeakMap<object, Cause.Cause<Failure>>();
  const fail = (reason: RequestFailureReason): Result.Result<never, Failure> => {
    const refused = refusal(reason), result = Result.fail(refused.error);
    chargeReceipts.set(result, refused.cause);
    return result;
  };
  const refuse = (reason: RequestFailureReason): Effect.Effect<never, Failure> => Effect.failCause(refusal(reason).cause);
  const charge = (bytes: number): Result.Result<void, Failure> => {
    if (request.phase === "rollbackOnly")
      return Result.fail(failure("rollbackOnly", Option.getOrUndefined(request.failure)));
    if (request.phase !== "open" && request.phase !== "closing") return fail("closed");
    if (!Number.isSafeInteger(bytes) || bytes < 0 || request.bytes + bytes > limits.commandBytes) return fail("limitExceeded");
    request.bytes += bytes;
    return Result.succeed(undefined);
  };
  const fromResult: BoundedRequestLifetime<Failure>["fromResult"] = result => {
    const cause = chargeReceipts.get(result);
    return cause === undefined ? Effect.fromResult(result) : Effect.failCause(cause);
  };
  const check = Effect.fnUntraced(function* (supplied: BoundedRequestContext) {
    const state = contexts.get(supplied);
    if (state === undefined || !state.live || state.request !== request ||
      state.request.owner !== owner || state.request.requestIdentity !== requestIdentity) {
      return yield* refuse("invalidAuthority");
    }
    if (request.phase !== "open") {
      // A framework refusal may re-enter before seal. Keep its rollback-only
      // verdict while retaining the original complete cause for the owner.
      return yield* Effect.fail(request.phase === "rollbackOnly"
        ? failure("rollbackOnly", Option.getOrUndefined(request.failure))
        : failure("closed"));
    }
    if ((yield* Clock.currentTimeMillis) >= request.expiresAt) return yield* refuse("deadlineExceeded");
    if (request.active !== supplied) return yield* refuse("overlappingOperation");
  }, work => observeExecution("BoundedRequest.checkContext", work));
  const resolveId = Effect.fnUntraced(function* (presented: PresentedTransactionId, missingAllowed: boolean) {
    if (presented === undefined || presented === null) {
      if (missingAllowed) return request.id;
      return yield* refuse("invalidAuthority");
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
      return yield* refuse("invalidAuthority");
    }
    return value;
  }, work => observeExecution("BoundedRequest.resolveId", work));
  const enter = Effect.fnUntraced(function* (supplied: BoundedRequestContext,
    presented: PresentedTransactionId, missingAllowed: boolean) {
    yield* check(supplied);
    request.calls += 1;
    if (request.calls > limits.calls) return yield* refuse("limitExceeded");
    yield* resolveId(presented, missingAllowed);
    // Pending IDs may settle after revocation, closure, timeout or child entry.
    yield* check(supplied);
  }, work => observeExecution("BoundedRequest.enter", work));
  const observe = <Value>(work: Effect.Effect<Value, Failure>) => Effect.suspend(() => {
    request.activeCalls += 1;
    return Effect.uninterruptibleMask(restore => restore(work).pipe(Effect.catchCause(cause => {
      const owned = ownCause(cause);
      latch(owned);
      return Effect.failCause(owned);
    }),
      Effect.ensuring(Effect.sync(() => { request.activeCalls -= 1; }))));
  });
  const begin = Effect.fnUntraced(function* (supplied: BoundedRequestContext, presented?: PresentedTransactionId) {
    return yield* (observe(enter(supplied, presented, true).pipe(Effect.as(request.id))));
  }, work => observeExecution("BoundedRequest.begin", work));
  const operation: BoundedRequestLifetime<Failure>["operation"] = Effect.fnUntraced(
    function* <Value>(supplied: BoundedRequestContext, presented: PresentedTransactionId, operationMode: "read" | "write", work: Effect.Effect<Value, Failure>) {
    return yield* (observe(Effect.gen(function* () {
      yield* enter(supplied, presented, operationMode === "read" && readIdPolicy === "allowMissing");
      if (contexts.get(supplied)?.mode === "read" && operationMode === "write") return yield* refuse("invalidAuthority");
      if (request.busy) return yield* refuse("overlappingOperation");
      request.busy = true;
      return yield* work.pipe(Effect.ensuring(Effect.sync(() => { request.busy = false; })));
    })));
  },
    work => observeExecution("BoundedRequest.operation", work));
  const nested: BoundedRequestLifetime<Failure>["nested"] = Effect.fnUntraced(
    function* <Value>(supplied: BoundedRequestContext, presented: PresentedTransactionId, work: (child: BoundedRequestContext) => Effect.Effect<Value, Failure>, nestedMode?: "read" | "write") {
    return yield* (observe(Effect.gen(function* () {
      yield* enter(supplied, presented, false);
      if (request.busy) return yield* refuse("overlappingOperation");
      const parentMode = contexts.get(supplied)?.mode ?? request.mode;
      if (parentMode === "read" && nestedMode === "write") return yield* refuse("invalidAuthority");
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
      if (remaining <= 0) return yield* refuse("deadlineExceeded");
      // The deadline branch latches its failure before the race interrupts
      // native work. Nested observed operations must not latch that internal
      // interruption ahead of the owning deadline cause.
      return yield* Effect.raceFirst(work, Effect.sleep(remaining).pipe(
        Effect.andThen(() => refuse("deadlineExceeded"))));
    })));
  },
    work => observeExecution("BoundedRequest.withinDeadline", work));
  const settleFromAdapter = Effect.fnUntraced(function* (supplied: BoundedRequestContext, presented: PresentedTransactionId, reason: "borrowedSettlement" | "rollbackOnly") {
    return yield* (observe(enter(supplied, presented, false).pipe(Effect.andThen(() => refuse(reason)))));
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
  const recordFailure: BoundedRequestLifetime<Failure>["recordFailure"] = (supplied, cause) => {
    const state = contexts.get(supplied);
    if (state === undefined || !state.live || state.request !== request ||
      state.request.owner !== owner || state.request.requestIdentity !== requestIdentity)
      return Result.fail(failure("invalidAuthority"));
    if (request.phase === "closed" || request.phase === "closing") return Result.fail(failure("closed"));
    // Failure observation grants no SQL or settlement authority. A live
    // parent can poison its own root while a child runs. Only authenticated
    // originating Reason tokens admit enrichment of the same failure chain.
    const owned = ownCause(cause);
    latch(owned);
    return Result.succeed(owned);
  };
  const lifetime = Object.freeze({ context, mode, begin, operation, nested, withinDeadline, recordFailure,
    checkpoint: (supplied: BoundedRequestContext) => observe(check(supplied)), charge, fromResult, seal, close,
    remainingBytes: () => limits.commandBytes - request.bytes,
    usedCalls: () => request.calls,
    isClosing: () => request.phase === "closing" && !request.busy && request.children === 0 && request.activeCalls === 0 && Option.isNone(request.failure),
    adapterCommit: (supplied: BoundedRequestContext, presented: PresentedTransactionId) => settleFromAdapter(supplied, presented, "borrowedSettlement"),
    rollback: (supplied: BoundedRequestContext, presented: PresentedTransactionId) => settleFromAdapter(supplied, presented, "rollbackOnly"),
  });
  requestRoots.set(lifetime, Object.freeze({}));
  return lifetime;
}, work => observeExecution("BoundedRequest.makeLifetime", work));
