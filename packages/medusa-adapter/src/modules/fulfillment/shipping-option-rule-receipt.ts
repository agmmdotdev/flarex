import { Effect, Result, Schema } from "effect";
import { validateAndNormalizeRules } from "@medusajs/fulfillment/rule-validation";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { Modules } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceEventValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { correlateScalarCreateReceipt } from "../../repository/scalar-create-receipt";
import { scalarLogicalEventPolicy } from "../../repository/scalar-events";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { nativePreimageSelection } from "../../workflow/preimage";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import type { prepareShippingOptionRuleRepository } from "./shipping-option-rule-repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareShippingOptionRuleRepository>>;
type Row = Result.Result.Success<ReturnType<Prepared["contracts"]["decodeRow"]>>;

/** One receipt binds each genuine native call to its complete observed rows,
 * physical attempts, selector projection, result and ordered module messages.
 * Reused native normalization remains the business authority. */
export function shippingOptionRulePolicy(prepared: Prepared) {
  const maximum = prepared.inputs.maximum;
  const decodeRead = prepared.inputs.decodeRead;
  const decodeCreates = prepared.inputs.decodeCreates, decodeUpdates = prepared.inputs.decodeUpdates, decodeIds = prepared.inputs.decodeIds;
  const decodeOrderedIdentities = commerceDecoder(Schema.Array(Schema.Struct({ id: Schema.String })).check(Schema.isMaxLength(maximum)), "receiptMismatch");
  const { capture } = scalarLogicalEventPolicy(Modules.FULFILLMENT, "shipping_option_rule", {
    insert: "shippingOptionRuleCreateForBatch", update: "shippingOptionRuleUpdateForBatch", delete: "shippingOptionRuleDeleteForBatch" });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ShippingOptionRule.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    const decodeRow = (value: JsonObject) => Effect.fromResult(prepared.contracts.decodeRow(projectNativeRow(value)))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const initial = new Map<string, Row>(), observations: Row[] = [];
    for (const observation of activity.observedRows) {
      if (observation.table !== prepared.contracts.table.name) return yield* Effect.fail(mismatch());
      const row = yield* decodeRow(observation.row);
      observations.push(row); if (!initial.has(row.id)) initial.set(row.id, row);
    }
    const first = new Set<string>();
    const mutations: Array<{ operation: string; before: Row | null; after: Row | null }> = [];
    for (const [ordinal, mutation] of activity.mutations.entries()) {
      if (mutation.ordinal !== ordinal || mutation.table !== prepared.contracts.table.name ||
        !["insert", "patch", "delete"].includes(mutation.operation)) return yield* Effect.fail(mismatch());
      const before = mutation.before === null ? null : yield* decodeRow(mutation.before);
      const after = mutation.after === null ? null : yield* decodeRow(mutation.after);
      const id = after?.id ?? before?.id;
      if (id === undefined || mutation.operation === "insert" && (before !== null || after === null) ||
        mutation.operation === "patch" && (before === null || after === null || before.id !== after.id) ||
        mutation.operation === "delete" && (before === null || after !== null)) return yield* Effect.fail(mismatch());
      if (!first.has(id)) { if (before === null) initial.delete(id); else initial.set(id, before); first.add(id); }
      mutations.push({ operation: mutation.operation, before, after });
    }
    if (initial.size > maximum || observations.some(row => !jsonEqual(initial.get(row.id) ?? null, row) &&
      !mutations.some(mutation => jsonEqual(mutation.before, row) || jsonEqual(mutation.after, row))))
      return yield* Effect.fail(mismatch());
    const read = (predicate: Parameters<typeof commerceRelationReadQuery>[1], count: number) => ({ table: prepared.contracts.table.name,
      query: commerceRelationReadQuery(defaultCommerceResources, predicate), total: count, returned: count });
    const active = [...initial.values()].filter(row => row.deleted_at === null);
    if (call.commandName === "shippingOptionRuleListForBatch") {
      if (call.mode !== "read" || mutations.length || call.events.length) return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult(decodeRead(call.input));
      const filters: JsonObject = input.filters;
      if ([...initial.values()].some(row => Object.entries(filters).some(([field, value]) =>
        Array.isArray(value) ? !value.includes(row[field] ?? null) : row[field] !== value))) return yield* Effect.fail(mismatch());
      const config = nativePreimageSelection(input.config ?? {}, prepared);
      const query = yield* Effect.fromResult(captureCommerceInput(buildQuery(input.filters, {
        ...(config.select === undefined ? {} : { select: [...config.select] }),
        ...(config.relations === undefined ? {} : { relations: [...config.relations] }),
      })).pipe(Result.flatMap(prepared.query))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const expected = yield* Effect.fromResult(projectRows(orderNativeIdRows(active, buildQuery(input.filters).where), query.projection.node));
      if (!jsonEqual(activity.relationalReads, [read(query.query.predicate, active.length)]) ||
        !jsonEqual(yield* Effect.fromResult(prepared.contracts.decodePreimages(call.result)), expected)) return yield* Effect.fail(mismatch());
      return;
    }
    if (call.mode !== "write") return yield* Effect.fail(mismatch());
    const expectedEvents: Array<{ id: string; action: "created" | "updated" | "deleted" }> = [];
    if (call.commandName === "shippingOptionRuleCreateForBatch") {
      const inputs = structuredClone(yield* Effect.fromResult(decodeCreates(call.input)));
      // This foreign call only runs the genuine synchronous native validator on
      // detached checked JSON; any native refusal means no successful receipt.
      // SAFETY: the native helper's Rule alias omits runtime boolean/number and
      // opaque JSON values. These are captured JSON and native validation owns
      // their acceptance; the cast does not bypass that executing validator.
      yield* Effect.try({ try: () => validateAndNormalizeRules(inputs as Parameters<typeof validateAndNormalizeRules>[0]), catch: cause => commerceError("receiptMismatch", cause) });
      const output = yield* Effect.fromResult(prepared.contracts.decodeCreatedRows(call.result));
      const cohort = yield* Effect.fromResult(correlateScalarCreateReceipt(inputs, output));
      if (initial.size || activity.relationalReads.length || cohort.inputs.length !== mutations.length)
        return yield* Effect.fail(mismatch());
      for (const [index, input] of cohort.inputs.entries()) {
        const mutation = mutations[index], after = mutation?.after;
        if (mutation?.operation !== "insert" || after === null || after === undefined || after.deleted_at !== null ||
          !jsonEqual(cohort.results[index] ?? null, after)) return yield* Effect.fail(mismatch());
        const createdAt = after.created_at, updatedAt = after.updated_at;
        if (typeof createdAt !== "string" || typeof updatedAt !== "string" ||
          ("created_at" in input ? createdAt !== input.created_at : createdAt !== updatedAt)) return yield* Effect.fail(mismatch());
        const expected = { ...input, id: after.id, created_at: createdAt, updated_at: updatedAt, deleted_at: null };
        if (input.id !== undefined && input.id !== after.id || !jsonEqual(after, expected)) return yield* Effect.fail(mismatch());
        expectedEvents.push({ id: after.id, action: "created" });
      }
    } else if (call.commandName === "shippingOptionRuleUpdateForBatch") {
      const inputs = structuredClone(yield* Effect.fromResult(decodeUpdates(call.input)));
      // SAFETY: same checked native wider runtime boundary as creation above.
      yield* Effect.try({ try: () => validateAndNormalizeRules(inputs as Parameters<typeof validateAndNormalizeRules>[0]), catch: cause => commerceError("receiptMismatch", cause) });
      const byId = new Map(inputs.map(row => [row.id, row]));
      const selected = orderNativeIdRows(active.filter(row => byId.has(row.id)), { $or: inputs.map(row => ({ id: row.id })) });
      const query = yield* Effect.fromResult(captureCommerceInput(buildQuery({ $or: inputs.map(row => ({ id: row.id })) })).pipe(Result.flatMap(prepared.query)));
      if (selected.length !== byId.size || initial.size !== selected.length || mutations.length !== selected.length ||
        !jsonEqual(activity.relationalReads, inputs.length ? [read(query.query.predicate, selected.length)] : [])) return yield* Effect.fail(mismatch());
      const expected: Row[] = [];
      for (const [index, before] of selected.entries()) {
        const mutation = mutations[index], after = mutation?.after;
        if (mutation?.operation !== "patch" || after === null || after === undefined || !jsonEqual(mutation.before, before))
          return yield* Effect.fail(mismatch());
        const updatedAt = after.updated_at;
        if (typeof updatedAt !== "string" || !jsonEqual(after, { ...before, ...byId.get(before.id), updated_at: updatedAt }))
          return yield* Effect.fail(mismatch());
        expected.push(after); expectedEvents.push({ id: after.id, action: "updated" });
      }
      if (!jsonEqual(yield* Effect.fromResult(prepared.contracts.decodeRows(call.result)), expected)) return yield* Effect.fail(mismatch());
    } else if (call.commandName === "shippingOptionRuleDeleteForBatch") {
      const ids = yield* Effect.fromResult(decodeIds(call.input));
      const identities = ids.length ? yield* Effect.fromResult(decodeOrderedIdentities(activity.relationalReads[0]?.orderedIdentities)) : [];
      if (identities.length !== initial.size || new Set(identities.map(row => row.id)).size !== identities.length ||
        identities.some(row => !initial.has(row.id))) return yield* Effect.fail(mismatch());
      if (call.result !== null || [...initial.keys()].some(id => !ids.includes(id)) || initial.size !== mutations.length ||
        !jsonEqual(activity.relationalReads, ids.length ? [{ table: prepared.contracts.table.name,
          query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: ids },
            { kind: "storageInsertion", direction: "asc" }), total: initial.size, returned: initial.size, orderedIdentities: identities }] : []))
        return yield* Effect.fail(mismatch());
      const pending = new Set(initial.keys());
      for (const [index, mutation] of mutations.entries()) {
        const before = mutation.before;
        if (mutation.operation !== "delete" || before === null || identities[index]?.id !== before.id || !pending.delete(before.id))
          return yield* Effect.fail(mismatch());
        const original = initial.get(before.id);
        if (original === undefined || !jsonEqual(original, before)) return yield* Effect.fail(mismatch());
        expectedEvents.push({ id: before.id, action: "deleted" });
      }
      if (pending.size) return yield* Effect.fail(mismatch());
    } else return yield* Effect.fail(mismatch());
    let ordinal = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        const expected = expectedEvents[ordinal++];
        if (expected === undefined || expected.id !== id || expected.action !== message.metadata.action) return yield* Effect.fail(mismatch());
      }
    }
    if (ordinal !== expectedEvents.length) return yield* Effect.fail(mismatch());
  }, Effect.mapError(cause => commerceError("receiptMismatch", cause)));
  const validateLogical: LogicalCommerceEventValidation = Effect.fn("ShippingOptionRule.validateCohort")(function* (calls, mutations, _lifecycle, observedRows) {
    const rules = new Set<string>(), parents = new Set<string>();
    const record = (row: JsonObject | null) => {
      if (row === null) return;
      if (typeof row.id === "string") rules.add(row.id);
      if (typeof row.shipping_option_id === "string") parents.add(row.shipping_option_id);
    };
    for (const mutation of mutations) { record(mutation.before); record(mutation.after); }
    // Closure includes core-owned required-FK observations outside the Rule
    // command slices. They retain core dependency authority; their parent IDs
    // are not Rule identities or additional selected Rule-parent references.
    for (const observation of observedRows)
      if (observation.table === prepared.contracts.table.name) record(observation.row);
    for (const call of calls) {
      if (call.commandName === "shippingOptionRuleDeleteForBatch")
        for (const id of yield* Effect.fromResult(decodeIds(call.input))) rules.add(id);
    }
    if (rules.size > (prepared.inputs.profile === "batch" ? 12 : 32) || parents.size > 4) return yield* Effect.fail(commerceError("limitExceeded"));
  });
  return { capture, validateLogicalCall, validateLogical, allowStorageInsertionOrder: true as const };
}
