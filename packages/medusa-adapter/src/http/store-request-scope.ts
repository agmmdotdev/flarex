import { asValue, type AwilixContainer } from "@medusajs/deps/awilix-portable";
import type { MedusaRequest } from "@medusajs/framework/http";
import { Effect } from "effect";
import type { StoreRequestReads } from "./store-request-reads";

/** Native Medusa's container callbacks require a Promise, with no Effect services. */
function runStoreRequestReadPromise<A, E>(work: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(work);
}

/** Bind one already-admitted generation's read capabilities to native Medusa DI.
 * The host supplies its logger/configuration container and owns this scope. */
export const makeStoreRequestScopeFactory = Effect.fn("StoreRequestReads.makeScopeFactory")(function* (input: Readonly<{
  reads: StoreRequestReads; container: AwilixContainer;
}>) {
  const container = yield* Effect.acquireRelease(Effect.sync(() => input.container.createScope().register({
    // These are native framework Promise edges; storage execution stays in the
    // exact read owner with its unchanged failure and resource semantics.
    remoteQuery: asValue((query: unknown) => runStoreRequestReadPromise(input.reads.remoteQuery(query))),
    query: asValue({ graph: (query: unknown, options?: unknown) => runStoreRequestReadPromise(input.reads.query.graph(query, options)) }),
  })), scope => Effect.promise(() => scope.dispose()));
  return Object.freeze({ createRequestScope: (): MedusaRequest["scope"] => container.createScope() });
});
