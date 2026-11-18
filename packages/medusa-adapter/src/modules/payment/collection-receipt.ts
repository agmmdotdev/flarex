import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { captureCommerceInput } from "../../value/input";
import { captureExactNumericRow, encodeNativeExactNumeric } from "../../value/exact-numeric";
import { paymentSessionPolicy } from "./receipt";
import { paymentLifecyclePolicy } from "./lifecycle-receipt";
import { decodeCollectionCreates, decodeCollectionIds, decodeCollectionUpdate, decodeCollectionUpserts } from "./collection-input";
import type { preparePaymentSessionRepository } from "./repository";
import { paymentAccountPolicy } from "./account-receipt";

type Prepared = Result.Result.Success<ReturnType<typeof preparePaymentSessionRepository>>;
const mismatch = (phase: string, cause?: unknown) => commerceError("receiptMismatch", { phase, cause });

/** Collection mutation causality. Native Payment remains the operation/event
 * owner; this policy authenticates observed preimages and exact persisted fields. */
export function paymentCollectionPolicy(prepared: Prepared) {
  const sessions = paymentSessionPolicy(prepared), lifecycle = paymentLifecyclePolicy(prepared), accounts = paymentAccountPolicy(prepared);
  const { contracts, query } = prepared;
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PaymentCollection.validateCall")(function* (call, activity) {
    if (["paymentAccountHolderCreate", "paymentAccountHolderDelete", "paymentAccountHolderCount"].includes(call.commandName))
      return yield* accounts.validateLogicalCall(call, activity);
    if (call.commandName === "paymentSessionDeleteForWorkflow" || call.commandName === "paymentSessionCreateForWorkflow" ||
      call.commandName === "paymentSessionListForWorkflow") return yield* sessions.validateLogicalCall(call, activity);
    if (call.commandName === "paymentCollectionsCreate") {
      const input = yield* Effect.fromResult(decodeCollectionCreates(call.input));
      if (!Array.isArray(call.result) || call.result.length !== 1) return yield* Effect.fail(mismatch("create-result"));
      const row = input[0]!;
      const amount = yield* encodeNativeExactNumeric(row.amount);
      return yield* sessions.validateLogicalCall({ ...call, commandName: "paymentCollectionCreateForWorkflow",
        input: { ...row, amount: amount.value }, result: call.result[0]! }, activity);
    }
    if (call.commandName === "paymentCollectionsList") {
      if (!Array.isArray(call.result)) return yield* Effect.fail(mismatch("list-result"));
      return yield* lifecycle.validateLogicalCall({ ...call, commandName: "paymentCollectionCountForLifecycle", result: [call.result, call.result.length] }, activity);
    }
    if (!["paymentCollectionsUpdate", "paymentCollectionsUpsert", "paymentCollectionsDelete"].includes(call.commandName))
      return yield* lifecycle.validateLogicalCall(call, activity);
    if (call.mode !== "write" || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length || activity.mutations.length !== 1)
      return yield* Effect.fail(mismatch("mutation-profile"));
    const mutation = activity.mutations[0]!;
    if (mutation.ordinal !== 0 || mutation.table !== contracts.collection.name || mutation.before === null)
      return yield* Effect.fail(mismatch("mutation"));
    const before = yield* Effect.fromResult(contracts.decodeCollection(projectNativeRow(mutation.before)));
    const deleting = call.commandName === "paymentCollectionsDelete", upserting = call.commandName === "paymentCollectionsUpsert";
    let id: string;
    let fields: JsonObject = {};
    if (deleting) id = (yield* Effect.fromResult(decodeCollectionIds(call.input)))[0]!;
    else if (upserting) {
      const [input] = yield* Effect.fromResult(decodeCollectionUpserts(call.input));
      if (input === undefined) return yield* Effect.fail(mismatch("upsert-input"));
      id = input.id;
      const { id: _identity, ...patch } = input;
      fields = yield* captureExactNumericRow(patch, contracts.collectionNumbers, false, "nativeRaw");
    } else {
      const input = yield* Effect.fromResult(decodeCollectionUpdate(call.input));
      id = input.selector.id;
      fields = yield* captureExactNumericRow(input.update, contracts.collectionNumbers, false, "nativeRaw");
    }
    if (before.id !== id || before.deleted_at !== null) return yield* Effect.fail(mismatch("preimage"));
    const filters = { $or: [{ id }] };
    // Shared deletion returns its authenticated preimage directly; it performs
    // no separate relational query. Native update resolves selector then IDs.
    const selectors = deleting ? [] : upserting ? [filters] : [{ id }, filters];
    const reads = [];
    for (const selector of selectors) {
      const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(selector, {})).pipe(Result.flatMap(value => query(contracts.collection, value))));
      reads.push({ table: contracts.collection.name, query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: 1, returned: 1 });
    }
    if (!jsonEqual(reads, activity.relationalReads)) return yield* Effect.fail(mismatch("read-closure", { expected: reads, actual: activity.relationalReads }));
    for (const observation of activity.observedRows) {
      const observed = projectNativeRow(observation.row);
      if (observation.table !== contracts.collection.name || (!jsonEqual(observed, before) &&
        (mutation.after === null || !jsonEqual(observed, projectNativeRow(mutation.after)))))
        return yield* Effect.fail(mismatch("observed-row"));
    }
    if (deleting) {
      if (mutation.operation !== "delete" || mutation.after !== null || call.result !== null)
        return yield* Effect.fail(mismatch("delete-result"));
    } else {
      if (mutation.operation !== "patch" || mutation.after === null) return yield* Effect.fail(mismatch("update"));
      const after = yield* Effect.fromResult(contracts.decodeCollection(projectNativeRow(mutation.after)));
      for (const [name, previous] of Object.entries(before)) {
        if (name === "updated_at") continue;
        const actual = after[name], expected = Object.hasOwn(fields, name) ? fields[name] : previous;
        if (actual === undefined || expected === undefined || !jsonEqual(actual, expected)) return yield* Effect.fail(mismatch("update-field"));
      }
      if (!jsonEqual(call.result, [yield* contracts.present(after, contracts.collection.name)])) return yield* Effect.fail(mismatch("update-result"));
    }
    const events = [];
    for (const input of call.events) {
      const event = yield* lifecycle.capture(input);
      for (const eventId of typeof event.data.id === "string" ? [event.data.id] : event.data.id)
        events.push({ object: event.metadata.object, action: event.metadata.action, id: eventId });
    }
    if (!jsonEqual(events, [{ object: "payment_collection", action: deleting ? "deleted" : "updated", id }]))
      return yield* Effect.fail(mismatch("events"));
  });
  return { capture: lifecycle.capture, validateLogicalCall };
}
