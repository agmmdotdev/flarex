/**
 * Function-type admission translated from Convex application_function_runner/mod.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Bounded waiters and callback
 * backlog are the DO adaptation recorded in do-cache-and-admission-budgets.md.
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Data, Deferred, Effect, Schema } from "effect";

const NonnegativeCount = Schema.Int.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0
  ? undefined : "Expected a nonnegative safe count"));
const PositiveCount = NonnegativeCount.check(Schema.isGreaterThan(0));
const LimiterConfiguration = Schema.Struct({
  maxActive: PositiveCount,
  maxQueued: NonnegativeCount,
  waitMilliseconds: NonnegativeCount,
});

export const CoreApplicationAdmissionConfigurationSchema = Schema.Struct({
  query: LimiterConfiguration,
  mutation: LimiterConfiguration,
  /** Outstanding foreign callbacks, including the currently executing callback. */
  maxPendingCallbacks: PositiveCount,
  /** Retained bridge stream handles; independent of unioned core read intervals. */
  maxOpenQueries: PositiveCount,
});
export type CoreApplicationAdmissionConfiguration = typeof CoreApplicationAdmissionConfigurationSchema.Type;
export type CoreApplicationFunctionKind = "query" | "mutation";

export class CoreApplicationAdmissionError extends Data.TaggedError("CoreApplicationAdmissionError")<{
  readonly reason: "invalidConfiguration" | "overloaded" | "waitExpired" | "closed" | "callbackCapacity" | "queryCapacity";
  readonly kind?: CoreApplicationFunctionKind;
  readonly cause?: unknown;
}> {}

export interface CoreApplicationAdmission {
  readonly maxPendingCallbacks: number;
  readonly maxOpenQueries: number;
  readonly withPermit: <A, E, R>(kind: CoreApplicationFunctionKind,
    work: Effect.Effect<A, E, R>) => Effect.Effect<A, E | CoreApplicationAdmissionError, R>;
  /** Refuse new/queued work, then wait for active owners to drain before release. */
  readonly close: Effect.Effect<void>;
}

interface Waiter {
  readonly ready: Deferred.Deferred<void, CoreApplicationAdmissionError>;
  state: "queued" | "active" | "released";
}

/** One app-lifetime owner; both fresh query and mutation layers borrow it.
 * Nested function calls stay inside their admitted root invocation. */
export const makeCoreApplicationAdmission = Effect.fn("CoreApplicationAdmission.make")(function* (
  input: CoreApplicationAdmissionConfiguration,
) {
  const configuration = yield* Schema.decodeUnknownEffect(CoreApplicationAdmissionConfigurationSchema)(input).pipe(
    Effect.mapError(cause => new CoreApplicationAdmissionError({ reason: "invalidConfiguration", cause })),
  );
  let closed = false;
  const drained = Deferred.makeUnsafe<void>();
  const query = makeLimiter("query", configuration.query);
  const mutation = makeLimiter("mutation", configuration.mutation);
  const channels = { query, mutation };

  function notifyDrained(): void {
    if (closed && query.active.size === 0 && mutation.active.size === 0)
      Deferred.doneUnsafe(drained, Effect.void);
  }

  function makeLimiter(kind: CoreApplicationFunctionKind, limits: typeof configuration.query) {
    const active = new Set<Waiter>();
    const queued = new Set<Waiter>();
    const refusal = (reason: "overloaded" | "waitExpired" | "closed") => new CoreApplicationAdmissionError({ reason, kind });
    const release = (waiter: Waiter) => Effect.sync(() => {
      if (waiter.state === "released") return;
      active.delete(waiter);
      queued.delete(waiter);
      waiter.state = "released";
      if (!closed && active.size < limits.maxActive) {
        const next = queued.values().next().value;
        if (next !== undefined) {
          queued.delete(next);
          next.state = "active";
          active.add(next);
          Deferred.doneUnsafe(next.ready, Effect.void);
        }
      }
      notifyDrained();
    });
    const reserve = Effect.suspend(() => {
      if (closed) return Effect.fail(refusal("closed"));
      if (active.size >= limits.maxActive && queued.size >= limits.maxQueued)
        return Effect.fail(refusal("overloaded"));
      const entry: Waiter = { ready: Deferred.makeUnsafe(), state: active.size < limits.maxActive ? "active" : "queued" };
      if (entry.state === "active") active.add(entry);
      else queued.add(entry);
      return Effect.succeed(entry);
    });
    const wait = (waiter: Waiter) => waiter.state === "active" ? Effect.void : Deferred.await(waiter.ready).pipe(
      Effect.timeoutOrElse({ duration: limits.waitMilliseconds, orElse: () => Effect.fail(refusal("waitExpired")) }),
    );
    return { active, queued, reserve, wait, release };
  }

  const close = Effect.fn("CoreApplicationAdmission.close")(() => Effect.andThen(Effect.sync(() => {
    closed = true;
    for (const kind of ["query", "mutation"] as const) {
      const channel = channels[kind];
      for (const waiter of channel.queued) {
        waiter.state = "released";
        Deferred.doneUnsafe(waiter.ready, Effect.fail(new CoreApplicationAdmissionError({ reason: "closed", kind })));
      }
      channel.queued.clear();
    }
    notifyDrained();
  }), Deferred.await(drained)));
  const admission: CoreApplicationAdmission = Object.freeze({
    maxPendingCallbacks: configuration.maxPendingCallbacks,
    maxOpenQueries: configuration.maxOpenQueries,
    withPermit: Effect.fn("CoreApplicationAdmission.withPermit")(<A, E, R>(
      kind: CoreApplicationFunctionKind, work: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | CoreApplicationAdmissionError, R> => Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const channel = channels[kind];
      const waiter = yield* channel.reserve;
      // One mask protects reservation until cleanup is installed. Only the wait
      // and body restore the caller's interruptibility; nesting this under a
      // masked acquireUseRelease acquisition would make restore ineffective.
      return yield* Effect.gen(function* () {
        yield* restore(channel.wait(waiter));
        if (closed) return yield* new CoreApplicationAdmissionError({ reason: "closed", kind });
        return yield* restore(work);
      }).pipe(Effect.ensuring(channel.release(waiter)));
    }))),
    close: close(),
  });
  yield* Effect.addFinalizer(() => admission.close);
  return admission;
});
