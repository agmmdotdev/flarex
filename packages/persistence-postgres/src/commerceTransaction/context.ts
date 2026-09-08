import { Effect } from "effect";
import type { Json } from "flarex-protocol/json";
import type { BoundedRequestContext, BoundedRequestLifetime } from "../boundedRequestLifetime";
import { getCommerceCommand, type CommerceCommand, type CommerceCommandContext } from "./commands";
import { commerceError, type CommerceTransactionError } from "./model";
import type { makeCommerceStore } from "./store";

/** Same borrowed-manager semantics for standalone and composite physical owners. */
export function makeCommerceCommandContext(
  lifetime: BoundedRequestLifetime<CommerceTransactionError>, working: Pick<Effect.Success<ReturnType<typeof makeCommerceStore>>, "store" | "table" | "resources">,
  id: string, manager: BoundedRequestContext,
  invoke: (context: BoundedRequestContext, command: CommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError>,
  captureEvent: (context: BoundedRequestContext, event: unknown) => Effect.Effect<void, CommerceTransactionError>,
): CommerceCommandContext {
  return Object.freeze({ manager, resources: working.resources, store: working.store,
    table: tableId => working.table(manager, tableId),
    captureLocalEvent: event => captureEvent(manager, event),
    nested: (child, args) => lifetime.nested(manager, id, context => invoke(context, child, args), getCommerceCommand(child)?.mode),
    rejectEvent: lifetime.operation(manager, id, "write", Effect.fail(commerceError("unadmittedEvent"))),
    refuse: error => lifetime.operation(manager, id, "read", Effect.fail(error)),
    borrow: work => lifetime.nested(manager, id, child => work(makeCommerceCommandContext(lifetime, working, id, child, invoke, captureEvent))),
  } satisfies CommerceCommandContext);
}
