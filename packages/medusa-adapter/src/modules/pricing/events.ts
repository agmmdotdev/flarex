import { moduleEventDecoder } from "../../module/events";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { Effect, Schema } from "effect";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { CommonEvents, Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { pricingPreferencePolicy } from "./preference-receipt";

/** Core owns FK/unique settlement; this receipt authenticates the exact native
 * create events for each admitted Pricing graph. */
export function pricingLogicalCreateEventPolicy(preferences: ReturnType<typeof pricingPreferencePolicy>,
  options: Readonly<{ priceListPriceRules?: true }> = {}) {
  const profiles = new Map<string, ReadonlySet<string>>([
    ["pricingCreate", new Set(["price_set", "price", "price_rule"])],
    ["pricingCreateList", new Set(["price_list", "price", "price_list_rule", ...(options.priceListPriceRules ? ["price_rule"] : [])])],
  ]);
  const tables = new Set([...profiles.values()].flatMap(profile => [...profile]));
  const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
  const decode = moduleEventDecoder(Schema.Struct({ name: Schema.String,
    metadata: Schema.Struct({ source: Schema.Literal(Modules.PRICING), object: Schema.String,
      action: Schema.Literal(CommonEvents.CREATED) }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1),
      Schema.isMaxLength(defaultCommerceResources.eventIds))]) }),
  }), defaultCommerceResources);
  const capture = Effect.fn("PricingEvents.captureLogical")(function* (input: unknown) {
    // The complete preference owner authenticates its event envelope and rows.
    // Capture uses the same outer private-data boundary as the generic decoder.
    const message = yield* decode(input);
    if (message.metadata.object === "price_preference") return yield* preferences.capture(input);
    if (!tables.has(message.metadata.object) || message.name !== buildModuleResourceEventName({
      prefix: Modules.PRICING, objectName: message.metadata.object, action: CommonEvents.CREATED,
    })) return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } } satisfies Json;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PricingEvents.validateLogicalCreate")(
    function* (call: Parameters<LogicalCommerceCallValidation>[0], activity: Parameters<LogicalCommerceCallValidation>[1]) {
      if (call.commandName === "pricingCreatePreference") return yield* preferences.validateLogicalCall(call, activity);
      const { mutations, lifecycle, setNull, referenceReplacements } = activity;
      if (lifecycle.length || setNull.length || referenceReplacements.length ||
        mutations.some((mutation, index) => mutation.ordinal !== index))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (call.mode === "read") {
        if (mutations.length || call.events.length) return yield* Effect.fail(commerceError("receiptMismatch"));
        return;
      }
      const allowed = profiles.get(call.commandName);
      if (allowed === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      const emitted = call.events;
      const expected = new Set<string>();
      let listRoots = 0;
      const listRootIds = new Set<string>();
      for (const mutation of mutations) {
        const id = mutation.after?.id;
        const identity = mutation.table + ":" + id;
        if (!allowed.has(mutation.table) || mutation.operation !== "insert" || mutation.before !== null ||
          typeof id !== "string" || mutation.after?.deleted_at !== null || expected.has(identity))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        if (call.commandName === "pricingCreateList" && mutation.table === "price_list") {
          listRoots++;
          listRootIds.add(id);
        }
        expected.add(identity);
      }
      if (call.commandName === "pricingCreateList") {
        if (!Array.isArray(call.input) || !Array.isArray(call.result) ||
          call.input.length < 1 || call.input.length > 4 ||
          listRoots !== call.input.length ||
          call.result.length !== call.input.length)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        const resultIds = new Set<string>();
        for (const result of call.result) {
          if (!isJsonObject(result) || typeof result.id !== "string")
            return yield* Effect.fail(commerceError("receiptMismatch"));
          if (resultIds.has(result.id)) return yield* Effect.fail(commerceError("receiptMismatch"));
          resultIds.add(result.id);
          if (!listRootIds.delete(result.id))
            return yield* Effect.fail(commerceError("receiptMismatch"));
        }
        if (listRootIds.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      if (call.commandName === "pricingCreateList" && options.priceListPriceRules) {
        const lists = new Set(mutations.flatMap(mutation => mutation.table === "price_list" && typeof mutation.after?.id === "string" ? [mutation.after.id] : []));
        const prices = new Set(mutations.flatMap(mutation => mutation.table === "price" && typeof mutation.after?.id === "string" ? [mutation.after.id] : []));
        for (const mutation of mutations) {
          if (mutation.table === "price" && (typeof mutation.after?.price_list_id !== "string" || !lists.has(mutation.after.price_list_id)))
            return yield* Effect.fail(commerceError("receiptMismatch"));
          if (mutation.table === "price_rule" && (typeof mutation.after?.price_id !== "string" || !prices.has(mutation.after.price_id)))
            return yield* Effect.fail(commerceError("receiptMismatch"));
        }
      }
      for (const event of emitted) {
        const message = yield* capture(event);
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
          if (!expected.delete(message.metadata.object + ":" + id)) return yield* Effect.fail(commerceError("receiptMismatch"));
        }
      }
      if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    });
  return { capture, validateLogicalCall };
}
