import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { moduleEventDecoder } from "../../module/events";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { compilePricePreferenceContracts, decodeStorePreferenceFilters, decodePricePreferenceIds } from "./preference-input";
import { decodePricePreferenceCreate } from "./input";

type Contracts = Result.Result.Success<ReturnType<typeof compilePricePreferenceContracts>>;
type Row = Result.Result.Success<ReturnType<Contracts["decodeRow"]>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.PRICING), object: Schema.Literal("price_preference"),
    action: Schema.Literals(["created", "updated", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 4))]) }),
}), defaultCommerceResources);

/** This named profile authenticates complete native preference rows, public
 * creation, Store lookup membership, partitioned upsert order, no-op rows and
 * physical inverses against one complete DML-derived row contract. */
export function pricingPreferencePolicy(contracts: Contracts) {
  const capture = Effect.fn("PricingPreferences.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.PRICING, objectName: "price_preference", action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PricingPreferences.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    const initial = new Map<string, Row>();
    const decodeRow = (row: JsonObject) => Effect.fromResult(contracts.decodeRow(projectNativeRow(row)))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    for (const observation of activity.observedRows) {
      if (observation.table !== "price_preference") return yield* Effect.fail(mismatch());
      const row = yield* decodeRow(observation.row); initial.set(row.id, row);
    }
    const seen = new Set<string>();
    for (const [ordinal, mutation] of activity.mutations.entries()) {
      if (mutation.ordinal !== ordinal || mutation.table !== "price_preference") return yield* Effect.fail(mismatch());
      if (mutation.operation === "insert") {
        if (mutation.before !== null || mutation.after === null) return yield* Effect.fail(mismatch());
        const row = yield* decodeRow(mutation.after);
        if (seen.has(row.id)) return yield* Effect.fail(mismatch());
        seen.add(row.id); initial.delete(row.id);
      } else {
        if (mutation.before === null) return yield* Effect.fail(mismatch());
        const before = yield* decodeRow(mutation.before);
        if (seen.has(before.id)) return yield* Effect.fail(mismatch());
        seen.add(before.id); initial.set(before.id, before);
      }
    }
    if (initial.size > 4) return yield* Effect.fail(mismatch());
    const expectedEvents: Array<Readonly<{ id: string; action: "created" | "updated" | "deleted" }>> = [];
    switch (call.commandName) {
      case "pricingCreatePreference": {
        if (call.mode !== "write" || initial.size !== 0) return yield* Effect.fail(mismatch());
        const input = yield* Effect.fromResult(decodePricePreferenceCreate(call.input))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const output = yield* Effect.fromResult(contracts.decodeOutput(call.result))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (activity.mutations.length !== input.length || output.length !== input.length)
          return yield* Effect.fail(mismatch());
        for (const [ordinal, supplied] of input.entries()) {
          const mutation = activity.mutations[ordinal];
          if (mutation?.operation !== "insert" || mutation.before !== null || mutation.after === null)
            return yield* Effect.fail(mismatch());
          const after = yield* decodeRow(mutation.after);
          const returned = output[ordinal];
          if (after.attribute !== supplied.attribute || after.value !== (supplied.value ?? null) ||
            after.is_tax_inclusive !== (supplied.is_tax_inclusive ?? false) || after.deleted_at !== null ||
            after.created_at !== after.updated_at || returned === undefined || !jsonEqual(returned, after))
            return yield* Effect.fail(mismatch());
          expectedEvents.push({ id: after.id, action: "created" });
        }
        break;
      }
      case "pricingStorePreferenceList": {
        if (call.mode !== "read" || activity.mutations.length || call.events.length) return yield* Effect.fail(mismatch());
        const filters = yield* Effect.fromResult(decodeStorePreferenceFilters(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const output = yield* Effect.fromResult(contracts.decodeOutput(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const expected = orderNativeIdRows([...initial.values()], filters);
        if (expected.some(row => row.deleted_at !== null || !filters.$or.some(pair => pair.attribute === row.attribute && pair.value === row.value)) ||
          !jsonEqual(expected, output)) return yield* Effect.fail(mismatch());
        return;
      }
      case "pricingStorePreferenceUpsert": {
        if (call.mode !== "write") return yield* Effect.fail(mismatch());
        const input = yield* Effect.fromResult(contracts.decodeUpsert(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const output = yield* Effect.fromResult(contracts.decodeOutput(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const creates = input.filter(row => !("id" in row)), updates = new Map(input.flatMap(row => "id" in row ? [[row.id, row] as const] : []));
        if ([...initial.values()].some(row => !updates.has(row.id) || row.deleted_at !== null) ||
          [...updates.keys()].some(id => !initial.has(id))) return yield* Effect.fail(mismatch());
        const expected: Row[] = [], createdIds = new Set<string>();
        let ordinal = 0;
        for (const supplied of creates) {
          const mutation = activity.mutations[ordinal++];
          if (mutation?.operation !== "insert" || mutation.before !== null || mutation.after === null) return yield* Effect.fail(mismatch());
          const row = yield* decodeRow(mutation.after);
          if (createdIds.has(row.id) || updates.has(row.id) || row.attribute !== supplied.attribute || row.value !== supplied.value ||
            row.is_tax_inclusive !== (supplied.is_tax_inclusive ?? false) || row.deleted_at !== null)
            return yield* Effect.fail(mismatch());
          createdIds.add(row.id); expected.push(row); expectedEvents.push({ id: row.id, action: "created" });
        }
        const updateWhere = { $or: input.flatMap(row => "id" in row ? [{ id: row.id }] : []) };
        for (const before of orderNativeIdRows([...initial.values()], updateWhere)) {
          const supplied = updates.get(before.id);
          if (supplied === undefined) return yield* Effect.fail(mismatch());
          if ("created_at" in supplied && (supplied.created_at !== before.created_at || supplied.deleted_at !== before.deleted_at))
            return yield* Effect.fail(mismatch());
          if (Object.keys(supplied).length === 1) { expected.push(before); continue; }
          const mutation = activity.mutations[ordinal++];
          if (mutation?.operation !== "patch" || mutation.before === null || mutation.after === null ||
            !jsonEqual(projectNativeRow(mutation.before), before)) return yield* Effect.fail(mismatch());
          const after = yield* decodeRow(mutation.after);
          if (typeof after.updated_at !== "string") return yield* Effect.fail(mismatch());
          const wanted: JsonObject = { ...before, ...Object.fromEntries(Object.entries(supplied)
            .filter(([field]) => field !== "created_at" && field !== "updated_at" && field !== "deleted_at")), updated_at: after.updated_at };
          if (!jsonEqual(after, wanted)) return yield* Effect.fail(mismatch());
          expected.push(after); expectedEvents.push({ id: after.id, action: "updated" });
        }
        if (ordinal !== activity.mutations.length || !jsonEqual(output, expected)) return yield* Effect.fail(mismatch());
        break;
      }
      case "pricingPreferenceDelete": {
        if (call.mode !== "write" || call.result !== null) return yield* Effect.fail(mismatch());
        const ids = yield* Effect.fromResult(decodePricePreferenceIds(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const expected = orderNativeIdRows([...initial.values()], {});
        if (expected.some(row => !ids.includes(row.id)) || activity.mutations.length !== expected.length)
          return yield* Effect.fail(mismatch());
        for (const [ordinal, row] of expected.entries()) {
          const mutation = activity.mutations[ordinal];
          if (mutation?.operation !== "delete" || mutation.before === null || mutation.after !== null ||
            !jsonEqual(projectNativeRow(mutation.before), row)) return yield* Effect.fail(mismatch());
          expectedEvents.push({ id: row.id, action: "deleted" });
        }
        break;
      }
      default: return yield* Effect.fail(mismatch());
    }
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        const expected = expectedEvents[emitted++];
        if (expected === undefined || expected.id !== id || expected.action !== message.metadata.action)
          return yield* Effect.fail(mismatch());
      }
    }
    if (emitted !== expectedEvents.length) return yield* Effect.fail(mismatch());
  });
  return { capture, validateLogicalCall };
}
