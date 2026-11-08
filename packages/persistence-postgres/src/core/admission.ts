/**
 * Function-type admission translated from Convex application_function_runner/mod.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Bounded waiters are the adaptation
 * recorded in do-cache-and-admission-budgets.md and native-root-admission.md.
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Data, Deferred, Effect, Schema } from "effect";

const CoreAdmissionNonnegativeCount = Schema.Int.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0
  ? undefined : "Expected a nonnegative safe count"));
export const CoreAdmissionPositiveCount = CoreAdmissionNonnegativeCount.check(Schema.isGreaterThan(0));
const LimiterConfiguration = Schema.Struct({
  maxActive: CoreAdmissionPositiveCount,
  maxQueued: CoreAdmissionNonnegativeCount,
  waitMilliseconds: CoreAdmissionNonnegativeCount,
});

export const CoreAdmissionChannelsSchema = Schema.Struct({
  query: LimiterConfiguration,
  mutation: LimiterConfiguration,
});
export type CoreAdmissionChannels = typeof CoreAdmissionChannelsSchema.Type;
export type CoreApplicationFunctionKind = "query" | "mutation";

export class CoreApplicationAdmissionError extends Data.TaggedError("CoreApplicationAdmissionError")<{
  readonly reason: "invalidConfiguration" | "overloaded" | "waitExpired" | "closed" | "callbackCapacity" | "queryCapacity";
  readonly kind?: CoreApplicationFunctionKind;
  readonly cause?: unknown;
}> {}

export interface CoreAdmissionLimiter {
  /** Only admission's own refusals pass through `refuse`, never one raised by `work`. */
  readonly withPermit: <A, E, R, F>(kind: CoreApplicationFunctionKind, work: Effect.Effect<A, E, R>,
    refuse: (error: CoreApplicationAdmissionError) => F) => Effect.Effect<A, E | F, R>;
  /** Refuse new work and fail every waiter. Active permits run to completion. */
  readonly stop: Effect.Effect<void>;
  /** Completes once stopped with no active permit. */
  readonly drained: Effect.Effect<void>;
}

interface Waiter {
  readonly ready: Deferred.Deferred<void, CoreApplicationAdmissionError>;
  state: "queued" | "active" | "released";
}

export function makeCoreAdmissionLimiter(configuration: CoreAdmissionChannels): CoreAdmissionLimiter {
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

  return Object.freeze({
    withPermit: <A, E, R, F>(kind: CoreApplicationFunctionKind, work: Effect.Effect<A, E, R>,
      refuse: (error: CoreApplicationAdmissionError) => F): Effect.Effect<A, E | F, R> => Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const channel = channels[kind];
      const waiter = yield* Effect.mapError(channel.reserve, refuse);
      // One mask protects reservation until cleanup is installed. Only the wait
      // and body restore the caller's interruptibility; nesting this under a
      // masked acquireUseRelease acquisition would make restore ineffective.
      return yield* Effect.gen(function* () {
        yield* Effect.mapError(restore(channel.wait(waiter)), refuse);
        if (closed) return yield* Effect.fail(refuse(new CoreApplicationAdmissionError({ reason: "closed", kind })));
        return yield* restore(work);
      }).pipe(Effect.ensuring(channel.release(waiter)));
    })),
    stop: Effect.sync(() => {
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
    }),
    drained: Deferred.await(drained),
  });
}
