import { Effect, Schema } from "effect";
import type { CommerceProfileState, LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { scalarEventPolicy } from "./scalar-events";
import { captureCommerceInput } from "./commerce-input";

/** Reuse scalar fact authentication for each member of the native create graph. */
export function pricingEventPolicy(descriptor: CommerceProfileState, deliver: LocalCommerceEventPolicy["deliver"]): LocalCommerceEventPolicy {
  const tables = ["price_set", "price", "price_rule"];
  const policies = new Map(tables.map(table => [table, scalarEventPolicy("pricing", table, { insert: "pricingCreate" }, descriptor, deliver)]));
  const decode = Schema.decodeUnknownEffect(Schema.Struct({ metadata: Schema.Struct({ object: Schema.String }) }));
  const capture = Effect.fn("PricingEvents.capture")(function* (input: unknown) {
    const captured = yield* Effect.fromResult(captureCommerceInput(input, descriptor.resources));
    const value = yield* decode(captured).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
    const policy = policies.get(value.metadata.object);
    if (!policy) return yield* Effect.fail(commerceError("unadmittedEvent"));
    return yield* policy.capture(captured);
  });
  return { capture, deliver, validate: Effect.fn("PricingEvents.validate")(function* (events, rows, command, lifecycle = []) {
    if (lifecycle.length || rows.some(row => !policies.has(row.tableId))) return yield* Effect.fail(commerceError("receiptMismatch"));
    const groups = new Map<string, typeof events[number][]>();
    for (const event of events) {
      yield* capture(event);
      const value = yield* decode(event).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
      const group = groups.get(value.metadata.object) ?? []; group.push(event); groups.set(value.metadata.object, group);
    }
    for (const [table, policy] of policies) yield* policy.validate(groups.get(table) ?? [], rows.filter(row => row.tableId === table), command);
  }) };
}
