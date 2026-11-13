import { Effect, Result } from "effect";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LocalGraphQuery, PreparedLocalGraph } from "../../src/local-graph/model";
import { makeCommercePromiseOwner } from "../../src/module/promise-owner";
import { bindWorkflowQuery } from "../../src/workflow/query";
import { promiseFailureObserver } from "./promise-failure-observer";

/** Records the adapter-to-native method boundary only. Native query algorithms
 * are exercised by the source comparisons and authenticated graph tests. */
export async function workflowQueryBoundary(options: {
  readonly remote?: Effect.Effect<unknown, CommerceTransactionError>;
  readonly graph?: Effect.Effect<unknown, CommerceTransactionError>;
} = {}) {
  const calls: Array<{ readonly method: string; readonly args: readonly unknown[] }> = [], refusals: string[] = [];
  const unexpected = () => Effect.die(new Error("A workflow facade must use the bound native Query"));
  const native: LocalGraphQuery = {
    remoteQuery: (...args) => { calls.push({ method: "remoteQuery", args }); return options.remote ?? Effect.succeed([]); },
    nativeGraph: (...args) => { calls.push({ method: "nativeGraph", args }); return options.graph ?? Effect.succeed({
      data: [], metadata: { count: 0, skip: 0, take: commerceLimits.catalogRows },
    }); },
    graph: unexpected,
  };
  const graph: PreparedLocalGraph = { entities: ["variant"], admitProjection: () => Result.succeed(undefined), bind: () => native };
  const context: AtomicCommerceContext = { eventGroupId: "workflow-query-boundary", checkpoint: Effect.void,
    recordFailure: promiseFailureObserver(), refuse: error => { refusals.push(error.reason); return Effect.fail(error); },
    capture: () => Effect.fail(commerceError("unsupportedProfile")), emit: () => Effect.fail(commerceError("unadmittedEvent")),
    clearPendingEvents: () => Effect.fail(commerceError("unadmittedEvent")), call: unexpected,
  };
  const owner = await Effect.runPromise(makeCommercePromiseOwner());
  return { calls, refusals, owner, query: bindWorkflowQuery(graph, context, owner) };
}
