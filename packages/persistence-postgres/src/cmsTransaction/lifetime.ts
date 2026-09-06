import { Cause, Clock, Effect, Option, Result } from "effect";
import { cmsError, cmsLimits, type CmsRequestContext, type CmsPresentedTransactionId,
  type CmsTransactionError, type CmsHostIdentity, type CmsRequestIdentity } from "./model";

interface RequestState {
  readonly owner: CmsHostIdentity;
  readonly requestIdentity: CmsRequestIdentity;
  readonly id: string;
  readonly mode: "read" | "write";
  readonly expiresAt: number;
  phase: "open" | "rollbackOnly" | "closing" | "closed";
  active: CmsRequestContext;
  busy: boolean;
  children: number;
  activeCalls: number;
  calls: number;
  bytes: number;
  failure: Option.Option<Cause.Cause<CmsTransactionError>>;
  readonly pending: WeakMap<Promise<string>, Effect.Effect<string, CmsTransactionError>>;
}

interface ContextState {
  readonly request: RequestState;
  live: boolean;
}
const contexts = new WeakMap<object, ContextState>();

/** Source-private per-request owner. It conveys no database or publication authority. */
export interface CmsRequestLifetime {
  readonly context: CmsRequestContext;
  readonly begin: (context: CmsRequestContext, id?: CmsPresentedTransactionId) => Effect.Effect<string, CmsTransactionError>;
  readonly adapterCommit: (context: CmsRequestContext, id: CmsPresentedTransactionId) => Effect.Effect<never, CmsTransactionError>;
  readonly rollback: (context: CmsRequestContext, id: CmsPresentedTransactionId) => Effect.Effect<never, CmsTransactionError>;
  readonly operation: <Value>(context: CmsRequestContext, id: CmsPresentedTransactionId, mode: "read" | "write",
    work: Effect.Effect<Value, CmsTransactionError>) => Effect.Effect<Value, CmsTransactionError>;
  readonly nested: <Value>(context: CmsRequestContext, id: CmsPresentedTransactionId,
    work: (child: CmsRequestContext) => Effect.Effect<Value, CmsTransactionError>) => Effect.Effect<Value, CmsTransactionError>;
  readonly charge: (bytes: number) => Result.Result<void, CmsTransactionError>;
  readonly seal: Effect.Effect<void, CmsTransactionError>;
  readonly close: Effect.Effect<void>;
  readonly isClosing: () => boolean;
  readonly remainingBytes: () => number;
}

export const makeCmsRequestLifetime = Effect.fn("CmsRequest.makeLifetime")(function* (
  owner: CmsHostIdentity,
  requestIdentity: CmsRequestIdentity,
  id: string,
  mode: "read" | "write",
): Effect.fn.Return<CmsRequestLifetime, CmsTransactionError> {
  if (id.trim().length === 0 || id.length > 256 || id.includes("\0")) {
    return yield* Effect.fail(cmsError("invalidInput"));
  }
  // SAFETY: the brand is inert; the private registry and bound owner methods authenticate it.
  const context = Object.freeze({}) as CmsRequestContext;
  const request: RequestState = {
    owner, requestIdentity, id, mode,
    expiresAt: (yield* Clock.currentTimeMillis) + cmsLimits.commandMs,
    phase: "open", active: context, busy: false, children: 0, activeCalls: 0, calls: 1, bytes: 0,
    failure: Option.none(), pending: new WeakMap(),
  };
  contexts.set(context, { request, live: true });

  const latch = (cause: Cause.Cause<CmsTransactionError>): void => {
    if (request.phase === "closed") return;
    if (Option.isNone(request.failure)) request.failure = Option.some(cause);
    if (request.phase === "open") request.phase = "rollbackOnly";
  };
  const fail = (reason: CmsTransactionError["reason"]): Result.Result<never, CmsTransactionError> => {
    const error = cmsError(reason);
    latch(Cause.fail(error));
    return Result.fail(error);
  };
  const charge = (bytes: number): Result.Result<void, CmsTransactionError> => {
    if (request.phase !== "open" && request.phase !== "closing") return fail("closed");
    if (!Number.isSafeInteger(bytes) || bytes < 0 || request.bytes + bytes > cmsLimits.commandBytes) return fail("limitExceeded");
    request.bytes += bytes;
    return Result.succeed(undefined);
  };
  const check = Effect.fn("CmsRequest.checkContext")(function* (supplied: CmsRequestContext) {
    const state = contexts.get(supplied);
    if (state === undefined || !state.live || state.request !== request ||
      state.request.owner !== owner || state.request.requestIdentity !== requestIdentity) {
      return yield* Effect.fromResult(fail("invalidAuthority"));
    }
    if (request.phase !== "open") return yield* Effect.fail(cmsError(request.phase === "rollbackOnly" ? "rollbackOnly" : "closed"));
    if ((yield* Clock.currentTimeMillis) >= request.expiresAt) return yield* Effect.fromResult(fail("deadlineExceeded"));
    if (request.active !== supplied) return yield* Effect.fromResult(fail("overlappingOperation"));
  });
  const resolveId = Effect.fn("CmsRequest.resolveId")(function* (presented: CmsPresentedTransactionId, missingAllowed: boolean) {
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
          catch: cause => cmsError("invalidAuthority", cause),
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
  const enter = Effect.fn("CmsRequest.enter")(function* (supplied: CmsRequestContext,
    presented: CmsPresentedTransactionId, missingAllowed: boolean) {
    yield* check(supplied);
    request.calls += 1;
    if (request.calls > cmsLimits.calls) return yield* Effect.fromResult(fail("limitExceeded"));
    yield* resolveId(presented, missingAllowed);
    // Pending IDs may settle after revocation, closure, timeout or child entry.
    yield* check(supplied);
  });
  const observe = <Value>(work: Effect.Effect<Value, CmsTransactionError>) => Effect.suspend(() => {
    request.activeCalls += 1;
    return work.pipe(Effect.tapCause(cause => Effect.sync(() => latch(cause))),
      Effect.ensuring(Effect.sync(() => { request.activeCalls -= 1; })));
  });
  const begin = Effect.fn("CmsRequest.begin")((supplied: CmsRequestContext, presented?: CmsPresentedTransactionId) =>
    observe(enter(supplied, presented, true).pipe(Effect.as(request.id))));
  const operation: CmsRequestLifetime["operation"] = Effect.fn("CmsRequest.operation")(
    (supplied, presented, operationMode, work) => observe(Effect.gen(function* () {
      yield* enter(supplied, presented, operationMode === "read");
      if (request.mode === "read" && operationMode === "write") return yield* Effect.fromResult(fail("invalidAuthority"));
      if (request.busy) return yield* Effect.fromResult(fail("overlappingOperation"));
      request.busy = true;
      return yield* work.pipe(Effect.ensuring(Effect.sync(() => { request.busy = false; })));
    })),
  );
  const nested: CmsRequestLifetime["nested"] = Effect.fn("CmsRequest.nested")(
    (supplied, presented, work) => observe(Effect.gen(function* () {
      yield* enter(supplied, presented, false);
      if (request.busy) return yield* Effect.fromResult(fail("overlappingOperation"));
      // SAFETY: this child is registered only for this exact outer lifetime.
      const child = Object.freeze({}) as CmsRequestContext;
      const childState: ContextState = { request, live: true };
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
  const settleFromAdapter = Effect.fn("CmsRequest.adapterSettlement")((supplied: CmsRequestContext,
    presented: CmsPresentedTransactionId, reason: "borrowedSettlement" | "rollbackOnly") =>
    observe(enter(supplied, presented, false).pipe(Effect.andThen(() => Effect.fromResult(fail(reason))))));
  const seal = Effect.gen(function* () {
    if (request.phase === "closed" || request.phase === "closing") return yield* Effect.fail(cmsError("closed"));
    if (request.busy || request.children !== 0 || request.activeCalls !== 0) latch(Cause.fail(cmsError("overlappingOperation")));
    if ((yield* Clock.currentTimeMillis) >= request.expiresAt) latch(Cause.fail(cmsError("deadlineExceeded")));
    if (Option.isSome(request.failure)) {
      return yield* Effect.failCause(Cause.combine(Cause.fail(cmsError("rollbackOnly")), request.failure.value));
    }
    request.phase = "closing";
  });
  const close = Effect.sync(() => {
    request.phase = "closed";
    contexts.delete(context);
  });
  return Object.freeze({ context, begin, operation, nested, charge, seal, close,
    remainingBytes: () => cmsLimits.commandBytes - request.bytes,
    isClosing: () => request.phase === "closing" && !request.busy && request.children === 0 && request.activeCalls === 0 && Option.isNone(request.failure),
    adapterCommit: (supplied: CmsRequestContext, presented: CmsPresentedTransactionId) => settleFromAdapter(supplied, presented, "borrowedSettlement"),
    rollback: (supplied: CmsRequestContext, presented: CmsPresentedTransactionId) => settleFromAdapter(supplied, presented, "rollbackOnly"),
  });
});
