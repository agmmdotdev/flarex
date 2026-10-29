import { Context, Effect, Exit, Ref, type Scope } from "effect";

import type {
  ApplicationQueryCacheCandidate,
  ApplicationQueryCacheHandoff,
} from "./applicationQueryDataCache";

export interface ApplicationQueryCompletionApi {
  /** Borrowed only by a sealed snapshot's release; it does not publish yet. */
  readonly stage: (
    handoff: ApplicationQueryCacheHandoff,
    candidate: ApplicationQueryCacheCandidate,
  ) => Effect.Effect<void>;
}

/** One trusted query invocation's outcome, never a global cache or authority. */
export class ApplicationQueryCompletion extends Context.Service<
  ApplicationQueryCompletion,
  ApplicationQueryCompletionApi
>()("flarex/persistence-postgres/ApplicationQueryCompletion") {}

interface StagedQueryCache {
  readonly handoff: ApplicationQueryCacheHandoff;
  readonly candidate: ApplicationQueryCacheCandidate;
}

interface QueryCompletionState {
  readonly phase: "open" | "settled";
  readonly pending: readonly StagedQueryCache[];
}

/** Own the query through result validation and every resource release. Caller
 * recovery cannot change this outcome after its scope has already settled. */
export const withApplicationQueryCompletion = Effect.fn(
  "ApplicationQueryCompletion.own",
)(function* <A, E, R>(
  operation: Effect.Effect<A, E, R>,
): Effect.fn.Return<A, E, Exclude<Exclude<R, ApplicationQueryCompletion>, Scope.Scope>> {
  const state = yield* Ref.make<QueryCompletionState>({ phase: "open", pending: [] });
  const completion = ApplicationQueryCompletion.of({
    stage: Effect.fn("ApplicationQueryCompletion.stage")(function* (
      handoff: ApplicationQueryCacheHandoff,
      candidate: ApplicationQueryCacheCandidate,
    ): Effect.fn.Return<void> {
      const staged = yield* Ref.modify(state, current => current.phase === "open"
        ? [true, { phase: "open", pending: [...current.pending, { handoff, candidate }] }] as const
        : [false, current] as const);
      if (!staged) return yield* Effect.die(new Error("Cannot stage cache data after its query outcome settled."));
    }),
  });
  const settle = Effect.fn("ApplicationQueryCompletion.settle")(function* (
    exit: Exit.Exit<A, E>,
  ): Effect.fn.Return<void> {
    const pending = yield* Ref.modify(state, current => [current.pending, { phase: "settled", pending: [] }] as const);
    if (Exit.isSuccess(exit)) {
      for (const entry of pending) yield* Effect.sync(() => entry.handoff.put(entry.candidate));
    }
  });
  const scoped = Effect.scoped(operation.pipe(Effect.provideService(ApplicationQueryCompletion, completion)));
  return yield* Effect.onExit(scoped, exit => settle(exit));
});
