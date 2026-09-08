import { vi } from "vitest";
import { Effect } from "effect";
import { observeCommerceQueries } from "../../../persistence-postgres/test/commerceQueryObservation";

const queries = observeCommerceQueries();

// Observe the real owner. No budget, clock, result, failure or settlement is replaced.
vi.mock("../../../persistence-postgres/src/boundedRequestLifetime", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../persistence-postgres/src/boundedRequestLifetime")>();
  return { ...actual,
    makeBoundedRequestLifetime: (...args: Parameters<typeof actual.makeBoundedRequestLifetime>) =>
      actual.makeBoundedRequestLifetime(...args).pipe(Effect.map(lifetime => {
        const started = performance.now();
        queries.mockClear();
        return { ...lifetime, close: Effect.sync(() => {
          process.stdout.write(JSON.stringify({ commerceLifetimeMs: Math.round(performance.now() - started),
            retainedBytes: args[1].commandBytes - lifetime.remainingBytes(), maximumBytes: args[1].commandBytes,
            awaitedDrizzleQueries: queries.mock.calls.length }) + "\n");
          queries.mockClear();
        }).pipe(Effect.andThen(lifetime.close)) };
      })),
  };
});
