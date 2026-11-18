import { Effect, Result, Schema } from "effect";
import { Modules } from "@medusajs/framework/utils/portable";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { prepareUpdateMetadata } from "@medusajs/utils/modules-sdk/prepare-update-metadata";
import { planScalarCreateBatch } from "@medusajs/utils/dal/create-planning";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { scalarLogicalEventPolicy } from "../../repository/scalar-events";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { captureCommerceInput } from "../../value/input";
import { decodeAddressRead, decodeAddressUpdate, decodeAddressCreates, decodeAddressIds } from "./address-input";
import type { prepareCustomerAddressRepository } from "./address-repository";
import { commerceDecoder } from "../../value/decoder";

type Prepared = Result.Result.Success<ReturnType<typeof prepareCustomerAddressRepository>>;
const mismatch = (phase: string) => commerceError("receiptMismatch", { phase });
const object = commerceDecoder(Schema.JsonObject, "receiptMismatch");

export function customerAddressPolicy(prepared: Prepared) {
  const base = scalarLogicalEventPolicy(Modules.CUSTOMER, prepared.table.name,
    { insert: "customerAddressesCreate", update: "customerAddressesUpdate", delete: "customerAddressesDelete" });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("CustomerAddress.validateCall")(function* (call, activity) {
    yield* base.validateLogicalCall(call, activity);
    const state = new Map<string, JsonObject & { id: string }>();
    for (const observation of activity.observedRows) {
      if (observation.table !== prepared.table.name) return yield* Effect.fail(mismatch("observed-table"));
      const row = yield* Effect.fromResult(prepared.decodeRow(projectNativeRow(observation.row)));
      if (state.has(row.id)) return yield* Effect.fail(mismatch("duplicate-observation"));
      state.set(row.id, row);
    }
    for (const mutation of activity.mutations) if (mutation.before !== null) {
      const row = yield* Effect.fromResult(prepared.decodeRow(projectNativeRow(mutation.before))); state.set(row.id, row);
    }
    if (state.size > 4 || activity.mutations.length > 4) return yield* Effect.fail(mismatch("bounds"));
    const matches = (row: JsonObject, filter: JsonObject) => Object.entries(filter).every(([name, value]) =>
      Array.isArray(value) ? value.some(item => jsonEqual(item, row[name] ?? null)) : jsonEqual(value, row[name] ?? null));
    const candidate = (row: JsonObject, filters: JsonObject) => matches(row, Object.fromEntries(Object.entries(filters).filter(([name]) => name === "id" || name === "customer_id")));
    const readPlan = (filters: JsonObject, config: JsonObject = {}) => captureCommerceInput(buildQuery(filters, config)).pipe(Result.flatMap(prepared.query));
    const reading = call.commandName === "customerAddressesList" || call.commandName === "customerAddressesCount";
    if (reading) {
      if (call.mode !== "read" || call.events.length || activity.mutations.length) return yield* Effect.fail(mismatch("read-mode"));
      const input = yield* Effect.fromResult(decodeAddressRead(call.input)), plan = yield* Effect.fromResult(readPlan(input.filters ?? {}, input.config ?? {}));
      if ([...state.values()].some(row => !candidate(row, input.filters ?? {}))) return yield* Effect.fail(mismatch("read-candidates"));
      const rows = orderNativeIdRows([...state.values()].filter(row => row.deleted_at === null && matches(row, input.filters ?? {})), input.filters ?? {});
      const output = yield* Effect.fromResult(projectRows(rows, plan.projection.node));
      const expected = call.commandName === "customerAddressesCount" ? [output, rows.length] : output;
      const read = { table: prepared.table.name, query: plan.window.kind === "catalog" ? commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate) : plan.query,
        total: rows.length, returned: rows.length };
      const reads = call.commandName === "customerAddressesCount" && plan.window.kind !== "catalog" ? [read, read] : [read];
      if (!jsonEqual(call.result, expected) || !jsonEqual(activity.relationalReads, reads)) return yield* Effect.fail(mismatch("read-result"));
      return;
    }
    if (call.mode !== "write") return yield* Effect.fail(mismatch("write-mode"));
    if (call.commandName === "customerAddressesCreate") {
      const input = yield* Effect.fromResult(decodeAddressCreates(call.input)), stored: Array<JsonObject & { id: string }> = [];
      if (!Array.isArray(call.result) || call.result.length !== input.length) return yield* Effect.fail(mismatch("create-cardinality"));
      const submitted: Array<JsonObject & { id: string }> = [];
      for (const [index, data] of input.entries()) {
        const output = yield* Effect.fromResult(prepared.decodeRow(call.result[index]));
        if (data.id !== undefined && data.id !== output.id) return yield* Effect.fail(mismatch("create-identity"));
        submitted.push({ ...data, id: output.id });
      }
      const creation = planScalarCreateBatch(submitted);
      if (activity.relationalReads.length || activity.mutations.length !== creation.entities.length) return yield* Effect.fail(mismatch("create-closure"));
      for (const [index, mutation] of activity.mutations.entries()) {
        if (mutation.after === null) return yield* Effect.fail(mismatch("create-row"));
        const row = yield* Effect.fromResult(prepared.decodeRow(projectNativeRow(mutation.after))), data = creation.entities[index];
        if (data === undefined || data.id !== undefined && data.id !== row.id || row.deleted_at !== null) return yield* Effect.fail(mismatch("create-id"));
        for (const column of prepared.table.columns) {
          if (column.name === "id" || ["created_at", "updated_at"].includes(column.name) && data[column.name] === undefined) continue;
          const expected = data[column.name] ?? column.defaultValue ?? (column.nullable ? null : undefined);
          if (expected === undefined || !jsonEqual(row[column.name] ?? null, expected)) return yield* Effect.fail(mismatch("create-fields"));
        }
        if (data.created_at === undefined && data.updated_at === undefined && row.created_at !== row.updated_at) return yield* Effect.fail(mismatch("create-clock"));
        stored.push(row);
      }
      if (!jsonEqual(call.result, creation.positions.map(position => stored[position]!))) return yield* Effect.fail(mismatch("create-result"));
      // The storage owner's two Boolean-unique checks can observe other rows
      // in the same Customer cohort before their residual flags are applied.
      // Those are complete dependency candidates, never additional mutations.
      if (stored.some(row => !jsonEqual(state.get(row.id) ?? null, row)) ||
        [...state.values()].some(row => !input.some(data => data.customer_id === row.customer_id))) return yield* Effect.fail(mismatch("create-observations"));
      return;
    }
    if (call.commandName === "customerAddressesDelete") {
      const ids = yield* Effect.fromResult(decodeAddressIds(call.input));
      if (activity.relationalReads.length || call.result !== null || state.size !== activity.mutations.length ||
        activity.mutations.some(row => row.before === null || typeof row.before.id !== "string" || !ids.includes(row.before.id)))
        return yield* Effect.fail(mismatch("delete-closure"));
      return;
    }
    if (call.commandName !== "customerAddressesUpdate") return yield* Effect.fail(mismatch("command"));
    const input = yield* Effect.fromResult(decodeAddressUpdate(call.input)), filters = typeof input.selector === "string" ? { id: input.selector } : input.selector;
    const rows = orderNativeIdRows([...state.values()].filter(row => row.deleted_at === null && matches(row, filters)), filters);
    // Mutations also inspect the two native unique indexes. Complete rows
    // outside the selector must belong to a selected Customer cohort.
    if ([...state.values()].some(row => !candidate(row, filters) && !rows.some(selected => selected.customer_id === row.customer_id)))
      return yield* Effect.fail(mismatch("update-candidates"));
    if (activity.mutations.length !== rows.length) return yield* Effect.fail(mismatch("update-cohort"));
    const selector = typeof input.selector === "string" ? { $or: [{ id: input.selector }] } : input.selector;
    const plan = yield* Effect.fromResult(readPlan(selector));
    if (!jsonEqual(activity.relationalReads, [{ table: prepared.table.name,
      query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: rows.length, returned: rows.length }])) return yield* Effect.fail(mismatch("update-reads"));
    const results = new Map<string, JsonObject>();
    for (const mutation of activity.mutations) {
      if (mutation.before === null || mutation.after === null) return yield* Effect.fail(mismatch("update-row"));
      const before = yield* Effect.fromResult(prepared.decodeRow(projectNativeRow(mutation.before))), after = yield* Effect.fromResult(prepared.decodeRow(projectNativeRow(mutation.after)));
      const patch = yield* Effect.fromResult(captureCommerceInput(input.update).pipe(Result.flatMap(object)));
      const pair = { entity: structuredClone(before), update: structuredClone(patch) };
      if (input.options?.metadata !== "replace") prepareUpdateMetadata([pair]);
      for (const [name, previous] of Object.entries(before)) {
        if (name === "updated_at") continue;
        const expected = Object.hasOwn(pair.update, name) ? pair.update[name] : previous;
        if (expected === undefined || !jsonEqual(after[name] ?? null, expected)) return yield* Effect.fail(mismatch("update-fields"));
      }
      if (results.has(after.id)) return yield* Effect.fail(mismatch("duplicate-update")); results.set(after.id, after);
    }
    const output = rows.map(row => results.get(row.id)!);
    if (!jsonEqual(call.result, typeof input.selector === "string" ? output[0] ?? null : output)) return yield* Effect.fail(mismatch("update-output"));
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture: base.capture, validateLogicalCall };
}
