import { Effect } from "effect";
import type { Json } from "flarex-protocol/json";
import type { BoundedRequestContext, BoundedRequestLifetime } from "../boundedRequestLifetime";
import { getCommerceCommand, type CommerceCommand, type CommerceCommandContext } from "./commands";
import { commerceError, type CommerceTransactionError } from "./model";
import type { CommerceStore } from "./storeModel";
import type { CommerceResources } from "./resources";
import type { CommerceSetNullSelection, CommerceReferenceReplacement } from "./commands";

/** Same borrowed-manager semantics for standalone and composite owners. */
export function makeCommerceCommandContext(
  lifetime: BoundedRequestLifetime<CommerceTransactionError>, working: Readonly<{ store: CommerceStore; resources: CommerceResources;
    table: (context: BoundedRequestContext, tableId: string) => Effect.Effect<CommerceStore, CommerceTransactionError>;
    transactionTime?: (context: BoundedRequestContext) => Effect.Effect<string, CommerceTransactionError>;
    planSetNull?: (context: BoundedRequestContext, selection: CommerceSetNullSelection) => Effect.Effect<void, CommerceTransactionError>;
    planReferenceReplacement?: (context: BoundedRequestContext, selection: CommerceReferenceReplacement) => Effect.Effect<void, CommerceTransactionError> }>,
  id: string, manager: BoundedRequestContext,
  invoke: (context: BoundedRequestContext, command: CommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError>,
  captureEvent: (context: BoundedRequestContext, event: unknown) => Effect.Effect<void, CommerceTransactionError>,
): CommerceCommandContext {
  const planSetNull = working.planSetNull;
  const planReferenceReplacement = working.planReferenceReplacement;
  const transactionTime = working.transactionTime;
  return Object.freeze({ manager, resources: working.resources, store: working.store,
    table: tableId => working.table(manager, tableId),
    ...(transactionTime === undefined ? {} : { transactionTime: transactionTime(manager) }),
    ...(planSetNull === undefined ? {} : { planSetNull: (selection: CommerceSetNullSelection) => planSetNull(manager, selection) }),
    ...(planReferenceReplacement === undefined ? {} : { planReferenceReplacement: (selection: CommerceReferenceReplacement) => planReferenceReplacement(manager, selection) }),
    captureLocalEvent: event => captureEvent(manager, event),
    nested: (child, args) => lifetime.nested(manager, id, context => invoke(context, child, args), getCommerceCommand(child)?.mode),
    rejectEvent: lifetime.operation(manager, id, "write", Effect.fail(commerceError("unadmittedEvent"))),
    refuse: error => lifetime.operation(manager, id, "read", Effect.fail(error)),
    borrow: work => lifetime.nested(manager, id, child => work(makeCommerceCommandContext(lifetime, working, id, child, invoke, captureEvent))),
  } satisfies CommerceCommandContext);
}
