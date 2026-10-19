import { Effect, Schema } from "effect";
import { CommonEvents, Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { pricingStaticResources } from "@medusajs/pricing/static-manifest";
import { commerceError, defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { moduleEventDecoder } from "../../module/events";
import { captureCommerceInput } from "../../value/input";
import { pricingLogicalMutationEventPolicy } from "./mutation-events";
import { decodePricingLifecycleInput, pricingLifecycleIds } from "./lifecycle";
import type { pricingPreferencePolicy } from "./preference-receipt";

const models = new Map([["price_set", "PriceSet"], ["price", "Price"], ["price_rule", "PriceRule"]]);
const linkableKeys = pricingStaticResources.joinerConfig?.linkableKeys ?? {};

/** Pricing owns native module events/results, while storage authenticates each
 * managed transition and its complete before/after row. */
export function pricingLogicalProductUpdateEventPolicy(preferences: ReturnType<typeof pricingPreferencePolicy>) {
  const mutation = pricingLogicalMutationEventPolicy(preferences, { priceListPriceRules: true });
  const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
  const decode = moduleEventDecoder(Schema.Struct({ name: Schema.String,
    metadata: Schema.Struct({ source: Schema.Literal(Modules.PRICING), object: Schema.Literals(["price_set", "price", "price_rule"]),
      action: Schema.Literal(CommonEvents.DELETED) }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(defaultCommerceResources.eventIds))]) }),
  }), defaultCommerceResources);
  const capture = Effect.fn("PricingEvents.captureProductUpdate")(function* (input: unknown) {
    const value = yield* Effect.fromResult(captureCommerceInput(input, defaultCommerceResources));
    if (!isJsonObject(value) || value.metadata === undefined || !isJsonObject(value.metadata) || value.metadata.action !== CommonEvents.DELETED
      || typeof value.metadata.object !== "string" || !models.has(value.metadata.object)) return yield* mutation.capture(value);
    const message = yield* decode(value);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.PRICING, objectName: message.metadata.object, action: CommonEvents.DELETED }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } } satisfies Json;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PricingEvents.validateProductUpdateCall")(function* (call, activity) {
    if (call.commandName !== "pricingSoftDeletePriceSets") return yield* mutation.validateLogicalCall(call, activity);
    const input = yield* Effect.fromResult(decodePricingLifecycleInput(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const ids = pricingLifecycleIds(input.selector), requested = new Set(ids);
    if (call.mode !== "write" || ids.length > 4 || requested.size !== ids.length || !isJsonObject(call.result)
      || activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    const observed = new Map<string, JsonObject>();
    for (const { table, row } of activity.observedRows) {
      if (models.has(table) && typeof row.id === "string") observed.set(table + ":" + row.id, row);
    }
    // Call evidence exposes the pending view at completion. Reconstruct each
    // changed row's preimage; untouched observed descendants still establish
    // the complete closure and cannot disappear from the receipt.
    for (const change of [...activity.mutations].reverse()) {
      if (models.has(change.table) && typeof change.before?.id === "string")
        observed.set(change.table + ":" + change.before.id, change.before);
    }
    const roots = new Set([...observed.entries()].flatMap(([key, row]) => key.startsWith("price_set:")
      && typeof row.id === "string" && requested.has(row.id) && row.deleted_at === null ? [row.id] : []));
    const prices = new Set([...observed.entries()].flatMap(([key, row]) => key.startsWith("price:")
      && typeof row.id === "string" && typeof row.price_set_id === "string" && roots.has(row.price_set_id) ? [row.id] : []));
    const expected = new Set([...roots].map(id => "price_set:" + id));
    for (const id of prices) expected.add("price:" + id);
    for (const [key, row] of observed) if (key.startsWith("price_rule:") && typeof row.price_id === "string" && prices.has(row.price_id)) expected.add(key);
    const events = new Set<string>(), matched = new Set<number>();
    const changed = new Map<string, string[]>();
    for (const transition of activity.lifecycle) {
      const id = transition.key.id, model = models.get(transition.table), ordinal = transition.attemptOrdinal;
      if (model === undefined || typeof id !== "string" || Object.keys(transition.key).length !== 1
        || transition.operation !== "softDelete" || typeof transition.afterDeletedAt !== "string" || ordinal === null
        || !expected.delete(transition.table + ":" + id) || matched.has(ordinal)) return yield* Effect.fail(commerceError("receiptMismatch"));
      const change = activity.mutations[ordinal], before = observed.get(transition.table + ":" + id);
      if (change === undefined || change.ordinal !== ordinal || change.operation !== "patch" || change.table !== transition.table
        || change.before?.id !== id || change.after?.id !== id || before === undefined
        || before.deleted_at !== transition.beforeDeletedAt || change.before.deleted_at !== transition.beforeDeletedAt
        || change.after.deleted_at !== transition.afterDeletedAt || (transition.table === "price_set" && transition.beforeDeletedAt !== null))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      matched.add(ordinal); events.add(transition.table + ":" + id);
      const group = changed.get(model) ?? []; group.push(id); changed.set(model, group);
    }
    if (expected.size || matched.size !== activity.mutations.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    const output = new Map<string, readonly string[]>();
    const pick = input.config.returnLinkableKeys;
    for (const [key, model] of Object.entries(linkableKeys)) {
      const group = changed.get(model);
      if (group !== undefined && (!pick?.length || pick.includes(key))) output.set(key, group);
    }
    if (Object.keys(call.result).length !== output.size) return yield* Effect.fail(commerceError("receiptMismatch"));
    for (const [key, expectedIds] of output) {
      const returned = call.result[key];
      if (!Array.isArray(returned) || returned.length !== expectedIds.length || returned.some((id, index) => id !== expectedIds[index]))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    for (const event of call.events) {
      const message = yield* decode(event);
      if (message.name !== buildModuleResourceEventName({ prefix: Modules.PRICING, objectName: message.metadata.object, action: CommonEvents.DELETED }))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!events.delete(message.metadata.object + ":" + id)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (events.size) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}
