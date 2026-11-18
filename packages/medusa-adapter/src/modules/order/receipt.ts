import { Effect, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { moduleEventDecoder } from "../../module/events";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { OrderArchiveId, decodeOrderArchiveIds, decodeOrderArchiveRead, decodeOrderArchiveStatuses,
  decodeOrderCompletionStatuses, type OrderRetainedStatuses, type OrderStatusProfile } from "./input";
import type { prepareOrderArchiveRepository } from "./repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareOrderArchiveRepository>>;
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.Literal("order.order.updated"),
  metadata: Schema.Struct({ source: Schema.Literal(Modules.ORDER), object: Schema.Literal("order"), action: Schema.Literal("updated") }),
  data: Schema.Struct({ id: Schema.Union([OrderArchiveId, Schema.Array(OrderArchiveId).check(Schema.isLengthBetween(1, 4))]) }),
}), defaultCommerceResources);
const mutableFields = new Set(["status", "updated_at"]);
const stable = (row: JsonObject) => Object.fromEntries(Object.entries(row).filter(([name]) => !mutableFields.has(name)));

/** Authenticate actual root selections, native immediate returns, exact status
 * mutations and module events. The original archive return retains pre-write
 * updated_at; the inverse returns the freshly updated rows. */
export function orderArchivePolicy(prepared: Prepared) {
  return orderStatusPolicy(prepared, "archive");
}

export function orderCompletionPolicy(prepared: Prepared) {
  return orderStatusPolicy(prepared, "complete");
}

function orderStatusPolicy(prepared: Prepared, profile: OrderStatusProfile) {
  const { contracts } = prepared;
  const decodeStatuses: (input: unknown) => Result.Result<OrderRetainedStatuses, CommerceTransactionError> =
    profile === "archive" ? decodeOrderArchiveStatuses : decodeOrderCompletionStatuses;
  const capture = Effect.fn("OrderStatus.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.ORDER, objectName: "order", action: "updated" }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("OrderStatus.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    type Row = Result.Result.Success<ReturnType<typeof contracts.decodeRow>>;
    const initial = new Map<string, Row>(), observations: Row[] = [], mutations = new Map<string, Row>();
    for (const observation of activity.observedRows) {
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
      if (before.id !== after.id || before.deleted_at !== null || after.deleted_at !== null ||
        !jsonEqual(stable(before), stable(after)) || mutations.has(after.id))
        return yield* Effect.fail(mismatch());
      initial.set(before.id, before); mutations.set(after.id, after);
    }
    if (initial.size > 4 || observations.some(row => {
      const before = initial.get(row.id), after = mutations.get(row.id);
      return (before === undefined || !jsonEqual(row, before)) && (after === undefined || !jsonEqual(row, after));
    })) return yield* Effect.fail(mismatch());
    const ordered = orderNativeIdRows([...initial.values()], {});
    const read = (where: JsonObject, fields?: readonly ["id", "status"]) => captureCommerceInput(buildQuery(where,
      { order: { id: "ASC" }, ...(fields === undefined ? {} : { select: [...fields] }) })).pipe(Result.flatMap(prepared.query));
    const receipt = (plan: Result.Result.Success<ReturnType<typeof read>>) => ({ table: contracts.table.name,
      query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: ordered.length, returned: ordered.length });
    if (call.commandName === "orderStatusPreimages") {
      if (call.mode !== "read" || activity.mutations.length || call.events.length) return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult(decodeOrderArchiveRead(call.input)),
        plan = yield* Effect.fromResult(read(input.filters, ["id", "status"]));
      if (ordered.some(row => !input.filters.id.includes(row.id)) ||
        !jsonEqual(activity.relationalReads, [receipt(plan)]) ||
        !jsonEqual(call.result, yield* Effect.fromResult(projectRows(ordered, plan.projection.node))))
        return yield* Effect.fail(mismatch());
      return;
    }
    if (call.mode !== "write") return yield* Effect.fail(mismatch());
    const transition = call.commandName === (profile === "archive" ? "orderArchive" : "orderComplete");
    if (!transition && call.commandName !== "orderRestoreStatuses") return yield* Effect.fail(mismatch());
    const ids = transition ? yield* Effect.fromResult(decodeOrderArchiveIds(call.input))
      : (yield* Effect.fromResult(decodeStatuses(call.input))).map(row => row.id);
    const selected = new Set(ids);
    if (ordered.length !== selected.size || ordered.some(row => !selected.has(row.id))) return yield* Effect.fail(mismatch());
    const lookup = yield* Effect.fromResult(read({ $or: ids.map(id => ({ id })) }));
    const reads = transition ? [receipt(yield* Effect.fromResult(read({ id: ids }))), ...(ids.length ? [receipt(lookup)] : [])]
      : ids.length ? [receipt(lookup)] : [];
    if (!jsonEqual(activity.relationalReads, reads)) return yield* Effect.fail(mismatch());
    const inverse = transition ? [] : yield* Effect.fromResult(decodeStatuses(call.input));
    const expected: JsonObject[] = [], changed: string[] = [];
    for (const row of ordered) {
      if (transition && (profile === "archive" ? !["completed", "canceled", "draft"].includes(row.status) : row.status === "canceled"))
        return yield* Effect.fail(mismatch());
      const status = transition ? profile === "archive" ? "archived" : "completed" : inverse.find(value => value.id === row.id)?.status;
      if (status === undefined) return yield* Effect.fail(mismatch());
      const after = mutations.get(row.id);
      if (after?.status !== status) return yield* Effect.fail(mismatch());
      changed.push(row.id);
      expected.push(yield* Effect.fromResult(contracts.present(transition ? { ...row, status } : after)));
    }
    if (mutations.size !== changed.length || !jsonEqual(call.result, expected)) return yield* Effect.fail(mismatch());
    const emitted: string[] = [];
    for (const event of call.events) {
      const message = yield* capture(event);
      emitted.push(...(Array.isArray(message.data.id) ? message.data.id : [message.data.id]));
    }
    if (!jsonEqual(emitted, changed)) return yield* Effect.fail(mismatch());
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture, validateLogicalCall };
}
