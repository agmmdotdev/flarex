import { Effect, Schema, type Result } from "effect";
import { CommonEvents, Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { pricingStaticResources } from "@medusajs/pricing/static-manifest";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { moduleEventDecoder } from "../../module/events";
import { projectNativeRow } from "../../repository/result";
import { projectExactNumericColumns } from "../../value/exact-numeric";
import { pricingLogicalCreateEventPolicy } from "./events";
import { compileShippingPricingOutput, decodeShippingPriceSetCreate, decodeShippingPriceSetDeletionIds,
  decodeShippingPricingLifecycle, shippingPricingIds } from "./shipping-input";

type DecodeOutput = Result.Result.Success<ReturnType<typeof compileShippingPricingOutput>>;
const models = new Map([["price_set", "PriceSet"], ["price", "Price"], ["price_rule", "PriceRule"]]);
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.PRICING), object: Schema.Literals(["price_set", "price", "price_rule"]),
    action: Schema.Literals([CommonEvents.CREATED, CommonEvents.UPDATED, CommonEvents.DELETED, CommonEvents.RESTORED]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(defaultCommerceResources.eventIds))]) }),
}), defaultCommerceResources);

/** Shipping owns its selected Pricing capability; core authenticates managed
 * transitions, complete reads and mutation preimages. */
export function pricingShippingOptionPolicy(decodeOutput: DecodeOutput) {
  const create = pricingLogicalCreateEventPolicy();
  const capture = Effect.fn("PricingEvents.captureShippingOption")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.PRICING, objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PricingEvents.validateShippingOption")(function* (call, activity) {
    if (call.mode === "read") return yield* create.validateLogicalCall(call, activity);
    if (call.commandName === "pricingCreate") {
      yield* create.validateLogicalCall(call, activity);
      if (Array.isArray(call.input) !== Array.isArray(call.result)) return yield* Effect.fail(commerceError("receiptMismatch"));
      const input = yield* Effect.fromResult(decodeShippingPriceSetCreate(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const requested = Array.isArray(input) ? input : [input];
      const result = yield* Effect.fromResult(decodeOutput(Array.isArray(call.result) ? call.result : [call.result]))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const roots = activity.mutations.flatMap(change => change.table === "price_set" && change.after !== null ? [projectNativeRow(change.after)] : []);
      const prices = activity.mutations.flatMap(change => change.table === "price" && change.after !== null ? [projectNativeRow(change.after)] : []);
      const rules = activity.mutations.flatMap(change => change.table === "price_rule" && change.after !== null ? [projectNativeRow(change.after)] : []);
      if (roots.length !== requested.length || result.length !== roots.length || rules.length > 24) return yield* Effect.fail(commerceError("receiptMismatch"));
      const remainingPrices = new Set(prices.map(row => row.id)), remainingRules = new Set(rules.map(row => row.id));
      for (const [index, root] of roots.entries()) {
        const returned = result[index], supplied = requested[index];
        if (!returned || !supplied || returned.id !== root.id || supplied.id !== undefined && supplied.id !== root.id)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const { prices: children, ...scalars } = returned;
        if (!jsonEqual(root, scalars) || !Array.isArray(children)) return yield* Effect.fail(commerceError("receiptMismatch"));
        for (const child of children) {
          if (!isJsonObject(child)) return yield* Effect.fail(commerceError("receiptMismatch"));
          const persisted = prices.find(row => row.id === child.id);
          if (!persisted || persisted.price_set_id !== root.id || !remainingPrices.delete(child.id)) return yield* Effect.fail(commerceError("receiptMismatch"));
          const projected = yield* projectExactNumericColumns(persisted, [{ name: "amount" }, { name: "min_quantity", nullable: true }, { name: "max_quantity", nullable: true }]);
          if (!isJsonObject(projected)) return yield* Effect.fail(commerceError("receiptMismatch"));
          for (const [key, value] of Object.entries(projected)) if (child[key] === undefined || !jsonEqual(value, child[key]))
            return yield* Effect.fail(commerceError("receiptMismatch"));
          if (!Array.isArray(child.price_rules)) return yield* Effect.fail(commerceError("receiptMismatch"));
          for (const rule of child.price_rules) {
            if (!isJsonObject(rule)) return yield* Effect.fail(commerceError("receiptMismatch"));
            const persistedRule = rules.find(row => row.id === rule.id);
            if (!persistedRule || persistedRule.price_id !== child.id || !remainingRules.delete(rule.id) || !jsonEqual(persistedRule, rule))
              return yield* Effect.fail(commerceError("receiptMismatch"));
          }
        }
      }
      if (remainingPrices.size || remainingRules.size) return yield* Effect.fail(commerceError("receiptMismatch"));
      return;
    }
    const operation = call.commandName === "pricingDeletePriceSets" ? "delete" : call.commandName === "pricingSoftDeletePriceSets" ? "softDelete"
      : call.commandName === "pricingRestorePriceSets" ? "restore" : undefined;
    if (!operation || activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    const lifecycleInput = operation === "delete" ? undefined : yield* Effect.fromResult(decodeShippingPricingLifecycle(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const ids = lifecycleInput === undefined ? yield* Effect.fromResult(decodeShippingPriceSetDeletionIds(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause))) : shippingPricingIds(lifecycleInput.selector);
    if (new Set(ids).size !== ids.length || ids.length > (operation === "delete" ? 4 : 8)) return yield* Effect.fail(commerceError("receiptMismatch"));
    const observed = new Map<string, JsonObject>();
    for (const { table, row } of activity.observedRows) if (models.has(table) && typeof row.id === "string") observed.set(table + ":" + row.id, row);
    for (const change of [...activity.mutations].reverse()) if (models.has(change.table) && typeof change.before?.id === "string")
      observed.set(change.table + ":" + change.before.id, change.before);
    const roots = [...observed.entries()].filter(([key, row]) => key.startsWith("price_set:") && ids.includes(String(row.id)) &&
      (operation !== "softDelete" || row.deleted_at === null));
    const rootIds = new Set(roots.map(([, row]) => row.id));
    const prices = [...observed.entries()].filter(([key, row]) => key.startsWith("price:") && rootIds.has(row.price_set_id));
    const priceIds = new Set(prices.map(([, row]) => row.id));
    const rules = [...observed.entries()].filter(([key, row]) => key.startsWith("price_rule:") && priceIds.has(row.price_id));
    if (prices.some(([, row]) => row.price_list_id !== null) || rules.length > (operation === "delete" ? 24 : 48) ||
      [...rootIds].some(id => prices.filter(([, row]) => row.price_set_id === id).length > 2)) return yield* Effect.fail(commerceError("receiptMismatch"));
    const expected = new Map([...roots, ...prices, ...rules]), pending = new Set(expected.keys()), matched = new Set<number>();
    const changed = new Map<string, string[]>(), emitted = new Map<string, string>();
    if (operation === "delete") {
      if (activity.lifecycle.length || call.result !== null) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const [ordinal, mutation] of activity.mutations.entries()) {
        const identity = mutation.table + ":" + mutation.before?.id;
        if (mutation.ordinal !== ordinal || mutation.operation !== "delete" || mutation.after !== null || !pending.delete(identity) || !jsonEqual(mutation.before, expected.get(identity)!))
          return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      for (const [, row] of roots) emitted.set("price_set:" + row.id, CommonEvents.DELETED);
    } else {
      for (const transition of activity.lifecycle) {
        const id = transition.key.id, identity = transition.table + ":" + id, before = expected.get(identity), model = models.get(transition.table);
        if (typeof id !== "string" || !model || !before || Object.keys(transition.key).length !== 1 || transition.operation !== operation ||
          !pending.delete(identity) || before.deleted_at !== transition.beforeDeletedAt ||
          (operation === "restore" ? transition.afterDeletedAt !== null : typeof transition.afterDeletedAt !== "string"))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const ordinal = transition.attemptOrdinal;
        if (ordinal === null) {
          return yield* Effect.fail(commerceError("receiptMismatch"));
        } else {
          const mutation = activity.mutations[ordinal];
          if (!mutation || mutation.ordinal !== ordinal || matched.has(ordinal) || mutation.operation !== "patch" || mutation.table !== transition.table ||
            mutation.before?.id !== id || mutation.after?.id !== id || mutation.before.deleted_at !== transition.beforeDeletedAt || mutation.after.deleted_at !== transition.afterDeletedAt)
            return yield* Effect.fail(commerceError("receiptMismatch"));
          for (const [field, value] of Object.entries(before)) if (!["deleted_at", "updated_at"].includes(field) &&
            (mutation.after[field] === undefined || !jsonEqual(value, mutation.after[field]))) return yield* Effect.fail(commerceError("receiptMismatch"));
          matched.add(ordinal);
        }
        const group = changed.get(model) ?? []; group.push(id); changed.set(model, group);
        emitted.set(identity, operation === "restore" ? CommonEvents.RESTORED : CommonEvents.DELETED);
      }
      if (matched.size !== activity.mutations.length || !isJsonObject(call.result)) return yield* Effect.fail(commerceError("receiptMismatch"));
      const keys = pricingStaticResources.joinerConfig?.linkableKeys ?? {}, output: Record<string, string[]> = {};
      for (const [key, model] of Object.entries(keys)) {
        const group = changed.get(model), pick = lifecycleInput?.config.returnLinkableKeys;
        if (group && (!pick?.length || pick.includes(key))) output[key] = group;
      }
      if (!jsonEqual(call.result, output)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (pending.size) return yield* Effect.fail(commerceError("receiptMismatch"));
    for (const input of call.events) {
      const message = yield* capture(input);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        const identity = message.metadata.object + ":" + id;
        if (emitted.get(identity) !== message.metadata.action || !emitted.delete(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    if (emitted.size) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall, allowActiveRestoreUpdate: true as const };
}
