import { Effect, Schema, type Result } from "effect";
import { CommonEvents, Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { pricingStaticResources } from "@medusajs/pricing/static-manifest";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { moduleEventDecoder } from "../../module/events";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { projectExactNumericColumns } from "../../value/exact-numeric";
import { pricingLogicalCreateEventPolicy } from "./events";
import { pricingLogicalMutationEventPolicy } from "./mutation-events";
import { pricingShippingUpdateReceipt } from "./shipping-update-receipt";
import type { preparePricingRepository } from "./repository";
import { compileShippingPricingOutput, decodeShippingPriceSetCreate, decodeShippingPriceSetDeletionIds,
  decodeShippingPricingLifecycle, shippingPricingIds, compileShippingPricingMutationContracts, decodeShippingPriceRead, decodeShippingRuleRead } from "./shipping-input";

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
export function pricingShippingOptionPolicy(decodeOutput: DecodeOutput,
  mutationContracts?: Result.Result.Success<ReturnType<typeof compileShippingPricingMutationContracts>>,
  prepared?: Result.Result.Success<ReturnType<typeof preparePricingRepository>>) {
  const create = pricingLogicalCreateEventPolicy();
  const mutation = pricingLogicalMutationEventPolicy({ scalarPriceSetUpdate: true });
  const validateUpdate = mutationContracts && prepared ? pricingShippingUpdateReceipt(mutationContracts, prepared) : undefined;
  const capture = Effect.fn("PricingEvents.captureShippingOption")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.PRICING, objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } };
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PricingEvents.validateShippingOption")(function* (call, activity) {
    if (mutationContracts && (call.commandName === "pricingShippingListPrices" || call.commandName === "pricingShippingListPriceRules")) {
      if (call.mode !== "read" || call.events.length || activity.mutations.length || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const prices = call.commandName === "pricingShippingListPrices";
      const input = yield* Effect.fromResult((prices ? decodeShippingPriceRead : decodeShippingRuleRead)(call.input));
      const byId = "id" in input.filters, column = byId ? "id" : "price_id";
      const ids = "id" in input.filters ? input.filters.id : input.filters.price_id;
      const table = prices ? "price" : "price_rule", observed = new Map<string, JsonObject & { id: string }>();
      for (const observation of activity.observedRows) {
        if (observation.table !== table) return yield* Effect.fail(commerceError("receiptMismatch"));
        const value = projectNativeRow(observation.row);
        const row = yield* Effect.fromResult(prices ? mutationContracts.decodeStoredPrice(value) : mutationContracts.decodeStoredRule(value));
        const id = row.id, selected = row[column];
        if (typeof id !== "string" || typeof selected !== "string" || !ids.includes(selected) || observed.has(id) && !jsonEqual(observed.get(id)!, row))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        observed.set(id, { ...row, id });
      }
      if (observed.size > (prices ? 8 : 24)) return yield* Effect.fail(commerceError("receiptMismatch"));
      const active = orderNativeIdRows([...observed.values()].filter(row => row.deleted_at === null), {});
      const membership = { kind: "in", column, values: byId ? [...ids] : [...new Set(ids)] };
      const predicate = { kind: "and", children: [byId ? { kind: "and", children: [membership] } : membership, { kind: "isNull", column: "deleted_at" }] };
      const reads = byId || ids.length ? [{ table, query: commerceRelationReadQuery(defaultCommerceResources, predicate), total: active.length, returned: active.length }] : [];
      const expected = byId ? active.map(row => ({ id: row.id })) : active;
      if (!jsonEqual(call.result, expected) || !jsonEqual(activity.relationalReads, reads)) return yield* Effect.fail(commerceError("receiptMismatch"));
      return;
    }
    if (call.mode === "read") return yield* create.validateLogicalCall(call, activity);
    if (mutationContracts && call.commandName === "pricingUpdate") {
      if (validateUpdate === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      yield* mutation.validateLogicalCall(call, activity);
      return yield* validateUpdate(call, activity);
    }
    if (mutationContracts && call.commandName === "pricingShippingCreatePriceRules") {
      if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const input = yield* Effect.fromResult(mutationContracts.decodeRuleRows(call.input));
      const output = yield* Effect.fromResult(mutationContracts.decodeRuleRows(call.result));
      if (activity.mutations.length !== input.length || output.length !== input.length) return yield* Effect.fail(commerceError("receiptMismatch"));
      const emitted = new Set<string>();
      for (const [index, change] of activity.mutations.entries()) {
        const supplied = input[index], returned = output[index];
        if (!supplied || !returned || change.ordinal !== index || change.table !== "price_rule" || change.operation !== "insert" ||
          change.before !== null || change.after === null || typeof change.after.id !== "string" || emitted.has(change.after.id))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const row = projectNativeRow(change.after);
        if (!jsonEqual(row, returned) || row.created_at !== supplied.created_at || row.deleted_at !== null)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        for (const [key, value] of Object.entries(supplied)) if (key !== "updated_at" && (row[key] === undefined || !jsonEqual(value, row[key])))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        emitted.add(change.after.id);
      }
      for (const event of call.events) {
        const message = yield* capture(event);
        if (message.metadata.object !== "price_rule" || message.metadata.action !== CommonEvents.CREATED)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
          if (!emitted.delete(id)) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      if (emitted.size) return yield* Effect.fail(commerceError("receiptMismatch"));
      return;
    }
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
  return { capture, validateLogicalCall, ...(mutationContracts === undefined
    ? { allowActiveRestoreUpdate: true as const } : { allowReconstitution: true as const }) };
}
