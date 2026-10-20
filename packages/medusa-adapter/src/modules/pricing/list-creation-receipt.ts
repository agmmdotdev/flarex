import { Effect, Schema, type Result } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { moduleEventDecoder } from "../../module/events";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { projectExactNumericColumns } from "../../value/exact-numeric";
import { captureCommerceInput } from "../../value/input";
import { compilePriceListCreationContracts, decodePriceListDeletionIds } from "./list-input";
import { decodePriceListCreate } from "./input";

type Contracts = Result.Result.Success<ReturnType<typeof compilePriceListCreationContracts>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.PRICING),
    object: Schema.Literals(["price_list", "price", "price_list_rule", "price_rule"]),
    action: Schema.Literals(["created", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, defaultCommerceResources.eventIds))]) }),
}), defaultCommerceResources);

/** Native normalization owns business values. This policy authenticates its
 * complete returned graph against shared write evidence and the physical
 * inverse against the existing root/descendant lifecycle evidence. */
export function pricingListCreationPolicy(contracts: Contracts, fallback?: Readonly<{
  capture: (input: unknown) => Effect.Effect<Json, ReturnType<typeof commerceError>>;
  validateLogicalCall: LogicalCallReceiptValidation;
}>) {
  const decoders = new Map([
    ["price_list", contracts.decodeListRow], ["price", contracts.decodePriceRow],
    ["price_list_rule", contracts.decodeListRuleRow], ["price_rule", contracts.decodePriceRuleRow],
  ]);
  const captureListEvent = Effect.fn("PricingLists.captureListEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.PRICING,
      objectName: message.metadata.object, action: message.metadata.action }) ||
      message.metadata.action === "deleted" && message.metadata.object !== "price_list")
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const capture = Effect.fn("PricingLists.captureEvent")(function* (input: unknown) {
    const captured = yield* Effect.fromResult(captureCommerceInput(input, defaultCommerceResources));
    if (fallback && (!isJsonObject(captured) || captured.metadata === undefined || !isJsonObject(captured.metadata) ||
      typeof captured.metadata.object !== "string" || !decoders.has(captured.metadata.object) ||
      captured.metadata.action !== "created" && captured.metadata.action !== "deleted" ||
      captured.metadata.action === "deleted" && captured.metadata.object !== "price_list")) return yield* fallback.capture(captured);
    return yield* captureListEvent(captured);
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PricingLists.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    if (call.commandName !== "pricingCreateList" && call.commandName !== "pricingDeleteList" && fallback)
      return yield* fallback.validateLogicalCall(call, activity);
    if (call.mode !== "write" || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    const created = call.commandName === "pricingCreateList", deleted = call.commandName === "pricingDeleteList";
    if (!created && !deleted) return yield* Effect.fail(mismatch());
    const rows = new Map<string, JsonObject>(), expectedEvents: string[] = [];
    for (const [index, change] of activity.mutations.entries()) {
      const decode = decoders.get(change.table), raw = created ? change.after : change.before;
      if (!decode || change.ordinal !== index || change.operation !== (created ? "insert" : "delete") ||
        (created ? change.before !== null : change.after !== null) || raw === null)
        return yield* Effect.fail(mismatch());
      const row = yield* Effect.fromResult(decode(projectNativeRow(raw)))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (typeof row.id !== "string" || rows.has(change.table + ":" + row.id) || created && row.deleted_at !== null)
        return yield* Effect.fail(mismatch());
      rows.set(change.table + ":" + row.id, row);
      if (created || change.table === "price_list") expectedEvents.push(change.table + ":" + row.id);
    }
    if (created) {
      const input = yield* Effect.fromResult(decodePriceListCreate(call.input))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const output = yield* Effect.fromResult(contracts.decodeOutput(call.result))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const roots = activity.mutations.filter(change => change.table === "price_list");
      if (roots.length !== input.length || output.length !== roots.length) return yield* Effect.fail(mismatch());
      const remaining = new Set(rows.keys());
      const consume = Effect.fn(function* (table: string, returned: JsonObject) {
        const key = table + ":" + returned.id, persisted = rows.get(key);
        if (!persisted || !remaining.delete(key)) return yield* Effect.fail(mismatch());
        const projected = table === "price" ? yield* projectExactNumericColumns(persisted,
          [{ name: "amount" }, { name: "min_quantity", nullable: true }, { name: "max_quantity", nullable: true }]) : persisted;
        if (!jsonEqual(projected, returned)) return yield* Effect.fail(mismatch());
      });
      for (const [index, root] of output.entries()) {
        const { prices, price_list_rules, ...scalars } = root;
        const supplied = input[index];
        if (!supplied || root.id !== roots[index]?.after?.id || !Array.isArray(prices) || !Array.isArray(price_list_rules) ||
          root.title !== supplied.title || root.description !== supplied.description ||
          supplied.id !== undefined && root.id !== supplied.id || supplied.status !== undefined && root.status !== supplied.status ||
          supplied.type !== undefined && root.type !== supplied.type)
          return yield* Effect.fail(mismatch());
        yield* consume("price_list", scalars);
        for (const rule of price_list_rules) {
          if (!isJsonObject(rule) || rule.price_list_id !== root.id) return yield* Effect.fail(mismatch());
          yield* consume("price_list_rule", rule);
        }
        for (const price of prices) {
          if (!isJsonObject(price) || price.price_list_id !== root.id || !Array.isArray(price.price_rules))
            return yield* Effect.fail(mismatch());
          const { price_rules, ...values } = price;
          yield* consume("price", values);
          for (const rule of price_rules) {
            if (!isJsonObject(rule) || rule.price_id !== price.id) return yield* Effect.fail(mismatch());
            yield* consume("price_rule", rule);
          }
        }
      }
      if (remaining.size) return yield* Effect.fail(mismatch());
    } else {
      const ids = yield* Effect.fromResult(decodePriceListDeletionIds(call.input))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (call.result !== null) return yield* Effect.fail(mismatch());
      const orderedIdentities = activity.mutations.flatMap(change => change.table === "price_list" && typeof change.before?.id === "string"
        ? [{ id: change.before.id }] : []);
      const rootRead = ids.length ? [{ table: "price_list", query: commerceRelationReadQuery(defaultCommerceResources,
        { kind: "in", column: "id", values: ids }, { kind: "storageInsertion", direction: "asc" }),
        total: orderedIdentities.length, returned: orderedIdentities.length, orderedIdentities }] : [];
      if (!jsonEqual(activity.relationalReads.filter(read => read.table === "price_list"), rootRead))
        return yield* Effect.fail(mismatch());
      const observed = new Map<string, JsonObject>();
      for (const observation of activity.observedRows) if (decoders.has(observation.table) && typeof observation.row.id === "string")
        observed.set(observation.table + ":" + observation.row.id, projectNativeRow(observation.row));
      for (const [key, row] of rows) observed.set(key, row);
      const roots = new Set([...observed].flatMap(([key, row]) => key.startsWith("price_list:") &&
        typeof row.id === "string" && ids.includes(row.id) ? [row.id] : []));
      const prices = new Set([...observed].flatMap(([key, row]) => key.startsWith("price:") &&
        roots.has(String(row.price_list_id)) ? [row.id] : []));
      const expected = new Map([...observed].filter(([key, row]) => key.startsWith("price_list:") ? roots.has(String(row.id))
        : key.startsWith("price:") ? prices.has(row.id) : key.startsWith("price_list_rule:")
          ? roots.has(String(row.price_list_id)) : key.startsWith("price_rule:") && prices.has(row.price_id)));
      if (expected.size !== rows.size || [...expected].some(([key, row]) => !jsonEqual(rows.get(key) ?? null, row)))
        return yield* Effect.fail(mismatch());
    }
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* captureListEvent(event);
      if (message.metadata.action !== (created ? "created" : "deleted")) return yield* Effect.fail(mismatch());
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (expectedEvents[emitted++] !== message.metadata.object + ":" + id) return yield* Effect.fail(mismatch());
    }
    if (emitted !== expectedEvents.length) return yield* Effect.fail(mismatch());
  });
  return { capture, validateLogicalCall, ...(fallback === undefined ? { allowStorageInsertionOrder: true as const } : {}) };
}
