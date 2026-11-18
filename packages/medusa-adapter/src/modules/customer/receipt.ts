import { Effect, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { matchesPublicRow, orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { correlatePhysicalGraphReceipt } from "../../repository/physical-graph-receipt";
import { commerceRelationReadQuery } from "../../query/relations";
import { moduleEventDecoder } from "../../module/events";
import { captureCommerceInput } from "../../value/input";
import { CustomerSelectionId, decodeCustomerCreate, decodeCustomerDelete, decodeCustomerList, decodeCustomerRetrieve } from "./input";
import type { prepareCustomerSelectionRepository } from "./repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareCustomerSelectionRepository>>;
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.CUSTOMER), object: Schema.Literal("customer"),
    action: Schema.Literals(["created", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([CustomerSelectionId, Schema.Array(CustomerSelectionId).check(Schema.isLengthBetween(1, 1))]) }),
}), defaultCommerceResources);

/** Authenticate call-local observations against the native scalar planner,
 * creation DTO/defaults and shared physical lifecycle receipt owner. */
export function customerSelectionPolicy({ contracts, query }: Prepared) {
  const capture = Effect.fn("Customer.captureSelectionEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.CUSTOMER, objectName: "customer", action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("Customer.validateSelectionCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    if (call.commandName === "customerRetrieveForWorkflow" || call.commandName === "customerListForWorkflow") {
      const retrieve = call.commandName === "customerRetrieveForWorkflow";
      if (call.mode !== "read" || call.events.length || activity.mutations.length || activity.relationalReads.length !== 1)
        return yield* Effect.fail(mismatch());
      const filters = retrieve ? yield* Effect.fromResult(decodeCustomerRetrieve(call.input)) : yield* Effect.fromResult(decodeCustomerList(call.input));
      const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(filters, retrieve ? {} : { order: { id: "ASC" } })).pipe(Result.flatMap(query)))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const rows = [];
      for (const observation of activity.observedRows) {
        if (observation.table !== contracts.customer.name) return yield* Effect.fail(mismatch());
        const row = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(observation.row))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (row.deleted_at !== null || ("id" in filters ? row.id !== filters.id : row.email !== filters.email ||
          filters.has_account !== undefined && row.has_account !== filters.has_account)) return yield* Effect.fail(mismatch());
        rows.push(row);
      }
      if (new Set(rows.map(row => row.id)).size !== rows.length || rows.length > 2 || retrieve && rows.length !== 1)
        return yield* Effect.fail(mismatch());
      if (!jsonEqual(activity.relationalReads[0] ?? null, { table: contracts.customer.name,
        query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: rows.length, returned: rows.length }))
        return yield* Effect.fail(mismatch());
      const output = retrieve
        ? yield* Effect.fromResult(contracts.decodeRow(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)))
        : yield* Effect.fromResult(contracts.decodeRows(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (!jsonEqual(output, retrieve ? rows[0] ?? null : orderNativeIdRows(rows, filters))) return yield* Effect.fail(mismatch());
      return;
    }
    if (call.mode !== "write") return yield* Effect.fail(mismatch());
    const creating = call.commandName === "customerCreateForWorkflow";
    let expectedEvents: readonly string[];
    if (creating) {
      const input = yield* Effect.fromResult(decodeCustomerCreate(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const result = yield* Effect.fromResult(contracts.decodeCreatedRow(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const mutation = activity.mutations[0], row = mutation?.after;
      if (activity.mutations.length !== 1 || activity.relationalReads.length || mutation === undefined || mutation.ordinal !== 0 ||
        mutation.table !== contracts.customer.name || mutation.operation !== "insert" || mutation.before !== null || row === null || row === undefined ||
        mutation.deletedReference !== undefined) return yield* Effect.fail(mismatch());
      const { groups, addresses, ...scalarValues } = result;
      const scalar: JsonObject = scalarValues;
      if (!matchesPublicRow(row, scalar) || groups.length || addresses.length || result.deleted_at !== null || result.created_at !== result.updated_at)
        return yield* Effect.fail(mismatch());
      for (const [name, value] of Object.entries({ ...contracts.defaults, ...input }))
        if (scalar[name] === undefined || !jsonEqual(scalar[name], value)) return yield* Effect.fail(mismatch());
      if (activity.observedRows.length !== 1 || activity.observedRows[0]?.table !== contracts.customer.name ||
        !jsonEqual(projectNativeRow(activity.observedRows[0].row), scalar)) return yield* Effect.fail(mismatch());
      expectedEvents = [result.id];
    } else {
      if (call.commandName !== "customerDeleteForWorkflow" || call.result !== null) return yield* Effect.fail(mismatch());
      const id = yield* Effect.fromResult(decodeCustomerDelete(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const root = activity.mutations.find(mutation => mutation.table === contracts.customer.name)?.before;
      const reads = [...activity.relationalReads];
      if (root !== undefined && root !== null) {
        const membershipRead = reads.splice(1, 1)[0];
        if (!jsonEqual(membershipRead ?? null, { table: contracts.membership.name,
          query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "customer_id", values: [id] }), total: 0, returned: 0 }))
          return yield* Effect.fail(mismatch());
      }
      expectedEvents = yield* Effect.fromResult(correlatePhysicalGraphReceipt({ tables: contracts.tables, entities: contracts.entities,
        root: contracts.customer, requestedIds: [id], activity: { ...activity, relationalReads: reads } }));
    }
    let emitted = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.action !== (creating ? "created" : "deleted")) return yield* Effect.fail(mismatch());
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (expectedEvents[emitted++] !== id) return yield* Effect.fail(mismatch());
    }
    if (emitted !== expectedEvents.length) return yield* Effect.fail(mismatch());
  });
  return { capture, validateLogicalCall };
}
