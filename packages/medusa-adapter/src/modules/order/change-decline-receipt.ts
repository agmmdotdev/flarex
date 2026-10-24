import { Effect, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { prepareUpdateMetadata } from "@medusajs/utils/modules-sdk/prepare-update-metadata";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { moduleEventDecoder } from "../../module/events";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import { OrderChangeId } from "./change-contracts";
import { decodeOrderChangeDeclineInput, decodeOrderChangeDeclinePreimage, decodeOrderChangeDeclineRead } from "./change-decline-input";
import type { prepareOrderChangeDeclineRepository } from "./change-decline-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareOrderChangeDeclineRepository>>;
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.Literal("order.order-change.updated"),
  metadata: Schema.Struct({ source: Schema.Literal(Modules.ORDER), object: Schema.Literal("order_change"), action: Schema.Literal("updated") }),
  data: Schema.Struct({ id: Schema.Union([OrderChangeId, Schema.Array(OrderChangeId).check(Schema.isLengthBetween(1, 1))]) }) }), defaultCommerceResources);
const guardFields = ["id", "order_id", "return_id", "claim_id", "exchange_id", "version", "status"];
const decodeInstant = commerceDecoder(Schema.DateFromString, "receiptMismatch");

/** Authenticate the genuine guard, complete update lookup and finite native
 * decline fields. Exact inverse replacement never repeats merge policy. */
export function orderChangeDeclinePolicy(prepared: Prepared) {
  const { contracts } = prepared;
  const capture = Effect.fn("OrderChangeDecline.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.ORDER, objectName: "order_change", action: "updated" }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("OrderChangeDecline.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    type Row = Result.Result.Success<ReturnType<typeof contracts.decodeRow>>;
    const observed = new Map<string, Row>(), observations: Row[] = [];
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
      observations.push(row); if (!observed.has(row.id)) observed.set(row.id, row);
    }
    if (observed.size !== 1) return yield* Effect.fail(mismatch());
    const read = (where: JsonObject, fields?: readonly string[]) => captureCommerceInput(buildQuery(where,
      { order: { id: "ASC" }, ...(fields === undefined ? {} : { select: [...fields] }) })).pipe(Result.flatMap(prepared.query));
    const receipt = (plan: Result.Result.Success<ReturnType<typeof read>>) => ({ table: contracts.table.name,
      query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: 1, returned: 1 });
    if (call.commandName === "orderChangeRetrieveForDecline") {
      if (call.mode !== "read" || activity.mutations.length || call.events.length || orders.size) return yield* Effect.fail(mismatch());
      const rows = [...observed.values()], before = rows[0];
      if (before === undefined || observations.some(row => !jsonEqual(row, before))) return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult(decodeOrderChangeDeclineRead(call.input)),
        plan = yield* Effect.fromResult(read({ id: input.id }, input.config.select));
      const selected = (yield* Effect.fromResult(projectRows(rows, plan.projection.node)))[0];
      if (before.id !== input.id || selected === undefined || !jsonEqual(activity.relationalReads, [receipt(plan)]) ||
        !jsonEqual(call.result, selected)) return yield* Effect.fail(mismatch());
      yield* Effect.fromResult(contracts.decodeSelected(call.result));
      return;
    }
    if (call.mode !== "write" || activity.mutations.length !== 1 || orders.size !== 1) return yield* Effect.fail(mismatch());
    const mutation = activity.mutations[0];
    if (mutation === undefined || mutation.ordinal !== 0 || mutation.table !== contracts.table.name || mutation.operation !== "patch" ||
      mutation.before === null || mutation.after === null || mutation.realNormalization !== undefined) return yield* Effect.fail(mismatch());
    const before = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(mutation.before))),
      after = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(mutation.after)));
    // Activity captures the current row after a write. The authenticated
    // mutation retains its pre-state; every complete observed projection must
    // correlate with this same transition's before or after value.
    if (before.id !== after.id || !observed.has(before.id) || before.deleted_at !== null || after.deleted_at !== null ||
      observations.some(row => !jsonEqual(row, before) && !jsonEqual(row, after)) || typeof after.updated_at !== "string")
      return yield* Effect.fail(mismatch());
    const rows = [before], parent = orders.get(before.order_id);
    if (parent === undefined || parent.deleted_at !== null) return yield* Effect.fail(mismatch());
    let expected: JsonObject;
    const reads = [];
    if (call.commandName === "orderChangeDecline") {
      const input = yield* Effect.fromResult(decodeOrderChangeDeclineInput(call.input));
      if (before.id !== input.id || before.status !== "pending" && before.status !== "requested" || typeof after.declined_at !== "string")
        return yield* Effect.fail(mismatch());
      const instant = yield* Effect.fromResult(decodeInstant(after.declined_at));
      if (instant.toISOString() !== after.declined_at) return yield* Effect.fail(mismatch());
      const pairs = [{ entity: structuredClone(before), update: structuredClone(input) }];
      prepareUpdateMetadata(pairs);
      const pair = pairs[0];
      if (pair === undefined) return yield* Effect.fail(mismatch());
      // Full-row equality below preserves declined_reason and every field outside the finite decline patch.
      expected = { ...before, ...pair.update, status: "declined", declined_at: after.declined_at, updated_at: after.updated_at };
      reads.push(receipt(yield* Effect.fromResult(read({ id: [input.id] }, guardFields))));
      if (call.result !== null) return yield* Effect.fail(mismatch());
    } else if (call.commandName === "orderChangeRestoreDecline") {
      const input = yield* Effect.fromResult(decodeOrderChangeDeclinePreimage(call.input));
      if (before.id !== input.id) return yield* Effect.fail(mismatch());
      expected = { ...before, ...input, updated_at: after.updated_at };
      yield* Effect.fromResult(contracts.decodeOutput(call.result));
      if (!jsonEqual(call.result, yield* Effect.fromResult(contracts.present(after)))) return yield* Effect.fail(mismatch());
    } else return yield* Effect.fail(mismatch());
    reads.push(receipt(yield* Effect.fromResult(read({ $or: [{ id: before.id }] }))));
    reads.push({ table: contracts.order.name,
      query: commerceRelationReadQuery(defaultCommerceResources, yield* Effect.fromResult(prepared.orderPredicate(rows))), total: 1, returned: 1 });
    if (!jsonEqual(activity.relationalReads, reads) || !jsonEqual(after, expected) || call.events.length !== 1)
      return yield* Effect.fail(mismatch());
    const message = yield* capture(call.events[0]);
    if (!jsonEqual(Array.isArray(message.data.id) ? message.data.id : [message.data.id], [before.id]))
      return yield* Effect.fail(mismatch());
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture, validateLogicalCall };
}
