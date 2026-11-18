import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { Modules } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { scalarLogicalEventPolicy } from "../../repository/scalar-events";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { nativePreimageSelection } from "../../workflow/preimage";
import { commerceRelationReadQuery } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { ShippingOptionTypeUpdateReadInput, decodeShippingOptionTypeUpdateInput, decodeShippingOptionTypeUpdateUpserts } from "./shipping-option-type-update-input";
import type { prepareShippingOptionTypeUpdateRepository } from "./shipping-option-type-update-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareShippingOptionTypeUpdateRepository>>;
type Row = Result.Result.Success<ReturnType<Prepared["contracts"]["decodeRow"]>>;
const decodeRead = commerceDecoder(ShippingOptionTypeUpdateReadInput, "receiptMismatch");

/** Bind native selector retargeting, true forward no-ops and real sequential
 * inverse upserts to authenticated current rows, attempts, outputs and events.
 * Native inverses preserve tombstones and can recreate complete missing rows. */
export function shippingOptionTypeUpdatePolicy(prepared: Prepared) {
  const { capture } = scalarLogicalEventPolicy(Modules.FULFILLMENT, "shipping_option_type", { insert: "shippingOptionTypeUpsertForUpdateInverse", update: "shippingOptionTypeUpdateForWorkflow" });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ShippingOptionTypeUpdate.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    const decodeRow = (row: JsonObject) => Effect.fromResult(prepared.contracts.decodeRow(projectNativeRow(row)))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const initial = new Map<string, Row>(), observations: Row[] = [];
    for (const observation of activity.observedRows) {
      if (observation.table !== "shipping_option_type") return yield* Effect.fail(mismatch());
      const row = yield* decodeRow(observation.row);
      observations.push(row);
      if (!initial.has(row.id)) initial.set(row.id, row);
    }
    const firstMutation = new Set<string>();
    const mutations: Array<{ before: Row | null; after: Row }> = [];
    for (const [ordinal, mutation] of activity.mutations.entries()) {
      if (mutation.ordinal !== ordinal || mutation.table !== "shipping_option_type" || mutation.after === null ||
        mutation.operation !== "patch" && mutation.operation !== "insert") return yield* Effect.fail(mismatch());
      const before = mutation.before === null ? null : yield* decodeRow(mutation.before), after = yield* decodeRow(mutation.after);
      if (mutation.operation === "insert" ? before !== null : before === null || before.id !== after.id)
        return yield* Effect.fail(mismatch());
      if (!firstMutation.has(after.id)) {
        if (before === null) initial.delete(after.id); else initial.set(after.id, before);
        firstMutation.add(after.id);
      }
      mutations.push({ before, after });
    }
    if (initial.size > 5 || observations.some(row => !jsonEqual(initial.get(row.id) ?? null, row) &&
      !mutations.some(mutation => jsonEqual(mutation.before, row) || jsonEqual(mutation.after, row))))
      return yield* Effect.fail(mismatch());
    if (call.commandName === "shippingOptionTypeListForUpdate") {
      if (call.mode !== "read" || mutations.length || call.events.length) return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult(decodeRead(call.input));
      const requested = typeof input.filters.id === "string" ? [input.filters.id] : input.filters.id;
      if ([...initial.keys()].some(id => !requested.includes(id))) return yield* Effect.fail(mismatch());
      const config = nativePreimageSelection(input.config ?? {}, prepared);
      const envelope = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, {
        ...(config.select === undefined ? {} : { select: [...config.select] }),
        ...(config.relations === undefined ? {} : { relations: [...config.relations] }),
      })));
      const plan = yield* Effect.fromResult(prepared.query(envelope)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const active = [...initial.values()].filter(row => row.deleted_at === null);
      const reads = [{ table: prepared.contracts.table.name, query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate),
        total: active.length, returned: active.length }];
      if (!jsonEqual(activity.relationalReads, reads)) return yield* Effect.fail(mismatch());
      const expected = yield* Effect.fromResult(projectRows(orderNativeIdRows(active,
        buildQuery(input.filters).where), plan.projection.node)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const output = yield* Effect.fromResult(prepared.contracts.decodePreimages(call.result))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (!jsonEqual(output, expected)) return yield* Effect.fail(mismatch());
      return;
    }
    if (call.mode !== "write") return yield* Effect.fail(mismatch());
    const expectedReads: Array<{ table: string; query: JsonObject; total: number; returned: number }> = [];
    const selectorRead = (selector: JsonObject, count: number) => captureCommerceInput(buildQuery(selector)).pipe(
      Result.flatMap(prepared.query),
      Result.map(plan => ({ table: prepared.contracts.table.name,
        query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: count, returned: count })),
      Result.mapError(cause => commerceError("receiptMismatch", cause)));
    const expected: Row[] = [], expectedEvents: Array<{ id: string; action: "created" | "updated" }> = [];
    if (call.commandName === "shippingOptionTypeUpdateForWorkflow") {
      const input = yield* Effect.fromResult(decodeShippingOptionTypeUpdateInput(call.input))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const requested = typeof input.selector.id === "string" ? [input.selector.id] : input.selector.id;
      const active = [...initial.values()].filter(row => row.deleted_at === null);
      const originallySelected = orderNativeIdRows(active.filter(row => requested.includes(row.id)), buildQuery(input.selector).where);
      const supplied = originallySelected.map(row => ({ id: row.id, ...input.update }));
      const patches = new Map(supplied.map(row => [row.id, row]));
      const admitted = new Set([...requested, ...(originallySelected.length && input.update.id !== undefined ? [input.update.id] : [])]);
      if ([...initial.keys()].some(id => !admitted.has(id))) return yield* Effect.fail(mismatch());
      const selected = orderNativeIdRows(active.filter(row => patches.has(row.id)), { $or: supplied.map(row => ({ id: row.id })) });
      expectedReads.push(yield* Effect.fromResult(selectorRead(input.selector, originallySelected.length)));
      if (originallySelected.length) expectedReads.push(yield* Effect.fromResult(
        selectorRead({ $or: supplied.map(row => ({ id: row.id })) }, selected.length)));
      if (selected.length !== patches.size) return yield* Effect.fail(mismatch());
      let ordinal = 0;
      for (const before of selected) {
        const patch = patches.get(before.id);
        if (patch === undefined) return yield* Effect.fail(mismatch());
        const { id, ...data } = patch;
        if (!Object.keys(data).length) { expected.push(before); continue; }
        const mutation = mutations[ordinal++];
        if (mutation === undefined || typeof mutation.after.updated_at !== "string" ||
          !jsonEqual(mutation.before, before) || mutation.after.deleted_at !== null ||
          !jsonEqual(mutation.after, { ...before, ...data, updated_at: mutation.after.updated_at }))
          return yield* Effect.fail(mismatch());
        expected.push(mutation.after); expectedEvents.push({ id: before.id, action: "updated" });
      }
      if (ordinal !== mutations.length) return yield* Effect.fail(mismatch());
      const output = yield* Effect.fromResult(prepared.contracts.decodeRows(call.result))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (!jsonEqual(output, expected)) return yield* Effect.fail(mismatch());
    } else if (call.commandName === "shippingOptionTypeUpsertForUpdateInverse") {
      const inputs = yield* Effect.fromResult(decodeShippingOptionTypeUpdateUpserts(call.input))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (mutations.length !== inputs.length || [...initial.keys()].some(id => !inputs.some(input => input.id === id)))
        return yield* Effect.fail(mismatch());
      const current = new Map(initial);
      for (const [ordinal, input] of inputs.entries()) {
        const mutation = mutations[ordinal], before = current.get(input.id);
        if (mutation === undefined || !jsonEqual(mutation.before, before ?? null) || mutation.after.id !== input.id)
          return yield* Effect.fail(mismatch());
        expectedReads.push({ table: prepared.contracts.table.name, query: commerceRelationReadQuery(defaultCommerceResources,
          { kind: "in", column: "id", values: [input.id] }), total: before === undefined ? 0 : 1, returned: before === undefined ? 0 : 1 });
        const after = mutation.after, createdAt = after.created_at, updatedAt = after.updated_at;
        if (typeof createdAt !== "string" || typeof updatedAt !== "string") return yield* Effect.fail(mismatch());
        const wanted: JsonObject = before === undefined
          ? { ...prepared.contracts.defaults, ...input, created_at: createdAt, updated_at: updatedAt, deleted_at: null }
          : { ...before, ...input, updated_at: updatedAt };
        if (before === undefined && after.created_at !== after.updated_at || !jsonEqual(after, wanted))
          return yield* Effect.fail(mismatch());
        expected.push(after); current.set(after.id, after);
        const action = before === undefined ? "created" : "updated";
        if (!expectedEvents.some(event => event.id === after.id && event.action === action)) expectedEvents.push({ id: after.id, action });
      }
      const output = yield* Effect.fromResult(prepared.contracts.decodeUpsertRows(call.result))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (!jsonEqual(output, expected)) return yield* Effect.fail(mismatch());
    } else return yield* Effect.fail(mismatch());
    if (!jsonEqual(activity.relationalReads, expectedReads)) return yield* Effect.fail(mismatch());
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        const wanted = expectedEvents[emitted++];
        if (wanted === undefined || id !== wanted.id || message.metadata.action !== wanted.action)
          return yield* Effect.fail(mismatch());
      }
    }
    if (emitted !== expectedEvents.length) return yield* Effect.fail(mismatch());
  });
  return { capture, validateLogicalCall };
}
