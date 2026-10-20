import { Effect, Schema } from "effect";
import { CommonEvents, Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError, defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { moduleEventDecoder } from "../../module/events";
import { pricingLogicalCreateEventPolicy } from "./events";
import { projectExactNumericColumns } from "../../value/exact-numeric";
import { jsonEqual } from "flarex-protocol/json";
import type { pricingPreferencePolicy } from "./preference-receipt";
function matchesStoredScalars(actual: JsonObject, expected: JsonObject) {
  return Object.entries(expected).every(([key, value]) => {
    if (key === "_id" || key === "_creationTime") return true;
    const received = actual[key]; return received !== undefined && jsonEqual(received, value);
  });
}

/** Native Pricing replacements authenticate operation-local base-price and
 * rule mutations. Physical cascade cleanup has no separate native rule event. */
export function pricingLogicalMutationEventPolicy(preferences: ReturnType<typeof pricingPreferencePolicy>,
  options: Readonly<{ scalarPriceSetUpdate?: true }> = {}) {
  const creation = pricingLogicalCreateEventPolicy(preferences);
  const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
  const decode = moduleEventDecoder(Schema.Struct({ name: Schema.String,
    metadata: Schema.Struct({ source: Schema.Literal(Modules.PRICING), object: Schema.String,
      action: Schema.Literals([CommonEvents.CREATED, CommonEvents.UPDATED, CommonEvents.DELETED]) }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1),
      Schema.isMaxLength(defaultCommerceResources.eventIds))]) }),
  }), defaultCommerceResources);
  const capture = Effect.fn("PricingEvents.captureMutations")(function* (input: unknown) {
    const message = yield* decode(input);
    if (!["price", "price_rule"].includes(message.metadata.object)) return yield* creation.capture(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.PRICING,
      objectName: message.metadata.object, action: message.metadata.action })) return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } } satisfies Json;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PricingEvents.validateMutationCall")(
    function* (call: Parameters<LogicalCommerceCallValidation>[0], activity: Parameters<LogicalCommerceCallValidation>[1]) {
      if (!["pricingUpsert", "pricingUpdate"].includes(call.commandName)) return yield* creation.validateLogicalCall(call, activity);
      const { mutations, lifecycle, setNull, referenceReplacements } = activity;
      const scalar = options.scalarPriceSetUpdate === true && call.commandName === "pricingUpdate";
      if (call.mode !== "write" || lifecycle.length || setNull.length || referenceReplacements.length ||
        (scalar ? !isJsonObject(call.result) : !Array.isArray(call.result)))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const result = Array.isArray(call.result) ? call.result : [call.result];
      const requested = new Set<string>();
      if (call.commandName === "pricingUpsert") {
        if (!Array.isArray(call.input)) return yield* Effect.fail(commerceError("receiptMismatch"));
        for (const row of call.input) {
          if (!isJsonObject(row) || typeof row.id !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
          requested.add(row.id);
        }
      } else {
        if (!isJsonObject(call.input) || call.input.selector === undefined ||
          (scalar ? typeof call.input.selector !== "string" : !isJsonObject(call.input.selector))) return yield* Effect.fail(commerceError("receiptMismatch"));
        const ids = isJsonObject(call.input.selector) ? call.input.selector.id : call.input.selector;
        for (const id of typeof ids === "string" ? [ids] : Array.isArray(ids) ? ids : []) {
          if (typeof id !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
          requested.add(id);
        }
      }
      const state = new Map(activity.observedRows.flatMap(observation => typeof observation.row.id === "string"
        ? [[observation.table + ":" + observation.row.id, observation.row] as const] : []));
      for (const mutation of mutations) {
        const row = mutation.operation === "delete" ? mutation.before : mutation.after;
        if (typeof row?.id !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
        if (mutation.operation === "delete") state.delete(mutation.table + ":" + row.id);
        else state.set(mutation.table + ":" + row.id, row);
      }
      const sets = new Set<string>();
      for (const row of result) {
        if (!isJsonObject(row) || typeof row.id !== "string" || !requested.has(row.id) || sets.has(row.id) || !Array.isArray(row.prices) || row.prices.length > 2)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        sets.add(row.id);
        const parent = state.get("price_set:" + row.id);
        if (parent === undefined || !matchesStoredScalars(row, parent))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const seenPrices = new Set<string>();
        for (const returned of row.prices) {
          if (!isJsonObject(returned) || typeof returned.id !== "string" || seenPrices.has(returned.id)) return yield* Effect.fail(commerceError("receiptMismatch"));
          seenPrices.add(returned.id);
          const price = state.get("price:" + returned.id);
          if (price === undefined || price.price_set_id !== row.id || price.price_list_id !== null || price.deleted_at !== null)
            return yield* Effect.fail(commerceError("receiptMismatch"));
          const projected = yield* projectExactNumericColumns(price, ["amount", "min_quantity", "max_quantity"].map(name => ({ name, nullable: name !== "amount" })));
          if (!isJsonObject(projected) || !matchesStoredScalars(returned, projected))
            return yield* Effect.fail(commerceError("receiptMismatch"));
          const returnedRules = returned.price_rules;
          if (returnedRules !== undefined) {
            if (!Array.isArray(returnedRules)) return yield* Effect.fail(commerceError("receiptMismatch"));
            const expectedRules = [...state.entries()].flatMap(([key, rule]) => key.startsWith("price_rule:") && rule.price_id === returned.id && rule.deleted_at === null ? [rule] : []);
            if (expectedRules.length !== returnedRules.length || expectedRules.some(rule => !returnedRules.some(value => isJsonObject(value) && matchesStoredScalars(value, rule))))
              return yield* Effect.fail(commerceError("receiptMismatch"));
          }
        }
        const storedPrices = [...state.entries()].flatMap(([key, price]) => key.startsWith("price:") && price.price_set_id === row.id && price.price_list_id === null && price.deleted_at === null
          ? [price.id] : []);
        if (storedPrices.length !== seenPrices.size || storedPrices.some(id => typeof id !== "string" || !seenPrices.has(id)))
          return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      if (scalar && (sets.size !== 1 || sets.size !== requested.size)) return yield* Effect.fail(commerceError("receiptMismatch"));
      const priceIds = new Set<string>(), removedPrices = new Set<string>();
      for (const mutation of mutations) if (mutation.table === "price") {
        const row = mutation.operation === "delete" ? mutation.before : mutation.after;
        if (typeof row?.id !== "string" || typeof row.price_set_id !== "string" || !sets.has(row.price_set_id)
          || row.price_list_id !== null) return yield* Effect.fail(commerceError("receiptMismatch"));
        priceIds.add(row.id);
        if (mutation.operation === "delete") removedPrices.add(row.id);
      }
      const expected = new Set<string>();
      for (const [ordinal, mutation] of mutations.entries()) {
        const row = mutation.operation === "delete" ? mutation.before : mutation.after;
        const action = mutation.operation === "insert" ? CommonEvents.CREATED : mutation.operation === "patch" ? CommonEvents.UPDATED
          : mutation.operation === "delete" ? CommonEvents.DELETED : undefined;
        if (mutation.ordinal !== ordinal || action === undefined || !["price", "price_rule"].includes(mutation.table)
          || typeof row?.id !== "string" || (mutation.operation === "insert" ? mutation.before !== null || row.deleted_at !== null
            : mutation.operation === "patch" ? mutation.before === null || mutation.before.id !== row.id || row.deleted_at !== null
              : mutation.after !== null || mutation.before === null)) return yield* Effect.fail(commerceError("receiptMismatch"));
        if (mutation.table === "price_rule" && (typeof row.price_id !== "string" || !priceIds.has(row.price_id)))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        if (mutation.table === "price_rule" && mutation.operation === "delete" && typeof row.price_id === "string" && removedPrices.has(row.price_id)) continue;
        const identity = mutation.table + ":" + action + ":" + row.id;
        if (expected.has(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
        expected.add(identity);
      }
      for (const event of call.events) {
        const message = yield* capture(event);
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
          if (!expected.delete(message.metadata.object + ":" + message.metadata.action + ":" + id)) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      if (expected.size) return yield* Effect.fail(commerceError("receiptMismatch"));
    });
  return { capture, validateLogicalCall };
}
