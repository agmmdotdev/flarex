import { Effect, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { moduleEventDecoder } from "../../module/events";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { OrderChangeUpdateId, decodeOrderChangeUpdateInput, decodeOrderChangeUpdateRead } from "./change-update-input";
import type { prepareOrderChangeUpdateRepository } from "./change-update-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareOrderChangeUpdateRepository>>;
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.Literal("order.order-change.updated"),
  metadata: Schema.Struct({ source: Schema.Literal(Modules.ORDER), object: Schema.Literal("order_change"), action: Schema.Literal("updated") }),
  data: Schema.Struct({ id: Schema.Union([OrderChangeUpdateId, Schema.Array(OrderChangeUpdateId).check(Schema.isLengthBetween(1, 4))]) }) }), defaultCommerceResources);

/** Correlate complete observed rows, the native internal service's final-key
 * assignments, exact patches and native events. No compensating data is invented. */
export function orderChangeUpdatePolicy(prepared: Prepared) {
  const { contracts } = prepared;
  const capture = Effect.fn("OrderChangeUpdate.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.ORDER, objectName: "order_change", action: "updated" }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("OrderChangeUpdate.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    type Row = Result.Result.Success<ReturnType<typeof contracts.decodeRow>>;
    const initial = new Map<string, Row>(), observations: Row[] = [], mutations = new Map<string, Row>();
    const orders = new Map<string, Result.Result.Success<ReturnType<typeof contracts.decodeOrderRow>>>();
    for (const observation of activity.observedRows) {
      if (observation.table === contracts.order.name) {
        const row = yield* Effect.fromResult(contracts.decodeOrderRow(projectNativeRow(observation.row))), previous = orders.get(row.id);
        if (previous !== undefined && !jsonEqual(previous, row)) return yield* Effect.fail(mismatch());
        orders.set(row.id, row); continue;
      }
      if (observation.table !== contracts.table.name) return yield* Effect.fail(mismatch());
      const row = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(observation.row)));
      if (row.deleted_at !== null) return yield* Effect.fail(mismatch());
      observations.push(row); if (!initial.has(row.id)) initial.set(row.id, row);
    }
    for (const [ordinal, mutation] of activity.mutations.entries()) {
      if (mutation.ordinal !== ordinal || mutation.table !== contracts.table.name || mutation.operation !== "patch" ||
        mutation.before === null || mutation.after === null || mutation.realNormalization !== undefined)
        return yield* Effect.fail(mismatch());
      const before = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(mutation.before))),
        after = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(mutation.after)));
      if (before.id !== after.id || before.deleted_at !== null || after.deleted_at !== null || mutations.has(after.id))
        return yield* Effect.fail(mismatch());
      initial.set(before.id, before); mutations.set(after.id, after);
    }
    if (initial.size > 4 || observations.some(row => {
      const before = initial.get(row.id), after = mutations.get(row.id);
      return (before === undefined || !jsonEqual(row, before)) && (after === undefined || !jsonEqual(row, after));
    })) return yield* Effect.fail(mismatch());
    const ordered = orderNativeIdRows([...initial.values()], {});
    const read = (where: JsonObject, fields?: readonly string[]) => captureCommerceInput(buildQuery(where,
      { order: { id: "ASC" }, ...(fields === undefined ? {} : { select: [...fields] }) })).pipe(Result.flatMap(prepared.query));
    const receipt = (plan: Result.Result.Success<ReturnType<typeof read>>) => ({ table: contracts.table.name,
      query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: ordered.length, returned: ordered.length });
    if (call.commandName === "orderChangeListForUpdate") {
      if (call.mode !== "read" || activity.mutations.length || call.events.length || orders.size) return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult(decodeOrderChangeUpdateRead(call.input)),
        plan = yield* Effect.fromResult(read(input.filters, input.config.select));
      if (ordered.some(row => !input.filters.id.includes(row.id)) ||
        !jsonEqual(activity.relationalReads, [receipt(plan)]) ||
        !jsonEqual(call.result, yield* Effect.fromResult(projectRows(ordered, plan.projection.node))))
        return yield* Effect.fail(mismatch());
      yield* Effect.fromResult(contracts.decodePreimages(call.result));
      return;
    }
    if (call.commandName !== "orderChangeUpdate" || call.mode !== "write") return yield* Effect.fail(mismatch());
    const input = yield* Effect.fromResult(decodeOrderChangeUpdateInput(call.input)),
      requested = new Map(input.map(row => [row.id, row])), ids = input.map(row => row.id);
    if (ordered.length !== requested.size || ordered.some(row => !requested.has(row.id))) return yield* Effect.fail(mismatch());
    const parents = new Set(ordered.map(row => row.order_id));
    if (orders.size !== parents.size || [...orders.values()].some(row => !parents.has(row.id) || row.deleted_at !== null))
      return yield* Effect.fail(mismatch());
    const reads = ids.length ? [receipt(yield* Effect.fromResult(read({ $or: ids.map(id => ({ id })) })))] : [];
    if (ordered.length) reads.push({ table: contracts.order.name,
      query: commerceRelationReadQuery(defaultCommerceResources, yield* Effect.fromResult(prepared.orderPredicate(ordered))),
      total: orders.size, returned: orders.size });
    if (!jsonEqual(activity.relationalReads, reads)) return yield* Effect.fail(mismatch());
    const expected: JsonObject[] = [], changed: string[] = [];
    for (const before of ordered) {
      const patch = requested.get(before.id);
      if (patch === undefined) return yield* Effect.fail(mismatch());
      const fields = Object.keys(patch).filter(name => name !== "id"), after = mutations.get(before.id);
      if (fields.length === 0) {
        if (after !== undefined) return yield* Effect.fail(mismatch());
        expected.push(yield* Effect.fromResult(contracts.present(before)));
        continue;
      }
      if (after === undefined) return yield* Effect.fail(mismatch());
      const { updated_at: _timestamp, ...actual } = after, { updated_at: _previousTimestamp, ...previous } = before;
      if (!jsonEqual(actual, { ...previous, ...patch })) return yield* Effect.fail(mismatch());
      changed.push(before.id); expected.push(yield* Effect.fromResult(contracts.present(after)));
    }
    if (mutations.size !== changed.length || !jsonEqual(call.result, expected)) return yield* Effect.fail(mismatch());
    yield* Effect.fromResult(contracts.decodeRows(call.result));
    const emitted: string[] = [];
    for (const event of call.events) {
      const message = yield* capture(event);
      emitted.push(...(Array.isArray(message.data.id) ? message.data.id : [message.data.id]));
    }
    if (!jsonEqual(emitted, changed)) return yield* Effect.fail(mismatch());
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture, validateLogicalCall };
}
